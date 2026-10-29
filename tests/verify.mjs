import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const live=process.argv.includes('--live');
let mock,dir,requests=[],wrongAccount=false,failSend=false;
const env={...process.env};
env.QQ_EXPECTED_ACCOUNT='10000';
env.QQ_SEND_DELAY_MIN_MS='0';env.QQ_SEND_DELAY_MAX_MS='0';
if(!live){
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'qq-mcp-test-'));
  mock=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const a=JSON.parse(body);requests.push({action:req.url,args:a});assert.equal(req.headers.authorization,'Bearer test-only');let data={};
    if(req.url==='/get_login_info')data={user_id:wrongAccount?123:10000,nickname:'test'};
    else if(req.url==='/get_group_list')data=[{group_id:10001,group_name:'测试群',member_count:2}];
    else if(req.url==='/get_friend_list')data=[{user_id:10002,nickname:'测试好友',remark:''}];
    else if(req.url==='/get_group_msg_history')data={messages:[{message_id:12,message:[{type:'text',data:{text:'sample'}}]}]};
    else if(req.url==='/send_group_msg'||req.url==='/send_private_msg'){if(failSend){res.writeHead(500);res.end();return;}data={message_id:777};}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',retcode:0,data}));
  });await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  env.QQ_ONEBOT_CONFIG=path.join(dir,'config.json');env.QQ_LEDGER=path.join(dir,'ledger.json');env.QQ_REPLY_CLAIMS=path.join(dir,'claims.json');env.QQ_REPLY_LOG=path.join(dir,'flow.jsonl');
  await fs.writeFile(env.QQ_ONEBOT_CONFIG,JSON.stringify({network:{httpServers:[{name:'qq-mcp-local',enable:true,host:'127.0.0.1',port:mock.address().port,token:'test-only'}]}}));
}
const client=new Client({name:'qq-verifier',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('server.mjs')],env,stderr:'pipe'});
let stderr='';transport.stderr?.on('data',c=>stderr+=c.toString());
try{
 await client.connect(transport);
 const tools=(await client.listTools()).tools;assert.equal(tools.length,18);
 assert.equal(tools.find(t=>t.name==='qq_send_text').annotations.readOnlyHint,false);
 const call=async(name,args={})=>client.callTool({name,arguments:args});
 const groups=await call('qq_list_groups');assert.ok(!groups.isError);const rows=JSON.parse(groups.content[0].text);
 if(live){
  const status=await call('qq_status');assert.ok(!status.isError);
  const friends=await call('qq_list_friends');assert.ok(!friends.isError);
  let historyCount=null;
  if(rows.length){const history=await call('qq_read_history',{target_type:'group',target_id:String(rows[0].group_id),count:2});assert.ok(!history.isError,history.content[0].text);historyCount=JSON.parse(history.content[0].text).messages.length;}
  console.log(JSON.stringify({mode:'live-readonly',tools:tools.length,groupCount:rows.length,friendCount:JSON.parse(friends.content[0].text).total,historyCount,status:'passed',sendCalls:0}));
 }else{
  const args={target_type:'group',target_id:'10001',expected_name:'测试群',request_id:'test-message-001',send_reason:'proactive',text:'hello [CQ:at,qq=all]'};
  assert.ok((await call('qq_send_text',{...args,expected_name:'错误群'})).isError);
  assert.equal(requests.filter(r=>r.action==='/send_group_msg').length,0);
  assert.ok(!(await call('qq_send_text',args)).isError);
  const sent=requests.find(r=>r.action==='/send_group_msg');assert.deepEqual(sent.args.message,[{type:'text',data:{text:args.text}}]);
  assert.ok(!(await call('qq_send_text',args)).isError);assert.equal(requests.filter(r=>r.action==='/send_group_msg').length,1);
  assert.ok((await call('qq_send_text',{...args,text:'changed'})).isError);
  wrongAccount=true;assert.ok((await call('qq_list_groups')).isError);wrongAccount=false;
  assert.ok((await call('qq_send_image',{...args,request_id:'test-image-001',filename:'../config.json'})).isError);
  assert.ok((await call('qq_send_image',{...args,request_id:'test-image-002',base64:Buffer.from('not an image').toString('base64')})).isError);
  const image={...args,request_id:'test-image-003',base64:Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64')};
  assert.ok(!(await call('qq_send_image',image)).isError);assert.equal(requests.at(-1).args.message[0].type,'image');
  failSend=true;assert.equal(JSON.parse((await call('qq_send_text',{...args,request_id:'test-timeout-001'})).content[0].text).status,'unknown');
  const before=requests.filter(r=>r.action==='/send_group_msg').length;
  assert.equal(JSON.parse((await call('qq_send_text',{...args,request_id:'test-timeout-001'})).content[0].text).status,'unknown');assert.equal(requests.filter(r=>r.action==='/send_group_msg').length,before);
  console.log(JSON.stringify({mode:'mock',status:'passed',checks:['MCP handshake and schemas','target mismatch blocked','account mismatch blocked','literal CQ text','duplicate prevented','request ID conflict','image traversal blocked','non-image rejected','image routing','uncertain send not retried']}));
 }
}finally{await client.close();if(mock)await new Promise(r=>mock.close(r));}
