import {downloadQQImage,readAllowed} from './media.mjs';

// Only try sources actually returned by OneBot. Never move signed URLs to guessed hosts.
export async function resolveMessageImage(file,{api,roots,known,download=downloadQQImage,read=readAllowed,signal}={}){
  const attempts=[];let original;const budget=AbortSignal.timeout(20000);const bounded=signal?AbortSignal.any([signal,budget]):budget;
  const capture=(stage,error)=>{original??=error;attempts.push({stage,error:String(error.message).replace(/https?:\/\/\S+/g,'[URL redacted]').slice(0,300)});};
  const trySources=async(data,stage)=>{
    const sources=[...new Set([data?.file,data?.file_path,data?.url].filter(v=>typeof v==='string'&&v))];
    if(!sources.length)capture(stage,Error('SnowLuma 未返回可读取的图片。'));
    for(const source of sources){signal?.throwIfAborted();if(budget.aborted)break;try{return /^https?:\/\//i.test(source)?await download(source,{signal:bounded}):await read(source,roots);}catch(e){capture(stage,e);}}
  };
  const get=async(stage)=>{signal?.throwIfAborted();if(budget.aborted)return;try{return await trySources(await api('get_image',{file},{signal:bounded}),stage);}catch(e){if(signal?.aborted)throw e;capture(stage,e);}};
  let bytes=await get('get_image');if(bytes)return bytes;
  // Refresh one previously observed parent message, checking the same file identity.
  const messageId=known&&Date.now()-known.at<3600000?[...known.ids].at(-1):null;
  if(messageId&&!budget.aborted){
    signal?.throwIfAborted();
    try{
      const message=await api('get_msg',{message_id:messageId},{signal:bounded});
      const segment=Array.isArray(message?.message)?message.message.find(s=>s.type==='image'&&s.data?.file===file):null;
      if(segment){bytes=await trySources({url:segment.data.url},'refreshed_message');if(bytes)return bytes;}
    }catch(e){if(signal?.aborted)throw e;capture('get_msg',e);}
  }
  bytes=await get('get_image_refresh');if(bytes)return bytes;
  const error=Error('图片读取失败（已尝试备用来源和刷新）：'+(attempts[0]?.error||'未知错误'));
  error.media_details={original_error:attempts[0]?.error,attempts};error.cause=original;throw error;
}
