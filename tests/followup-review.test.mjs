import test from 'node:test';
import assert from 'node:assert/strict';
import {dayBounds,summarizeReview,createFollowupReviewHandler} from '../server/followupReview.js';
import { requireOwner } from '../server/auth.js';
const response=()=>({code:0,body:null,setHeader(){},status(n){this.code=n;return this;},json(data){this.body=data;}});
test('India day boundaries and invalid dates',()=>{
 assert.deepEqual(dayBounds('2026-10-20'),['2026-10-19T18:30:00.000Z','2026-10-20T18:30:00.000Z']);
 assert.throws(()=>dayBounds('2026-02-30'));assert.throws(()=>dayBounds(''));
});
test('separates completed, moved later, and self-reported contact outcomes; flags open repeated tasks',()=>{
 const events=[['completed','completed'],['postponed','no_answer'],['postponed','not_contacted'],['rescheduled','customer_callback']].map(([event_type,outcome])=>({event_type,outcome,actor_email:'staff@example.test'}));
 const result=summarizeReview(events,[{current_status:'PENDING',postponement_count:2},{current_status:'COMPLETED',postponement_count:3},{current_status:'PENDING',postponement_count:2,deleted:true}]);
 assert.deepEqual(result.totals,[{staff:'staff@example.test',completed:1,postponed:2,customer_callback:1,no_answer:1,not_contacted:1}]);assert.equal(result.flagged.length,1);
});
test('authorization denial and company denial never read private rows',async()=>{
 let reads=0;const request=async()=>{reads++;throw Error('must not read');};
 let res=response();await createFollowupReviewHandler({authorize:async(req,res)=>{res.status(403).json({error:'Owner only'});return null;},request})({method:'GET'},res);
 assert.equal(res.code,403);
 res=response();await createFollowupReviewHandler({authorize:async()=>({}),companyAccess:async(a,c,res)=>{res.status(403).json({error:'Company denied'});return false;},request})({method:'GET'},res);
 assert.equal(res.code,403);assert.equal(reads,0);
});
test('company-filtered pages continue through server row caps; failures report errors',async()=>{
 const previous=process.env.SUPABASE_SERVICE_ROLE_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-key';
 try{
 const urls=[];const handler=createFollowupReviewHandler({authorize:async()=>({url:'https://synthetic.invalid'}),companyAccess:async()=>true,request:async(url)=>{
 urls.push(url);const parsed=new URL(url);const offset=Number(parsed.searchParams.get('offset'));
 return {ok:true,json:async()=>offset===0 ? (url.includes('events?') ? [{actor_email:'staff@example.test',event_type:'completed'}] : [{current_status:'PENDING',postponement_count:2}]) : []};
 }});
 const res=response();await handler({method:'GET',query:{company_id:'synthetic-company',day:'2026-10-20'}},res);
 assert.equal(res.code,200);assert.equal(res.body.totals[0].completed,1);assert.equal(urls.length,4);
 assert.ok(urls.every(url=>new URL(url).searchParams.get('company_id')==='eq.synthetic-company'));
 const failed=response();await createFollowupReviewHandler({authorize:async()=>({url:'https://synthetic.invalid'}),companyAccess:async()=>true,request:async()=>({ok:false})})({method:'GET',query:{company_id:'synthetic-company',day:'2026-10-20'}},failed);
 assert.equal(failed.code,503);
 }finally{if(previous===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=previous;}
});
test('real authorization boundary denies Email-only staff and inaccessible companies before service-role reads',async()=>{
 const originalFetch=globalThis.fetch;
 const names=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'];const previous=names.map(name=>process.env[name]);
 process.env.SUPABASE_URL='https://synthetic.invalid';process.env.SUPABASE_ANON_KEY='synthetic-anon';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service';
 try{
 let mode='staff';const calls=[];
 globalThis.fetch=async(url)=>{
 calls.push(url);
 if(url.endsWith('/auth/v1/user'))return {ok:true,json:async()=>({id:'synthetic-user',email:mode==='staff'?'fransonputhukkara@gmail.com':'owner@b2p.com'})};
 if(url.endsWith('/rpc/current_app_role'))return {ok:true,json:async()=>'staff'};
 if(url.includes('/profiles?'))return {ok:true,json:async()=>[]};
 throw Error('Private data must not be read');
 };
 const req={method:'GET',headers:{authorization:'Bearer synthetic-session'},query:{company_id:'11111111-1111-4111-8111-111111111111',day:'2026-10-20'}};
 let res=response();await createFollowupReviewHandler()(req,res);assert.equal(res.code,403);
 mode='owner';res=response();await createFollowupReviewHandler()(req,res);assert.equal(res.code,403);
 assert.ok(calls.every(url=>!url.includes('followup_review_')));
 }finally{globalThis.fetch=originalFetch;names.forEach((name,i)=>{if(previous[i]===undefined)delete process.env[name];else process.env[name]=previous[i];});}
});


test('Franson review access requires confirmed Auth identity and company access, without Owner privileges', async()=>{
 const originalFetch=globalThis.fetch;
 const names=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'];const previous=names.map(name=>process.env[name]);
 process.env.SUPABASE_URL='https://synthetic.invalid';process.env.SUPABASE_ANON_KEY='synthetic-anon';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service';
 let email='fransonputhukkara@gmail.com',confirmed=true,companyAllowed=true;
 let privateReads=0;
 const company='11111111-1111-4111-8111-111111111111';
 try {
  globalThis.fetch=async(url)=>{
   if(url.endsWith('/auth/v1/user'))return {ok:true,json:async()=>({id:'synthetic-user',email,email_confirmed_at:confirmed?'2026-10-01T00:00:00Z':null})};
   if(url.endsWith('/rpc/current_app_role'))return {ok:true,json:async()=>'staff'};
   if(url.includes('/profiles?'))return {ok:true,json:async()=>companyAllowed?[{id:company}]:[]};
   if(url.includes('/followup_review_')){
    privateReads++;
    assert.equal(new URL(url).searchParams.get('company_id'),`eq.${company}`);
    return {ok:true,json:async()=>[]};
   }
   throw Error('Unexpected request');
  };
  const req={method:'GET',headers:{authorization:'Bearer synthetic-session'},query:{company_id:company,day:'2026-10-20'}};
  let res=response();await createFollowupReviewHandler()(req,res);assert.equal(res.code,200);assert.equal(privateReads,2);
  res=response();assert.equal(await requireOwner(req,res),null);assert.equal(res.code,403);
  for(const scenario of ['company','unconfirmed','other','unsigned']){
   companyAllowed=scenario!=='company';confirmed=scenario!=='unconfirmed';email=scenario==='other'?'other@example.test':'fransonputhukkara@gmail.com';
   const before=privateReads;res=response();
   await createFollowupReviewHandler()({...req,headers:scenario==='unsigned'?{}:req.headers,body:{email:'fransonputhukkara@gmail.com',role:'owner'}},res);
   assert.equal(res.code,scenario==='unsigned'?401:403,scenario);assert.equal(privateReads,before,scenario);
  }
  email='owner@b2p.com';confirmed=true;companyAllowed=true;res=response();await createFollowupReviewHandler()(req,res);assert.equal(res.code,200);
 } finally {globalThis.fetch=originalFetch;names.forEach((name,i)=>{if(previous[i]===undefined)delete process.env[name];else process.env[name]=previous[i];});}
});
