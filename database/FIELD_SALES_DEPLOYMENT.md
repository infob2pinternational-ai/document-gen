# Field Sales Data Collection: database release notes

This is a review document, not authorization to deploy. Nothing in this
repository applies the migration. The frontend build does not apply it either.

- Target: Supabase project **generator**, reference **rqovkmjsdwzggebvwvdk**.
- Migration: `database/migrations/20261110000001_field_sales_data_collection.sql`
- Rollback: `database/rollback/20261110000001_field_sales_data_collection_rollback.sql`
- Tests: `tests/field-sales-db.test.mjs` (in-memory Postgres only)
- Fixture: `tests/fixtures/live-schema-2026-11-10.sql`

## 1. What the migration changes

New objects:

| Kind | Name | Purpose |
|---|---|---|
| Table | `field_sales_members` | Which companies a salesperson may submit visits for |
| Table | `field_visits` | One row per visit; separate from `leads` until converted |
| Table | `field_visit_events` | Append-only audit history |
| Function | `save_field_visit(jsonb)` | Create or correct a visit; idempotent on the visit id |
| Function | `review_field_visit(uuid, text, text)` | Approve, reject, request correction (owner/admin) |
| Function | `convert_field_visit_to_lead(...)` | Atomic, idempotent conversion with optional follow-up (owner/admin) |
| Function | `my_field_sales_companies()` | Companies the caller may submit for |
| Function | `field_visit_assignees(uuid)` | Eligible lead assignees for a company (owner/admin) |
| Function | `field_sales_can_submit(uuid)`, `field_visit_can_review(uuid)` | Access checks used by the read policy |
| Function | `field_visit_assignee_ok(uuid, text)`, `field_visit_normalize_phone(text)`, `field_sales_guard_membership()` | Internal helpers; not callable by app users |

Changes to existing objects (each reversed by the rollback script):

1. `app_members_role_check` gains `sales`.
2. `leads_lead_source_check` gains `field_visit`.
3. `app_members` and `app_company_members` each gain one guard trigger, so a
   `sales` user can never hold normal company membership.
4. Nineteen tables gain one RESTRICTIVE policy named `office_roles_only`
   (owner, admin and staff only). Their existing policies are not edited.

The nineteen tables: `account_groups`, `account_heads`, `bank_accounts`,
`bank_reconciliation_statements`, `customer_receipts`, `expenses`,
`financial_audit_logs`, `financial_period_locks`, `financial_year_closures`,
`journal_entries`, `purchase_bills`, `supplier_payments`, `suppliers`,
`bookings`, `resources`, `google_sync_log`, `google_sync_queue`,
`google_sync_settings`, `lead_activity`.

No existing row is modified. No existing policy, function or trigger is edited
or removed.

## 2. Schema drift (why this is a standalone script)

Live was inspected read-only on 2026-11-10. It differs from the files in
`database/migrations`:

| Item | Repository files | Live |
|---|---|---|
| Recorded migration history | 23 files | 19 entries; only `followup_timeline_atomic` matches by name |
| `lead_activities` | `action`, `note`, `user_email` | `type`, `notes`, `performed_by` |
| `follow_ups` | `due_date`, `due_time` | `follow_up_date`, `follow_up_time` |
| `leads.phone` | NOT NULL | nullable |
| `can_access_company` | owner bypass only | owner and admin bypass |
| `lead_activity` (singular) | absent | present, 0 rows |

The migration checks the live columns it needs before changing anything and
stops with a clear error if they are missing.

## 3. Release gates (all must be true before applying)

- [ ] The two separate security patches are released first, or real sales
      accounts are not created until they are:
      (A) `claim_telecalling_sync_queue_rows` is callable anonymously;
      (B) `api/daily-report.js` proceeds without authentication.
      Neither is touched by this branch.
- [ ] Production Vercel `VITE_SUPABASE_URL` and `SUPABASE_URL` are confirmed to
      be `https://rqovkmjsdwzggebvwvdk.supabase.co`. This is still unverified.
- [ ] This SQL has been reviewed and approved at an exact commit.
- [ ] `npm test` passes at that commit.

## 4. Backup checklist (before applying)

- [ ] Confirm the dashboard shows project **generator / rqovkmjsdwzggebvwvdk**.
- [ ] Confirm a recent automatic backup exists (Database → Backups), or take a
      manual one, and note its timestamp.
- [ ] Export `leads`, `app_members` and `app_company_members` to CSV.
- [ ] Save the output of the "before" queries below with the date and operator.
- [ ] Choose a time outside working hours. The two constraint changes take a
      brief lock on `leads` (333 rows) and `app_members` (4 rows).

