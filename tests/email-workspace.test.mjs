import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailHandler, createEmailRepository, publicAccount } from '../server/emailWorkspace.js';
import { encryptCredentials, decryptCredentials, accountSettings, resolveMailHost } from '../server/emailSecurity.js';

const company='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const id='33333333-3333-4333-8333-333333333333', sendId='44444444-4444-4444-8444-444444444444';
const env={EMAIL_ENCRYPTION_KEY:'01'.repeat(32),EMAIL_ALLOWED_HOSTS:'mail.synthetic.test',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-test-key'};
const settings={name:'Synthetic Inbox',email:'owner@example.test',imap_host:'mail.synthetic.test',imap_port:993,imap_user:'owner@example.test',smtp_host:'mail.synthetic.test',smtp_port:587,smtp_user:'owner@example.test'};
const account={...settings,id,company_id:company,credentials_encrypted:encryptCredentials({imapPassword:'synthetic-imap',smtpPassword:'synthetic-smtp'},company,id,env)};
const request=(action,method='GET',body)=>({method,query:{company_id:company,account_id:id,action},body});
function response() { return {code:0,data:null,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}}; }
function setup(extra={}) {
  const events=[], claims=new Set();
  const repo={
    async list(){return [account];}, async get(accountId){events.push(['get',accountId]);return account;},
    async save(value){events.push(['save',value]);return value;},async remove(accountId){events.push(['remove',accountId]);},
    async claim(key){if(claims.has(key))return false;claims.add(key);return true;},async finish(key,status){events.push(['finish',status]);}
  };
  const handler=createEmailHandler({env,authorize:async()=>({user:{id:'synthetic-user'}}),companyAccess:async()=>true,repository:(scope,user)=>{events.push(['scope',scope,user]);return repo;},resolveHost:async()=>({host:'8.8.8.8',servername:'mail.synthetic.test'}),...extra});
  return {handler,events,repo,claims};
}

test('encryption hides passwords and authenticates the account/company context',()=>{
  assert.ok(!account.credentials_encrypted.includes('synthetic-imap'));
  assert.equal(decryptCredentials(account.credentials_encrypted,company,id,env).imapPassword,'synthetic-imap');
  assert.throws(()=>decryptCredentials(account.credentials_encrypted,other,id,env));
  assert.throws(()=>decryptCredentials(account.credentials_encrypted,company,sendId,env));
});

test('account settings allow TLS ports and approved hosts only',()=>{
  assert.equal(accountSettings(settings,env).smtp_port,587);
  assert.throws(()=>accountSettings({...settings,imap_port:143},env));
  assert.throws(()=>accountSettings({...settings,smtp_host:'127.0.0.1'},env));
  assert.throws(()=>accountSettings({...settings,imap_user:'bad\r\nuser'},env));
});

test('mail endpoint resolution rejects private addresses and pins a public address',async()=>{
  await assert.rejects(resolveMailHost('mail.synthetic.test',env,async()=>[{address:'127.0.0.1'}]),/public addresses/);
  await assert.rejects(resolveMailHost('mail.synthetic.test',env,async()=>[{address:'10.0.0.1'}]),/public addresses/);
  const resolved=await resolveMailHost('mail.synthetic.test',env,async()=>[{address:'8.8.8.8'}]);
  assert.deepEqual(resolved,{host:'8.8.8.8',servername:'mail.synthetic.test'});
});

test('account responses omit encrypted credentials and all unexpected properties',()=>{
  const value=publicAccount({...account,password:'must-not-return',extra:'private'});
  assert.equal(value.email,settings.email);
  assert.ok(!('credentials_encrypted' in value));assert.ok(!('password' in value));assert.ok(!('extra' in value));
});

test('unauthenticated requests never create a repository or call mail transports',async()=>{
  const {handler,events}=setup({authorize:async(req,res)=>{res.status(401).json({error:'Sign in'});return null;}});
  const res=response();await handler(request('inbox'),res);
  assert.equal(res.code,401);assert.deepEqual(events,[]);
});

test('denied company access never reads mailbox accounts',async()=>{
  const {handler,events}=setup({companyAccess:async(auth,scope,res)=>{res.status(403).json({error:'Denied'});return false;}});
  const res=response();await handler(request('inbox'),res);
  assert.equal(res.code,403);assert.deepEqual(events,[]);
});

