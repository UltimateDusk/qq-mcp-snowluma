import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ReplyClaims} from '../reply-claims.mjs';

const dir=await fs.mkdtemp(path.join(os.tmpdir(),'qq-reply-claims-'));let now=1000;
try{
  const c=new ReplyClaims(path.join(dir,'claims.json'),path.join(dir,'flow.jsonl'),'10000',{now:()=>now,tokenTtl:10000,reservedTtl:500,terminalTtl:1000});
  const event={event_id:'session:1:0',event_type:'message',target_type:'group',target_id:'456',message_id:789};
  const one=await c.issueMany([event],{waitRequestId:'wait-a',flowId:'flow-a-0001'}),two=await c.issueMany([event],{waitRequestId:'wait-b',flowId:'flow-b-0001'});
  assert.notEqual(one[event.event_id],two[event.event_id]);
  const a=await c.acquire({tokens:[one[event.event_id]],target_type:'group',target_id:'456',request_id:'send-a-0001',mcp_request_id:'mcp-a'});assert.equal(a.ok,true);
  const blocked=await c.acquire({tokens:[two[event.event_id]],target_type:'group',target_id:'456',request_id:'send-b-0001',mcp_request_id:'mcp-b'});assert.equal(blocked.status,'blocked');assert.equal(blocked.reason,'incoming_event_already_claimed');
  await c.release(a);const b=await c.acquire({tokens:[two[event.event_id]],target_type:'group',target_id:'456',request_id:'send-b-0001',mcp_request_id:'mcp-b'});assert.equal(b.ok,true);
  await c.dispatch(b);await c.release(b);assert.equal((await c.acquire({tokens:[one[event.event_id]],target_type:'group',target_id:'456',request_id:'send-c-0001',mcp_request_id:'mcp-c'})).status,'blocked');
  await c.finish(b,'sent',{outbound_message_id:'999'});now+=1001;
  const afterTtl=await c.acquire({tokens:[one[event.event_id]],target_type:'group',target_id:'456',request_id:'send-c-0001',mcp_request_id:'mcp-c'});assert.equal(afterTtl.ok,true);
  await c.release(afterTtl);
  const legacy1=await c.acquire({legacyEvent:{...event,event_id:'session:2:0'},target_type:'group',target_id:'456',request_id:'legacy-a',mcp_request_id:'mcp-l1'});assert.equal(legacy1.ok,true);
  const legacy2=await c.acquire({legacyEvent:{...event,event_id:'session:2:0'},target_type:'group',target_id:'456',request_id:'legacy-b',mcp_request_id:'mcp-l2'});assert.equal(legacy2.status,'blocked');
  const proactive=await c.acquire({target_type:'group',target_id:'456',request_id:'direct-a',mcp_request_id:'mcp-d',send_reason:'proactive'});assert.equal(proactive,null);
  const lines=(await fs.readFile(path.join(dir,'flow.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(lines.some(x=>x.action==='claim_acquired'));assert.ok(lines.some(x=>x.action==='claim_rejected'));assert.ok(lines.every(x=>!('text' in x)));
  console.log('PASS reply tokens, atomic claim, cancellation release, dispatch retention, TTL, legacy fallback, proactive bypass and structured audit log');
}finally{await fs.rm(dir,{recursive:true,force:true});}
