import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import WebSocket from 'ws';
import {endpoint} from './backend.mjs';

// OneBot's message_seq can be a signed hash. Ordering belongs to this queue.
export class Events {
  constructor(configFile,account,{capacity=1000,ttl=1800000}={}) {
    Object.assign(this,{configFile,account,capacity,ttl});
    this.session=randomUUID();this.seq=0;this.floor=0;this.rows=[];this.seen=new Map();this.evicted=new Map();this.evictionFloor=0;this.bytes=0;
    this.bus=new EventEmitter();this.bus.setMaxListeners(40);
    this.connected=false;this.stopped=false;this.generation=0;this.delay=1000;
  }
  status(){return {connected:this.connected,cursor:this.cursor(this.seq),buffered:this.rows.length,connection_generation:this.generation,retention_limit:this.capacity,retention_ms:this.ttl};}
  cursor(n){return `${this.session}:${n}:${this.generation}`;}
  prune(){while(this.rows.length && (this.rows.length>this.capacity || this.bytes>16*1024*1024 || Date.now()-this.rows[0].received>this.ttl)){const r=this.rows.shift();this.floor=r.seq;this.bytes-=r.bytes;this.seen.delete(r.key);this.evicted.delete(r.peer);this.evicted.set(r.peer,r.seq);if(this.evicted.size>4096){const [key,seq]=this.evicted.entries().next().value;this.evictionFloor=Math.max(this.evictionFloor,seq);this.evicted.delete(key);}}}
  lostAfter(pos,a){const targets=a.target_ids||(a.target_type?[{target_type:a.target_type,target_id:a.target_id}]:null);return targets?pos<this.evictionFloor||targets.some(t=>pos<(this.evicted.get(`${t.target_type}:${t.target_id}`)||0)):pos<this.floor;}
  accept(e){
    if(String(e.self_id)!==this.account) return;
    const poke=e.post_type==='notice'&&e.notice_type==='notify'&&e.sub_type==='poke';
    if(poke){
      const operator=String(e.sender_id??e.operator_id??e.user_id),target=String(e.target_id);
      if(!/^\d+$/.test(operator)||!/^\d+$/.test(target))return;
      const type=e.group_id?'group':'private';const peer=String(e.group_id||(String(e.user_id)!==this.account?e.user_id:operator!==this.account?operator:target));
      e={event_type:'poke',time:e.time,operator_id:operator,target_user_id:target,target_type:type,target_id:peer,...(e.group_id?{group_id:String(e.group_id)}:{}),incoming:target===this.account&&operator!==this.account,is_self_action:operator===this.account,count:1,source_event_id:e.event_id??e.message_id};
    }else{
      if(e.post_type!=='message' || String(e.user_id)===this.account)return;
      if(!['group','private'].includes(e.message_type)||e.message_id==null)return;
      e={...e,event_type:'message',target_type:e.message_type,target_id:String(e.group_id||e.user_id)};
    }
    const peer=`${e.target_type}:${e.target_id}`;
    // NapCat poke notices normally have no unique source ID. Do not collapse
    // legitimate repeated pokes with identical second-resolution timestamps.
    const key=poke?`${peer}:poke:${e.source_event_id??randomUUID()}`:`${peer}:message:${e.message_id}`;
    this.prune();if(this.seen.has(key))return;
    const bytes=Buffer.byteLength(JSON.stringify(e));this.bytes+=bytes;
    this.seen.set(key,true);this.rows.push({seq:++this.seq,key,peer,bytes,received:Date.now(),event:e});this.prune();this.bus.emit('change');
  }
  async start(){
    if(this.stopped || this.connecting || this.ws?.readyState===WebSocket.OPEN)return;
    this.connecting=true;
    try {
      const s=await endpoint(this.configFile,'ws');
      if(this.stopped)return;
      const ws=this.ws=new WebSocket(`ws://127.0.0.1:${s.port}${s.path}`,{headers:{Authorization:`Bearer ${s.token}`},maxPayload:2*1024*1024,handshakeTimeout:5000});
      let lastSeen=Date.now();
      const heartbeat=setInterval(()=>{if(Date.now()-lastSeen>90000)ws.terminate();else if(ws.readyState===WebSocket.OPEN)ws.ping();},30000);heartbeat.unref();
      ws.on('pong',()=>{lastSeen=Date.now();});
      ws.on('open',()=>{this.connected=true;this.delay=1000;this.bus.emit('change');});
      ws.on('message',b=>{lastSeen=Date.now();try{this.accept(JSON.parse(b.toString()));}catch{}});
      ws.on('error',()=>{});
      ws.on('close',()=>{clearInterval(heartbeat);this.connected=false;this.generation++;this.bus.emit('change');this.retry();});
    } catch {this.retry();} finally {this.connecting=false;}
  }
  retry(){if(this.stopped)return;clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>this.start(),this.delay);this.retryTimer.unref();this.delay=Math.min(30000,this.delay*2);}
  close(){this.stopped=true;clearTimeout(this.retryTimer);this.ws?.terminate();this.bus.emit('change');}
  matches(e,a){
    const type=e.target_type||e.message_type,target=String(e.target_id??e.group_id??e.user_id);
    if(a.target_type && (type!==a.target_type || target!==a.target_id))return false;
    if(a.target_ids&&!a.target_ids.some(t=>t.target_type===type&&t.target_id===target))return false;
    if(a.user_id && String(e.operator_id??e.user_id)!==a.user_id)return false;
    if(e.event_type==='poke')return (!a.only_at_me||e.target_user_id===this.account)&&(!a.event_types||a.event_types.includes('poke'));
    const segments=Array.isArray(e.message)?e.message:[];
    if(a.only_at_me && !segments.some(x=>x.type==='at'&&String(x.data?.qq)===this.account))return false;
    if(a.event_types?.length && !a.event_types.some(t=>t==='message'||segments.some(x=>x.type===t)))return false;
    return true;
  }
  async wait(a,signal){
    this.prune();let pos=this.seq,gap=false,reason,invalid=false;
    const gen=this.generation;
    if(a.after_event_id){
      const [session,num,generation]=a.after_event_id.split(':');
      if(session!==this.session || !/^\d+$/.test(num||'') || !/^\d+$/.test(generation||'') || Number(num)>this.seq){gap=true;invalid=true;reason='cursor_expired_or_server_restarted';}
      else {pos=Number(num);if(Number(generation)!==gen){gap=true;reason='connection_interrupted';}}
    } else if(a.after_message_seq){
      const row=this.rows.findLast(r=>this.matches(r.event,{target_type:a.target_type,target_id:a.target_id})&&String(r.event.message_seq??r.event.message_id)===a.after_message_seq);
      if(row)pos=row.seq;else{gap=true;invalid=true;reason='message_anchor_not_in_event_buffer';}
    }
    const deadline=Date.now()+(a.timeout_ms??30000);let batchUntil=null;let found=[];
    while(!invalid) {
      if(signal?.aborted)throw Error('等待已取消。');
      this.prune();if(this.lostAfter(pos,a)){gap=true;reason='event_buffer_overflow';}
      found=this.rows.filter(r=>r.seq>pos&&this.matches(r.event,a));
      if(found.length && batchUntil===null)batchUntil=Math.min(deadline,Date.now()+200);
      const remaining=Math.min(deadline,batchUntil??deadline)-Date.now();
      if(remaining<=0 || found.length>=100 || this.stopped || gap)break;
      await new Promise((resolve,reject)=>{
        const finish=()=>{clearTimeout(timer);this.bus.off('change',finish);signal?.removeEventListener('abort',abort);resolve();};
        const abort=()=>{finish();reject(Error('等待已取消。'));};
        const timer=setTimeout(finish,remaining);this.bus.once('change',finish);signal?.addEventListener('abort',abort,{once:true});
      });
      if(this.generation!==gen){gap=true;reason='connection_interrupted';}
    }
    if(!this.connected){gap=true;reason=reason||'event_connection_unavailable';}
    const selected=found.slice(0,100),end=found.length>100?selected.at(-1).seq:this.seq;
    const batch=selected.map(r=>({...r.event,event_id:this.cursor(r.seq)}));const messages=batch.filter(e=>e.event_type==='message');
    return {events:batch,messages,latest_message_seq:a.target_type&&messages.length?String(messages.at(-1).message_seq??messages.at(-1).message_id):null,next_cursor:this.cursor(end),timed_out:!gap&&!selected.length,connected:this.connected,connection_generation:this.generation,cursor_gap:gap,gap_reason:reason,history_check_required:gap,more_available:found.length>100};
  }
}
