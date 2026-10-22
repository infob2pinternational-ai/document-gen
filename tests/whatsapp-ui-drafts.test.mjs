import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import ts from'typescript';
const source=readFileSync(new URL('../src/services/whatsappDrafts.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText;
const{createWhatsAppDraftStore}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const scope={userId:'synthetic-user',companyId:'synthetic-company',conversationId:'synthetic-conversation'};
function fixture(){const m=new Map();const storage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};return {m,storage,store:createWhatsAppDraftStore(()=>storage)};}
test('draft text survives a fresh store without normalization',()=>{const{store,storage}=fixture();store.save(scope,'  Text\n ');assert.equal(createWhatsAppDraftStore(()=>storage).load(scope).text,'  Text\n ');});
test('all three identity dimensions isolate draft text',()=>{const{store}=fixture();store.save(scope,'private draft');for(const key of Object.keys(scope))assert.equal(store.load({...scope,[key]:'other'}).text,'');});
test('late successful send cannot erase newer draft',()=>{const{store}=fixture();store.save(scope,'new');store.confirmSend(scope,'old');assert.equal(store.load(scope).text,'new');store.confirmSend(scope,'new');assert.equal(store.load(scope).text,'');});
test('storage failure preserves memory and reports unavailable persistence',()=>{const{store,storage}=fixture();storage.setItem=()=>{throw Error('synthetic');};assert.equal(store.save(scope,'retained'),false);assert.deepEqual(store.load(scope),{text:'retained',storageOK:false});});
test('explicit discard clears only its scoped text',()=>{const{store}=fixture();store.save(scope,'one');store.save({...scope,userId:'other'},'two');store.discard(scope);assert.equal(store.load(scope).text,'');assert.equal(store.load({...scope,userId:'other'}).text,'two');});
test('composer still does not call unsupported media endpoints',()=>{const s=readFileSync(new URL('../src/components/WhatsAppInbox.tsx',import.meta.url),'utf8');assert.doesNotMatch(s,/whatsapp-media|media_id/);});

test('unresolved request survives reload, edits and discard; blocks repeated submission',()=>{
 const{store,storage}=fixture();store.save(scope,'kept');const id=store.beginSend(scope,'kept');
 const fresh=createWhatsAppDraftStore(()=>storage);assert.equal(fresh.load(scope).pending.id,id);
 fresh.save(scope,'new draft');assert.throws(()=>fresh.beginSend(scope,'new draft'),/unresolved/);
 fresh.discard(scope);assert.equal(createWhatsAppDraftStore(()=>storage).load(scope).pending.id,id);
});
test('explicit rejection preserves text but unlocks a new intentional attempt',()=>{
 const{store}=fixture();store.save(scope,'kept');const id=store.beginSend(scope,'kept');store.rejectSend(scope,id);
 assert.equal(store.load(scope).text,'kept');assert.equal(store.load(scope).pending,undefined);assert.notEqual(store.beginSend(scope,'kept'),id);
});
test('confirmed acceptance clears pending reference while preserving newer text on disk',()=>{
 const{store,storage}=fixture();store.save(scope,'sent');store.beginSend(scope,'sent');store.save(scope,'new');store.confirmSend(scope,'sent');
 const actual=createWhatsAppDraftStore(()=>storage).load(scope);assert.equal(actual.pending,undefined);assert.equal(actual.text,'new');
});
test('storage failure blocks dispatch preparation without losing text',()=>{
 const{store,storage}=fixture();store.save(scope,'kept');storage.setItem=()=>{throw Error('synthetic');};
 assert.throws(()=>store.beginSend(scope,'kept'),/nothing was sent/);assert.equal(store.load(scope).text,'kept');assert.equal(store.load(scope).pending,undefined);
});