"Before" queries (read-only):

```sql
SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conname IN ('app_members_role_check', 'leads_lead_source_check');

SELECT tablename, policyname, permissive, cmd, roles, qual, with_check
FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;

SELECT role, active, count(*) FROM public.app_members GROUP BY 1, 2;
SELECT lead_source, count(*) FROM public.leads GROUP BY 1;
```

## 5. Applying (separate SQL Editor operation, after approval)

1. Open the SQL Editor for project `rqovkmjsdwzggebvwvdk` and confirm the name.
2. Paste the whole migration file. It contains its own `BEGIN` and `COMMIT`.
   Stop on any error: the transaction rolls back and nothing is changed.
3. Record commit, filename, operator and time. Running SQL by hand does not
   register an entry in Supabase's migration history.
4. Run the verification queries.

Verification queries (read-only):

```sql
-- Expect 3 tables, all with row-level security on.
SELECT relname, relrowsecurity FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relname IN ('field_visits', 'field_visit_events', 'field_sales_members');

-- Expect: anon has nothing; authenticated has SELECT on field_visits and field_visit_events only.
SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name IN ('field_visits', 'field_visit_events', 'field_sales_members')
  AND grantee IN ('anon', 'authenticated') GROUP BY 1, 2;

-- Expect anon_can_run = false on every row; authenticated true on the 7 public entry points only.
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_run,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_run
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  AND (p.proname LIKE 'field_%' OR p.proname LIKE '%field_visit%' OR p.proname = 'my_field_sales_companies') ORDER BY 1;

-- Expect 19 rows, all RESTRICTIVE.
SELECT tablename, permissive FROM pg_policies WHERE schemaname = 'public' AND policyname = 'office_roles_only' ORDER BY 1;

-- Expect the same counts as before the migration.
SELECT role, active, count(*) FROM public.app_members GROUP BY 1, 2;
SELECT lead_source, count(*) FROM public.leads GROUP BY 1;
```

Then sign in to the web app as owner, admin and a staff user and confirm leads,
follow-ups, telecalling and Google Sheets sync behave as before.

## 6. Off-switch (temporary stop, nothing removed)

Disables the feature immediately. Phones keep unsent visits as pending.

```sql
REVOKE EXECUTE ON FUNCTION
  public.save_field_visit(jsonb),
  public.review_field_visit(uuid, text, text),
  public.convert_field_visit_to_lead(uuid, text, uuid, boolean, date, time)
FROM authenticated;
```

Re-enable with the matching `GRANT EXECUTE ... TO authenticated`.

## 7. Rollback (full removal)

1. Remove every sales account using the removal procedure in section 9. The
   script refuses to run while any `app_members` row has role `sales`.
2. Run the rollback file. It contains its own `BEGIN` and `COMMIT`.
3. It copies the three feature tables into the private schema
   `field_sales_archive` before dropping them. That schema is left in place;
   drop it by hand once the data is no longer needed.
4. Leads already created from field visits remain as ordinary leads. Their
   `lead_source` becomes `other`; the origin stays in `source_details`.
5. Re-run the section 5 queries: no `field_*` objects, no `office_roles_only`
   policies, both constraints back to their original definitions.

The rollback restores the previous state of the nineteen tables, which means
they are again open to every signed-in account.

## 8. Adding a salesperson

Run by the owner in the Supabase dashboard. Replace the placeholders.

1. Authentication → Users → Add user: email and password, with "Auto Confirm
   User" on. Do not use the web sign-up form.
2. SQL Editor:

```sql
-- Role: sales. Never add app_company_members for this user.
INSERT INTO public.app_members (user_id, role, active)
SELECT id, 'sales', true FROM auth.users WHERE lower(email) = lower('<salesperson email>');

-- One row per company they sell for.
INSERT INTO public.field_sales_members (user_id, company_id, note)
SELECT u.id, p.id, 'Added by <your name> on <date>'
FROM auth.users u, public.profiles p
WHERE lower(u.email) = lower('<salesperson email>') AND p.name = '<company name>';
```

3. Verify. Expect role `sales`, `normal_memberships` = 0, `field_memberships` ≥ 1:

```sql
SELECT u.email, m.role, m.active,
  (SELECT count(*) FROM public.app_company_members c WHERE c.user_id = u.id) AS normal_memberships,
  (SELECT count(*) FROM public.field_sales_members f WHERE f.user_id = u.id AND f.active) AS field_memberships
FROM auth.users u JOIN public.app_members m ON m.user_id = u.id
WHERE lower(u.email) = lower('<salesperson email>');
```

