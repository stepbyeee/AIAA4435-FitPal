import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// Run against a Vite development server; grouped outputs use expanded-{index % 4}/.
const [manifestPath,artifactRoot,outputPath]=process.argv.slice(2);
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const browser=await chromium.launch({executablePath:process.env.FITPAL_CHROME,args:['--disable-gpu']});
const sourceHashes=Object.fromEntries(await Promise.all(['perception/pulldown.ts','perception/pulldownUpperArm.ts','perception/pulldownForm.ts','perception/squat.ts','tracking/armLandmarks.ts'].map(async path=>[path,createHash('sha256').update(await readFile('src/'+path)).digest('hex')])));
const rows=[];
try{
 const page=await browser.newPage();await page.route('**/__audit__',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Counter frame audit</title>'}));await page.goto((process.env.FITPAL_URL??'http://127.0.0.1:5190')+'/__audit__');
 for(const c of manifest){
  const group=c.index%4,dir=artifactRoot+'/expanded-'+group;
  const original=JSON.parse(await readFile(dir+'/results.json','utf8')).results.find(r=>r.index===c.index);
  assert(original&&!original.errors.length,'Complete successful execution required before counter audit: '+c.file);
  const frames=JSON.parse(await readFile(dir+'/'+c.index+'/frames.json','utf8'));
  const audit=await page.evaluate(async({frames,exercise})=>{
   const {createPulldown}=await import('/src/perception/pulldown.ts');const {createSquat}=await import('/src/perception/squat.ts');
   const create=c=>exercise==='squat'?createSquat(c):createPulldown(c,{assessForm:true});
   let engine=create(),calibration=null,calibrationEndSec=null,previous=0,calCount=0,calVisible=0,calFrames=0;const calibrationEvents=[],events=[];
   for(const f of frames){
    const state=engine.accept(f);
    if(!calibration){
     calFrames++;if(state.visible)calVisible++;
     if(state.repCount>calCount)calibrationEvents.push(f.timestampMs/1000);calCount=state.repCount;
     const found=engine.getCalibration();
     if(found){calibration=found;calibrationEndSec=f.timestampMs/1000;engine=create(found);engine.accept(f);}
    }else{
     while(previous<state.repCount){events.push(f.timestampMs/1000);previous++;}
    }
   }
   return {calibration,calibrationEndSec,calibrationEvents,calibrationCycles:calCount,calibrationVisibleFraction:calFrames?calVisible/calFrames:0,formalEvents:events,verified:events.length};
  },{frames,exercise:c.exercise});
  assert.equal(Boolean(audit.calibration),original.calibrated,'Calibration must reproduce actual UI');
  assert.equal(audit.verified,original.verified,'Counter must reproduce actual UI');
  let countCheck=null;
  if(c.windows!==null){const remaining=[...audit.formalEvents],matches=[],misses=[];for(const window of c.windows.slice(3)){const i=remaining.findIndex(t=>t>=window[0]&&t<=window[1]+.35);if(i<0)misses.push(window);else matches.push({window,event:remaining.splice(i,1)[0]});}countCheck={expected:c.windows.slice(3).length,matched:matches.length,missed:misses.length,unmatched:remaining.length,matches,misses,unmatchedTimes:remaining};}
  rows.push({index:c.index,file:c.file,...audit,countCheck});console.log(JSON.stringify({file:c.file,calibrationEndSec:audit.calibrationEndSec,calibrationCycles:audit.calibrationCycles,countCheck}));
  await writeFile(outputPath,JSON.stringify({sourceHashes,method:'Replay the actual application-captured pose frames through the unchanged counter, preserving the calibration anchor. Assert identical UI counts before matching source completion timestamps to reference windows. No pose rerun or threshold changes.',results:rows},null,2));
 }
}finally{await browser.close();}
