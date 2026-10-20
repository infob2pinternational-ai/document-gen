import test from 'node:test';
import assert from 'node:assert/strict';
import { requireEmailAccess } from '../server/emailAccess.js';
import { requireOwner } from '../server/auth.js';
import { createEmailHandler } from '../server/emailWorkspace.js';

function response() { return {code:0,data:null,setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}}; }
async function withIdentity(email, confirmed, run) {
  const previousFetch=globalThis.fetch;
  const previousUrl=process.env.SUPABASE_URL,previousKey=process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL='https://synthetic.invalid';process.env.SUPABASE_ANON_KEY='synthetic-key';
  globalThis.fetch=async url=>({ok:true,async json(){return String(url).endsWith('/auth/v1/user') ? {id:'synthetic-user',email,email_confirmed_at:confirmed?'2026-10-01T00:00:00Z':null} : 'staff';}});
  try { await run(); } finally {
    globalThis.fetch=previousFetch;
    if(previousUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=previousUrl;
    if(previousKey===undefined)delete process.env.SUPABASE_ANON_KEY;else process.env.SUPABASE_ANON_KEY=previousKey;
  }
}
const req={headers:{authorization:'Bearer synthetic-session'}};

test('Franson confirmed by Auth can use Email without becoming Owner',async()=>{
  await withIdentity('fransonputhukkara@gmail.com',true,async()=>{
    const emailRes=response();assert.ok(await requireEmailAccess(req,emailRes));
    const ownerRes=response();assert.equal(await requireOwner(req,ownerRes),null);assert.equal(ownerRes.code,403);
  });
});
test('other staff remain denied even when browser body claims Franson identity',async()=>{
  await withIdentity('other@example.test',true,async()=>{
    const res=response();assert.equal(await requireEmailAccess({...req,body:{email:'fransonputhukkara@gmail.com',role:'owner'}},res),null);assert.equal(res.code,403);
  });
});
test('an unconfirmed address does not qualify for Franson access',async()=>{
  await withIdentity('fransonputhukkara@gmail.com',false,async()=>{
    const res=response();assert.equal(await requireEmailAccess(req,res),null);assert.equal(res.code,403);
  });
});
test('Owner access is preserved',async()=>{
  await withIdentity('sarathjohnpanengadan@gmail.com',true,async()=>{assert.ok(await requireEmailAccess(req,response()));});
});
test('Franson still cannot access another company without company authorization',async()=>{
  await withIdentity('fransonputhukkara@gmail.com',true,async()=>{
    let read=false;
    const handler=createEmailHandler({companyAccess:async(auth,id,res)=>{res.status(403).json({error:'Company access denied'});return false;},repository:()=>{read=true;return {};}});
    const res=response();await handler({...req,method:'GET',query:{company_id:'11111111-1111-4111-8111-111111111111',action:'accounts'}},res);
    assert.equal(res.code,403);assert.equal(read,false);
  });
});
