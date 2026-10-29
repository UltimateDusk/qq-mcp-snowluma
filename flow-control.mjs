import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const EMPTY=()=>({version:2,flows:{},actions:{}});

export class FlowControl {
  constructor(file,logFile,account,{now=Date.now,leaseTtl=120000,closingGrace=30000,retention=30*60*1000}={}){
    Object.assign(this,{file,logFile,account,now,leaseTtl,closingGrace,retention});this.queue=Promise.resolve();
  }
  serial(fn){const run=this.queue.then(fn);this.queue=run.catch(()=>{});return run;}
  key(flow_id,target_type,target_id){return [this.account,target_type,target_id,flow_id].join('|');}
  async load(){try{const s=JSON.parse(await fs.readFile(this.file,'utf8'));if(!s?.flows||!s?.actions)return EMPTY();s.version=2;for(const flow of Object.values(s.flows))this.normalize(flow);return s;}catch(e){if(e.code==='ENOENT')return EMPTY();throw e;}}
  normalize(flow){
    flow.mode=flow.mode||'hard';flow.status=flow.status||'active';flow.ended_reason=flow.ended_reason??null;flow.ended_at=flow.ended_at??null;flow.last_activity_at=flow.last_activity_at||flow.started_at;
    if(flow.mode==='hard'){flow.target_at=null;flow.wind_down_at=null;flow.idle_end_ms=null;}
    else {flow.target_at=flow.target_at||flow.deadline_at;flow.wind_down_at=flow.wind_down_at||flow.target_at;flow.idle_end_ms=flow.idle_end_ms??null;}
    return flow;
  }
  async save(s){await fs.mkdir(path.dirname(this.file),{recursive:true});const tmp=this.file+'.tmp';await fs.writeFile(tmp,JSON.stringify(s),'utf8');await fs.rename(tmp,this.file);}
  async log(action,data={}){try{await fs.mkdir(path.dirname(this.logFile),{recursive:true});try{if((await fs.stat(this.logFile)).size>10*1024*1024){await fs.rm(this.logFile+'.1',{force:true});await fs.rename(this.logFile,this.logFile+'.1');}}catch{}await fs.appendFile(this.logFile,JSON.stringify({time:new Date(this.now()).toISOString(),action,...data})+'\n','utf8');}catch{}}
  finish(flow,reason,at=this.now()){flow.status='ended';flow.ended_reason=reason;flow.ended_at=at;}
  advanceFlow(flow){
    this.normalize(flow);if(flow.status==='ended')return false;const before=flow.status,now=this.now();
    if(flow.mode==='hard'){if(now>=flow.deadline_at)this.finish(flow,'deadline',flow.deadline_at);return before!==flow.status;}
    if(flow.status==='active'&&now>=flow.wind_down_at)flow.status='winding_down';
    if(now>=flow.deadline_at&&flow.status!=='ended'&&flow.status!=='closing'){flow.status='closing';flow.closing_at=flow.deadline_at;flow.closing_until=flow.deadline_at+this.closingGrace;}
    if(flow.status==='closing'&&now>flow.closing_until)this.finish(flow,'deadline',flow.closing_until);
    if(flow.status==='winding_down'&&flow.idle_end_ms!=null&&now>=flow.wind_down_at&&now-flow.last_activity_at>=flow.idle_end_ms)this.finish(flow,'idle_after_target',now);
    return before!==flow.status;
  }
  expire(s){
    const now=this.now();let changed=false;
    for(const [key,flow] of Object.entries(s.flows)){if(this.advanceFlow(flow))changed=true;if(flow.status==='ended'&&now-(flow.ended_at||flow.deadline_at)>this.retention){delete s.flows[key];changed=true;}}
    for(const [key,action] of Object.entries(s.actions))if(!action||action.expires_at<=now){delete s.actions[key];changed=true;}
    return changed;
  }
  waitLimit(flow){
    const now=this.now();if(!flow||['closing','ended'].includes(flow.status))return 0;const points=[flow.deadline_at];
    if(flow.mode==='soft'&&flow.status==='active')points.push(flow.wind_down_at);
    if(flow.mode==='soft'&&flow.status==='winding_down'&&flow.idle_end_ms!=null)points.push(Math.max(flow.wind_down_at,flow.last_activity_at+flow.idle_end_ms));
    return Math.max(0,Math.min(...points)-now);
  }
  view(flow){
    if(!flow)return null;this.normalize(flow);const now=this.now(),remaining=Math.max(0,flow.deadline_at-now);
    return {flow_id:flow.flow_id,target_type:flow.target_type,target_id:flow.target_id,mode:flow.mode,started_at:new Date(flow.started_at).toISOString(),target_at:flow.target_at?new Date(flow.target_at).toISOString():null,wind_down_at:flow.wind_down_at?new Date(flow.wind_down_at).toISOString():null,deadline_at:new Date(flow.deadline_at).toISOString(),remaining_ms:remaining,remaining_to_target_ms:flow.target_at?Math.max(0,flow.target_at-now):null,remaining_to_deadline_ms:remaining,flow_phase:flow.status,status:flow.status,ended_reason:flow.ended_reason??null,ended_at:flow.ended_at?new Date(flow.ended_at).toISOString():null,last_activity_at:new Date(flow.last_activity_at).toISOString(),idle_end_ms:flow.idle_end_ms,lease_owner:flow.lease?.owner??null,lease_generation:flow.lease?.generation??0,lease_expires_at:flow.lease?new Date(flow.lease.expires_at).toISOString():null};
  }
  blocked(reason,flow,extra={}){return {ok:false,status:['closing','ended'].includes(flow?.status)?flow.status:'blocked',reason,resend_performed:false,flow:this.view(flow),...extra};}
  createFlow({flow_id,target_type,target_id,duration_ms,target_duration_ms,max_duration_ms,idle_end_ms},now){
    if(duration_ms!=null)return {flow_id,target_type,target_id,mode:'hard',started_at:now,target_at:null,wind_down_at:null,deadline_at:now+duration_ms,idle_end_ms:null,last_activity_at:now,status:'active',ended_reason:null,ended_at:null,lease:null};
    if(target_duration_ms==null||max_duration_ms==null)return null;
    const windDownLead=Math.max(0,max_duration_ms-target_duration_ms);
    return {flow_id,target_type,target_id,mode:'soft',started_at:now,target_at:now+target_duration_ms,wind_down_at:now+Math.max(0,target_duration_ms-windDownLead),deadline_at:now+max_duration_ms,idle_end_ms:idle_end_ms??null,last_activity_at:now,status:'active',ended_reason:null,ended_at:null,lease:null};
  }
  async enter({flow_id,target_type,target_id,duration_ms,target_duration_ms,max_duration_ms,idle_end_ms,execution_id,lease_token,takeover=false,mcp_request_id,allowDeadlineReply=false,operation='unknown'}){
    if(!flow_id)return null;
    return this.serial(async()=>{
      const s=await this.load();const expired=this.expire(s);const key=this.key(flow_id,target_type,target_id);let flow=s.flows[key];const now=this.now();let created=false,takenOver=false;
      if(!flow){
        flow=this.createFlow({flow_id,target_type,target_id,duration_ms,target_duration_ms,max_duration_ms,idle_end_ms},now);
        if(!flow){if(expired)await this.save(s);return this.blocked('flow_not_initialized',null,{flow_id,target_type,target_id,instruction:'首次调用需提供 flow_duration_ms，或同时提供 flow_target_duration_ms 与 flow_max_duration_ms。'});}
        if(!execution_id){if(expired)await this.save(s);return this.blocked('flow_execution_id_required',null,{flow_id,target_type,target_id});}
        s.flows[key]=flow;created=true;this.advanceFlow(flow);
      }
      const closingReply=allowDeadlineReply&&((flow.mode==='hard'&&flow.status==='ended'&&flow.ended_reason==='deadline'&&now<=flow.deadline_at+this.closingGrace)||(flow.mode==='soft'&&flow.status==='closing'&&now<=flow.closing_until))&&execution_id&&flow.lease?.owner===execution_id&&lease_token===flow.lease.token;
      if(['closing','ended'].includes(flow.status)){
        if(!closingReply){if(expired||created)await this.save(s);return this.blocked(flow.ended_reason||'deadline',flow);}
        if(expired||created)await this.save(s);await this.log('flow_closing_reply_allowed',{flow_id,target_type,target_id,mode:flow.mode,execution_id,lease_generation:flow.lease.generation,mcp_request_id,operation});
        return {ok:true,key,flow_id,target_type,target_id,execution_id,lease_token,lease_generation:flow.lease.generation,closing:true,created:false,taken_over:false,flow:this.view(flow),wait_limit_ms:0};
      }
      if(!execution_id){if(expired||created)await this.save(s);return this.blocked('flow_execution_id_required',flow);}
      const lease=flow.lease;
      if(!lease||lease.expires_at<=now)flow.lease={owner:execution_id,token:randomUUID(),generation:(lease?.generation||0)+1,expires_at:now+this.leaseTtl};
      else if(lease.owner===execution_id&&(!lease_token||lease.token===lease_token))lease.expires_at=now+this.leaseTtl;
      else if(takeover){const previous=lease.owner;flow.lease={owner:execution_id,token:randomUUID(),generation:lease.generation+1,expires_at:now+this.leaseTtl};takenOver=true;await this.log('flow_lease_taken_over',{flow_id,target_type,target_id,mode:flow.mode,previous_execution_id:previous,execution_id,lease_generation:flow.lease.generation,mcp_request_id,operation});}
      else {if(expired||created)await this.save(s);const reason=lease_token?'flow_lease_lost':'flow_lease_held_by_other_execution';await this.log('flow_lease_rejected',{flow_id,target_type,target_id,mode:flow.mode,execution_id,lease_owner:lease.owner,lease_generation:lease.generation,mcp_request_id,operation,reason});return this.blocked(reason,flow,{lease_owner:lease.owner});}
      await this.save(s);const handle={ok:true,key,flow_id,target_type,target_id,execution_id,lease_token:flow.lease.token,lease_generation:flow.lease.generation,closing:false,created,taken_over:takenOver,flow:this.view(flow),wait_limit_ms:this.waitLimit(flow)};
      await this.log(created?'flow_started':'flow_lease_renewed',{flow_id,target_type,target_id,mode:flow.mode,started_at:new Date(flow.started_at).toISOString(),target_at:flow.target_at?new Date(flow.target_at).toISOString():null,wind_down_at:flow.wind_down_at?new Date(flow.wind_down_at).toISOString():null,deadline_at:new Date(flow.deadline_at).toISOString(),idle_end_ms:flow.idle_end_ms,flow_phase:flow.status,execution_id,lease_generation:flow.lease.generation,mcp_request_id,operation});return handle;
    });
  }
  async authorizeSend(handle,{send_reason,dedupe_key,request_id,mcp_request_id}){
    if(!handle?.ok)return null;
    return this.serial(async()=>{
      const s=await this.load();const expired=this.expire(s),flow=s.flows[handle.key],now=this.now();
      const reject=async(reason,row,extra={})=>{if(expired)await this.save(s);const error=Error(reason);error.flow_result=this.blocked(reason,row,extra);throw error;};
      if(!flow)return reject('flow_not_found',null);
      if(flow.lease?.token!==handle.lease_token||flow.lease.owner!==handle.execution_id||flow.lease.generation!==handle.lease_generation)return reject('flow_lease_lost',flow);
      if(send_reason==='reply'){
        if(flow.mode==='hard'&&flow.status==='ended'&&!(flow.ended_reason==='deadline'&&handle.closing))return reject(flow.ended_reason||'flow_ended',flow);
        if(flow.mode==='soft'&&flow.status==='ended')return reject(flow.ended_reason||'flow_ended',flow);
        if(flow.mode==='soft'&&flow.status==='closing'){
          if(!handle.closing)return reject('deadline',flow);
          if(flow.closing_reply&&flow.closing_reply.request_id!==request_id)return reject('closing_reply_already_claimed',flow,{claimed_by_request_id:flow.closing_reply.request_id,closing_state:flow.closing_reply.state});
          flow.closing_reply={request_id,execution_id:handle.execution_id,state:'reserved',reserved_at:now};flow.lease.expires_at=now+this.leaseTtl;await this.save(s);
          await this.log('flow_closing_reply_authorized',{flow_id:flow.flow_id,target_type:flow.target_type,target_id:flow.target_id,execution_id:handle.execution_id,lease_generation:handle.lease_generation,send_request_id:request_id,mcp_request_id});
          return {ok:true,kind:'closing',key:handle.key,request_id,flow_id:flow.flow_id,target_type:flow.target_type,target_id:flow.target_id,execution_id:handle.execution_id,lease_generation:handle.lease_generation};
        }
      }
      let action=null;
      if(send_reason==='proactive'){
        if(flow.mode==='hard'&&flow.status!=='active')return reject('deadline',flow);
        if(flow.mode==='soft'&&['closing','ended'].includes(flow.status))return reject('deadline',flow);
        if(flow.mode==='soft'&&now>=flow.target_at&&dedupe_key!=='closing')return reject('target_reached',flow,{instruction:'soft target 已到达；不要开启新话题。若需自然告别，使用稳定 dedupe_key=closing。'});
        if(!dedupe_key)return reject('proactive_dedupe_key_required',flow,{instruction:'持续会话主动消息必须提供稳定 dedupe_key，例如 opening。'});
        const actionKey=handle.key+'|'+dedupe_key,previous=s.actions[actionKey];
        if(previous&&previous.request_id!==request_id){await this.log('proactive_action_rejected',{flow_id:flow.flow_id,target_type:flow.target_type,target_id:flow.target_id,execution_id:handle.execution_id,lease_generation:handle.lease_generation,dedupe_key,send_request_id:request_id,claimed_by_request_id:previous.request_id,action_state:previous.state,mcp_request_id});return reject('proactive_action_already_claimed',flow,{dedupe_key,claimed_by_request_id:previous.request_id,action_state:previous.state});}
        s.actions[actionKey]={flow_key:handle.key,flow_id:flow.flow_id,target_type:flow.target_type,target_id:flow.target_id,dedupe_key,request_id,execution_id:handle.execution_id,lease_generation:handle.lease_generation,state:'reserved',reserved_at:now,expires_at:Math.max(flow.deadline_at+this.retention,now+this.retention)};
        action={ok:true,kind:'proactive',key:actionKey,flow_key:handle.key,request_id,flow_id:flow.flow_id,target_type:flow.target_type,target_id:flow.target_id,dedupe_key,execution_id:handle.execution_id,lease_generation:handle.lease_generation};
      }
      if(!['closing','ended'].includes(flow.status))flow.lease.expires_at=now+this.leaseTtl;await this.save(s);
      await this.log('flow_send_authorized',{flow_id:flow.flow_id,target_type:flow.target_type,target_id:flow.target_id,mode:flow.mode,flow_phase:flow.status,execution_id:handle.execution_id,lease_generation:handle.lease_generation,send_reason,dedupe_key:dedupe_key??null,send_request_id:request_id,mcp_request_id});return action;
    });
  }
  async updateAction(handle,state,data={}){
    if(!handle?.ok)return;
    return this.serial(async()=>{
      const s=await this.load();this.expire(s);
      if(handle.kind==='closing'){
        const flow=s.flows[handle.key];if(!flow?.closing_reply||flow.closing_reply.request_id!==handle.request_id)return;flow.closing_reply.state=state;flow.closing_reply[state+'_at']=this.now();Object.assign(flow.closing_reply,data);if(['sent','unknown'].includes(state))this.finish(flow,'deadline',this.now());await this.save(s);await this.log('flow_closing_reply_'+state,{flow_id:handle.flow_id,target_type:handle.target_type,target_id:handle.target_id,execution_id:handle.execution_id,lease_generation:handle.lease_generation,send_request_id:handle.request_id,...data});return;
      }
      const action=s.actions[handle.key];if(!action||action.request_id!==handle.request_id)return;action.state=state;action[state+'_at']=this.now();Object.assign(action,data);const flow=s.flows[handle.flow_key];if(flow?.mode==='soft'&&handle.dedupe_key==='closing'&&['sent','unknown'].includes(state))this.finish(flow,'target_reached',this.now());await this.save(s);await this.log('proactive_action_'+state,{flow_id:handle.flow_id,target_type:handle.target_type,target_id:handle.target_id,execution_id:handle.execution_id,lease_generation:handle.lease_generation,dedupe_key:handle.dedupe_key,send_request_id:handle.request_id,...data});
    });
  }
  dispatchAction(handle){return this.updateAction(handle,'dispatched');}
  finishAction(handle,status,data={}){return this.updateAction(handle,status,data);}
  async releaseAction(handle,reason='cancelled_before_dispatch'){
    if(!handle?.ok)return;
    return this.serial(async()=>{const s=await this.load();if(handle.kind==='closing'){const flow=s.flows[handle.key];if(flow?.closing_reply?.request_id===handle.request_id&&flow.closing_reply.state==='reserved'){delete flow.closing_reply;await this.save(s);}await this.log('flow_closing_reply_released',{flow_id:handle.flow_id,target_type:handle.target_type,target_id:handle.target_id,execution_id:handle.execution_id,send_request_id:handle.request_id,reason});return;}const action=s.actions[handle.key];if(action?.request_id===handle.request_id&&action.state==='reserved'){delete s.actions[handle.key];await this.save(s);}await this.log('proactive_action_released',{flow_id:handle.flow_id,target_type:handle.target_type,target_id:handle.target_id,execution_id:handle.execution_id,lease_generation:handle.lease_generation,dedupe_key:handle.dedupe_key,send_request_id:handle.request_id,reason});});
  }
  async completeWait(handle,{events,effectiveTimeout,mcp_request_id}={}){
    if(!handle?.ok)return handle?.flow??null;
    return this.serial(async()=>{const s=await this.load();const flow=s.flows[handle.key];if(!flow)return null;if(events>0)flow.last_activity_at=this.now();this.advanceFlow(flow);if(flow.mode==='soft'&&flow.status==='closing'&&!events)this.finish(flow,'deadline',this.now());await this.save(s);await this.log('flow_wait_completed',{flow_id:handle.flow_id,target_type:handle.target_type,target_id:handle.target_id,mode:flow.mode,flow_phase:flow.status,execution_id:handle.execution_id,lease_generation:handle.lease_generation,event_count:events??0,effective_timeout_ms:effectiveTimeout,mcp_request_id,ended_reason:flow.ended_reason??null});return this.view(flow);});
  }
  async end(handle,reason,mcp_request_id){
    if(!handle?.ok)return handle?.flow??null;if(!['target_reached','cancelled','error'].includes(reason))throw Error('Invalid flow end reason.');
    return this.serial(async()=>{const s=await this.load();this.expire(s);const flow=s.flows[handle.key];if(!flow)return null;if(flow.lease?.token!==handle.lease_token||flow.lease.owner!==handle.execution_id||flow.lease.generation!==handle.lease_generation){const error=Error('flow_lease_lost');error.flow_result=this.blocked('flow_lease_lost',flow);throw error;}if(reason==='target_reached'&&(flow.mode!=='soft'||this.now()<flow.wind_down_at)){const error=Error('target_not_in_wind_down');error.flow_result=this.blocked('target_not_in_wind_down',flow);throw error;}if(flow.status!=='ended'){this.finish(flow,reason,this.now());await this.save(s);}await this.log('flow_ended',{flow_id:handle.flow_id,target_type:handle.target_type,target_id:handle.target_id,mode:flow.mode,execution_id:handle.execution_id,lease_generation:handle.lease_generation,ended_reason:flow.ended_reason,mcp_request_id});return this.view(flow);});
  }
  async status(){return this.serial(async()=>{const s=await this.load();const changed=this.expire(s);if(changed)await this.save(s);return Object.values(s.flows).map(flow=>this.view(flow)).sort((a,b)=>b.started_at.localeCompare(a.started_at)).slice(0,20);});}
}
