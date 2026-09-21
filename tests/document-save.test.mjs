import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const url = s => `data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;

test('document client confirms the complete bundle before changing the local cache', async () => {
  const stub = url(`export const calls=[]; export let failure=true;
    export function fail(value){ failure=value; }
    export const isSupabaseConfigured=()=>true;
    export const supabase={async rpc(name,args){calls.push({name,args});
      if(failure)return {error:{message:'Simulated database failure'}};
      return {data:name==='delete_document_bundle'?args.p_id:{...args.p_document,status:'pending_approval'}};
    }};`);
  let { outputText } = ts.transpileModule(readFileSync(new URL('../src/services/db.ts',import.meta.url),'utf8'), {
    compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}
  });
  for(const [name,source] of Object.entries({ './supabaseClient':stub, './sheetsSyncQueue':url('export function enqueueSync(){}'), jszip:url('export default class JSZip {}') })) {
    outputText=outputText.replace(`'${name}'`,JSON.stringify(source));
  }
  const {dbService}=await import(url(outputText.replaceAll('import.meta.env.DEV','false')));
  const transport=await import(stub);
  const oldStorage=globalThis.localStorage;
  const store=new Map([['supabase_user','{"id":"staff"}']]);
  globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
  try {
    const doc={id:'document',company_id:'company',document_type:'comparison_invoice',status:'approved'};
    const config={options:[{id:'option',rows:[{quantity:4,rate:20000}],totalValue:80000}]};
    store.set('docgen_documents',JSON.stringify([doc]));
    const before=store.get('docgen_documents');
    await assert.rejects(dbService.saveDocument(doc,[],config),/not saved/);
    assert.equal(store.get('docgen_documents'),before);
    assert.equal(store.has('docgen_comparison_doc_document'),false);
    assert.equal(transport.calls[0].name,'save_document_bundle');
    assert.deepEqual(transport.calls[0].args.p_comparison,config);
    transport.fail(false);
    await dbService.saveDocument(doc,[],config);
    assert.equal(doc.status,'pending_approval');
    assert.deepEqual(JSON.parse(store.get('docgen_comparison_doc_document')),config);
    transport.fail(true);
    await assert.rejects(dbService.deleteDocument(doc.id),/database failure/);
    assert.equal(JSON.parse(store.get('docgen_documents')).length,1);
    store.delete('supabase_user');
    const callCount=transport.calls.length;
    await assert.rejects(dbService.saveDocument(doc,[],config),/sign in again/);
    assert.equal(transport.calls.length,callCount);
    await assert.rejects(dbService.getPublicDocument({id:doc.id}),/Could not load/);
  } finally {
    if(oldStorage===undefined)delete globalThis.localStorage; else globalThis.localStorage=oldStorage;
  }
});
