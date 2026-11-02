import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FlowControl} from '../flow-control.mjs';
import {Events} from '../events.mjs';
import {ConversationPolicy} from '../conversation-policy.mjs';
import {resolveMessageImage} from '../media-resolver.mjs';

const dir=await fs.mkdtemp(path.join(os.tmpdir(),'qq-conversation-'));
let now=1000000;
const flows=new FlowControl(path.join(dir,'flows.json'),path.join(dir,'audit.jsonl'),'10000',{now:()=>now});
const base={flow_id:'rolling-flow',target_type:'group',target_id:'10001',execution_id:'execution-1',rolling:true,operation:'wait'};
try{
  let h=await flows.enter(base);assert.equal(h.flow.mode,'rolling');assert.equal(h.wait_limit_ms,60000);
  assert.equal((await flows.enter({...base,lease_token:h.lease_token,renew:true})).reason,'renew_requires_new_activity');
  const started=h.flow.started_at,absolute=h.flow.absolute_deadline_at;
  now+=20000;await flows.completeWait(h,{events:1,activityRows:[{seq:1,received:now}]});
  h=await flows.enter({...base,lease_token:h.lease_token,renew:true,after_event_id:'cursor-ack-1',observation:'human_active'});
  assert.equal(h.flow.renewal_count,1);assert.equal(h.wait_limit_ms,60000);assert.equal(h.flow.started_at,started);assert.equal(h.flow.absolute_deadline_at,absolute);
  assert.equal((await flows.enter({...base,lease_token:h.lease_token,renew:true})).reason,'renew_requires_new_activity');
  await flows.completeWait(h,{events:1,activityRows:[{seq:1,received:now-1000}]});
  assert.equal((await flows.enter({...base,lease_token:h.lease_token,renew:true})).reason,'renew_requires_new_activity');
  const restarted=new FlowControl(path.join(dir,'flows.json'),path.join(dir,'audit.jsonl'),'10000',{now:()=>now});
  const restored=await restarted.enter({...base,lease_token:h.lease_token});assert.equal(restored.flow.resume_cursor,'cursor-ack-1');assert.equal(restored.flow.renewal_count,1);
  now+=60001;assert.equal((await restarted.enter({...base,lease_token:h.lease_token,renew:true})).status,'ended');

  // Unknown identities never count as a confirmed human. Explicit contextual assessments are bounded per new batch.
  const aiBase={...base,flow_id:'suspected-ai-flow'};let ai=await flows.enter(aiBase);
  for(let n=1;n<=3;n++){
    now+=1000;await flows.completeWait(ai,{events:1,activityRows:[{seq:n,received:now}]});
    const result=await flows.enter({...aiBase,lease_token:ai.lease_token,renew:true,observation:'suspected_ai_only'});
    if(n<3){assert.equal(result.ok,true);ai=result;}else{assert.equal(result.reason,'ai_only_renewal_paused');assert.equal(result.flow.suspected_ai_rounds,3);}
  }
  const repeat=await flows.enter({...aiBase,lease_token:ai.lease_token,observation:'suspected_ai_only'});assert.equal(repeat.flow.suspected_ai_rounds,3);
  // A fresh human assessment clears weak AI evidence.
  now+=1000;await flows.completeWait(ai,{events:1,activityRows:[{seq:4,received:now}]});
  ai=await flows.enter({...aiBase,lease_token:ai.lease_token,renew:true,observation:'human_active'});assert.equal(ai.flow.suspected_ai_rounds,0);
  for(let n=5;n<=10;n++){
    now+=1000;await flows.completeWait(ai,{events:1,activityRows:[{seq:n,received:now}],assessment:'suspected_ai_only'});
    const result=await flows.enter({...aiBase,lease_token:ai.lease_token});
    if(n<10)ai=result;else{assert.equal(result.status,'ended');assert.equal(result.reason,'ai_only_loop');assert.equal(result.flow.assessment_is_inferred,true);}
  }
  const owner=await flows.enter({...base,flow_id:'takeover-flow'});
  const taker=await flows.enter({...base,flow_id:'takeover-flow',execution_id:'execution-2',takeover:true});
  await flows.completeWait(owner,{events:1,activityRows:[{seq:999,received:now}]});
  assert.equal((await flows.enter({...base,flow_id:'takeover-flow',execution_id:'execution-2',lease_token:taker.lease_token,renew:true})).reason,'renew_requires_new_activity');
  assert.equal((await flows.end(taker,'manual_end')).ended_reason,'manual_end');

  const policy=new ConversationPolicy('10000',{now:()=>now});
  const msg=(id,text)=>({post_type:'message',message_type:'group',self_id:10000,user_id:10005,group_id:10001,message_id:id,message:[{type:'text',data:{text}}]});
  const stateFile=path.join(dir,'events.json');const ev=new Events('unused','10000',{stateFile});await ev.restore();ev.connected=true;const cursor=ev.status().cursor;
  for(let n=1;n<=105;n++)ev.accept(msg(n,n===105?'请问怎么设置？':'哈哈'));
  let batch=await ev.wait({after_event_id:cursor,timeout_ms:0});assert.equal(batch.events.length,100);assert.equal(batch.more_available,true);
  const sorted=policy.decorate(batch.events);assert.equal(sorted.events.length,100);assert.equal(sorted.reply_order.length,100);
  const next=batch.next_cursor;batch=await ev.wait({after_event_id:next,timeout_ms:0});assert.equal(batch.events.length,5);assert.equal(policy.decorate(batch.events).reply_order[0],batch.events[4].event_id);
  const snapshot=await fs.readFile(stateFile,'utf8');assert.ok(snapshot.includes('105'));
  const recovered=new Events('unused','10000',{stateFile});await recovered.restore();recovered.connected=true;
  const recovery=await recovered.wait({after_event_id:next,timeout_ms:0});assert.equal(recovery.events.length,5);assert.equal(recovery.cursor_gap,true);assert.equal(recovery.gap_reason,'connection_interrupted');
  recovered.accept(msg(105,'duplicate'));assert.equal(recovered.rows.length,105);
  recovered.ttl=-1;const expired=await recovered.wait({after_event_id:next,timeout_ms:0});assert.equal(expired.cursor_gap,true);assert.equal(expired.events.length,0);
  // Batch window starts at the first event, later events don't extend it indefinitely.
  const bursts=new Events('unused','10000');bursts.connected=true;const from=bursts.status().cursor;
  bursts.accept(msg(1,'a'));setTimeout(()=>bursts.accept(msg(2,'b')),10);setTimeout(()=>bursts.accept(msg(3,'c')),20);
  const began=Date.now();const merged=await bursts.wait({after_event_id:from,timeout_ms:1000,batch_window_ms:70});assert.equal(merged.events.length,3);assert.ok(Date.now()-began<500);
  const ambiguous=policy.classify({...msg(7,'作为AI我可以帮助你'),target_type:'group',target_id:'10001'});assert.equal(ambiguous.speaker_kind,'unknown');assert.equal(ambiguous.suspected_ai,true);
  policy.recordSent('group:10001','777');assert.equal(policy.classify({target_type:'group',target_id:'10001',message:[{type:'reply',data:{id:'777'}}]}).priority,'high');

  let reads=0,downloads=[];
  const ok=Buffer.from('GIF89a');
  const downloaded=await resolveMessageImage('received.gif',{roots:[],api:async()=>({file:'https://untrusted.example/x',url:'https://multimedia.nt.qq.com.cn/download'}),download:async url=>{downloads.push(url);if(url.includes('untrusted'))throw Error('not_allowed');return ok;}});
  assert.equal(downloaded,ok);assert.equal(downloads.length,2);
  const refreshed=await resolveMessageImage('received.gif',{roots:[],known:{at:Date.now(),ids:new Set(['1'])},api:async action=>{reads++;return action==='get_msg'?{message:[{type:'image',data:{file:'received.gif',url:'https://gchat.qpic.cn/fresh'}}]}:{url:'https://gchat.qpic.cn/expired'};},download:async url=>{if(url.endsWith('fresh'))return ok;throw Error('HTTP 403');}});
  assert.equal(refreshed,ok);assert.equal(reads,2);
  let retries=0;await assert.rejects(resolveMessageImage('file',{roots:[],api:async()=>{retries++;return {url:'https://untrusted.example/x'};},download:async()=>{throw Error('original_rejection');}}),e=>e.media_details.original_error==='original_rejection'&&e.media_details.attempts.length===2);assert.equal(retries,2);
  console.log('PASS rolling renewal/replay/absolute deadline/lease, AI round guard, batching/priority/cursor persistence, bounded image fallback');
}finally{await fs.rm(dir,{recursive:true,force:true});}
