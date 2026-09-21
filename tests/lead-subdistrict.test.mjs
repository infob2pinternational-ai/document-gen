import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const asModule = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;

test('cleared sub-district remains cleared after hydration and missing schema is never silently dropped', async () => {
  const store=new Map();
  globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))};
  const dbUrl=asModule(`
    export const isCloudActive=()=>true; export let row; export let writes=0; let fail=false;
    export function setMissingColumn(value){fail=value;}
    export const supabase={from(table){return {
      select(){return Promise.resolve({data:table==='leads' && row?[row]:[],error:null});},
      upsert(payload){if(table!=='leads')return Promise.resolve({error:null});
        writes++;return {select(){return {async single(){
          if(fail && Object.hasOwn(payload,'sub_district'))return {error:{code:'PGRST204',message:'Missing sub_district column'}};
          row={...payload,lead_number:'B2P-LD-1042'};return {data:{id:row.id,lead_number:row.lead_number},error:null};
        }}}};}
    }}};
  `);
  const staff=await load('../src/utils/staffUtils.ts');
  const {leadService,hydrateLeadsFromCloud}=await load('../src/services/leadService.ts',{
    './metricsService':asModule('export const metricsService={notifyChange(){}};'),
    './db':dbUrl,'../utils/uuid':asModule('export const generateUUID=()=>"clear-sub-test";'),
    '../utils/staffUtils':asModule(`export const normalizeStaffEmail=${staff.normalizeStaffEmail.toString()};`)
  });
  const db=await import(dbUrl);
  const saved=await leadService.saveLead({customer_name:'Test',phone:'123',sub_district:'Chalakudy'});
  assert.equal(saved.lead_number,'B2P-LD-1042');
  await leadService.saveLead({...saved,sub_district:''});
  assert.equal(db.row.sub_district,null);
  await hydrateLeadsFromCloud();
  assert.equal(leadService.getLeadById(saved.id).sub_district,null);
  assert.equal(leadService.getSubDistrict(saved.id),undefined);
  db.setMissingColumn(true);
  const writes=db.writes;
  await assert.rejects(leadService.saveLead({...saved,sub_district:'Thrissur'}),/sub_district/);
  assert.equal(db.writes,writes+1);
  assert.equal(leadService.getLeadById(saved.id).sub_district,null);
});

async function load(path, replacements = {}) {
  let { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext
    }
  });
  for (const [from, to] of Object.entries(replacements)) {
    outputText = outputText.replace(new RegExp(`'${from}'`, 'g'), JSON.stringify(to));
  }
  return import(asModule(outputText));
}

test('all 14 Kerala districts have configured sub-districts in districts.ts', async () => {
  const districtsModule = await load('../src/utils/districts.ts');
  const { KERALA_DISTRICTS, KERALA_SUB_DISTRICTS } = districtsModule;

  assert.ok(KERALA_DISTRICTS);
  assert.equal(KERALA_DISTRICTS.length, 14);
  assert.equal(Object.keys(KERALA_SUB_DISTRICTS).length, 14);

  // Check that every district has at least 3 sub-districts
  for (const dist of KERALA_DISTRICTS) {
    assert.ok(Array.isArray(KERALA_SUB_DISTRICTS[dist]), `Sub-districts missing for ${dist}`);
    assert.ok(KERALA_SUB_DISTRICTS[dist].length >= 3, `Expected at least 3 sub-districts for ${dist}`);
  }

  // Check Thrissur sub-districts
  assert.ok(KERALA_SUB_DISTRICTS['Thrissur'].includes('Chalakudy'));
  assert.ok(KERALA_SUB_DISTRICTS['Thrissur'].includes('Kunnamkulam'));
  assert.ok(KERALA_SUB_DISTRICTS['Thrissur'].includes('Kodungallur'));

  // Check Ernakulam sub-districts
  assert.ok(KERALA_SUB_DISTRICTS['Ernakulam'].includes('Kochi'));
  assert.ok(KERALA_SUB_DISTRICTS['Ernakulam'].includes('Aluva'));
});

test('lead with sub_district is saved and retrieved in local cache and sanitized for cloud', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) { return store.get(key) ?? null; },
    setItem(key, value) { store.set(key, String(value)); }
  };

  const dbUrl = asModule(`
    export const isCloudActive = () => false;
    export const supabase = null;
  `);

  const staff = await load('../src/utils/staffUtils.ts');

  const { leadService } = await load('../src/services/leadService.ts', {
    './metricsService': asModule('export const metricsService = { notifyChange() {} };'),
    './db': dbUrl,
    '../utils/uuid': asModule('export const generateUUID = () => "lead-sub-123";'),
    '../utils/staffUtils': asModule(`export const normalizeStaffEmail = ${staff.normalizeStaffEmail.toString()};`)
  });

  const leadData = {
    customer_name: 'Anand Menon',
    phone: '9847012345',
    location: 'Thrissur',
    sub_district: 'Chalakudy',
    service_required: 'LED Van Advertising'
  };

  const saved = await leadService.saveLead(leadData, 'staff@b2p.com');
  assert.equal(saved.location, 'Thrissur');
  assert.equal(saved.sub_district, 'Chalakudy');

  const retrieved = leadService.getLeadById(saved.id);
  assert.ok(retrieved);
  assert.equal(retrieved.location, 'Thrissur');
  assert.equal(retrieved.sub_district, 'Chalakudy');
  assert.equal(leadService.getSubDistrict(saved.id), 'Chalakudy');
});

