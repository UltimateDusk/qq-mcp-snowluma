import fs from 'node:fs/promises';
import path from 'node:path';

export class SendLedger {
  constructor(file){this.file=file;this.queue=Promise.resolve();this.waiting=0;}
  async execute(request_id,digest,operation,{signal,beforeDispatch,onCancelledBeforeDispatch,onDispatch,onOutcome}={}){
    if(this.waiting>=32)throw Error('发送队列已满，尚未提交；稍后复用同一 request_id。');
    this.waiting++;const entered=Date.now();
    const run=this.queue.then(async()=>{
      let ledger={};try{ledger=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
      const previous=ledger[request_id];
      const unknown=(reason,extra={})=>({status:'unknown',request_id,reason,retry_same_request_id:true,resend_performed:false,instruction:'仅复用原 request_id 查询结果；禁止更换 ID 重发。先读取历史人工核对。',...extra});
      if(previous){
        if(previous.digest!==digest)throw Error('request_id 已用于其他消息或操作。');
        if(previous.state==='sent')return {...previous.result,status:'sent',request_id,deduplicated:true};
        return unknown(previous.reason||'previous_attempt_unconfirmed',{deduplicated:true});
      }
      const cancelled=async(reason='cancelled_before_dispatch')=>{try{await onCancelledBeforeDispatch?.(reason);}catch{}return {status:'failed',request_id,reason,dispatched:false,retry_same_request_id:true};};
      if(signal?.aborted||Date.now()-entered>(beforeDispatch?45000:12000)) return cancelled();
      if(beforeDispatch){try{await beforeDispatch(signal);}catch(e){if(signal?.aborted)return cancelled();throw e;}}
      if(signal?.aborted)return cancelled();
      const save=async()=>{await fs.mkdir(path.dirname(this.file),{recursive:true});await fs.writeFile(this.file+'.tmp',JSON.stringify(ledger),'utf8');await fs.rename(this.file+'.tmp',this.file);};
      ledger[request_id]={digest,state:'pending',at:new Date().toISOString()};await save();
      let result;
      try{await onDispatch?.();result=await operation();}catch(e){
        const reason=e.reason||'upstream_result_ambiguous';ledger[request_id].reason=reason;
        try{await save();}catch{} // The pre-dispatch pending record still blocks replay.
        try{await onOutcome?.({status:'unknown',reason});}catch{}
        return unknown(reason);
      }
      ledger[request_id]={digest,state:'sent',at:new Date().toISOString(),result};
      try{await onOutcome?.({status:'sent',result});}catch{}
      try{await save();}catch{return {...result,status:'sent',request_id,ledger_warning:'result_not_persisted_retries_will_be_blocked'};}
      return {...result,status:'sent',request_id};
    }).finally(()=>{this.waiting--;});
    this.queue=run.catch(()=>{});return run;
  }
}
