import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import https from 'node:https';
import handler from '../api/whatsapp.js';

for(const scenario of [
 {name:'accepted',status:200,body:{messageId:'provider-synthetic'},expected:200,outcome:'accepted'},
 {name:'missing provider ID',status:200,body:{success:true},expected:502,outcome:'uncertain'},
 {name:'rejected',status:400,body:{error:'synthetic rejection'},expected:400,outcome:'rejected'},
 {name:'response lost',networkError:true,expected:502,outcome:'uncertain'},
])test('actual Bizylead send handler: '+scenario.name,async()=>{
 const saved={...process.env};
 process.env.SUPABASE_URL='https://auth.invalid';process.env.SUPABASE_ANON_KEY='synthetic';
 process.env.BIZYLEAD_API_KEY='synthetic';process.env.BIZYLEAD_PHONE_NUMBER_ID='synthetic-phone-id';
 process.env.BIZYLEAD_BASE_URL='https://provider.invalid/api/v2/whatsapp-business';
 const company='11111111-1111-4111-8111-111111111111';
 mock.method(globalThis,'fetch',async url=>Response.json(url.endsWith('/auth/v1/user')?{id:'synthetic-user'}:[{id:company}]));
 mock.method(console,'warn',()=>{});mock.method(console,'error',()=>{});
 const transport=mock.method(https,'request',(url,options,onResponse)=>{
  assert.equal(url,'https://provider.invalid/api/v2/whatsapp-business/messages');
  assert.equal(options.headers.Authorization,'Bearer synthetic');
  const req=new EventEmitter();req.setTimeout=()=>req;req.write=body=>{assert.equal(JSON.parse(body).phoneNoId,'synthetic-phone-id');};
  req.end=()=>queueMicrotask(()=>{
   if(scenario.networkError){req.emit('error',new Error('synthetic timeout'));return;}
   const res=new EventEmitter();res.statusCode=scenario.status;onResponse(res);res.emit('data',JSON.stringify(scenario.body));res.emit('end');
  });return req;
 });
 try{
  const requestId='22222222-2222-4222-8222-222222222222';
  const req=Readable.from([JSON.stringify({company_id:company,phone:'0000000000',text:'Synthetic only'})]);
  Object.assign(req,{method:'POST',query:{action:'send-message'},headers:{authorization:'Bearer synthetic','x-request-id':requestId}});
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.statusCode=c;return this;},json(v){this.body=v;return this;}};
  await handler(req,res);assert.equal(res.statusCode,scenario.expected);assert.equal(res.body.outcome,scenario.outcome);assert.equal(transport.mock.callCount(),1);
  assert.equal(res.headers['X-Request-ID'],requestId);
  if(scenario.outcome!=='accepted')assert.equal(res.body.messageId,undefined);
 }finally{mock.restoreAll();for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
