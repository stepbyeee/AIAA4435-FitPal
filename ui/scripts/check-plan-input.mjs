import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.FITPAL_CHROME,args:['--disable-gpu']});
try{
 const page=await browser.newPage();await page.goto(process.env.FITPAL_URL??'http://127.0.0.1:4173');
 await page.locator('.training-settings summary').click();await page.getByLabel('观察重点').selectOption('tempo');
 const input=page.getByLabel('自选还原目标');await input.focus();await input.press('ControlOrMeta+A');await input.press('Backspace');
 assert.equal(await input.inputValue(),'','Clearing the field must leave it editable');
 await input.pressSequentially('0.5');await input.press('Tab');assert.equal(await input.inputValue(),'0.5');
 const reps=page.getByLabel('每组目标次数');await reps.focus();await reps.press('ControlOrMeta+A');await reps.press('Backspace');await reps.pressSequentially('8');await reps.press('Tab');assert.equal(await reps.inputValue(),'8');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('fitpal.training-plan.v1')));assert.equal(saved.returnSeconds,.5);assert.equal(saved.reps,8);
 console.log('PASS: keyboard clear, decimal0.5 and target8 persist');
}finally{await browser.close();}
