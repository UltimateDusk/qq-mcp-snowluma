import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SendPacing} from '../send-pacing.mjs';
import {SendLedger} from '../ledger.mjs';
let now=100000;const sleeps=[];let values=[8000,13000,9500];
const pacing=new SendPacing({now:()=>now,pickDelay:()=>values.shift(),sleep:async ms=>{sleeps.push(ms);now+=ms;}});
assert.equal(await pacing.wait(98000),8000);assert.equal(now,106000);assert.equal(sleeps[0],6000);
assert.equal(await pacing.wait(98000),13000);assert.equal(now,119000);assert.equal(sleeps[1],13000);
assert.equal(await pacing.wait(undefined),9500);assert.equal(now,128500);assert.equal(sleeps[2],9500);
const defaults=new SendPacing();
assert.deepEqual(defaults.policy(),{min_ms:5000,max_ms:13000,sticker_only_ms:5000,text_bands:[{max_chars:10,min_ms:5000,max_ms:7000},{max_chars:30,min_ms:6000,max_ms:9000},{max_chars:80,min_ms:8000,max_ms:11000},{max_chars:null,min_ms:10000,max_ms:13000}]});
for(let i=0;i<1000;i++){
 const sticker=defaults.pickDelay({stickerOnly:true,textLength:0});assert.equal(sticker,5000);
 const image=defaults.pickDelay({textLength:0});assert.ok(image>=5000&&image<=7000);
 const short=defaults.pickDelay({textLength:10});assert.ok(short>=5000&&short<=7000);
 const medium=defaults.pickDelay({textLength:30});assert.ok(medium>=6000&&medium<=9000);
 const long=defaults.pickDelay({textLength:80});assert.ok(long>=8000&&long<=11000);
 const veryLong=defaults.pickDelay({textLength:81});assert.ok(veryLong>=10000&&veryLong<=13000);
}
assert.equal(new SendPacing({min:0,max:0}).pickDelay({textLength:999,stickerOnly:true}),0);
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'qq-pacing-'));
try{
 const ledger=new SendLedger(path.join(dir,'ledger.json'));let writes=0,gates=0;
 const op=async()=>({message_id:++writes});const gate=async()=>{gates++;};
 const results=await Promise.all([ledger.execute('same','digest',op,{beforeDispatch:gate}),ledger.execute('same','digest',op,{beforeDispatch:gate})]);
 assert.equal(writes,1);assert.equal(gates,1);assert.equal(results[1].deduplicated,true);
 const controller=new AbortController();
 const cancelled=await ledger.execute('cancel','digest',op,{signal:controller.signal,beforeDispatch:async signal=>{controller.abort();signal.throwIfAborted();}});
 assert.equal(cancelled.dispatched,false);assert.equal(writes,1);
 assert.equal((await ledger.execute('cancel','digest',op,{beforeDispatch:gate})).status,'sent');assert.equal(writes,2);
 const c=new AbortController();c.abort();await assert.rejects(new SendPacing().wait(undefined,c.signal));
 console.log('PASS 5-13s length-aware pacing, sticker-only timing, received-message timing, consecutive spacing, fallback, duplicate retry, cancellation and same-ID recovery');
}finally{await fs.rm(dir,{recursive:true,force:true});}
