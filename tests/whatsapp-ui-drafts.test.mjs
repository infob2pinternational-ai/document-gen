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
test('UI release does not call media endpoints or pass new dispatch fields',()=>{const s=readFileSync(new URL('../src/components/WhatsAppInbox.tsx',import.meta.url),'utf8');assert.doesNotMatch(s,/whatsapp-media|media_id|request_id|draftUserId|beginDispatch|persisted/);});
