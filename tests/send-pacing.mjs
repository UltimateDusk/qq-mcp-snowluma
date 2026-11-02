import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SendPacing} from '../send-pacing.mjs';
import {SendLedger} from '../ledger.mjs';
let now=100000;const sleeps=[];let values=[8000,13000,9500];
const pacing=new SendPacing({now:()=>now,pickDelay:()=>values.shift(),sleep:async ms=>{sleeps.push(ms);now+=ms;}});
assert.equal(await pacing.wait(98000,undefined,{peer:'a'}),8000);assert.equal(now,106000);assert.equal(sleeps[0],6000);
assert.equal(await pacing.wait(98000,undefined,{peer:'a'}),16000);assert.equal(now,122000);assert.equal(pacing.lastDetails.consecutive_penalty_ms,3000);
assert.equal(await pacing.wait(undefined,undefined,{peer:'b'}),9500);assert.equal(now,131500);
const defaults=new SendPacing();assert.equal(defaults.min,8000);assert.equal(defaults.max,40000);
for(let i=0;i<1000;i++){
 const short=defaults.pickDelay({textLength:5});const long=defaults.pickDelay({textLength:150});
 assert.ok(short>=8000&&short<=12000);assert.ok(long>=24000&&long<=40000);assert.ok(long>short);
 const sticker=defaults.pickDelay({stickerOnly:true});assert.ok(sticker>=8000&&sticker<=12000);
}
const crowd=new SendPacing({now:()=>now,pickDelay:()=>35000,sleep:async ms=>{now+=ms;}});
assert.equal(await crowd.wait(undefined,undefined,{active_ai_count:4,suspected_ai_rounds:5}),40000);
assert.ok(crowd.lastDetails.ai_activity_penalty_ms>0);
await assert.rejects(crowd.wait(undefined,undefined,{deadline_at:now+1000}),/flow_deadline_before_send/);
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
 console.log('PASS 8-40s adaptive pacing, burst/AI penalties, deadline bounds, received-message timing, consecutive spacing, fallback, duplicate retry, cancellation and same-ID recovery');
}finally{await fs.rm(dir,{recursive:true,force:true});}
