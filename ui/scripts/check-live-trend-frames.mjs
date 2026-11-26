// Reuse actual application-captured poses; this is a display regression, not a new pose run.
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const [manifestPath,artifactRoot,baselinePath,outputPath]=process.argv.slice(2);
const clips=JSON.parse(await readFile(manifestPath,'utf8')),baseline=JSON.parse(await readFile(baselinePath,'utf8'));
const browser=await chromium.launch({executablePath:process.env.FITPAL_CHROME,args:['--disable-gpu']});
const results=[];
try{
 const page=await browser.newPage();await page.route('**/__trend_audit__',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Display audit</title>'}));await page.goto((process.env.FITPAL_URL??'http://127.0.0.1:5190')+'/__trend_audit__');
 for(const clip of clips){
  const frames=JSON.parse(await readFile(`${artifactRoot}/expanded-${clip.index%4}/${clip.index}/frames.json`,'utf8'));
  const old=baseline.results.find(r=>r.index===clip.index);
  const actual=await page.evaluate(async({frames,exercise})=>{
   const {createPulldown}=await import('/src/perception/pulldown.ts');const {createSquat}=await import('/src/perception/squat.ts');
   const {createLiveTrends,trendPath}=await import('/src/analytics/liveTrends.ts');const {createMotionRecorder}=await import('/src/analytics/motion.ts');const {settle}=await import('/src/feedback/settle.ts');
   const limb=exercise==='squat'?'leg':'arm',create=(c,confirmedTop)=>limb==='leg'?createSquat(c):createPulldown(c,{assessForm:true,confirmedTop});
   let engine=create(),calibration=null,trends=createLiveTrends(limb),motion=createMotionRecorder(limb),phase='ready',samples=0,rangeSamples=0,tiltSamples=0,maxBuffer=0,invalidPaths=0;let lastAt=null;
   for(const frame of frames){
    const state=engine.accept(frame);
    if(!calibration){const found=engine.getCalibration();if(found){calibration=found;engine=create(found,frame);engine.accept(frame);trends=createLiveTrends(limb,found);motion=createMotionRecorder(limb);motion.observe(frame,true);}continue;}
    trends.observe(frame,state);motion.observe(frame,state.visible&&state.phase==='ready'&&state.q<=.18);
    if(phase!=='ready'&&state.phase==='ready')motion.capture(engine.endSet(),engine.getRepReview());phase=state.phase;
    const current=trends.samples.at(-1);if(current&&current.atMs!==lastAt){samples++;if(current.range!==null)rangeSamples++;if(current.tilt!==null)tiltSamples++;lastAt=current.atMs;}
    maxBuffer=Math.max(maxBuffer,trends.samples.length);
    if(/NaN|Infinity/.test(trendPath(trends.samples,'range',284,62,0,1)+trendPath(trends.samples,'tilt',284,62,-45,45)))invalidPaths++;
   }
   if(!calibration)return {calibrated:false,verified:0,samples,rangeSamples,tiltSamples,maxBuffer,invalidPaths};
   const summary=engine.endSet(),metrics=motion.finish(summary,engine.getRepReview());return {calibrated:true,verified:summary.reps.filter(r=>r.status==='verified').length,metrics,exp:settle(summary,null).exp,samples,rangeSamples,tiltSamples,maxBuffer,invalidPaths};
  },{frames,exercise:clip.exercise});
  assert.equal(actual.calibrated,old.calibrated);assert.equal(actual.verified,old.verified);assert(actual.maxBuffer<=128);assert.equal(actual.invalidPaths,0);
  if(actual.calibrated){assert.deepEqual(actual.metrics.summary,old.metrics);assert.deepEqual(actual.metrics.reps,old.repetitions);assert.deepEqual(actual.exp,old.exp);}
  results.push({index:clip.index,file:clip.file,...actual});await writeFile(outputPath,JSON.stringify({mode:'captured-pose replay, no new inference or independent annotation',allLegacyValuesEqual:true,results},null,2));
  console.log(JSON.stringify({file:clip.file,verified:actual.verified,range:actual.rangeSamples,tilt:actual.tiltSamples,maxBuffer:actual.maxBuffer}));
 }
}finally{await browser.close();}
