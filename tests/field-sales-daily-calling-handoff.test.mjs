// Field Visit -> Daily Calling handoff: approval no longer creates a lead by
// itself; it hands the visit to telecalling_entries, and only an explicit
// office action (convert_telecalling_entry_to_lead) may qualify it into a
// lead. Runs against PGlite by default; FIELD_SALES_TEST_PG=1 for real
// PostgreSQL. Never touches Supabase or production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  setup, visit, save, review,
  U, EMAIL, A, LEAD_A, as, asAdmin, one, count, ENGINE
} from './helpers/field-sales-db.mjs';

const HANDOFF_MIGRATION = readFileSync(new URL('../database/migrations/20261112000001_field_visit_daily_calling_handoff.sql', import.meta.url), 'utf8');

async function setupWithHandoff() {
  const db = await setup();
  await asAdmin(db);
  await db.exec(HANDOFF_MIGRATION);
  return db;
}

test(`[${ENGINE}] approving a visit creates exactly one Daily Calling entry, carrying the visit's data, and no lead`, async () => {
  const db = await setupWithHandoff();
  try {
    await as(db, U.salesA);
    await save(db, visit(1));
    await as(db, U.owner);
    const approved = await review(db, visit(1).id, 'approve');
    assert.equal(approved.result, 'approved');

    assert.equal(await count(db, 'telecalling_entries', `field_visit_id = '${visit(1).id}'`), 1);
    assert.equal(await count(db, 'leads', `company_id = '${A}' AND id <> '${LEAD_A}'`), 0);     // no lead on approval

    const entry = await one(db, 'SELECT * FROM public.telecalling_entries WHERE field_visit_id = $1', [visit(1).id]);
    assert.equal(entry.company_name, 'Shop 1');
    assert.equal(entry.contact_person, 'Contact 1');
    assert.equal(entry.call_status, 'Not Called Yet');
    assert.equal(entry.salesperson_email, EMAIL.salesA);
    assert.equal(Number(entry.estimated_budget), 25000);
    assert.deepEqual([...entry.requirements].sort(), ['crm', 'website']);
    assert.equal(entry.visit_remarks, 'Wants a demo');
  } finally { await db.close(); }
});

test(`[${ENGINE}] re-approving (retry) does not create a second Daily Calling entry`, async () => {
  const db = await setupWithHandoff();
  try {
    await as(db, U.salesA);
    await save(db, visit(1));
    await as(db, U.owner);
    await review(db, visit(1).id, 'approve');
    const retry = await review(db, visit(1).id, 'approve');
    assert.equal(retry.result, 'unchanged');
    assert.equal(await count(db, 'telecalling_entries', `field_visit_id = '${visit(1).id}'`), 1);
  } finally { await db.close(); }
});

test(`[${ENGINE}] a rejected visit never creates a Daily Calling entry`, async () => {
  const db = await setupWithHandoff();
  try {
    await as(db, U.salesA);
    await save(db, visit(1));
    await as(db, U.owner);
    await review(db, visit(1).id, 'reject', 'Not a real business');
    assert.equal(await count(db, 'telecalling_entries', `field_visit_id = '${visit(1).id}'`), 0);
  } finally { await db.close(); }
});

test(`[${ENGINE}] correction workflow still works and still creates no Daily Calling entry until approved`, async () => {
  const db = await setupWithHandoff();
  try {
    await as(db, U.salesA);
    await save(db, visit(1));
    await as(db, U.admin);
    await review(db, visit(1).id, 'request_correction', 'Check the phone number');
    assert.equal(await count(db, 'telecalling_entries', `field_visit_id = '${visit(1).id}'`), 0);

    await as(db, U.salesA);
    await save(db, visit(1, { phone: '9000019999' }));
    assert.equal(await count(db, 'telecalling_entries', `field_visit_id = '${visit(1).id}'`), 0);

    await as(db, U.admin);
    const approved = await review(db, visit(1).id, 'approve');
    assert.equal(approved.result, 'approved');
    assert.equal(await count(db, 'telecalling_entries', `field_visit_id = '${visit(1).id}'`), 1);
  } finally { await db.close(); }
});

