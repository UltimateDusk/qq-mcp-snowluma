import {readAllowed,imageMime,preview,downloadQQImage} from './media.mjs';

export class Favorites {
  constructor(api,roots){this.api=api;this.roots=roots;}
  async rows(){
    const data=await this.api('fetch_custom_face_detail',{count:2000});
    if(!Array.isArray(data))throw Error('当前 SnowLuma 未返回收藏表情列表。');
    return data.filter(r=>r.md5||r.resId).map(r=>({...r,sticker_id:r.md5?String(r.md5).toUpperCase():String(r.resId)}));
  }
  async find(id){const r=(await this.rows()).find(r=>r.sticker_id===id);if(!r)throw Error('此 ID 不在当前 QQ 收藏表情列表内，请重新查询。');return r;}
  async bytes(r){
    for(const file of [r.emoOriginalPath,r.emoPath].filter(Boolean)) {try{return await readAllowed(file,this.roots);}catch{}}
    return downloadQQImage(r.url);
  }

  async list({offset=0,limit=20,query,include_previews=false}){
    const all=await this.rows();const filtered=all.filter(r=>!query||[r.desc,r.modifyWord,r.ocrWord,r.sticker_id].some(x=>String(x||'').includes(query)));
    const items=[];const previews=[];
    for(const r of filtered.slice(offset,offset+limit)) {
      const item={sticker_id:r.sticker_id,name:r.desc||r.modifyWord||r.ocrWord||null,type:'unknown',preview:{tool:'qq_get_favorite_sticker',sticker_id:r.sticker_id}};
      try {
        const b=include_previews?await this.bytes(r):await readAllowed(r.emoOriginalPath||r.emoPath,this.roots);item.type=imageMime(b)==='image/gif'?'gif':'image';
        if(include_previews){previews.push({type:'text',text:JSON.stringify({sticker_id:r.sticker_id})},...(await preview(b,{mode:'first_frame'})).content);}
      }catch{item.preview_unavailable=true;}
      items.push(item);
    }
    return {content:[{type:'text',text:JSON.stringify({total:filtered.length,total_may_be_truncated:all.length>=2000,offset,items,next_offset:offset+limit<filtered.length?offset+limit:null})},...previews]};
  }
}
