import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const output=process.argv[2]??'artifacts/next-set';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.FITPAL_CHROME,args:['--disable-webgl','--disable-gpu','--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.addInitScript(()=>{
  navigator.mediaDevices.getUserMedia=async()=>{
   const source=document.createElement('video');source.src='/showcase/go4it-rear.mp4';source.muted=true;source.loop=true;source.playbackRate=.5;
   await source.play();return source.captureStream();
  };
 });
 await page.goto(process.env.FITPAL_URL??'http://127.0.0.1:4173');
 await page.locator('.training-settings summary').click();
 await page.getByLabel('计划组数').fill('3');await page.getByLabel('每组目标次数').fill('10');
 await page.getByRole('button',{name:'开始',exact:true}).click();
 const targets=[10,8,6],focuses=['range','coordination','tempo'];const appearance=[];
 for(let set=1;set<=3;set++){
  await page.locator('.live-panel-heading h2').filter({hasText:'第 '+set+' 组'}).waitFor({timeout:120000});
  assert((await page.locator('.plan-current').innerText()).includes(`第 ${set} / 3 组 · 目标 ${targets[set-1]} 次`));
  await page.waitForFunction(()=>Number(document.querySelector('.count-now')?.textContent)>=1,null,{timeout:60000});
  await page.getByRole('button',{name:'结束这一组',exact:true}).click();
  await page.getByRole('region',{name:'本组训练趋势'}).waitFor();
  await page.waitForFunction(n=>JSON.parse(localStorage.getItem('fitpal.history.v3')??'[]')[0]?.sets.length===n,set);
  if(set<3){
   assert.equal(await page.locator('.reward dt').nth(1).innerText(),'至少 8 下达到目标幅度，且占八成');
   assert.equal(await page.locator('.reward dt').nth(2).innerText(),'改掉上一组的问题');
   const settings=page.getByRole('region',{name:'下一组设置'});await settings.waitFor();
   assert((await settings.innerText()).includes(`第 ${set+1} 组`));
   assert((await settings.innerText()).includes('高位下拉'));assert(!(await settings.innerText()).includes('3 组 ×'));
   assert.equal(await settings.locator('details').count(),0);assert.equal(await settings.getByLabel('计划组数').count(),0);
   const target=page.getByLabel('下一组目标次数');await target.focus();await target.press('ControlOrMeta+A');await target.press('Backspace');assert.equal(await target.inputValue(),'');await target.pressSequentially(String(targets[set]));await target.press('Tab');await settings.getByLabel('观察重点').selectOption(focuses[set]);
   if(set===2){const seconds=settings.getByLabel('下一组还原目标');await seconds.focus();await seconds.press('ControlOrMeta+A');await seconds.press('Backspace');await seconds.pressSequentially('0.5');await seconds.press('Tab');assert.equal(await seconds.inputValue(),'0.5');}
   const css=await page.evaluate(()=>({rewardFont:getComputedStyle(document.querySelector('.reward > div')).fontSize,nextFont:getComputedStyle(document.querySelector('.next-set-settings > div')).fontSize,rewardRule:getComputedStyle(document.querySelector('.reward > div + div')).borderTop,nextRule:getComputedStyle(document.querySelector('.next-set-settings > div + div')).borderTop,nextBackground:getComputedStyle(document.querySelector('.next-set-settings')).backgroundColor}));
   assert.equal(css.rewardFont,css.nextFont);assert.equal(css.rewardRule,css.nextRule);assert.equal(css.nextBackground,'rgba(0, 0, 0, 0)');appearance.push(css);
   await page.locator('.panel').screenshot({path:`${output}/rest-before-set-${set+1}.png`});
   if(set===1){await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('.panel').screenshot({path:output+'/rest-mobile.png'});await page.setViewportSize({width:1440,height:1000});}
   await page.getByRole('button',{name:`开始第 ${set+1} 组`,exact:true}).click();
  }
 }
 assert.equal(await page.getByRole('region',{name:'下一组设置'}).count(),0);
 const history=await page.evaluate(()=>JSON.parse(localStorage.getItem('fitpal.history.v3')));
 assert.deepEqual(history[0].sets.map(s=>s.plan.reps),targets);assert.deepEqual(history[0].sets.map(s=>s.plan.focus),focuses);assert.equal(history[0].sets[2].plan.returnSeconds,.5);
 assert.deepEqual(errors,[]);await writeFile(output+'/results.json',JSON.stringify({scenario:'three camera-stream sets with separate targets',targets,focuses,history,appearance,errors},null,2));
 console.log('PASS: next set2/3, editable targets10/8/6, saved plans, original row styling and mobile width');
}catch(e){await page.screenshot({path:output+'/failure.png',fullPage:true}).catch(()=>{});throw e;}finally{await browser.close();}
