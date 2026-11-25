// Real-file app evaluation. MANIFEST is a prepared clip array; media stay outside the public app.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const [manifestPath,mediaPath,outputPath]=process.argv.slice(2);
const clips=JSON.parse(await readFile(manifestPath,'utf8')),media=resolve(mediaPath),output=resolve(outputPath);
await mkdir(output,{recursive:true});
const origin=process.env.FITPAL_URL??'http://127.0.0.1:5190';
const browser=await chromium.launch({executablePath:process.env.FITPAL_CHROME,args:['--disable-webgl','--disable-gpu','--autoplay-policy=no-user-gesture-required']});
const sourceHashes=Object.fromEntries(await Promise.all(['tracking/poseTracker.ts','tracking/recordedFrames.ts','perception/pulldown.ts','perception/squat.ts','analytics/motion.ts','screens/Session.tsx'].map(async path=>[path,createHash('sha256').update(await readFile('src/'+path)).digest('hex')])));
const results=[];
try{
 for(const clip of clips){
  const started=Date.now(),dir=output+'/'+clip.index;await mkdir(dir,{recursive:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});const page=await context.newPage();
  const faults=[];page.on('pageerror',e=>faults.push(e.message));
  const record={index:clip.index,file:clip.file,exercise:clip.exercise,control:Boolean(clip.control),preparedSha256:clip.preparedSha256,referenceWindows:clip.windows,errors:[]};
  try{
   await page.addInitScript(()=>{window.fpSamples=[];});
   await page.route('**/src/tracking/poseTracker.ts*',async route=>{
    const response=await route.fetch();let body=await response.text();assert(body.includes('onFrame({'),'Frame audit anchor absent');
    body=body.replace('onFrame({','((frame) => { window.fpSamples.push(frame); onFrame(frame); })({');
    await route.fulfill({response,body});
   });
   await page.goto(origin);
   await page.getByText('录像回放',{exact:true}).click();
   await page.getByLabel('录像中的动作').selectOption(clip.exercise);
   await page.locator('input[type=file]').setInputFiles(media+'/'+clip.preparedFile);
   await page.getByRole('button',{name:'画中分析',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.set-review-stage')||document.body.innerText.includes('录像已结束。校准需要')||document.body.innerText.includes('姿态模型未能启动。'),null,{timeout:360000});
   const frames=await page.evaluate(()=>window.fpSamples);
   await writeFile(dir+'/frames.json',JSON.stringify(frames));
   record.frames=frames.length;
   record.sourceSpanMs=frames.length?[frames[0].timestampMs,frames.at(-1).timestampMs]:null;
   record.maxSourceGapMs=Math.max(0,...frames.slice(1).map((f,i)=>f.timestampMs-frames[i].timestampMs));
   assert(frames.length>0,'No video frames processed');
   assert(record.maxSourceGapMs<67,'Scheduled source samples must not be skipped');
   record.terminalMessage=await page.locator('.panel').innerText();
   assert(!record.terminalMessage.includes('姿态模型未能启动。'),'Pose analysis failed; this is a runtime error, not a recognition miss');
   const calibrated=await page.locator('.set-review-stage').count()>0;record.calibrated=calibrated;
   let report=null;
   if(calibrated){
    const choices=page.getByRole('group',{name:'选择要回顾的动作'}).getByRole('button');record.reviewEntries=await choices.count();
    for(const name of ['我的节奏怎么样？','左右配合说明了什么？','为什么得到这些 EXP？','下一组先做什么？']){
     await page.getByRole('button',{name,exact:true}).click();assert((await page.locator('.coach-answer').innerText()).length>10);
    }
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出本次训练报告',exact:true}).click();
    report=JSON.parse(await readFile(await (await download).path(),'utf8'));await writeFile(dir+'/report.json',JSON.stringify(report,null,2));
    const set=report.sets[0];assert.equal(set.reps.length,record.reviewEntries);assert.equal(report.source,'video-replay');
    const verified=set.reps.filter(r=>r.status==='verified').length;assert.equal(verified,set.result.exp.verifiedReps);
    record.verified=verified;record.metrics=set.motion.summary;record.repetitions=set.motion.reps;record.exp=set.result.exp;record.cue=set.result.cue;
    for(const m of set.motion.reps){
     for(const key of ['durationMs','outboundMs','returnMs','bottomHoldMs'])assert(m[key]===null||Number.isFinite(m[key])&&m[key]>=0,`Invalid ${key}`);
     if(m.verified){assert(m.returnMs!==null&&m.outboundMs!==null);assert(Math.abs(m.returnMs+m.outboundMs-m.durationMs)<1);}
     if(m.bilateralLagMs!==null){assert(m.verified);assert.equal(m.pairedCoverage,1);}
     if(m.sourceStartMs!==null)assert(m.sourceStartMs+m.durationMs<=frames.at(-1).timestampMs+67,'Repetition outside source');
    }
    const sourceIndex=set.motion.reps.findIndex(r=>r.sourceStartMs!==null);
    if(sourceIndex>=0){
     await choices.nth(sourceIndex).click();await page.getByRole('region',{name:'录像证据'}).waitFor();
     const range=page.getByLabel('回顾时间');await range.fill('0');
     const sourceBefore=await page.locator('.source-review video').evaluate(v=>v.currentTime);
     if(await page.getByRole('button',{name:'查看最低点',exact:true}).count()){
      await page.getByRole('button',{name:'查看最低点',exact:true}).click();
      assert(await page.locator('.source-review video').evaluate(v=>v.currentTime)>=sourceBefore);
     }
     assert.equal(await choices.count(),record.reviewEntries);record.sourceReviewChecked=true;
    }else if(record.reviewEntries){
     await choices.first().click();assert.equal(await page.getByRole('region',{name:'录像证据'}).count(),0);
     assert((await page.locator('.rep-review').innerText()).includes('腕部证据不足'));record.sourceReviewChecked=false;record.sourceReviewUnavailable='count-only, no retained source trace';
    }
   }else{record.verified=0;record.reviewEntries=0;record.metrics=null;record.repetitions=[];}
   const events=(record.repetitions??[]).filter((r,i)=>report.sets[0].reps[i].status==='verified'&&r.sourceStartMs!==null).map(r=>(r.sourceStartMs+r.durationMs)/1000);
   record.unlocatedVerified=record.verified-events.length;
   if(clip.windows!==null){
    const reference=clip.windows.slice(3),remaining=[...events],matches=[],misses=[];
    for(const [bottom,top] of reference){const i=remaining.findIndex(t=>t>=bottom&&t<=top+.35);if(i<0)misses.push([bottom,top]);else matches.push({window:[bottom,top],event:remaining.splice(i,1)[0]});}
    record.countCheck={expected:reference.length,matched:matches.length,missed:misses.length,extra:remaining.length+record.unlocatedVerified,matches,misses,extraTimes:remaining};
   }else record.countCheck=null;
   assert.equal(await page.evaluate(()=>localStorage.getItem('fitpal.history.v3')),null,'Replay cannot award persistent progress');
   await page.locator('.panel').screenshot({path:dir+'/outcome.png'});
   await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   record.uiChecksPassed=true;assert.deepEqual(faults,[]);
  }catch(error){record.errors.push(String(error));await page.screenshot({path:dir+'/failure.png',fullPage:true}).catch(()=>{});}
  record.pageErrors=faults;record.elapsedSeconds=(Date.now()-started)/1000;results.push(record);
  await writeFile(output+'/results.json',JSON.stringify({sourceHashes,browser:browser.version(),mode:'source-15hz-cpu',referenceCaveat:'Existing project single-review/agent source windows; not independent human ground truth.',results},null,2));
  console.log(JSON.stringify({file:record.file,calibrated:record.calibrated,verified:record.verified,count:record.countCheck,metrics:record.metrics,errors:record.errors}));await context.close();
 }
}finally{await browser.close();}
if(results.some(r=>r.errors.length))process.exitCode=1;
