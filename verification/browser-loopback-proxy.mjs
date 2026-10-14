import http from 'node:http';
// Isolated test proxy. Never resolve or connect to an external target.
export function createLoopbackProxy(port=5193){
 const proxy=http.createServer((req,res)=>{
  let target;try{target=new URL(req.url);}catch{res.writeHead(403);res.end('Blocked');return;}
  if(!['localhost','127.0.0.1'].includes(target.hostname)||target.port!==String(port)||target.protocol!=='http:') {res.writeHead(403);res.end('Non-local test traffic blocked');return;}
  const upstream=http.request(target,{method:req.method,headers:req.headers},response=>{
   res.writeHead(response.statusCode,response.headers);
   response.on('aborted',()=>res.destroy());response.on('error',()=>res.destroy());
   response.pipe(res);
  });
  upstream.on('error',()=>{if(res.headersSent){res.destroy();return;}res.writeHead(502);res.end('Local server unavailable');});req.pipe(upstream);
 });
 proxy.on('connect',(_req,socket)=>socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
 return proxy;
}
