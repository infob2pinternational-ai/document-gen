import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const asModule = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const company = '11111111-1111-4111-8111-111111111111';
let instance = 0;
async function setup() {
  const storage = new Map([['supabase_user', '{"id":"user-a"}'], ['docgen_activity_cache_user','user-a'], ['docgen_lead_activities','[]']]);
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,String(value)), removeItem: key => storage.delete(key) };
  const requests = [];
  globalThis.activityTest = { requests };
  const stubs = {
    './db': `export const isCloudActive = () => Boolean(localStorage.getItem('supabase_user'));
      export const supabase = { from(table) {
        const filters = {};
        return { select() { return this; }, eq(k,v) { filters[k]=v; return this; }, order() { return this; },
          then(resolve,reject) { let finish; const promise = new Promise(r => finish=r);
            globalThis.activityTest.requests.push({table, filters, finish}); return promise.then(resolve,reject); },
          upsert(row) { return { select() { return { async single() {
            if (globalThis.activityTest.deferWrite) return new Promise(resolve => globalThis.activityTest.finishWrite=resolve);
            return {data:{id:row.id},error:null};
          } }; } }; }
        };
      } };`,
    './metricsService': 'export const metricsService = { notifyChange() {} };',
    '../utils/uuid': 'let id=0; export const generateUUID = () => "activity-" + (++id);',
    '../utils/staffUtils': 'export const normalizeStaffEmail = s => s;'
  };
  let code = ts.transpileModule(readFileSync(new URL('../src/services/leadService.ts',import.meta.url),'utf8'), {
    compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}
  }).outputText;
  for(const [key,value] of Object.entries(stubs)) code=code.replaceAll(`'${key}'`,JSON.stringify(asModule(value)));
  const service=await import(asModule(code+`\n// instance ${++instance}`));
  service.leadService.setActiveCompany(company);
  return {...service, storage, requests};
}
const row = id => ({id,lead_id:'lead-a',company_id:company,type:'Note Logged',notes:id,created_at:'2026-10-10T01:00:00Z'});
const tick = () => new Promise(resolve => setImmediate(resolve));

test('older targeted responses cannot replace newer results',async()=>{
  const {leadService,requests}=await setup();
  const older=leadService.refreshLeadActivities('lead-a',company); await tick();
  const newer=leadService.refreshLeadActivities('lead-a',company); await tick();
  requests[1].finish({data:[row('newer')],error:null}); await newer;
  requests[0].finish({data:[row('older')],error:null}); await older;
  assert.deepEqual(leadService.getLeadActivities('lead-a').map(a=>a.id),['newer']);
});

test('a confirmed save during a pending read remains in the timeline',async()=>{
  const {leadService,requests}=await setup();
  const pending=leadService.refreshLeadActivities('lead-a',company); await tick();
  const saved=await leadService.addLeadActivity({lead_id:'lead-a',company_id:company,user_email:'staff@example.test',action:'Note Logged',note:'New call'});
  requests[0].finish({data:[row('old')],error:null}); await pending;
  assert.equal(leadService.getLeadActivities('lead-a')[0].id,saved.id);
});

test('account switch clears previous activities and rejects late responses',async()=>{
  const {leadService,storage,requests}=await setup();
  storage.set('docgen_lead_activities',JSON.stringify([{...row('cached-a'),action:'Note Logged'}]));
  const pending=leadService.refreshLeadActivities('lead-a',company); await tick();
  storage.set('supabase_user','{"id":"user-b"}'); leadService.invalidateActivityContext();
  assert.deepEqual(leadService.getLeadActivities('lead-a'),[]);
  requests[0].finish({data:[row('late-a')],error:null}); await pending;
  assert.deepEqual(leadService.getLeadActivities('lead-a'),[]);
});

test('logout and same-user login invalidate requests even when identity returns to A',async()=>{
  const {leadService,storage,requests}=await setup();
  const pending=leadService.refreshLeadActivities('lead-a',company); await tick();
  storage.delete('supabase_user'); leadService.invalidateActivityContext();
  storage.set('supabase_user','{"id":"user-a"}'); leadService.invalidateActivityContext();
  requests[0].finish({data:[row('previous-session')],error:null}); await pending;
  assert.deepEqual(leadService.getLeadActivities('lead-a'),[]);
});

test('a company change rejects pending reads and hides another company cache',async()=>{
  const {leadService,requests}=await setup();
  const pending=leadService.refreshLeadActivities('lead-a',company); await tick();
  leadService.setActiveCompany('22222222-2222-4222-8222-222222222222');
  requests[0].finish({data:[row('old-company')],error:null}); await pending;
  assert.deepEqual(leadService.getLeadActivities('lead-a'),[]);
});

test('bulk hydration cannot overwrite a newer targeted timeline result',async()=>{
  const {leadService,hydrateLeadsFromCloud,requests}=await setup();
  const bulk=hydrateLeadsFromCloud(company); await tick();
  const targeted=leadService.refreshLeadActivities('lead-a',company); await tick();
  requests[2].finish({data:[row('newest')],error:null}); await targeted;
  requests[0].finish({data:[],error:null}); requests[1].finish({data:[row('stale-bulk')],error:null}); await bulk;
  assert.deepEqual(leadService.getLeadActivities('lead-a').map(a=>a.id),['newest']);
});

test('bulk hydration cannot cache a previous account',async()=>{
  const {leadService,hydrateLeadsFromCloud,storage,requests}=await setup();
  const bulk=hydrateLeadsFromCloud(company); await tick();
  storage.set('supabase_user','{"id":"user-b"}'); leadService.invalidateActivityContext();
  requests[0].finish({data:[],error:null}); requests[1].finish({data:[row('late-bulk')],error:null}); await bulk;
  assert.deepEqual(leadService.getLeadActivities('lead-a'),[]);
});

test('a pending confirmed activity write cannot cache a previous account',async()=>{
  const {leadService,storage}=await setup();
  globalThis.activityTest.deferWrite=true;
  const write=leadService.addLeadActivity({lead_id:'lead-a',company_id:company,user_email:'a@example.test',action:'Note Logged',note:'Private A note'});
  const rejected=assert.rejects(write,/Account or company changed/);
  await tick();
  storage.set('supabase_user','{"id":"user-b"}'); leadService.invalidateActivityContext();
  globalThis.activityTest.finishWrite({data:{id:'activity-1'},error:null});
  await rejected;
  assert.deepEqual(leadService.getLeadActivities('lead-a'),[]);
});