test(`[${ENGINE}] the telecaller can record a call outcome and feedback on the handed-off entry`, async () => {
  const db = await setupWithHandoff();
  try {
    await as(db, U.salesA);
    await save(db, visit(1));
    await as(db, U.owner);
    await review(db, visit(1).id, 'approve');
    const entry = await one(db, 'SELECT id FROM public.telecalling_entries WHERE field_visit_id = $1', [visit(1).id]);

    await as(db, U.staffA);
    await db.query(
      "UPDATE public.telecalling_entries SET call_status = 'Interested / Details Shared', feedback = 'Wants a demo next week' WHERE id = $1",
      [entry.id]
    );
    const updated = await one(db, 'SELECT call_status, feedback FROM public.telecalling_entries WHERE id = $1', [entry.id]);
    assert.equal(updated.call_status, 'Interested / Details Shared');
    assert.equal(updated.feedback, 'Wants a demo next week');
  } finally { await db.close(); }
});

test(`[${ENGINE}] the office can explicitly qualify a called entry into a lead, with assignment and a follow-up`, async () => {
  const db = await setupWithHandoff();
  try {
    await as(db, U.salesA);
    await save(db, visit(1));
    await as(db, U.owner);
    await review(db, visit(1).id, 'approve');
    const entry = await one(db, 'SELECT id FROM public.telecalling_entries WHERE field_visit_id = $1', [visit(1).id]);
    await db.query("UPDATE public.telecalling_entries SET call_status = 'Interested / Details Shared' WHERE id = $1", [entry.id]);

    const result = (await one(db,
      "SELECT public.convert_telecalling_entry_to_lead($1, $2, $3, '11:00', NULL, false) AS r",
      [entry.id, EMAIL.staffA, '2027-01-01'])).r;
    assert.equal(result.result, 'converted');
    assert.ok(result.lead_number);

    const lead = await one(db, 'SELECT * FROM public.leads WHERE id = $1', [result.lead_id]);
    assert.equal(lead.assigned_telecaller_email, EMAIL.staffA);
    assert.equal(lead.lead_source, 'field_visit');
    assert.match(lead.source_details, new RegExp(`\\[telecalling-entry:${entry.id}\\]`));
    assert.match(lead.source_details, new RegExp(`\\[field-visit:${visit(1).id}\\]`));

    const followUp = await one(db, 'SELECT * FROM public.follow_ups WHERE lead_id = $1', [result.lead_id]);
    assert.equal(followUp.assigned_staff_email, EMAIL.staffA);
    const fuDate = followUp.follow_up_date instanceof Date ? followUp.follow_up_date.toISOString().slice(0, 10) : String(followUp.follow_up_date).slice(0, 10);
    assert.equal(fuDate, '2027-01-01');

    const convertedEntry = await one(db, 'SELECT converted_lead_id, converted_by_email FROM public.telecalling_entries WHERE id = $1', [entry.id]);
    assert.equal(convertedEntry.converted_lead_id, result.lead_id);
    assert.equal(convertedEntry.converted_by_email, EMAIL.owner);
  } finally { await db.close(); }
});

test(`[${ENGINE}] converting the same entry twice does not create a second lead`, async () => {
  const db = await setupWithHandoff();
  try {
    await as(db, U.salesA);
    await save(db, visit(1));
    await as(db, U.owner);
    await review(db, visit(1).id, 'approve');
    const entry = await one(db, 'SELECT id FROM public.telecalling_entries WHERE field_visit_id = $1', [visit(1).id]);

    const first = (await one(db, "SELECT public.convert_telecalling_entry_to_lead($1, NULL, NULL, '11:00', NULL, false) AS r", [entry.id])).r;
    assert.equal(first.result, 'converted');
    const second = (await one(db, "SELECT public.convert_telecalling_entry_to_lead($1, NULL, NULL, '11:00', NULL, false) AS r", [entry.id])).r;
    assert.equal(second.result, 'already_converted');
    assert.equal(second.lead_id, first.lead_id);
    assert.equal(await count(db, 'leads', `company_id = '${A}' AND id <> '${LEAD_A}'`), 1);
  } finally { await db.close(); }
});

