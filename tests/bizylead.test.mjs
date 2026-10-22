import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import handler from '../api/bizylead-webhook.js';

function response() {
  return {headers:{},statusCode:0,setHeader(k,v){this.headers[k]=v;},status(c){this.statusCode=c;return this;},json(v){this.body=v;return this;},end(){this.ended=true;}};
}
test('GET receiver ping is informational, not proof of callback processing',async()=>{
  const res=response(); await handler({method:'GET'},res);
  assert.equal(res.statusCode,200); assert.equal(res.body.status,'ok');
});
test('OPTIONS remains compatible',async()=>{
  const res=response();await handler({method:'OPTIONS'},res);assert.equal(res.statusCode,200);assert.equal(res.ended,true);
});
for(const headers of [{},{authorization:'Bearer synthetic-only'},{'x-hub-signature-256':'sha256=synthetic'},{'x-bizylead-signature':'synthetic'}]) {
  test('callbacks fail closed before body access or side effects: '+Object.keys(headers).join(','),async()=>{
    const transport=mock.method(https,'request',()=>{throw Error('Unexpected network');});
    const logger=mock.method(console,'log',()=>{throw Error('Payload must not be logged');});
    try{
      const req={method:'POST',headers,get body(){throw Error('Body must not be read');}};
      const res=response();await handler(req,res);
      assert.equal(res.statusCode,503);assert.equal(transport.mock.callCount(),0);assert.equal(logger.mock.callCount(),0);
      assert.match(res.body.error,/verification is not configured/);
    }finally{mock.restoreAll();}
  });
}
