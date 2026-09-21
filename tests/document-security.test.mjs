import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  // Optional test dependency not installed in this local environment
}

test('production-schema document transactions, owner approvals and public access', { skip: !PGlite }, async () => {
  const db = new PGlite();
  const owner='11111111-1111-4111-8111-111111111111';
  const staff='22222222-2222-4222-8222-222222222222';
  const outsider='33333333-3333-4333-8333-333333333333';
  const company='44444444-4444-4444-8444-444444444444';
  const id='55555555-5555-4555-8555-555555555555';
  async function login(uid, role='authenticated') {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('test.uid',$1,false)",[uid]);
    await db.exec(`SET ROLE ${role}`);
  }
  async function value(sql,args=[]) { return (await db.query(sql,args)).rows[0]?.value; }
  try {
    await db.exec(readFileSync(new URL('./fixtures/production-document-schema.sql',import.meta.url),'utf8'));
    await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ($1,$2,now()),($3,$4,now()),($5,$6,now())',
      [owner,'sarathjohnpanengadan@gmail.com',staff,'sivasatheesan33@gmail.com',outsider,'unregistered@example.com']);
    await db.query('INSERT INTO profiles(id,name) VALUES($1,$2)',[company,'Test company']);
    await db.exec('ALTER TABLE leads ADD COLUMN lead_number text');
    const leadIds=['77777777-7777-4777-8777-777777777771','77777777-7777-4777-8777-777777777772',
      '77777777-7777-4777-8777-777777777773','77777777-7777-4777-8777-777777777774'];
    for (const [i,number] of ['B2P-LD-1001','B2P-LD-1001','B2P-LD-1020',null].entries()) {
      await db.query('INSERT INTO leads(id,company_id,customer_name,lead_number) VALUES($1,$2,$3,$4)',[leadIds[i],company,'Legacy lead',number]);
    }
    for (const file of ['20260918000000_live_crm_fields.sql','20260921000003_document_security_and_leads.sql']) {
      await db.exec(readFileSync(new URL('../database/migrations/'+file,import.meta.url),'utf8'));
    }
    // Safe to run the migration again.
    await db.exec(readFileSync(new URL('../database/migrations/20260921000003_document_security_and_leads.sql',import.meta.url),'utf8'));
    await login(staff);
    assert.equal(await value('SELECT current_app_role() AS value'),'staff');
    assert.equal(await value('SELECT lead_number AS value FROM leads WHERE id=$1',[leadIds[0]]),'B2P-LD-1001');
    assert.equal(await value('SELECT lead_number AS value FROM leads WHERE id=$1',[leadIds[2]]),'B2P-LD-1020');
    assert.equal(await value('SELECT count(DISTINCT lead_number)::int AS value FROM leads'),4);
    const insertLead=() => value("INSERT INTO leads(company_id,customer_name,lead_number) VALUES($1,'New enquiry','B2P-LD-1001') RETURNING lead_number AS value",[company]);
    const allocated=await Promise.all([insertLead(),insertLead()]);
    assert.deepEqual(allocated,['B2P-LD-1023','B2P-LD-1024']);
    await db.query("UPDATE leads SET lead_number='B2P-LD-9999' WHERE id=$1",[leadIds[2]]);
    assert.equal(await value('SELECT lead_number AS value FROM leads WHERE id=$1',[leadIds[2]]),'B2P-LD-1020');
    await assert.rejects(db.query('UPDATE lead_number_counters SET last_number=0'),/permission denied/);
    const doc={id,company_id:company,document_type:'invoice',document_number:'INV/TEST',sequence_number:1,customer_name:'Test',total:100,subtotal:100};
    const item={id:'66666666-6666-4666-8666-666666666666',description:'Item',quantity:1,rate:100,amount:100};
    const save=(d=doc,items=[item],comparison=null)=>value('SELECT save_document_bundle($1,$2,$3) AS value',[JSON.stringify(d),JSON.stringify(items),comparison && JSON.stringify(comparison)]);
    assert.equal((await save({...doc,status:'approved',approved_by_email:'forged'})).status,'pending_approval');
    await assert.rejects(db.query('UPDATE documents SET status=$1 WHERE id=$2',['approved',id]),/permission denied/);
    await assert.rejects(value('SELECT review_document($1,true) AS value',[id]),/Only the owner/);
    await assert.rejects(db.query("INSERT INTO app_members(user_id,role) VALUES($1,'owner')",[outsider]),/permission denied/);
    // The failed item insert rolls back the parent update AND the deletion of old items.
    await assert.rejects(save({...doc,total:999},[{...item,id:'invalid-uuid'}]),/uuid/);
    assert.equal(await value('SELECT total AS value FROM documents WHERE id=$1',[id]),'100');
    assert.equal(await value('SELECT count(*)::int AS value FROM document_items WHERE document_id=$1',[id]),1);
    await login('', 'anon');
    assert.equal(await value('SELECT get_public_document($1,NULL) AS value',[id]),null);
    await assert.rejects(db.query('SELECT * FROM documents'),/permission denied/);
    await login(owner);
    assert.equal((await value('SELECT review_document($1,true) AS value',[id])).approved_by_email,'sarathjohnpanengadan@gmail.com');
    await login('', 'anon');
    assert.equal((await value('SELECT get_public_document($1,NULL) AS value',[id])).document.total,100);
    assert.equal(await value('SELECT get_public_document(NULL,$1) AS value',['INVTEST']),null);
    await login(staff);
    assert.equal((await save()).status,'pending_approval');
    await login('', 'anon');
    assert.equal(await value('SELECT get_public_document($1,NULL) AS value',[id]),null);
    await login(staff);
    const config={options:[{id:'option',totalValue:100,rows:[{quantity:1,rate:100}]}]};
    await assert.rejects(save({...doc,document_type:'comparison_invoice'},[],null),/Comparison options/);
    await save({...doc,document_type:'comparison_invoice'},[],config);
    await login(owner);
    await value('SELECT review_document($1,true) AS value',[id]);
    await login('', 'anon');
    assert.deepEqual((await value('SELECT get_public_document($1,NULL) AS value',[id])).comparison,config);
    assert.deepEqual((await value('SELECT get_public_comparison_data($1) AS value',[id])).comparison,config);
    await login(outsider);
    assert.equal(await value('SELECT current_app_role() AS value'),null);
    assert.equal(await value('SELECT count(*)::int AS value FROM documents'),0);
    await assert.rejects(save(),/access denied/);
    await login(staff);
    await assert.rejects(value('SELECT delete_document_bundle($1) AS value',[id]),/deletion denied/);
    await login(owner);
    assert.equal(await value('SELECT delete_document_bundle($1) AS value',[id]),id);
    assert.equal(await value('SELECT count(*)::int AS value FROM comparison_document_data'),0);
    // The same gate covers quotations, tax/non-tax invoices, and comparison quotations.
    for (const type of ['quotation','non_tax_invoice','comparison_quotation']) {
      await login(staff);
      await save({...doc,document_type:type},type.startsWith('comparison')?[]:[item],type.startsWith('comparison')?config:null);
      await assert.rejects(value('SELECT review_document($1,true) AS value',[id]),/Only the owner/);
      await login(owner);
      await value('SELECT review_document($1,true) AS value',[id]);
      await value('SELECT delete_document_bundle($1) AS value',[id]);
    }
    // CRM quotation approval cannot be spoofed through its separate table either.
    await login(staff);
    await db.query(`INSERT INTO crm_quotations(id,company_id,quotation_number,date,customer_name,phone,service_summary)
      VALUES($1,$2,'CRM/TEST',current_date,'Test','123','Service')`,[id,company]);
    await assert.rejects(db.query("UPDATE crm_quotations SET approval_status='APPROVED' WHERE id=$1",[id]),/Only the owner/);
    await login(owner);
    await db.query("UPDATE crm_quotations SET approval_status='APPROVED',approver_name='forged' WHERE id=$1",[id]);
    assert.equal(await value('SELECT approver_name AS value FROM crm_quotations WHERE id=$1',[id]),'sarathjohnpanengadan@gmail.com');
    await login(staff);
    await db.query("UPDATE crm_quotations SET approval_status='SENT' WHERE id=$1",[id]);
    await db.query('UPDATE crm_quotations SET total=500 WHERE id=$1',[id]);
    assert.equal(await value('SELECT approval_status AS value FROM crm_quotations WHERE id=$1',[id]),'WAITING_APPROVAL');
    // Revoked membership takes effect without trusting the cached browser role.
    await login(owner);
    await db.exec('RESET ROLE');
    await db.query('UPDATE app_members SET active=false WHERE user_id=$1',[staff]);
    await login(staff);
    assert.equal(await value('SELECT current_app_role() AS value'),null);
    await assert.rejects(save(),/access denied/);
  } finally { await db.close(); }
});
