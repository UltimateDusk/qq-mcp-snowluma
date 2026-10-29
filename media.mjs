import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const MAX_BYTES = 10 * 1024 * 1024;
const decode = {limitInputPixels: 40000000};
export async function downloadQQImage(value){
  const url=new URL(value);
  const allowed=url.hostname==='qpic.cn'||url.hostname.endsWith('.qpic.cn')||url.hostname==='multimedia.nt.qq.com';
  if(!allowed||!['https:','http:'].includes(url.protocol)||url.port||url.username||url.password)throw Error('协议端返回的图片地址不在允许的 QQ 图片域名内。');
  url.protocol='https:';
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('QQ 图片下载失败：HTTP '+response.status);
  let size=0;const parts=[];
  for await(const part of response.body){size+=part.length;if(size>MAX_BYTES)throw Error('图片超过 10 MiB。');parts.push(part);}
  const bytes=Buffer.concat(parts);if(!imageMime(bytes))throw Error('协议端返回的内容不是受支持的图片。');return bytes;
}
export function imageMime(b) {
  if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if(b[0]===255 && b[1]===216 && b[2]===255) return 'image/jpeg';
  if(/^GIF8[79]a$/.test(b.subarray(0,6).toString())) return 'image/gif';
  if(b.subarray(0,4).toString()==='RIFF' && b.subarray(8,12).toString()==='WEBP') return 'image/webp';
  return null;
}
export async function readAllowed(source, roots) {
  const real=await fs.realpath(source);
  let allowed=false;
  for(const r of roots) { try {
    const root=await fs.realpath(r);
    const rel=path.relative(root,real);
    if(rel && !rel.startsWith('..'+path.sep) && rel!=='..' && !path.isAbsolute(rel)) allowed=true;
  } catch {} }
  if(!allowed) throw new Error('图片路径不在允许的 QQ 缓存目录内。');
  if((await fs.stat(real)).size>MAX_BYTES) throw new Error('图片超过 10 MiB。');
  const b=await fs.readFile(real);
  if(b.length>MAX_BYTES || !imageMime(b)) throw new Error('图片过大或格式不受支持。');
  return b;
}
export async function preview(b, {mode='contact_sheet',max_frames=6}={}) {
  if(b.length>MAX_BYTES || !imageMime(b)) throw new Error('仅支持不超过 10 MiB 的 PNG/JPEG/GIF/WebP。');
  const m=await sharp(b,decode).metadata();
  const pages=m.pages||1, height=m.pageHeight||m.height;
  if(pages>1000 || m.width*height>40000000) throw new Error('动图帧数或尺寸超过安全解码上限。');
  const n=mode==='first_frame'?1:Math.min(pages,max_frames);
  const indices=Array.from({length:n},(_,i)=>n===1?0:Math.round(i*(pages-1)/(n-1)));
  const info={format:m.format,width:m.width,height,frame_count:pages,duration_ms:m.delay?.reduce((a,v)=>a+v,0)??null,sampled_frames:indices.map(i=>i+1),preview_only:true};
  const content=[{type:'text',text:JSON.stringify(info)}];
  const frame=async(i,size)=>sharp(b,{...decode,page:i,pages:1}).rotate().resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).png().toBuffer();
  const image=data=>({type:'image',mimeType:'image/png',data:data.toString('base64')});
  if(n===1 || mode==='frames') {
    for(const i of indices) content.push(image(await frame(i,n===1?1600:512)));
  } else {
    content.push(image(await frame(0,800)));
    const cells=[];const cols=Math.min(3,n),w=256,h=282;
    for(let j=0;j<n;j++) {
      const cell=await sharp(await frame(indices[j],256)).resize(256,256,{fit:'contain',background:'#eeeeee'}).png().toBuffer();
      cells.push({input:cell,left:(j%cols)*w,top:Math.floor(j/cols)*h});
      const label=Buffer.from(`<svg width="256" height="26"><rect width="256" height="26" fill="white"/><text x="8" y="19" font-size="14">Frame ${indices[j]+1} / ${pages}</text></svg>`);
      cells.push({input:label,left:(j%cols)*w,top:Math.floor(j/cols)*h+256});
    }
    content.push(image(await sharp({create:{width:cols*w,height:Math.ceil(n/cols)*h,channels:4,background:'#ffffff'}}).composite(cells).png().toBuffer()));
  }
  return {content};
}
