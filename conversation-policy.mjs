// Priority and conversational signals are hints, never authorization or proof of identity.
export class ConversationPolicy {
  constructor(account,{aiIds=[],now=Date.now}={}){this.account=account;this.aiIds=new Set(aiIds.map(String));this.now=now;this.sent=new Map();}
  recordSent(peer,id){if(id==null)return;this.sent.set(`${peer}:${id}`,this.now());for(const [key,time] of this.sent)if(this.now()-time>1800000)this.sent.delete(key);while(this.sent.size>1000)this.sent.delete(this.sent.keys().next().value);}
  classify(event){
    const segments=Array.isArray(event.message)?event.message:[];
    const text=segments.filter(s=>s.type==='text').map(s=>String(s.data?.text||'')).join('').trim();
    const peer=`${event.target_type}:${event.target_id}`;
    const at=segments.some(s=>s.type==='at'&&String(s.data?.qq)===this.account);
    const reply=segments.some(s=>s.type==='reply'&&this.sent.has(`${peer}:${s.data?.id}`));
    const question=/[?？]|(?:吗|么|如何|为什么|怎么|能否|请问)/u.test(text);
    const low=!text||/^(?:哈|呵|嘿|嘻|[\s!！。，,.~～]|[\p{Emoji_Presentation}])+$/u.test(text);
    const ai=this.aiIds.has(String(event.user_id??event.operator_id));
    // Explicit automation language is only a weak style signal; quotes/jokes can match.
    const style=/(?:作为.{0,8}(?:AI|人工智能|语言模型)|我是.{0,4}(?:AI|机器人)|工具调用|request_id|flow_lease_token)/iu.test(text);
    return {priority:at||reply||question?'high':low?'low':'normal',priority_reason:at?'at_me':reply?'reply_to_me':question?'question_heuristic':low?'low_information':'chat',speaker_kind:ai?'configured_ai':'unknown',suspected_ai:!ai&&style,identity_is_inferred:!ai};
  }
  activity(rows,peer){
    const recent=rows.filter(r=>r.peer===peer&&this.now()-r.received<=120000&&r.event.event_type==='message').slice(-100);
    const ai=recent.filter(r=>this.classify(r.event).speaker_kind==='configured_ai');
    const suspects=recent.filter(r=>this.classify(r.event).suspected_ai);
    return {recent_message_count:recent.length,configured_ai_messages:ai.length,unknown_messages:recent.length-ai.length,active_ai_count:new Set([...ai,...suspects].map(r=>String(r.event.user_id))).size,style_signal_count:suspects.length,identity_note:'未知账号不等于真人；风格信号不能证明身份。'};
  }
  decorate(events){
    const annotated=events.map(e=>({...e,...this.classify(e)}));
    const rank={high:0,normal:1,low:2};
    return {events:annotated,reply_order:annotated.map((e,i)=>({e,i})).sort((a,b)=>rank[a.e.priority]-rank[b.e.priority]||a.i-b.i).map(x=>x.e.event_id)};
  }
}