4. Have them sign in on the phone and submit one test visit. Reject it from
   Office Review with the note "provisioning test".

The database enforces the separation: adding `app_company_members` for a
`sales` user fails, and the field-visit functions refuse a `sales` user who
somehow has such a row.

## 9. Removing a salesperson

1. If possible, ask them to open the app online so pending visits sync.
2. SQL Editor (takes effect on their next request):

```sql
UPDATE public.app_members SET active = false
WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = lower('<salesperson email>'));

DELETE FROM public.field_sales_members
WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = lower('<salesperson email>'));
```

3. Authentication → Users → the user → Ban user, then sign out their sessions.
   Prefer a ban to deletion: visits keep a copy of the email either way, but a
   ban also keeps the account id that the audit history refers to.
4. Verify. Expect zero rows:

```sql
SELECT u.email FROM auth.users u JOIN public.app_members m ON m.user_id = u.id
WHERE lower(u.email) = lower('<salesperson email>') AND m.active;
```

5. To remove the account completely (required before a rollback):

```sql
DELETE FROM public.app_members
WHERE role = 'sales' AND user_id = (SELECT id FROM auth.users WHERE lower(email) = lower('<salesperson email>'));
```

Visits they did not sync before removal stay on their phone and cannot be
recovered by the server.

Moving a salesperson to another company: delete and insert the
`field_sales_members` row. Their earlier visits stay with the original company
and they can no longer read them.

## 10. Test plan

### Automated now (`npm test`, file `tests/field-sales-db.test.mjs`)

| # | Test | Proves |
|---|---|---|
| 1 | Fixture reproduces the gap | Before the migration any signed-in account reads all 19 tables |
| 2 | Additive and re-runnable | Owner, admin and staff keep read/write on all 19 tables and on leads; the script can run twice |
| 3 | 19 restricted tables | Sales, no-role accounts and anonymous callers cannot read, insert, update or delete in any of them |
| 4 | Unrelated CRM data | Sales cannot reach leads, lead activities, follow-ups, customers, services, quotations, templates, telecalling, documents, WhatsApp or profiles |
| 5 | No self-provisioning | Sales cannot change roles or memberships; `sales` and normal membership are mutually exclusive |
| 6 | Anonymous access | No new table is readable and no field-sales function is runnable anonymously |
| 7 | Server-controlled identity | Forged salesperson, status, reviewer and lead fields are ignored; direct table writes are refused; another salesperson cannot see or overwrite a visit |
| 8 | Save idempotency | Retries create no second visit and no second event |
| 9 | Cross-company isolation | A visit cannot be created in, moved to or read from another company; other-company staff and leads are refused at conversion |
| 10 | Access re-checked on the server | Deactivation, ban, membership removal and a stray company membership all lock the user out |
| 11 | Review rules | Only owner/admin review; transitions, required notes, retries and self-review are enforced and audited |
| 12 | Conversion | One lead with source `field_visit`, activities, optional follow-up owned by the lead assignee; the salesperson is never the assignee |
| 13 | Conversion idempotency | Repeating a conversion creates nothing new |
| 14 | Conversion atomicity | A failure in the follow-up step leaves no lead, no activity, no consumed lead number |
| 15 | Duplicate protection | A phone match creates nothing until the reviewer links or forces; forcing is audited |
| 16 | Rollback | Data is archived, every new object is removed, constraints are restored, the migration can be re-applied |

### Limits of these tests

- They run on an in-memory Postgres built from a capture of live, not on live.
  Five existing tables and eighteen of the nineteen restricted tables are
  modelled with reduced columns; their policies and grants are verbatim.
- One connection only, so two truly simultaneous conversions are not exercised.
  The row lock and advisory lock that handle that case are covered only by
  sequential repeat calls.
- Known exception: `claim_telecalling_sync_queue_rows` stays callable by any
  caller until security patch A. No test here asserts it is closed.

### After applying (manual, with a test sales account)

- [ ] Sign in as the test sales user and confirm every query in the section 5
      list of restricted tables returns no rows through the app's API key.
- [ ] Submit, correct, approve and convert one visit end to end; delete the
      resulting test lead afterwards.
- [ ] Remove the test account with the section 9 procedure.

### Later stages (not written yet)

- Unit tests for the offline outbox, sync worker and cached-role gating.
- Playwright: New Visit and My Visits at phone width; web Office Review.
- Real-device Android: airplane-mode save, app kill, reconnect.
- Regression: `tests/leads`, `tests/regression`, lead form/filter/report with
  the new source.
