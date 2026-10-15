import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {loadWhatsAppService} from './load-utils.mjs';

test('accepted provider send with database failure remains accepted but requires tracking review; no resend',async()=>{
 const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
 let inserts=0;
 globalThis.__whatsappSyntheticDb={from(){return {insert:async()=>{inserts++;return {error:{message:'Synthetic failure'}};}};}};
 const service=await loadWhatsAppService('export const supabase=globalThis.__whatsappSyntheticDb; export const isCloudActive=()=>true; export const dbService={};');
 const transport=mock.method(globalThis,'fetch',async()=>Response.json({success:true,messageId:'provider-synthetic'}));
 mock.method(console,'error',()=>{});
 try{
  const result=await service.sendMessage({requestId:'synthetic-request',conversationId:'synthetic-conversation',phone:'0000000000',text:'Synthetic',senderName:'Synthetic'});
  assert.equal(result.id,'synthetic-request');assert.equal(result.dispatch_outcome,'accepted');assert.equal(result.wa_message_id,'provider-synthetic');
  assert.match(result.error_message,/history persistence could not be verified/);assert.equal(transport.mock.callCount(),1);assert.equal(inserts,1);
 }finally{mock.restoreAll();delete globalThis.__whatsappSyntheticDb;}
});
