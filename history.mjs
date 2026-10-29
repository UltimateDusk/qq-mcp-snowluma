export function historyParams(a){
  if(a.message_seq!==undefined)throw Error('SnowLuma 翻页使用消息 ID，不能使用消息序号 message_seq。请刷新工具列表，传入上一页返回的 next_message_id 至 message_id；读取最新页时省略这两个参数。');
  const p={[a.target_type==='group'?'group_id':'user_id']:a.target_id,count:a.count};
  if(a.message_id!==undefined){const n=Number(a.message_id);if(!Number.isInteger(n)||n < -2147483648||n>2147483647)throw Error('SnowLuma message_id 必须是返回过的有符号 32 位消息 ID。');p.message_id=n;}
  return p;
}
export function historyResult(data,a,compact){
  if(!Array.isArray(data?.messages))throw Error('历史接口返回格式异常，缺少 messages 数组。');
  const messages=data.messages.map(compact);
  return {messages,next_message_id:messages.length?String(messages[0].message_id):null,pagination_hint:'下一页使用最旧消息的 message_id；接口可能包含锚点消息，按 message_id 去重。',...(messages.length?{}:{status:'empty_or_unavailable',history_complete:false,hint:a.target_type==='group'?'SnowLuma 返回空结果。2.2.1 需要先收到该群消息以取得历史查询锚点；尚未收到、锚点不可用或上游无法取回历史均可能导致空结果，不代表该群没有聊天记录。可在该群出现新消息后重试。':'SnowLuma 返回空历史，不能据此确认该会话从未有过消息。'})};
}