test(`[${ENGINE}] converting a manual (non-field-visit) entry with a phone already on a lead is flagged as a duplicate, not auto-created`, async () => {
  const db = await setupWithHandoff();
  try {
    await as(db, U.salesA);
    await save(db, visit(1, { phone: '9000099999' }));
    await as(db, U.owner);
    await review(db, visit(1).id, 'approve');
    const firstEntry = await one(db, "SELECT id FROM public.telecalling_entries WHERE phone = $1", [visit(1, { phone: '9000099999' }).phone]);
    const first = (await one(db, "SELECT public.convert_telecalling_entry_to_lead($1, NULL, NULL, '11:00', NULL, false) AS r", [firstEntry.id])).r;
    assert.equal(first.result, 'converted');

    // A second, unrelated manual Daily Calling entry for the same phone number.
    await as(db, U.staffA);
    await db.query(
      `INSERT INTO public.telecalling_entries (company_id, company_name, phone, call_status, created_by, created_by_email)
       VALUES ($1, 'Second Contact Same Number', $2, 'Interested / Details Shared', $3, $4)`,
      [A, visit(1, { phone: '9000099999' }).phone, U.staffA, EMAIL.staffA]
    );
    const secondEntry = await one(db, "SELECT id FROM public.telecalling_entries WHERE company_name = 'Second Contact Same Number'");

    await as(db, U.owner);
    const attempt = (await one(db, "SELECT public.convert_telecalling_entry_to_lead($1, NULL, NULL, '11:00', NULL, false) AS r", [secondEntry.id])).r;
    assert.equal(attempt.result, 'duplicates_found');
    assert.equal(attempt.matches.length, 1);
    assert.equal(await count(db, 'leads', `company_id = '${A}' AND id <> '${LEAD_A}'`), 1);     // still just the first lead
  } finally { await db.close(); }
});

test(`[${ENGINE}] staff cannot qualify a calling record into a lead; only owner or admin can`, async () => {
  const db = await setupWithHandoff();
  try {
    await as(db, U.salesA);
    await save(db, visit(1));
    await as(db, U.owner);
    await review(db, visit(1).id, 'approve');
    const entry = await one(db, 'SELECT id FROM public.telecalling_entries WHERE field_visit_id = $1', [visit(1).id]);

    await as(db, U.staffA);
    await assert.rejects(
      db.query("SELECT public.convert_telecalling_entry_to_lead($1, NULL, NULL, '11:00', NULL, false)", [entry.id]),
      /Only the owner or an admin/
    );
    assert.equal(await count(db, 'leads', `company_id = '${A}' AND id <> '${LEAD_A}'`), 0);
  } finally { await db.close(); }
});

test(`[${ENGINE}] a prospect left as "Not Interested" is never converted and stays only in calling history`, async () => {
  const db = await setupWithHandoff();
  try {
    await as(db, U.salesA);
    await save(db, visit(1));
    await as(db, U.owner);
    await review(db, visit(1).id, 'approve');
    const entry = await one(db, 'SELECT id FROM public.telecalling_entries WHERE field_visit_id = $1', [visit(1).id]);
    await db.query("UPDATE public.telecalling_entries SET call_status = 'No Interest', feedback = 'Not interested' WHERE id = $1", [entry.id]);

    // The office simply never calls convert_telecalling_entry_to_lead for this entry.
    assert.equal(await count(db, 'leads', `company_id = '${A}' AND id <> '${LEAD_A}'`), 0);
    const stillThere = await one(db, 'SELECT call_status, converted_lead_id FROM public.telecalling_entries WHERE id = $1', [entry.id]);
    assert.equal(stillThere.call_status, 'No Interest');
    assert.equal(stillThere.converted_lead_id, null);
  } finally { await db.close(); }
});
