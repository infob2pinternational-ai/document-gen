import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { requireOwner, requireOwnerOrAdmin } from '../server/auth.js';
import { requireEmailAccess } from '../server/emailAccess.js';
import { requireFollowupReviewAccess } from '../server/followupReview.js';
const response=()=>({code:0,status(code){this.code=code;return this;},json(data){this.data=data;return this;}});
test('verified Admin gets operational APIs but never the Owner approval boundary',async()=>{
 const original=globalThis.fetch;
 const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_ANON_KEY;
 process.env.SUPABASE_URL='https://synthetic.invalid';process.env.SUPABASE_ANON_KEY='synthetic';
 let role='admin';
 globalThis.fetch=async url=>({ok:true,json:async()=>url.endsWith('/auth/v1/user')?{id:'test-admin',email:'admin@example.test',email_confirmed_at:'2026-10-01'}:role});
 const req={headers:{authorization:'Bearer synthetic'},body:{role:'owner'}};
 try {
  for(const authorize of [requireOwnerOrAdmin,requireEmailAccess,requireFollowupReviewAccess]) assert.ok(await authorize(req,response()));
  let res=response();assert.equal(await requireOwner(req,res),null);assert.equal(res.code,403);
  role='staff';
  for(const authorize of [requireOwnerOrAdmin,requireEmailAccess,requireFollowupReviewAccess]){res=response();assert.equal(await authorize(req,res),null);assert.equal(res.code,403);}
  role=null;res=response();assert.equal(await requireOwnerOrAdmin(req,res),null);assert.equal(res.code,403);
  globalThis.fetch=async()=>{throw Error('offline');};
  res=response();assert.equal(await requireOwnerOrAdmin(req,res),null);assert.equal(res.code,503);
 }finally{
  globalThis.fetch=original;
  for(const [key,value] of [['SUPABASE_URL',oldUrl],['SUPABASE_ANON_KEY',oldKey]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});
test('Admin company parity preserves database approval and role-escalation restrictions',async()=>{
 const db=new PGlite();
 const owner='11111111-1111-4111-8111-111111111111',admin='22222222-2222-4222-8222-222222222222',company='33333333-3333-4333-8333-333333333333',doc='44444444-4444-4444-8444-444444444444';
 try {
  await db.exec(readFileSync(new URL('./fixtures/production-document-schema.sql',import.meta.url),'utf8'));
  await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now()),($3,$4,now())',[owner,'sarathjohnpanengadan@gmail.com',admin,'fransonputhukkara@gmail.com']);
  await db.query('INSERT INTO profiles(id,name) VALUES($1,$2)',[company,'Test']);
  for(const file of ['20260918000000_live_crm_fields.sql','20260921000003_document_security_and_leads.sql']) await db.exec(readFileSync(new URL('../database/migrations/'+file,import.meta.url),'utf8'));
  await db.query('DELETE FROM app_company_members WHERE user_id=$1',[admin]);
  await db.exec(readFileSync(new URL('../docs/setup/admin-operational-access.sql',import.meta.url),'utf8'));
  await db.query("SELECT set_config('test.uid',$1,false)",[admin]);await db.exec('SET ROLE authenticated');
  assert.equal((await db.query('SELECT can_access_company($1) AS allowed',[company])).rows[0].allowed,true);
  const payload={id:doc,company_id:company,document_type:'invoice',document_number:'ADMIN/TEST',sequence_number:1,customer_name:'Test',total:0,subtotal:0};
  const saved=await db.query('SELECT save_document_bundle($1,$2,NULL) AS doc',[JSON.stringify(payload),'[]']);
  assert.equal(saved.rows[0].doc.status,'pending_approval');
  for(const approve of [true,false]) await assert.rejects(db.query('SELECT review_document($1,$2)',[doc,approve]),/Only the owner/);
  await db.query(`INSERT INTO crm_quotations(id,company_id,quotation_number,date,customer_name,phone,service_summary)
    VALUES($1,$2,'ADMIN/CRM',current_date,'Test','123','Service')`,[doc,company]);
  for(const status of ['APPROVED','REJECTED']) await assert.rejects(db.query('UPDATE crm_quotations SET approval_status=$1 WHERE id=$2',[status,doc]),/Only the owner/);
  await assert.rejects(db.query("UPDATE app_members SET role='owner' WHERE user_id=$1",[admin]),/permission denied/);
  await db.exec('RESET ROLE');await db.query("UPDATE app_members SET role='staff' WHERE user_id=$1",[admin]);await db.exec('SET ROLE authenticated');
  assert.equal((await db.query('SELECT can_access_company($1) AS allowed',[company])).rows[0].allowed,false);
 }finally{await db.close();}
});
