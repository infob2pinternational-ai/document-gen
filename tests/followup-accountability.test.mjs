import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const sql=readFileSync(new URL('../docs/setup/followup-accountability.sql',import.meta.url),'utf8');
const task='33333333-3333-4333-8333-333333333333';
const company='11111111-1111-4111-8111-111111111111';
async function setup(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT '22222222-2222-4222-8222-222222222222'::uuid$$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT '{"email":"staff@example.test"}'::jsonb$$;
 CREATE FUNCTION followup_timeline_version() RETURNS integer LANGUAGE sql AS $$SELECT 1$$;
 CREATE TABLE follow_ups(id uuid PRIMARY KEY,company_id uuid,customer_name text,assigned_staff_email text,status text,
 follow_up_date date,follow_up_time time,completion_note text);
 INSERT INTO follow_ups VALUES('${task}','${company}','Synthetic customer','staff@example.test','pending','2026-10-20','11:00',NULL);`);
 await db.exec(sql);return db;
}
async function move(db,date,outcome='not_contacted',action=crypto.randomUUID()){
 return db.query('UPDATE follow_ups SET follow_up_date=$1,reschedule_reason=$2,follow_up_outcome=$3,follow_up_action_id=$4 WHERE id=$5',[date,'Synthetic reason',outcome,action,task]);
}
test('original baseline is immutable, later changes counted, retries and earlier moves do not increment',async()=>{
 const db=await setup();try{
 const action=crypto.randomUUID();await move(db,'2026-10-21','not_contacted',action);await move(db,'2026-10-21','not_contacted',action);
 await move(db,'2026-10-22','no_answer');await move(db,'2026-10-21','not_contacted');
 let row=(await db.query('SELECT * FROM followup_review_state')).rows[0];
 assert.equal(row.postponement_count,2);assert.equal(row.consecutive_without_contact,2);
 assert.equal((await db.query('SELECT original_due::text AS due FROM followup_review_state')).rows[0].due,'2026-10-20 11:00:00');assert.equal(row.original_due_verified,false);
 assert.equal((await db.query('SELECT * FROM followup_review_events')).rows.length,3);
 await move(db,'2026-10-23','customer_callback');
 row=(await db.query('SELECT * FROM followup_review_state')).rows[0];assert.equal(row.postponement_count,3);assert.equal(row.consecutive_without_contact,0);
 }finally{await db.close();}
});
test('blank reason, stale action and cross-company identity changes roll back',async()=>{
 const db=await setup();try{
 await assert.rejects(db.exec("UPDATE follow_ups SET follow_up_date='2026-10-21'"),/fresh follow-up action/);
 await assert.rejects(db.exec("UPDATE follow_ups SET follow_up_date='2026-10-21',follow_up_action_id=gen_random_uuid(),reschedule_reason=' ',follow_up_outcome='not_contacted'"),/reason required/);
 const action=crypto.randomUUID();await move(db,'2026-10-21','not_contacted',action);
 await assert.rejects(move(db,'2026-10-22','not_contacted',action),/fresh follow-up action/);
 await move(db,'2026-10-22');
 await assert.rejects(move(db,'2026-10-23','not_contacted',action),/unique constraint/);
 await assert.rejects(db.exec("UPDATE follow_ups SET company_id=gen_random_uuid()"),/company cannot change/);
 assert.equal((await db.query('SELECT postponement_count FROM followup_review_state')).rows[0].postponement_count,2);
 }finally{await db.close();}
});
test('completion is separate from postponement, requires remarks, new tasks have verified original due',async()=>{
 const db=await setup();try{
 await move(db,'2026-10-21');
 await assert.rejects(db.exec("UPDATE follow_ups SET status='completed',follow_up_action_id=gen_random_uuid()"),/Completion remarks/);
 await db.exec("UPDATE follow_ups SET status='completed',completion_note='Synthetic completed',follow_up_action_id=gen_random_uuid()");
 await db.exec("UPDATE follow_ups SET status='completed'");
 const events=(await db.query('SELECT event_type FROM followup_review_events ORDER BY id')).rows;
 assert.deepEqual(events.map(e=>e.event_type),['postponed','completed']);
 await db.exec(`INSERT INTO follow_ups VALUES(gen_random_uuid(),'${company}','New synthetic','staff@example.test','pending','2026-10-25','12:00',NULL,NULL,NULL,NULL)`);
 assert.equal((await db.query('SELECT original_due_verified FROM followup_review_state WHERE follow_up_id<>$1',[task])).rows[0].original_due_verified,true);
 }finally{await db.close();}
});
test('staff cannot read or alter private review data, authorized writes still audit, delete preserves history',async()=>{
 const db=await setup();try{
 await db.exec('GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT,UPDATE,DELETE ON follow_ups TO authenticated; SET ROLE authenticated');
 await assert.rejects(db.query('SELECT * FROM followup_review_state'),/permission denied/);
 await assert.rejects(db.query('SELECT * FROM followup_review_events'),/permission denied/);
 await assert.rejects(db.exec('DELETE FROM followup_review_events'),/permission denied/);
 await move(db,'2026-10-21');await db.exec('DELETE FROM follow_ups');await db.exec('RESET ROLE');
 assert.equal((await db.query('SELECT deleted FROM followup_review_state')).rows[0].deleted,true);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM followup_review_events')).rows[0].n,2);
 }finally{await db.close();}
});
