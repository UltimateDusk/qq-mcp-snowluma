import fs from 'node:fs/promises';

export async function endpoint(file,kind){
  const c=JSON.parse(await fs.readFile(file,'utf8'));
  const snow=Boolean(c.networks);
  const rows=kind==='http'?(snow?c.networks.httpServers:c.network.httpServers):(snow?c.networks.wsServers:c.network.websocketServers);
  const name=kind==='http'?'qq-mcp-local':'qq-mcp-events';
  const s=rows?.find(s=>s.name===name&&(snow?s.enabled:s.enable));
  const token=s&&(snow?s.accessToken:s.token);
  if(!token||!['127.0.0.1','localhost'].includes(s.host)||!Number.isInteger(s.port)||s.port<1||s.port>65535)throw Error('本机 OneBot 接口配置不可用。');
  return {port:s.port,token,path:snow?(s.path||'/'):(kind==='http'?'/':'/event')};
}
