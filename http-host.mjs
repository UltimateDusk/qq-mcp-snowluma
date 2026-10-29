import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';

// Each HTTP request owns a stateless MCP transport. Tool handlers and the
// event queue live outside it, so reconnecting HTTP clients cannot reset data.
export async function serveHTTP(createServer,{port,authorization,onClose}){
  const expected=Buffer.from(authorization);let active=0;
  const host=http.createServer(async(req,res)=>{
    // Static local bearer auth is not OAuth. Discovery must get 404/405,
    // rather than an authentication challenge implying a missing OAuth server.
    if(req.url!=='/mcp'&&req.url!=='/health'){res.writeHead(404).end();return;}
    if(req.url==='/mcp'&&req.method!=='POST'){res.writeHead(405,{'Allow':'POST'}).end();return;}
    const supplied=Buffer.from(req.headers.authorization||'');
    if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){res.writeHead(401).end();return;}
    if(req.headers.origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin)){res.writeHead(403).end();return;}
    if(req.url==='/health'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ready:true,transport:'stateless-streamable-http'}));return;}
    if(req.url!=='/mcp'){res.writeHead(404).end();return;}
    if(req.method!=='POST'){res.writeHead(405,{'Allow':'POST'}).end();return;}
    if(active>=32){res.writeHead(503).end();return;}
    let size=0;const chunks=[];
    try{for await(const chunk of req){size+=chunk.length;if(size>20*1024*1024){res.writeHead(413).end();return;}chunks.push(chunk);}}
    catch{return;}
    let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{res.writeHead(400).end();return;}
    active++;const server=createServer();
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    let closed=false;
    const cleanup=()=>{if(closed)return;closed=true;active--;void server.close();};
    res.once('close',cleanup);
    try{await server.connect(transport);await transport.handleRequest(req,res,body);}
    catch{if(!res.headersSent)res.writeHead(500).end(JSON.stringify({jsonrpc:'2.0',id:body?.id??null,error:{code:-32603,message:'MCP transport request failed; do not replay writes with a new request_id.'}}));cleanup();}
  });
  host.requestTimeout=90000;host.headersTimeout=10000;
  await new Promise((resolve,reject)=>{host.once('error',reject);host.listen(port,'127.0.0.1',resolve);});
  host.on('close',()=>onClose?.());return host;
}