test('account list is scoped and redacted',async()=>{
  const {handler,events}=setup();const res=response();await handler(request('accounts'),res);
  assert.equal(res.code,200);assert.equal(events[0][1],company);
  assert.equal(res.data.accounts[0].email,settings.email);
  assert.ok(!('credentials_encrypted' in res.data.accounts[0]));
});

test('new account stores ciphertext and never echoes submitted passwords',async()=>{
  const {handler,events}=setup();const res=response();await handler(request('accounts','POST',{...settings,imap_password:'synthetic-in',smtp_password:'synthetic-out'}),res);
  assert.equal(res.code,200);
  const saved=events.find(event=>event[0]==='save')[1];
  assert.equal(decryptCredentials(saved.credentials_encrypted,company,saved.id,env).smtpPassword,'synthetic-out');
  assert.ok(!JSON.stringify(res.data).includes('synthetic-out'));
});

test('editing account with blank passwords preserves the previous encrypted passwords',async()=>{
  const {handler,events}=setup();const res=response();await handler(request('accounts','PATCH',{...settings,id,imap_password:'',smtp_password:''}),res);
  assert.equal(res.code,200);
  const saved=events.find(event=>event[0]==='save')[1];
  assert.equal(decryptCredentials(saved.credentials_encrypted,company,id,env).imapPassword,'synthetic-imap');
});

test('inbox uses a read-only lock, returns newest first, and closes its connection',async()=>{
  const calls=[];
  const client={mailbox:{exists:2,uidValidity:42n},async connect(){calls.push('connect');},async getMailboxLock(path,options){assert.equal(path,'INBOX');assert.equal(options.readOnly,true);return {release(){calls.push('release');}};},async *fetch(range){assert.equal(range,'1:2');yield {uid:5,envelope:{subject:'Older'},flags:new Set(['\\Seen'])};yield {uid:6,envelope:{subject:'Newer'},flags:new Set()};},close(){calls.push('close');}};
  const {handler}=setup({makeImap:options=>{assert.equal(options.logger,false);assert.equal(options.host,'8.8.8.8');return client;}});
  const res=response();await handler(request('inbox'),res);
  assert.equal(res.code,200);assert.deepEqual(res.data.messages.map(m=>m.uid),[6,5]);assert.equal(res.data.uidValidity,'42');
  assert.deepEqual(calls,['connect','release','close']);
});

test('changed UID validity does not fetch or open the wrong message',async()=>{
  let fetched=false;
  const client={mailbox:{uidValidity:43n},async connect(){},async getMailboxLock(){return {release(){}};},async fetchOne(){fetched=true;},close(){}};
  const {handler}=setup({makeImap:()=>client});const req=request('message');req.query.uid='5';req.query.uid_validity='42';
  const res=response();await handler(req,res);assert.equal(res.code,409);assert.equal(fetched,false);
});

test('message bodies are plain text and size limits are enforced before downloading source',async()=>{
  let fetches=0;
  const client={mailbox:{uidValidity:42n},async connect(){},async getMailboxLock(){return {release(){}};},async fetchOne(){fetches++;return {size:3*1024*1024};},close(){}};
  const {handler}=setup({makeImap:()=>client});const req=request('message');req.query.uid='5';req.query.uid_validity='42';
  const res=response();await handler(req,res);assert.equal(res.code,413);assert.equal(fetches,1);
});

const mailBody={request_id:sendId,to:'recipient@example.test',subject:'Synthetic message',text:'Not sent to a real provider.'};
test('two simultaneous requests with one ID invoke SMTP once',async()=>{
  let sent=0;
  const {handler}=setup({makeSmtp:options=>{assert.equal(options.requireTLS,true);assert.equal(options.tls.servername,'mail.synthetic.test');return {async verify(){},async sendMail(message){sent++;assert.equal(message.from.address,settings.email);assert.equal(message.to,mailBody.to);return {accepted:[mailBody.to]};},close(){}};}});
  const a=response(),b=response();await Promise.all([handler(request('send','POST',{...mailBody,from:'forged@example.test'}),a),handler(request('send','POST',mailBody),b)]);
  assert.equal(sent,1);assert.deepEqual([a.code,b.code].sort(),[200,409]);
});