test('cloud hydration preserves sub_district when cloud table lacks column', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) { return store.get(key) ?? null; },
    setItem(key, value) { store.set(key, String(value)); }
  };

  const cloudLeadsSimulated = [
    {
      id: 'lead-test-456',
      customer_name: 'Shibu DM',
      company_name: 'Aakash Institute',
      phone: '7356601284',
      location: 'Thrissur',
      // Note: sub_district is intentionally missing from cloud response
      service_required: 'Other Advertising',
      status: 'new',
      updated_at: new Date().toISOString()
    }
  ];

  const dbUrl = asModule(`
    export const isCloudActive = () => true;
    export const supabase = {
      from: (table) => ({
        select: () => Promise.resolve({
          data: table === 'leads' ? ${JSON.stringify(cloudLeadsSimulated)} : [],
          error: null
        }),
        upsert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { id: 'lead-test-456', lead_number: 'B2P-LD-1001' }, error: null })
          })
        })
      })
    };
  `);

  const staff = await load('../src/utils/staffUtils.ts');

  const { leadService, hydrateLeadsFromCloud } = await load('../src/services/leadService.ts', {
    './metricsService': asModule('export const metricsService = { notifyChange() {} };'),
    './db': dbUrl,
    '../utils/uuid': asModule('export const generateUUID = () => "lead-test-456";'),
    '../utils/staffUtils': asModule(`export const normalizeStaffEmail = ${staff.normalizeStaffEmail.toString()};`)
  });

  // Step 1: User saves lead locally with sub_district
  const saved = await leadService.saveLead({
    id: 'lead-test-456',
    customer_name: 'Shibu DM',
    company_name: 'Aakash Institute',
    phone: '7356601284',
    location: 'Thrissur',
    sub_district: 'Chalakudy'
  });
  assert.equal(saved.sub_district, 'Chalakudy');

  // Step 2: Cloud sync runs (fetching cloudLeads that have no sub_district)
  await hydrateLeadsFromCloud('default');

  // Step 3: Verify sub_district is preserved and not wiped out
  const afterCloudSync = leadService.getLeadById('lead-test-456');
  assert.ok(afterCloudSync);
  assert.equal(afterCloudSync.company_name, 'Aakash Institute');
  assert.equal(afterCloudSync.sub_district, 'Chalakudy');
  assert.equal(leadService.getSubDistrict('lead-test-456'), 'Chalakudy');
});

test('lead numbers are sorted in strictly ascending numerical order without shuffling', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) { return store.get(key) ?? null; },
    setItem(key, value) { store.set(key, String(value)); }
  };

  const dbUrl = asModule(`
    export const isCloudActive = () => false;
    export const supabase = null;
  `);

  const staff = await load('../src/utils/staffUtils.ts');

  const { leadService, compareLeadNumbers } = await load('../src/services/leadService.ts', {
    './metricsService': asModule('export const metricsService = { notifyChange() {} };'),
    './db': dbUrl,
    '../utils/uuid': asModule('export const generateUUID = () => "lead-rand-" + Math.random();'),
    '../utils/staffUtils': asModule(`export const normalizeStaffEmail = ${staff.normalizeStaffEmail.toString()};`)
  });

  // Test compareLeadNumbers comparator directly
  assert.ok(compareLeadNumbers('B2P-LD-1001', 'B2P-LD-1002') < 0);
  assert.ok(compareLeadNumbers('B2P-LD-1002', 'B2P-LD-1001') > 0);
  assert.ok(compareLeadNumbers('B2P-LD-1009', 'B2P-LD-1010') < 0);
  assert.ok(compareLeadNumbers('B2P-LD-1009', 'B2P-LD-1020') < 0);
  assert.equal(compareLeadNumbers('B2P-LD-1005', 'B2P-LD-1005'), 0);

  // Save multiple leads in out-of-order sequence
  await leadService.saveLead({ id: 'id-1005', lead_number: 'B2P-LD-1005', customer_name: 'Client 5', phone: '123' });
  await leadService.saveLead({ id: 'id-1001', lead_number: 'B2P-LD-1001', customer_name: 'Client 1', phone: '123' });
  await leadService.saveLead({ id: 'id-1012', lead_number: 'B2P-LD-1012', customer_name: 'Client 12', phone: '123' });
  await leadService.saveLead({ id: 'id-1003', lead_number: 'B2P-LD-1003', customer_name: 'Client 3', phone: '123' });

  // Verify getLeads() returns them strictly in ascending order: 1001, 1003, 1005, 1012
  const leads = leadService.getLeads();
  assert.equal(leads.length, 4);
  assert.equal(leads[0].lead_number, 'B2P-LD-1001');
  assert.equal(leads[1].lead_number, 'B2P-LD-1003');
  assert.equal(leads[2].lead_number, 'B2P-LD-1005');
  assert.equal(leads[3].lead_number, 'B2P-LD-1012');
});

