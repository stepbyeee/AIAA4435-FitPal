// Run against a local preview with the bundled demo clips; no real camera is opened.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
const output = resolve(process.argv[2] ?? 'artifacts/training-experience') + '/';
await mkdir(output, { recursive: true });
const cpuOnly=process.env.FITPAL_CPU_ONLY==='1';
const scenario=process.env.FITPAL_SCENARIO ?? 'all';
const replaySource=process.env.FITPAL_REPLAY_SOURCE ?? 'upload';
assert(['upload','bundled'].includes(replaySource),'Unknown replay source');
assert(['all','lat-pulldown','squat','camera'].includes(scenario),'Unknown scenario');
const browser = await chromium.launch({ executablePath:process.env.FITPAL_CHROME, args:['--autoplay-policy=no-user-gesture-required', ...(cpuOnly ? ['--disable-webgl','--disable-gpu'] : [])] });
const context = await browser.newContext({ viewport:{width:1440,height:1000}, acceptDownloads:true, reducedMotion:'reduce' });
const page = await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const origin=new URL(process.env.FITPAL_URL ?? 'http://127.0.0.1:4173').origin;
const reports=[];
try {
 await page.goto(origin);
 await page.locator('.training-settings summary').click();
 await page.getByLabel('计划组数').fill('4');
 await page.getByLabel('每组目标次数').fill('12');
 await page.getByLabel('观察重点').selectOption('tempo');
 await page.getByLabel('自选还原目标').fill('2.5');
 await page.getByLabel('负重').fill('35');
 await page.screenshot({path:output+'experience-home.png',fullPage:true});
 await page.getByRole('button',{name:'开始',exact:true}).scrollIntoViewIfNeeded();
 const startHit=await page.getByRole('button',{name:'开始',exact:true}).evaluate(b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
 assert(startHit,'Start button must not be covered by the exercise list');
 await page.reload();
 await page.locator('.training-settings summary').click();
 assert.equal(await page.getByLabel('计划组数').inputValue(),'4');
 assert.equal(await page.getByLabel('自选还原目标').inputValue(),'2.5');
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:output+'experience-home-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 for(const [clip,exercise,expected] of [['go4it-rear','lat-pulldown',4],['goblet-squat','squat',2]].filter(([,exercise])=>scenario==='all'||scenario===exercise)) {
  if(replaySource==='upload'){
   await page.goto(origin);
   await page.getByText('录像回放',{exact:true}).click();
   await page.getByLabel('录像中的动作').selectOption(exercise);
   await page.locator('input[type=file]').setInputFiles(resolve('public/showcase',clip+'.mp4'));
   await page.waitForURL('**/#/review/'+exercise);
  }else await page.goto(origin+'/?video='+clip+'#/session/'+exercise);
  await page.getByRole('button',{name:'画中分析',exact:true}).click();
  await page.locator('.live-panel-heading h2').filter({hasText:'第 1 组'}).waitFor({timeout:300000});
  assert(await page.getByRole('group',{name:'选择要回顾的动作'}).count()===0);
  await page.getByLabel('录像分析进度').waitFor();
  await page.waitForFunction(()=>Number(document.querySelector('.count-now')?.textContent)>=1,null,{timeout:180000});
  await page.screenshot({path:output+'experience-'+exercise+'-live.png',fullPage:true});
  await page.locator('.panel').screenshot({path:output+'experience-'+exercise+'-progress.png'});
  await page.getByRole('button',{name:'暂停分析',exact:true}).click();
  const heldTime=await page.locator('video.stage-video').evaluate(v=>v.currentTime);
  await page.locator('.camera-stats .continuous-trend .trend-caption').filter({hasText:'等待清晰画面'}).first().waitFor();
  assert.equal(await page.locator('.camera-stats .continuous-trend .trend-current').first().innerText(),'—');
  await page.waitForTimeout(500);
  const pausedTime=await page.locator('video.stage-video').evaluate(v=>v.currentTime);
  assert(Math.abs(pausedTime-heldTime)<0.00001,'Pause must hold the source position (allow decoder microsecond rounding)');
  await page.getByRole('button',{name:'继续分析',exact:true}).click();
  await page.getByRole('region',{name:'本组训练趋势'}).waitFor({timeout:300000});
  const choices=page.getByRole('group',{name:'选择要回顾的动作'}).getByRole('button');
  assert.equal(await choices.count(),expected);
  await choices.first().click();
  await page.locator('.rep-review').screenshot({path:output+'experience-'+exercise+'-entries.png'});
  await page.locator('.review-choices').screenshot({path:output+'experience-'+exercise+'-choices.png'});
  await page.getByRole('region',{name:'录像证据'}).waitFor();
  await page.getByRole('button',{name:'查看最低点',exact:true}).click();
  const at=await page.locator('.source-review video').evaluate(v=>v.currentTime);
  assert(at>0);
  const counts=await choices.count();
  await page.getByLabel('回顾时间').fill('0');
  assert.equal(await choices.count(),counts);
  for(const name of ['每一下的节奏稳定吗？','这组哪里可以改进？','怎么确认有进步？','下一组先做什么？']) {
   await page.getByRole('button',{name,exact:true}).click();
   assert((await page.locator('.coach-answer').innerText()).length>10);
  }
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出本次训练报告',exact:true}).click();
  const download=await downloadPromise;
  const report=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.equal(report.source,'video-replay');
  assert.equal(report.sets[0].plan.returnSeconds,2.5);
  assert.equal(report.sets[0].result.exp.verifiedReps,expected);
  assert(report.sets[0].motion.summary.measuredReps>0);
  assert.equal(report.sets[0].reps.length,expected);
  if(exercise==='lat-pulldown'){
   const windows=[[18.95,23.35],[25.05,29.05],[30.4,34.05],[35.85,39.55]];
   report.sets[0].motion.reps.forEach((rep,i)=>{
    assert.notEqual(rep.sourceStartMs,null);
    const midpoint=(rep.sourceStartMs+rep.durationMs/2)/1000;
    assert(midpoint>=windows[i][0]&&midpoint<=windows[i][1],`Rep ${i+1} must match its independently labelled source window`);
   });
  }
  assert.equal(await page.evaluate(()=>localStorage.getItem('fitpal.history.v3')),null);
  await writeFile(output+'experience-'+exercise+'-report.json',JSON.stringify(report,null,2));
  await page.locator('.stage').evaluate(e=>e.style.height='auto');
  await page.screenshot({path:output+'experience-'+exercise+'-review.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:output+'experience-'+exercise+'-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  reports.push({exercise,attempts:counts,metrics:report.sets[0].motion.summary});
  console.log(JSON.stringify(reports.at(-1)));
 }
 await page.goto(origin+'/#/history');
 await page.evaluate(()=>localStorage.setItem('fitpal.history.v3',JSON.stringify([{id:'fixture',date:'2026-11-25',exerciseId:'lat-pulldown',sets:[{verified:4,quality:0,fixed:0,plan:{sets:3,reps:10,focus:'tempo',returnSeconds:2.5,loadKg:35},motion:{measuredReps:4,medianDurationMs:3400,medianReturnMs:2600,returnVariation:.05,medianRange:.98,pairedReps:2,medianLagMs:25,coverage:.97,view:null}}]}])));
 await page.reload();
 await page.getByRole('region',{name:'训练趋势'}).waitFor();
 assert((await page.locator('.history-metrics').innerText()).includes('2.60 s'));
 await page.screenshot({path:output+'experience-history.png',fullPage:true});
 if(scenario==='all'||scenario==='camera'){
 const cameraContext=await browser.newContext({viewport:{width:1280,height:900}});
 const camera=await cameraContext.newPage();
 camera.on('pageerror',e=>errors.push(e.message));
 await camera.addInitScript(()=>{
  const write=Storage.prototype.setItem;
  window.failTrainingSave=false;
  Storage.prototype.setItem=function(key,value){if(key==='fitpal.history.v3' && window.failTrainingSave)throw new DOMException('Simulated full storage','QuotaExceededError');return write.call(this,key,value);};
  navigator.mediaDevices.getUserMedia=async()=>{
   const source=document.createElement('video');source.src='/showcase/go4it-rear.mp4';source.muted=true;source.loop=true;source.playbackRate=.5;
   window.simulatedCamera=source;await source.play();return source.captureStream();
  };
 });
 await camera.goto(origin);
 await camera.locator('.training-settings summary').click();
 await camera.getByLabel('计划组数').fill('2');
 await camera.getByLabel('每组目标次数').fill('1');
 await camera.getByLabel('观察重点').selectOption('tempo');
 await camera.getByRole('button',{name:'开始',exact:true}).click();
 for(let set=1;set<=2;set++){
  await camera.locator('.live-panel-heading h2').filter({hasText:'第 '+set+' 组'}).waitFor({timeout:65000});
  await camera.waitForFunction(()=>Number(document.querySelector('.count-now')?.textContent)>=1,null,{timeout:35000});
  if(set===2)await camera.evaluate(()=>window.failTrainingSave=true);
  await camera.getByRole('button',{name:'结束这一组',exact:true}).click();
  await camera.getByRole('region',{name:'本组训练趋势'}).waitFor();
  if(set===1){
   await camera.waitForFunction(()=>JSON.parse(localStorage.getItem('fitpal.history.v3')??'[]')[0]?.sets.length===1);
   await camera.getByLabel('观察重点').selectOption('coordination');
   await camera.getByRole('button',{name:'开始第 2 组',exact:true}).click();
  }
 }
 await camera.getByRole('alert').filter({hasText:'本组记录未保存'}).waitFor();
 assert.equal(await camera.getByText('已关闭本地记录。EXP 仅作本组预览。',{exact:true}).count(),0);
 await camera.evaluate(()=>window.failTrainingSave=false);
 await camera.getByRole('button',{name:'重试保存记录',exact:true}).click();
 await camera.waitForFunction(()=>JSON.parse(localStorage.getItem('fitpal.history.v3')??'[]')[0]?.sets.length===2);
 const saved=await camera.evaluate(()=>JSON.parse(localStorage.getItem('fitpal.history.v3')));
 assert.deepEqual(saved[0].sets.map(s=>s.plan.focus),['tempo','coordination']);
 assert(saved[0].sets.every(s=>s.motion && s.verified>=1));
 await camera.screenshot({path:output+'experience-camera-settlement.png',fullPage:true});
 reports.push({scenario:'simulated-camera-plan-and-storage-retry',sets:saved[0].sets});
 console.log(JSON.stringify(reports.at(-1)));
 await cameraContext.close();
 }
 assert.deepEqual(errors,[]);
} catch(error) {
 errors.push(String(error));
 await page.screenshot({path:output+'experience-failure.png',fullPage:true}).catch(()=>{});
 throw error;
} finally {await writeFile(output+'experience-check.json',JSON.stringify({browser:browser.version(),cpuOnly,scenario,replaySource,analysisMode:'source-15hz',reports,errors},null,2));await browser.close();}
