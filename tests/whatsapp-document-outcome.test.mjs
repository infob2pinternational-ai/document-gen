import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {loadWhatsAppService} from './load-utils.mjs';

test('document API errors never open a fallback or log a confirmed send',async()=>{
 let logged=0;globalThis.__syntheticDocumentDb={logWhatsAppSend:async()=>{logged++;}};
 const service=await loadWhatsAppService('export const supabase=null;export const isCloudActive=()=>false;export const dbService=globalThis.__syntheticDocumentDb;');
 const oldWindow=globalThis.window;globalThis.window={location:{origin:'http://127.0.0.1'},open(){throw Error('Unexpected fallback');}};
 const transport=mock.method(globalThis,'fetch',async()=>Response.json({error:'synthetic'},{status:400}));
 const doc={id:'synthetic',status:'approved',customer_phone:'0000000000',total:100,date:'2026-10-15',document_number:'SYNTHETIC',document_type:'invoice',customer_name:'Synthetic'};
 try{
  assert.equal((await service.sendDocument(doc,'Synthetic','synthetic@example.invalid')).success,false);assert.equal(logged,0);
  transport.mock.mockImplementation(async()=>Response.json({success:true}));
  assert.equal((await service.sendDocument(doc,'Synthetic','synthetic@example.invalid')).success,false);assert.equal(logged,0);
  transport.mock.mockImplementation(async()=>Response.json({success:true,messageId:'provider-synthetic'}));
  assert.equal((await service.sendDocument(doc,'Synthetic','synthetic@example.invalid')).success,true);assert.equal(logged,1);
 }finally{mock.restoreAll();globalThis.window=oldWindow;delete globalThis.__syntheticDocumentDb;}
});
