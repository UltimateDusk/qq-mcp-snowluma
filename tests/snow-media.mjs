import assert from 'node:assert/strict';
import {downloadQQImage} from '../media.mjs';
const original=globalThis.fetch;
let calls=0;
try{
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(url.protocol,'https:');assert.equal(options.redirect,'error');return new Response(Buffer.from('GIF89a'));};
  for(const url of ['https://example.com/x','http://127.0.0.1/x','https://qpic.cn.example.com/x','https://user@qpic.cn/x','https://qpic.cn:3000/x','file:///x','https://multimedia.nt.qq.com.cn.example.com/x','https://evil.multimedia.nt.qq.com.cn/x','https://multimedia.nt.qq.com.cn@127.0.0.1/x','https://multimedia.nt.qq.com.cn:3000/x'])await assert.rejects(downloadQQImage(url));
  assert.equal(calls,0);
  assert.equal((await downloadQQImage('http://gchat.qpic.cn/x')).toString(),'GIF89a');
  for(const host of ['multimedia.nt.qq.com','multimedia.nt.qq.com.cn']){
    assert.equal((await downloadQQImage('https://'+host+'/download?appid=1407')).toString(),'GIF89a');
    assert.equal((await downloadQQImage('http://'+host+'/download?appid=1406')).toString(),'GIF89a');
  }
  globalThis.fetch=async()=>new Response('not an image');
  await assert.rejects(downloadQQImage('https://multimedia.nt.qq.com/x'));
  globalThis.fetch=async()=>new Response(Buffer.alloc(10*1024*1024+1));
  await assert.rejects(downloadQQImage('https://gchat.qpic.cn/x'));
  console.log('PASS SnowLuma remote image domain, HTTPS, format and size guards');
}finally{globalThis.fetch=original;}