test('ambiguous SMTP failure is held for review and cannot be resent with the same ID',async()=>{
  let sent=0;const {handler,events}=setup({makeSmtp:()=>({async verify(){},async sendMail(){sent++;throw new Error('synthetic timeout after DATA');},close(){}})});
  const a=response();await handler(request('send','POST',mailBody),a);assert.equal(a.code,202);assert.equal(a.data.status,'uncertain');
  const b=response();await handler(request('send','POST',mailBody),b);assert.equal(b.code,409);assert.equal(sent,1);assert.ok(events.some(event=>event[1]==='uncertain'));
});

test('post-acceptance storage failure retains the original claim and prevents a repeat send',async()=>{
  let sent=0;const {handler,repo}=setup({makeSmtp:()=>({async verify(){},async sendMail(){sent++;return {accepted:[mailBody.to]};},close(){}})});
  repo.finish=async()=>{throw new Error('synthetic database outage');};
  const a=response();await handler(request('send','POST',mailBody),a);assert.equal(a.data.status,'uncertain');
  const b=response();await handler(request('send','POST',mailBody),b);assert.equal(b.code,409);assert.equal(sent,1);
});

test('SMTP verification failure never invokes sendMail',async()=>{
  let sent=0;const {handler}=setup({makeSmtp:()=>({async verify(){throw new Error('synthetic authentication failure');},async sendMail(){sent++;},close(){}})});
  const res=response();await handler(request('send','POST',mailBody),res);assert.equal(res.code,502);assert.equal(res.data.status,'failed');assert.equal(sent,0);
});

test('invalid recipient lists are rejected without constructing SMTP',async()=>{
  let constructed=false;const {handler}=setup({makeSmtp:()=>{constructed=true;}});
  const res=response();await handler(request('send','POST',{...mailBody,to:'one@example.test,two@example.test'}),res);
  assert.equal(res.code,400);assert.equal(constructed,false);
});

test('repository uses company filters on every operation and atomic insert-on-conflict for send claims',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{calls.push({url,options});return {ok:true,status:200,async json(){return [{...account,status:'sending'}];}};};
  const repo=createEmailRepository(company,'synthetic-user',env,fetcher);
  await repo.list();await repo.get(id);await repo.claim(sendId,id);await repo.finish(sendId,'accepted');
  for(const call of calls)assert.ok(call.url.includes(`company_id=eq.${company}`));
  assert.ok(!calls[0].url.includes('credentials_encrypted'));
  assert.match(calls[2].options.headers.Prefer,/resolution=ignore-duplicates/);
  assert.equal(JSON.parse(calls[2].options.body).company_id,company);
});

test('opening a message returns only plain-text content without exposing HTML or attachments',async()=>{
  const client={mailbox:{uidValidity:42n},async connect(){},async getMailboxLock(){return {release(){}};},async fetchOne(uid,query,options){assert.equal(uid,5);assert.equal(options.uid,true);return query.source ? {source:Buffer.from('synthetic MIME')} : {size:128};},close(){}};
  const {handler}=setup({makeImap:()=>client,parse:async()=>({subject:'Synthetic subject',from:{text:'Sender <sender@example.test>',value:[{address:'sender@example.test'}]},text:'Safe text content',html:'<script>not returned</script>',attachments:[{content:'not returned'}]})});
  const req=request('message');req.query.uid='5';req.query.uid_validity='42';
  const res=response();await handler(req,res);assert.equal(res.code,200);assert.equal(res.data.message.text,'Safe text content');
  assert.equal(res.data.message.replyTo,'sender@example.test');assert.ok(!('html' in res.data.message));assert.ok(!('attachments' in res.data.message));
});

test('changing a provider endpoint cannot silently reuse the previous provider password',async()=>{
  const {handler,events}=setup({env:{...env,EMAIL_ALLOWED_HOSTS:'mail.synthetic.test,other.synthetic.test'}});
  const res=response();await handler(request('accounts','PATCH',{...settings,id,imap_host:'other.synthetic.test',imap_password:'',smtp_password:''}),res);
  assert.equal(res.code,400);assert.match(res.data.error,/Re-enter the password/);
  assert.ok(!events.some(event=>event[0]==='save'));
});
