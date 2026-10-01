import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDetailedStaffReport } from '../server/detailedStaffReport.js';
const d='2026-09-29', stamp='2026-09-29T10:12:40Z';
test('includes modified existing records, not only newly created rows',()=>{
 const result=buildDetailedStaffReport({date:d,telecalling:[{company_name:'Damro Furniture',created_by_email:'brutf5354@gmail.com',created_at:'2026-09-24T08:00:00Z',updated_at:stamp,call_status:'Interested / Details Shared'}],leads:[{lead_number:'B2P-LD-1014',company_name:'Palat',assigned_telecaller_email:'brutf5354@gmail.com',created_at:'2026-09-21T07:25:51Z',updated_at:stamp}]});
 assert.equal(result.counts['Existing telecalling records updated'],1);
 assert.equal(result.counts['Existing leads updated'],1);
 assert.match(result.markdown,/Damro Furniture/);
 assert.match(result.markdown,/Palat/);
});
test('does not count unrelated staff or another IST day',()=>{
 const result=buildDetailedStaffReport({date:d,telecalling:[{created_by_email:'other@example.com',updated_at:stamp},{created_by_email:'brutf5354@gmail.com',updated_at:'2026-09-29T19:00:00Z'}]});
 assert.equal(result.counts['Existing telecalling records updated'],0);
});
test('rejects reports for other staff',()=>assert.throws(()=>buildDetailedStaffReport({date:d,staffEmail:'other@example.com'})));
test('deletion counts require explicit staff attribution',()=>{
 const result=buildDetailedStaffReport({date:d,activities:[{type:'Follow-up Deleted',performed_by:'other@example.com',created_at:stamp},{type:'Follow-up Deleted',performed_by:'brutf5354@gmail.com',created_at:stamp}]});
 assert.equal(result.counts['Follow-up deletions (logged events)'],1);
});