test('out-of-Kerala location and sub-district/state can be saved and retrieved cleanly', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) { return store.get(key) ?? null; },
    setItem(key, value) { store.set(key, String(value)); }
  };

  const dbUrl = asModule(`
    export const isCloudActive = () => false;
    export const supabase = null;
  `);

  const staff = await load('../src/utils/staffUtils.ts');

  const { leadService } = await load('../src/services/leadService.ts', {
    './metricsService': asModule('export const metricsService = { notifyChange() {} };'),
    './db': dbUrl,
    '../utils/uuid': asModule('export const generateUUID = () => "lead-out-state-1";'),
    '../utils/staffUtils': asModule(`export const normalizeStaffEmail = ${staff.normalizeStaffEmail.toString()};`)
  });

  const outOfStateLead = {
    customer_name: 'Rajesh Sharma',
    company_name: 'Bangalore Tech Park',
    phone: '9845012345',
    location: 'Bangalore',
    sub_district: 'Indiranagar, Karnataka',
    service_required: 'Hoarding Advertising'
  };

  const saved = await leadService.saveLead(outOfStateLead, 'admin@b2p.com');
  assert.equal(saved.location, 'Bangalore');
  assert.equal(saved.sub_district, 'Indiranagar, Karnataka');

  const retrieved = leadService.getLeadById(saved.id);
  assert.ok(retrieved);
  assert.equal(retrieved.location, 'Bangalore');
  assert.equal(retrieved.sub_district, 'Indiranagar, Karnataka');
  assert.equal(leadService.getSubDistrict(saved.id), 'Indiranagar, Karnataka');
});

test('reading leads preserves established numbers and never resequences neighbouring records', async () => {
  const records = [
    {id:'a',company_id:'company',lead_number:'B2P-LD-1015'},
    {id:'b',company_id:'company',lead_number:'B2P-LD-1015'},
    {id:'c',company_id:'company',lead_number:'B2P-LD-1020'},
    {id:'d',company_id:'company'}
  ];
  const store = new Map([['docgen_leads',JSON.stringify(records)]]);
  globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v))};
  const staff=await load('../src/utils/staffUtils.ts');
  const {leadService}=await load('../src/services/leadService.ts',{
    './metricsService':asModule('export const metricsService={notifyChange(){}};'),
    './db':asModule('export const supabase=null; export const isCloudActive=()=>false;'),
    '../utils/uuid':asModule('export const generateUUID=()=>"read-only-test";'),
    '../utils/staffUtils':asModule(`export const normalizeStaffEmail=${staff.normalizeStaffEmail.toString()};`)
  });
  assert.equal(leadService.getLeadById('c').lead_number,'B2P-LD-1020');
  leadService.getLeads();
  assert.deepEqual(JSON.parse(store.get('docgen_leads')),records);
});

test('LED Van Advertising subdivisions (3 Side, 2 Side, Single Side Van/Truck) are saved and retained', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) { return store.get(key) ?? null; },
    setItem(key, value) { store.set(key, String(value)); }
  };

  const dbUrl = asModule(`
    export const isCloudActive = () => false;
    export const supabase = null;
  `);

  const staff = await load('../src/utils/staffUtils.ts');

  const { leadService } = await load('../src/services/leadService.ts', {
    './metricsService': asModule('export const metricsService = { notifyChange() {} };'),
    './db': dbUrl,
    '../utils/uuid': asModule('export const generateUUID = () => "van-lead-" + Math.random();'),
    '../utils/staffUtils': asModule(`export const normalizeStaffEmail = ${staff.normalizeStaffEmail.toString()};`)
  });

  const vanSpecs = [
    '3 Side LED Van',
    '2 Side LED Van',
    'Single Side LED Van',
    '3 Side LED Truck'
  ];

  for (const spec of vanSpecs) {
    const saved = await leadService.saveLead({
      customer_name: `Client for ${spec}`,
      phone: '9847000111',
      service_required: 'LED Van Advertising',
      vehicle_service_type: spec
    });

    assert.equal(saved.service_required, 'LED Van Advertising');
    assert.equal(saved.vehicle_service_type, spec);

    const retrieved = leadService.getLeadById(saved.id);
    assert.ok(retrieved);
    assert.equal(retrieved.vehicle_service_type, spec);
  }
});


