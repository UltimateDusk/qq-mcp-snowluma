import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const EMPTY=()=>({version:1,tokens:{},claims:{}});

export class ReplyClaims {
  constructor(file,logFile,account,{now=Date.now,tokenTtl=30*60*1000,reservedTtl=90*1000,terminalTtl=30*60*1000}={}){
    Object.assign(this,{file,logFile,account,now,tokenTtl,reservedTtl,terminalTtl});this.queue=Promise.resolve();
  }
  serial(fn){const run=this.queue.then(fn);this.queue=run.catch(()=>{});return run;}
  async load(){try{const s=JSON.parse(await fs.readFile(this.file,'utf8'));return s&&s.tokens&&s.claims?s:EMPTY();}catch(e){if(e.code==='ENOENT')return EMPTY();throw e;}}
  prune(s){const now=this.now();for(const [k,v] of Object.entries(s.tokens))if(!v||v.expires_at<=now)delete s.tokens[k];for(const [k,v] of Object.entries(s.claims))if(!v||v.expires_at<=now)delete s.claims[k];}
  async save(s){await fs.mkdir(path.dirname(this.file),{recursive:true});const tmp=this.file+'.tmp';await fs.writeFile(tmp,JSON.stringify(s),'utf8');await fs.rename(tmp,this.file);}
  async log(action,data={}){try{await fs.mkdir(path.dirname(this.logFile),{recursive:true});try{if((await fs.stat(this.logFile)).size>10*1024*1024){await fs.rm(this.logFile+'.1',{force:true});await fs.rename(this.logFile,this.logFile+'.1');}}catch{}await fs.appendFile(this.logFile,JSON.stringify({time:new Date(this.now()).toISOString(),action,...data})+'\n','utf8');}catch{}}
  meta(e,waitRequestId,flowId){
    const target_type=e.target_type||e.message_type,target_id=String(e.target_id??e.group_id??e.user_id??'');
    if(!['group','private'].includes(target_type)||!/^\d+$/.test(target_id)||typeof e.event_id!=='string')throw Error('事件缺少可用于回复保护的会话或 event_id。');
    const message_id=e.message_id==null?null:String(e.message_id);
    return {account:this.account,target_type,target_id,event_id:e.event_id,message_id,wait_request_id:String(waitRequestId??''),flow_id:flowId||null,issued_at:this.now()};
  }
  key(m){return [m.account,m.target_type,m.target_id,m.message_id==null?'event:'+m.event_id:'message:'+m.message_id].join('|');}
  async issueMany(events,{waitRequestId,flowId}={}){return this.serial(async()=>{
    const s=await this.load();this.prune(s);const issued={};
    for(const e of events){const token=randomUUID(),m=this.meta(e,waitRequestId,flowId);s.tokens[token]={...m,expires_at:this.now()+this.tokenTtl};issued[e.event_id]=token;}
    if(events.length){await this.save(s);await this.log('reply_tokens_issued',{flow_id:flowId||null,wait_request_id:String(waitRequestId??''),items:events.map(e=>({event_id:e.event_id,message_id:e.message_id==null?null:String(e.message_id),reply_token:issued[e.event_id],target_type:e.target_type,target_id:String(e.target_id)}))});}return issued;
  });}
  async acquire({tokens=[],legacyEvent,target_type,target_id,request_id,mcp_request_id,send_reason='reply',flow_id,execution_id,dedupe_key}){
    if(send_reason==='proactive'){await this.log('claim_skipped_proactive',{target_type,target_id,flow_id:flow_id||null,execution_id:execution_id||null,dedupe_key:dedupe_key||null,send_reason,send_request_id:request_id,mcp_request_id});return null;}
    return this.serial(async()=>{
      const s=await this.load();this.prune(s);let metas=[];let mode='token';
      for(const token of [...new Set(tokens)]){const m=s.tokens[token];if(!m)throw Error('reply_token 已过期或不属于当前 MCP 进程，请重新等待消息。');metas.push(m);}
      if(!metas.length&&legacyEvent){mode='legacy_latest_event';metas=[this.meta(legacyEvent,'legacy','legacy')];}
      if(!metas.length){await this.log('claim_unavailable_no_event',{target_type,target_id,flow_id:flow_id||null,execution_id:execution_id||null,send_reason,send_request_id:request_id,mcp_request_id});return null;}
      for(const m of metas)if(m.account!==this.account||m.target_type!==target_type||m.target_id!==target_id)throw Error('reply_token 与目标会话不匹配。');
      const unique=new Map(metas.map(m=>[this.key(m),m]));const keys=[...unique.keys()];
      const conflict=keys.map(k=>s.claims[k]).find(c=>c&&c.owner_request_id!==request_id);
      if(conflict){await this.log('claim_rejected',{target_type,target_id,source_event_id:conflict.event_id,source_message_id:conflict.message_id,flow_id:conflict.flow_id,execution_id:execution_id||null,reply_tokens:tokens,send_reason,wait_request_id:conflict.wait_request_id,send_request_id:request_id,mcp_request_id,claimed_by_request_id:conflict.owner_request_id,claim_state:conflict.state});return {ok:false,status:'blocked',reason:'incoming_event_already_claimed',source_event_id:conflict.event_id,source_message_id:conflict.message_id,claimed_by_request_id:conflict.owner_request_id,claim_state:conflict.state,resend_performed:false};}
      for(const [key,m] of unique){s.claims[key]={...m,key,mode,state:'reserved',owner_request_id:request_id,mcp_request_id,claimed_at:this.now(),expires_at:this.now()+this.reservedTtl};}
      const flow_ids=[...new Set([...unique.values()].map(m=>m.flow_id).filter(Boolean))];
      await this.save(s);const handle={ok:true,keys,request_id,target_type,target_id,mode,flow_ids,reply_tokens:tokens,execution_id:execution_id||null};
      await this.log('claim_acquired',{target_type,target_id,source_event_ids:[...unique.values()].map(m=>m.event_id),source_message_ids:[...unique.values()].map(m=>m.message_id).filter(Boolean),reply_tokens:tokens,flow_ids,execution_id:execution_id||null,send_reason,wait_request_ids:[...new Set([...unique.values()].map(m=>m.wait_request_id).filter(Boolean))],send_request_id:request_id,mcp_request_id,mode});return handle;
    });
  }
  async update(handle,state,data={}){if(!handle?.ok)return;return this.serial(async()=>{const s=await this.load();this.prune(s);let changed=false;for(const key of handle.keys){const c=s.claims[key];if(!c||c.owner_request_id!==handle.request_id)continue;c.state=state;c.expires_at=this.now()+this.terminalTtl;Object.assign(c,data);changed=true;}if(changed)await this.save(s);await this.log('claim_'+state,{target_type:handle.target_type,target_id:handle.target_id,flow_ids:handle.flow_ids,execution_id:handle.execution_id,reply_tokens:handle.reply_tokens,send_request_id:handle.request_id,keys:handle.keys,...data});});}
  dispatch(handle){return this.update(handle,'dispatched',{dispatched_at:this.now()});}
  finish(handle,status,data={}){return this.update(handle,status,{finished_at:this.now(),...data});}
  async release(handle,reason='cancelled_before_dispatch'){if(!handle?.ok)return;return this.serial(async()=>{const s=await this.load();this.prune(s);let changed=false;for(const key of handle.keys){const c=s.claims[key];if(c?.owner_request_id===handle.request_id&&c.state==='reserved'){delete s.claims[key];changed=true;}}if(changed)await this.save(s);await this.log('claim_released',{target_type:handle.target_type,target_id:handle.target_id,send_request_id:handle.request_id,reason,keys:handle.keys});});}
}
