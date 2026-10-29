import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {WebSocketServer} from 'ws';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import {Events} from '../events.mjs';

const minutes=Number(process.argv.find(a=>a.startsWith('--minutes='))?.split('=')[1]||0);
const report=process.argv.find(a=>a.startsWith('--report='))?.slice(9);
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'qq-stability-'));
const cache=path.join(dir,'Documents/Tencent Files');await fs.mkdir(cache,{recursive:true});
const images=await Promise.all(['red','green','blue'].map(background=>sharp({create:{width:16,height:12,channels:3,background}}).png().toBuffer()));
const gif=await sharp(images,{join:{animated:true}}).gif({delay:[100,200,300]}).toBuffer();
const pngFile=path.join(cache,'received.png'),gifFile=path.join(cache,'received.gif');await fs.writeFile(pngFile,images[0]);await fs.writeFile(gifFile,gif);
let favorites=[{md5:createHash('md5').update(gif).digest('hex').toUpperCase(),emoPath:gifFile}];
let sends=0,pokes=0,adds=0,delayNext=0,unsupported=false;const actions=[];
const mock=http.createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;const a=JSON.parse(raw);actions.push(req.url);let data={};
 if(req.url==='/get_login_info')data={user_id:10000};
 if(req.url==='/get_group_list')data=[10001,10002,10003].map(group_id=>({group_id,group_name:'group-'+group_id}));
 if(req.url==='/get_friend_list')data=[{user_id:10004,nickname:'friend'}];
 if(req.url==='/get_group_member_list')data=[{user_id:10005}];
 if(req.url==='/get_msg')data={message_id:a.message_id,user_id:10005,message:[{type:'image',data:{file:'received.png'}}]};
 if(req.url==='/get_image')data={file:a.file.endsWith('gif')?gifFile:pngFile};
 if(req.url==='/fetch_custom_face_detail')data=favorites;
 if(req.url==='/add_custom_face'){
   if(unsupported){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'failed',retcode:1404}));return;}
   adds++;favorites=[...favorites,{md5:createHash('md5').update(Buffer.from(a.file.slice(9),'base64')).digest('hex').toUpperCase(),emoPath:pngFile}];
 }
 if(req.url==='/group_poke'||req.url==='/friend_poke')pokes++;
 if(req.url==='/send_group_msg'||req.url==='/send_private_msg'){
   sends++;data={message_id:sends};const delay=delayNext;delayNext=0;if(delay)await new Promise(r=>setTimeout(r,delay));
 }
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',retcode:0,data}));
});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
const wss=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>wss.once('listening',r));
let ws;wss.on('connection',s=>{ws=s;});
const temporary=net.createServer();await new Promise(r=>temporary.listen(0,'127.0.0.1',r));const port=temporary.address().port;await new Promise(r=>temporary.close(r));
const configFile=path.join(dir,'config.json'),authFile=path.join(dir,'http-auth.txt');const authorization='Bearer '+randomBytes(32).toString('hex');await fs.writeFile(authFile,authorization);
await fs.writeFile(configFile,JSON.stringify({networks:{httpServers:[{name:'qq-mcp-local',enabled:true,path:'/',host:'127.0.0.1',port:mock.address().port,accessToken:'test'}],wsServers:[{name:'qq-mcp-events',enabled:true,path:'/',host:'127.0.0.1',port:wss.address().port,accessToken:'test'}]}}));
const child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve('.'),env:{...process.env,USERPROFILE:dir,QQ_EXPECTED_ACCOUNT:'10000',QQ_ONEBOT_CONFIG:configFile,QQ_LEDGER:path.join(dir,'ledger.json'),QQ_REPLY_CLAIMS:path.join(dir,'claims.json'),QQ_REPLY_LOG:path.join(dir,'flow.jsonl'),QQ_FLOW_STATE:path.join(dir,'chat-flows.json'),QQ_SEND_DELAY_MIN_MS:'0',QQ_SEND_DELAY_MAX_MS:'0',QQ_MCP_HTTP_PORT:String(port),QQ_MCP_AUTH_FILE:authFile,QQ_API_TIMEOUT_MS:'500'},stdio:['ignore','ignore','pipe'],windowsHide:true});
let stderr='';child.stderr.on('data',b=>stderr+=b);
let rpcId=0;
const rpc=async(method,params={},options={})=>{
 const response=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params}),...options});
 const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));if(result.error)throw Error(JSON.stringify(result.error));return result.result;
};
const call=(name,args={})=>rpc('tools/call',{name,arguments:args});
const data=r=>{assert.ok(!r.isError,r.content[0].text);return JSON.parse(r.content[0].text);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let seq=0;const message=(group=10001)=>({post_type:'message',message_type:group===10004?'private':'group',self_id:10000,user_id:group===10004?10004:10005,...(group===10004?{}:{group_id:group}),message_id:++seq,message_seq:seq,time:Math.floor(Date.now()/1000),message:[{type:'text',data:{text:'mock'}},{type:'image',data:{file:seq%2?'received.gif':'received.png'}}]});
const poke=(group=10001)=>({post_type:'notice',notice_type:'notify',sub_type:'poke',self_id:10000,user_id:group===10004?10004:10005,...(group===10004?{sender_id:10004}:{group_id:group}),target_id:10000,time:Math.floor(Date.now()/1000)});
const push=e=>ws.send(JSON.stringify(e));
const checks=[];
try{
 for(let n=0;n<100;n++){try{const r=await fetch(`http://127.0.0.1:${port}/health`,{headers:{Authorization:authorization}});if(r.ok)break;}catch{}if(n===99)throw Error('Host startup failed '+stderr);await sleep(50);}
 const tools=await rpc('tools/list');assert.equal(tools.tools.length,18); // Operational request before initialize is valid in stateless HTTP.
 for(let n=0;n<3;n++)await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'reconnecting-test',version:'1'}});
 const startStatus=data(await call('qq_status'));assert.ok(startStatus.events.connected);assert.equal(startStatus.mcp.version,'1.6.0');assert.equal(startStatus.mcp.flow_control.enabled,true);assert.equal(startStatus.mcp.flow_control.soft_duration,true);const initial=startStatus.events.cursor;
 const a=message(10001),b=message(10002),noise=message(10003),p=message(10004);for(const e of [a,b,noise,p,a,poke(),poke(),poke(10004)])push(e);
 const filter={target_ids:[{target_type:'group',target_id:'10001'},{target_type:'group',target_id:'10002'},{target_type:'private',target_id:'10004'}],timeout_ms:1000};
 let batch=data(await call('qq_wait_for_message',{...filter,after_event_id:initial}));assert.equal(batch.events.length,6);assert.equal(batch.messages.length,3);assert.equal(batch.events.filter(e=>e.event_type==='poke').length,3);assert.equal(batch.cursor_gap,false);assert.ok(batch.events.some(e=>e.operator_id==='10004'&&e.target_type==='private'));
 const replay=data(await call('qq_wait_for_message',{...filter,after_event_id:initial}));const first=batch.events.find(e=>e.event_type==='message'&&e.target_id==='10001'),second=replay.events.find(e=>e.event_id===first.event_id);assert.ok(first.reply_token);assert.ok(second.reply_token);assert.notEqual(first.reply_token,second.reply_token);
 const beforeClaimSend=sends;let protectedResult=data(await call('qq_send_text',{target_type:'group',target_id:'10001',expected_name:'group-10001',request_id:'claimed-flow-a',send_reason:'reply',reply_tokens:[first.reply_token],text:'protected reply'}));assert.equal(protectedResult.status,'sent');protectedResult=data(await call('qq_send_text',{target_type:'group',target_id:'10001',expected_name:'group-10001',request_id:'claimed-flow-b',send_reason:'reply',reply_tokens:[second.reply_token],text:'different duplicate reply'}));assert.equal(protectedResult.status,'blocked');assert.equal(protectedResult.reason,'incoming_event_already_claimed');assert.equal(sends,beforeClaimSend+1);
 const audit=(await fs.readFile(path.join(dir,'flow.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(audit.some(x=>x.action==='claim_acquired'&&x.send_request_id==='claimed-flow-a'));assert.ok(audit.some(x=>x.action==='claim_rejected'&&x.send_request_id==='claimed-flow-b'));assert.ok(audit.every(x=>!('text' in x)));checks.push('reply token atomic claim blocks different-ID duplicate and logs linkage');
 let cursor=batch.next_cursor;
 assert.equal(data(await call('qq_wait_for_message',{...filter,after_event_id:cursor})).events.length,0);
 // Buffered notices survive WebSocket reconnect and are returned even with gap warning.
 push(poke());await sleep(50);const before=ws;ws.terminate();for(let n=0;n<100&&ws===before;n++)await sleep(30);assert.notEqual(ws,before);
 push(poke(10004));batch=data(await call('qq_wait_for_message',{...filter,after_event_id:cursor}));assert.equal(batch.events.length,2);assert.equal(batch.cursor_gap,true);assert.equal(batch.connection_generation,1);cursor=batch.next_cursor;
 // A disconnected HTTP request does not own or clear the event buffer.
 const abort=new AbortController();const waiting=call('qq_wait_for_message',{...filter,timeout_ms:60000,after_event_id:cursor});
 // Independent short aborted request exercises HTTP transport cleanup.
 const cancelled=rpc('tools/call',{name:'qq_wait_for_message',arguments:{...filter,timeout_ms:60000,after_event_id:cursor}},{signal:abort.signal}).catch(()=>null);await sleep(30);abort.abort();await cancelled;push(message());batch=data(await waiting);cursor=batch.next_cursor;assert.equal(batch.messages.length,1);
 assert.equal(data(await call('qq_status')).events.cursor.split(':')[0],initial.split(':')[0]);
 checks.push('stateless initialize/reconnect','multi-chat filtering and dedup','poke identities and repeated pokes','WS retained-cache replay','HTTP disconnect preserves cursor');
 // A managed chat flow uses one wall-clock deadline across every wait.
 let flowCursor=data(await call('qq_status')).events.cursor;const deadlineBegan=Date.now();
 const deadlineFlow=data(await call('qq_wait_for_message',{target_type:'group',target_id:'10001',timeout_ms:60000,after_event_id:flowCursor,flow_id:'deadline-flow-0001',flow_duration_ms:180,execution_id:'deadline-execution-0001',flow_takeover:true}));
 const deadlineElapsed=Date.now()-deadlineBegan;assert.ok(deadlineElapsed>=120&&deadlineElapsed<800,deadlineElapsed);assert.ok(deadlineFlow.effective_timeout_ms<=180);assert.equal(deadlineFlow.ended_reason,'deadline');assert.equal(deadlineFlow.chat_flow.started_at<deadlineFlow.chat_flow.deadline_at,true);assert.equal(deadlineFlow.chat_flow.remaining_ms,0);
 const endedBegan=Date.now();const endedAgain=data(await call('qq_wait_for_message',{target_type:'group',target_id:'10001',timeout_ms:60000,after_event_id:deadlineFlow.next_cursor,flow_id:'deadline-flow-0001',execution_id:'deadline-execution-0001',flow_lease_token:deadlineFlow.chat_flow.flow_lease_token}));assert.ok(Date.now()-endedBegan<150);assert.equal(endedAgain.ended_reason,'deadline');assert.equal(endedAgain.events.length,0);
 const cancelledFlow=data(await call('qq_wait_for_message',{target_type:'group',target_id:'10001',timeout_ms:60000,after_event_id:deadlineFlow.next_cursor,flow_id:'cancelled-flow-0001',flow_duration_ms:5000,execution_id:'cancelled-execution-0001',flow_takeover:true,flow_end_reason:'cancelled'}));assert.equal(cancelledFlow.ended_reason,'cancelled');assert.equal(cancelledFlow.chat_flow.status,'ended');assert.equal(cancelledFlow.effective_timeout_ms,0);
 // An event received before the deadline may finish one reply during the closing grace.
 flowCursor=data(await call('qq_status')).events.cursor;const closingWait=call('qq_wait_for_message',{target_type:'group',target_id:'10001',timeout_ms:60000,after_event_id:flowCursor,flow_id:'closing-flow-0001',flow_duration_ms:300,execution_id:'closing-execution-0001',flow_takeover:true});await sleep(20);push(message(10001));const closingBatch=data(await closingWait);assert.equal(closingBatch.events.length,1);await sleep(130);const beforeClosingReply=sends;
 let closingResult=data(await call('qq_send_text',{target_type:'group',target_id:'10001',expected_name:'group-10001',request_id:'closing-reply-0001',send_reason:'reply',reply_tokens:[closingBatch.events[0].reply_token],flow_id:'closing-flow-0001',execution_id:'closing-execution-0001',flow_lease_token:closingBatch.chat_flow.flow_lease_token,text:'closing reply'}));assert.equal(closingResult.status,'sent');assert.equal(sends,beforeClosingReply+1);
 const lateProactive=data(await call('qq_send_text',{target_type:'group',target_id:'10001',expected_name:'group-10001',request_id:'late-proactive-0001',send_reason:'proactive',flow_id:'closing-flow-0001',execution_id:'closing-execution-0001',flow_lease_token:closingBatch.chat_flow.flow_lease_token,dedupe_key:'late-topic',text:'too late'}));assert.equal(lateProactive.status,'ended');assert.equal(lateProactive.reason,'deadline');assert.equal(sends,beforeClosingReply+1);
 // Two different executions and different opening text still share one action claim.
 const openingBase={target_type:'group',target_id:'10001',expected_name:'group-10001',send_reason:'proactive',flow_id:'opening-flow-0001',flow_duration_ms:5000,flow_takeover:true,dedupe_key:'opening'};const beforeOpening=sends;
 const openings=await Promise.all([
   call('qq_send_text',{...openingBase,request_id:'opening-request-0001',execution_id:'opening-execution-a',text:'first generated opening'}),
   call('qq_send_text',{...openingBase,request_id:'opening-request-0002',execution_id:'opening-execution-b',text:'different generated opening'})
 ]);const openingResults=openings.map(data);assert.deepEqual(openingResults.map(x=>x.status).sort(),['blocked','sent']);assert.equal(sends,beforeOpening+1);
 flowCursor=data(await call('qq_status')).events.cursor;const takeoverWait=call('qq_wait_for_message',{target_type:'group',target_id:'10001',timeout_ms:1000,after_event_id:flowCursor,flow_id:'opening-flow-0001',execution_id:'opening-execution-c',flow_takeover:true});await sleep(20);push(message(10001));const takeoverBatch=data(await takeoverWait);
 const openingReplay=data(await call('qq_send_text',{...openingBase,flow_duration_ms:undefined,flow_takeover:false,request_id:'opening-request-0003',execution_id:'opening-execution-c',flow_lease_token:takeoverBatch.chat_flow.flow_lease_token,text:'third different opening'}));assert.equal(openingReplay.status,'blocked');assert.equal(openingReplay.reason,'proactive_action_already_claimed');assert.equal(sends,beforeOpening+1);
 const flowStatus=data(await call('qq_status')).chat_flows;assert.ok(flowStatus.some(x=>x.flow_id==='deadline-flow-0001'&&x.ended_reason==='deadline'));const flowAudit=(await fs.readFile(path.join(dir,'flow.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(flowAudit.some(x=>x.action==='flow_lease_taken_over'&&x.flow_id==='opening-flow-0001'));assert.ok(flowAudit.some(x=>x.action==='proactive_action_rejected'&&x.dedupe_key==='opening'));assert.ok(flowAudit.some(x=>x.action==='reply_tokens_issued'&&x.items?.[0]?.reply_token));
 checks.push('wall-clock flow deadline caps wait','explicit cancelled/error flow ending','deadline allows one current reply then blocks proactive','lease takeover invalidates stale execution','proactive dedupe key blocks different-text duplicate','flow/reply/action correlation logs');
 // Soft target: wind-down and idle thresholds cap wait independently of hard max.
 flowCursor=data(await call('qq_status')).events.cursor;const softIdleBegan=Date.now();const softIdle=data(await call('qq_wait_for_message',{target_type:'group',target_id:'10001',timeout_ms:60000,after_event_id:flowCursor,flow_id:'soft-idle-flow-0001',flow_target_duration_ms:300,flow_max_duration_ms:450,flow_idle_end_ms:100,execution_id:'soft-idle-execution-0001',flow_takeover:true}));const softIdleElapsed=Date.now()-softIdleBegan;assert.ok(softIdleElapsed>=100&&softIdleElapsed<700,softIdleElapsed);assert.ok(softIdle.effective_timeout_ms>=130&&softIdle.effective_timeout_ms<=150,softIdle.effective_timeout_ms);assert.equal(softIdle.chat_flow.mode,'soft');assert.equal(softIdle.chat_flow.flow_phase,'ended');assert.equal(softIdle.ended_reason,'idle_after_target');assert.ok(softIdle.chat_flow.target_at<softIdle.chat_flow.deadline_at);assert.ok(softIdle.chat_flow.remaining_to_deadline_ms>0);
 // At target, ordinary proactive topics stop; a stable closing action may end naturally.
 flowCursor=data(await call('qq_status')).events.cursor;const softTalkWait=call('qq_wait_for_message',{target_type:'group',target_id:'10001',timeout_ms:60000,after_event_id:flowCursor,flow_id:'soft-talk-flow-0001',flow_target_duration_ms:300,flow_max_duration_ms:450,execution_id:'soft-talk-execution-0001',flow_takeover:true});await sleep(20);push(message(10001));const softTalk=data(await softTalkWait);assert.equal(softTalk.chat_flow.flow_phase,'winding_down');const untilTarget=Math.max(0,Date.parse(softTalk.chat_flow.target_at)-Date.now()+20);await sleep(untilTarget);const beforeSoftClosing=sends;
 const topicAfterTarget=data(await call('qq_send_text',{target_type:'group',target_id:'10001',expected_name:'group-10001',request_id:'soft-late-topic-0001',send_reason:'proactive',flow_id:'soft-talk-flow-0001',execution_id:'soft-talk-execution-0001',flow_lease_token:softTalk.chat_flow.flow_lease_token,dedupe_key:'topic-after-target',text:'new long topic'}));assert.equal(topicAfterTarget.status,'blocked');assert.equal(topicAfterTarget.reason,'target_reached');assert.equal(sends,beforeSoftClosing);
 const naturalClosing=data(await call('qq_send_text',{target_type:'group',target_id:'10001',expected_name:'group-10001',request_id:'soft-natural-closing-0001',send_reason:'proactive',flow_id:'soft-talk-flow-0001',execution_id:'soft-talk-execution-0001',flow_lease_token:softTalk.chat_flow.flow_lease_token,dedupe_key:'closing',text:'natural signoff'}));assert.equal(naturalClosing.status,'sent');assert.equal(naturalClosing.chat_flow.flow_phase,'ended');assert.equal(naturalClosing.chat_flow.ended_reason,'target_reached');assert.equal(sends,beforeSoftClosing+1);
 checks.push('soft target/max schema and status','wind-down-only idle early exit','target stops new topic','stable closing action ends naturally');
 const send={target_type:'group',target_id:'10001',expected_name:'group-10001',request_id:'timeout-test-0001',send_reason:'proactive',text:'test'};
 delayNext=800;let result=data(await call('qq_send_text',send));assert.equal(result.status,'unknown');assert.equal(result.reason,'upstream_timeout');const sent=sends;
 result=data(await call('qq_send_text',send));assert.equal(result.status,'unknown');assert.equal(sends,sent);
 const repeated={...send,request_id:'concurrent-test-0001'};const responses=await Promise.all(Array.from({length:8},()=>call('qq_send_text',repeated)));responses.forEach(r=>assert.equal(data(r).status,'sent'));assert.equal(sends,sent+1);
 // Client disconnect after dispatch: persist success even if the caller lost its response.
 delayNext=200;const sendAbort=new AbortController();const dropped=rpc('tools/call',{name:'qq_send_text',arguments:{...send,request_id:'dropped-response-01'}},{signal:sendAbort.signal}).catch(()=>null);await sleep(80);sendAbort.abort();await dropped;await sleep(250);
 result=data(await call('qq_send_text',{...send,request_id:'dropped-response-01'}));assert.equal(result.status,'sent');assert.equal(result.deduplicated,true);assert.equal(sends,sent+2);
 checks.push('timeout after side effect remains unknown','same-ID retry never resends','concurrent same-ID send once','lost HTTP response recovers persisted success');
 assert.ok((await call('qq_poke_user',{target_type:'group',target_id:'10001',user_id:'999',request_id:'poke-invalid'})).isError);
 for(const [type,target,user] of [['group','10001','10005'],['private','10004','10004']]){const args={target_type:type,target_id:target,user_id:user,request_id:'poke-'+type+'-0001'};assert.equal(data(await call('qq_poke_user',args)).success,true);data(await call('qq_poke_user',args));}
 assert.equal(pokes,2);
 assert.ok((await call('qq_add_favorite_sticker',{file:'unobserved.png'})).isError);assert.ok((await call('qq_add_favorite_sticker',{file:'../cache.png'})).isError);
 data(await call('qq_get_message',{message_id:'100'}));result=data(await call('qq_add_favorite_sticker',{file:'received.png',message_id:'100'}));assert.equal(result.status,'confirmed');data(await call('qq_add_favorite_sticker',{file:'received.png',message_id:'100'}));assert.equal(adds,1);
 favorites=favorites.filter(r=>r.emoPath!==pngFile);unsupported=true;assert.equal(data(await call('qq_add_favorite_sticker',{file:'received.png'})).status,'unsupported');unsupported=false;
 checks.push('group/private poke validation and dedup','favorite provenance and confirmed add','favorite unsupported is explicit');
 const q=new Events(configFile,'10000',{capacity:2});q.connected=true;const c=q.cursor(0);for(let n=0;n<10;n++)q.accept(message(10003));q.accept(message(10001));const r=await q.wait({after_event_id:c,target_ids:[{target_type:'group',target_id:'10001'}],timeout_ms:1});assert.equal(r.cursor_gap,false);assert.equal(r.events.length,1);checks.push('filtered-out overflow does not create false gap');
 const finish=Date.now()+minutes*60000;const began=Date.now();let cycles=0,received=0,reconnects=1;const seen=new Set();
 cursor=data(await call('qq_status')).events.cursor;
 const save=async(status)=>{const summary={status,minutes_requested:minutes,elapsed_seconds:Math.round((Date.now()-began)/1000),cycles,received,reconnects,checks,realQQWrites:0};if(report)await fs.writeFile(report,JSON.stringify(summary,null,2));return summary;};
 while(Date.now()<finish){
   const wait=call('qq_wait_for_message',{...filter,timeout_ms:30000,after_event_id:cursor});
   await sleep(100);const wanted=[message(10001),message(10002),message(10004),poke(10001),poke(10004)];for(const e of [...wanted,message(10003)])push(e);
   const result=data(await wait);assert.equal(result.events.length,5);assert.equal(result.cursor_gap,false);for(const e of result.events){assert.ok(!seen.has(e.event_id));seen.add(e.event_id);}received+=result.events.length;cursor=result.next_cursor;cycles++;
   if(cycles%12===0){
     await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'fresh-http-connection',version:'1'}});
     const prev=ws;push(poke());await sleep(30);ws.terminate();for(let n=0;n<100&&ws===prev;n++)await sleep(30);
     const recovered=data(await call('qq_wait_for_message',{...filter,after_event_id:cursor}));assert.equal(recovered.events.length,1);assert.ok(recovered.cursor_gap);assert.ok(!seen.has(recovered.events[0].event_id));seen.add(recovered.events[0].event_id);cursor=recovered.next_cursor;received++;reconnects++;
     const animation=data(await call('qq_read_animation',{file:'received.gif'}));assert.equal(animation.frame_count,3);data(await call('qq_list_favorite_stickers'));
   }
   if(cycles%12===0){await save('running');console.log(JSON.stringify({progress:'running',cycles,elapsed_seconds:Math.round((Date.now()-began)/1000)}));}
   await sleep(Math.min(4500,Math.max(0,finish-Date.now())));
 }
 console.log(JSON.stringify(await save('passed')));
}catch(e){if(report)await fs.writeFile(report,JSON.stringify({status:'failed',error:e.message,stderr}));throw e;}
finally{child.kill();for(const s of wss.clients)s.terminate();await new Promise(r=>wss.close(r));mock.closeAllConnections();await new Promise(r=>mock.close(r));}
