# Security hardening and Field Sales: database release guide

This is a review document, not authorization to deploy. Nothing in this
repository applies any of this SQL. The frontend build does not apply it either.

Target: Supabase project **generator**, reference **rqovkmjsdwzggebvwvdk**.

There are four separate operations. Each has its own script, its own approval
and its own section below. They must not be combined.

| Part | Operation | Script | Approval |
|---|---|---|---|
| **A** | Feature migration | `database/migrations/20261110000002_field_sales_data_collection.sql` | Feature release |
| **B** | Security hardening | `database/migrations/20261110000001_security_office_roles_only.sql` | Security change; apply first |
| **C** | Feature rollback | `database/rollback/20261110000002_field_sales_feature_rollback.sql` | Feature owner |
| **D** | Security-policy rollback | `database/rollback/20261110000001_security_office_roles_only_rollback.sql` | Owner, in writing, separately |

Order when installing: **B, then A**. Part A refuses to run without part B.
Order when removing the feature: **C only**. Part C never removes part B.
Part D is not a step of any normal procedure.

Supporting files:

- `database/verification/field_sales_readonly_production_checks.sql`: read-only checks for production.
- `database/verification/field_sales_schema_capture.sql`: read-only query that produced the test fixture.
- `tests/fixtures/live-schema-2026-11-10.sql`: schema fixture.
- `tests/field-sales-db.test.mjs`, `tests/field-sales-concurrency.test.mjs`, `tests/helpers/field-sales-db.mjs`, `tests/helpers/with-local-postgres.sh`: tests.

---

## Release gates (all parts)

- [ ] **Vercel configuration verified.** Production `VITE_SUPABASE_URL` and
      `SUPABASE_URL` are confirmed to be
      `https://rqovkmjsdwzggebvwvdk.supabase.co`. This is still **unverified**:
      the connected Vercel account shows no projects and the production site is
      not reachable from the development environment.
- [ ] **Security patch 1 released separately** before any real salesperson
      account is created: `claim_telecalling_sync_queue_rows` is a SECURITY
      DEFINER function with no identity or company check and is executable by
      anonymous callers.
- [ ] **Security patch 2 released separately:** `api/daily-report.js` proceeds
      without authentication when no Authorization header is sent, using the
      server's admin token and a recipient number from the request.
- [ ] Neither patch is part of this branch, and neither is fixed by anything
      here. Until patch 1 is live, a sales account could still read telecalling
      queue payloads through that function, like any other caller.
- [ ] The SQL has been reviewed and approved at an exact commit.
- [ ] `npm test` passes at that commit, and the concurrency suite passes on a
      local PostgreSQL (see "Tests").

## Backup checklist (before part B and before part A)

- [ ] The dashboard shows project **generator / rqovkmjsdwzggebvwvdk**.
- [ ] A recent automatic backup exists (Database → Backups), or a manual one
      was taken; note its timestamp.
- [ ] `leads`, `app_members` and `app_company_members` exported to CSV.
- [ ] `database/verification/field_sales_readonly_production_checks.sql` run,
      sections 0 to 8, and the output saved as the baseline with date and
      operator. Expected in the baseline: 55 policies, 8 triggers, section 8a
      lists the 19 tables.
- [ ] A time outside working hours is chosen. Part A briefly locks `leads`
      (333 rows) and `app_members` (4 rows) while it replaces two constraints.

## How to run any of the scripts

1. Open the SQL Editor for project `rqovkmjsdwzggebvwvdk` and confirm the name.
2. Paste the whole file. Each file contains its own `BEGIN` and `COMMIT`.
3. On any error the transaction rolls back and nothing is changed. Do not
   re-run pieces by hand; fix the cause and run the whole file again.
4. Record commit, filename, operator and time. Running SQL by hand does not
   add an entry to Supabase's migration history.
5. Run the read-only verification script and compare with the expectations
   written in it.

---

## Part B: security hardening (apply first)

**What it does.** Nineteen tables are readable and writable by any signed-in
account, in any company, with or without an office role. The script adds one
RESTRICTIVE policy, `office_roles_only`, to each, allowing only owner, admin
and staff. A restrictive policy is AND-ed with the existing ones, so no
existing policy is edited or dropped. The service role is unaffected.

The nineteen tables: `account_groups`, `account_heads`, `bank_accounts`,
`bank_reconciliation_statements`, `customer_receipts`, `expenses`,
`financial_audit_logs`, `financial_period_locks`, `financial_year_closures`,
`journal_entries`, `purchase_bills`, `supplier_payments`, `suppliers`,
`bookings`, `resources`, `google_sync_log`, `google_sync_queue`,
`google_sync_settings`, `lead_activity`.

It also creates a private schema, `b2p_migration_internal`, holding a registry
of every object these migrations create with a fingerprint of its definition.
No application role can reach it.

**Effect on current users.** None: all four current members are owner, admin
or staff. Accounts that can sign in but have no office role lose access to
these tables.

**After applying, verify (read-only script):**

- Section 2: 74 policies; the 55 from the baseline are unchanged.
- Section 8a: no rows.
- Section 8b: every boolean column `true` on all 19 rows.
- Section 9: 19 rows, all `unchanged`.
- Sign in as owner, admin and a staff user: Google Sheets sync, bookings and
  any finance screen in use behave as before.

## Part A: feature migration

**Requires part B, intact.** Before changing anything it checks each of the 19
`office_roles_only` policies against the fingerprint recorded when part B
created it, and stops, with nothing changed, if any policy is:

- missing;
- modified in any way (expression, WITH CHECK, roles, command or mode), even if
  it still has the right name and is still RESTRICTIVE;
- present but not recorded as created by the security migration.

The error lists every affected table. The same check runs again on any re-run
of part A.

**New objects**

| Kind | Name | Purpose |
|---|---|---|
| Table | `field_sales_members` | Which companies a salesperson may submit visits for |
| Table | `field_visits` | One row per visit; separate from `leads` until converted |
| Table | `field_visit_events` | Append-only audit history |
| API function | `save_field_visit(jsonb)` | Create or correct a visit; idempotent on the visit id |
| API function | `review_field_visit(uuid, text, text)` | Approve, reject, request correction (owner/admin) |
| API function | `convert_field_visit_to_lead(...)` | Atomic, idempotent conversion with optional follow-up (owner/admin) |
| API function | `my_field_sales_companies()` | Companies the caller may submit for |
| API function | `field_visit_assignees(uuid)` | Eligible lead assignees for a company (owner/admin) |
| Schema | `field_sales_internal` | Helpers; not reachable through the API |

**Changes to existing objects**

1. `app_members_role_check` gains `sales`.
2. `leads_lead_source_check` gains `field_visit`.
3. `app_members` and `app_company_members` each gain one guard trigger.

No existing row, policy, function or trigger is edited or removed.

**After applying, verify (read-only script):**

- Section 2: 76 policies. Section 4: 15 triggers, all enabled.
- Section 3: `authenticated` has SELECT on `field_visits` and
  `field_visit_events` and nothing else on the three new tables; `anon` has nothing.
- Section 6: the expectations written above that query.
- Section 7: also confirm in Dashboard → Settings → API that the exposed
  schemas are only `public` and `graphql_public`.
- Section 8d: `sales_with_normal_membership = 0`.
- Section 9: 44 rows, all `unchanged` (19 policies from part B, 25 objects from part A).
- Sign in to the web app as owner, admin and staff and confirm leads,
  follow-ups and telecalling behave as before.

**Off-switch (temporary stop, nothing removed).** Phones keep unsent visits as pending.

```sql
REVOKE EXECUTE ON FUNCTION
  public.save_field_visit(jsonb),
  public.review_field_visit(uuid, text, text),
  public.convert_field_visit_to_lead(uuid, text, uuid, boolean, date, time)
FROM authenticated;
```

Re-enable with the matching `GRANT EXECUTE ... TO authenticated`. After either
statement, section 9 of the verification script still reports `unchanged`
(privileges are not part of the fingerprint), and re-running part A restores
the grants.

## Part C: feature rollback

Removes the feature only.

- **It never touches the 19 `office_roles_only` policies** or their registry
  records. They stay in force.
- It refuses to run while any `app_members` row has role `sales`. Remove those
  accounts first ("Removing a salesperson").
- It refuses to drop an object that is not exactly what part A created.
- It copies `field_visits`, `field_visit_events` and `field_sales_members`
  into the private schema `field_sales_archive` before dropping them. That
  schema is left in place; drop it by hand when the data is no longer needed.
- **Leads are not modified.** Leads created from field visits keep every
  column, including `lead_source = 'field_visit'`, and keep their follow-ups
  and timeline.
  - If any such lead exists, `leads_lead_source_check` is left in its extended
    form so those rows remain valid.
  - If none exists, the constraint is restored to the original nine values.
- `app_members_role_check` is restored to owner/admin/staff.

If the web app is also rolled back to a build that does not know the
`field_visit` source, those leads still load and save; the lead form will show
their source as blank until the app is updated again.

**What the archive is, and is not.** The three archive tables are plain
copies made with `CREATE TABLE ... AS`. They preserve **every row and every
column value**. They do **not** carry over anything else from the originals:

- no primary key, foreign keys, CHECK or NOT NULL constraints;
- no indexes;
- no triggers, so the append-only protection does not apply to the copies;
- no row-level security policies and no grants (the script revokes all access,
  so only the database administrator can read them);
- no identity sequence: `field_visit_events.id` keeps its values but is an
  ordinary column in the copy.

They are a record for inspection and export, not tables the feature can run
on. To bring the data back after reinstalling part A, an administrator must
insert the rows into the new tables in dependency order
(`field_sales_members`, `field_visits`, `field_visit_events`), which re-applies
the real constraints. That reload is a manual step and is not scripted or
tested here. Each run of part C creates a new timestamped set; nothing is
overwritten.

**After running, verify:** no `field_*` tables or functions; section 8b still
all `true` on all 19 rows; section 9 lists only the 19 security policies.

## Part D: security-policy rollback (separate approval)

**This re-opens the nineteen tables to every signed-in account.** It is not
part of removing the feature and is not a recovery step for anything in part A.

Use it only if part B itself is shown to break a legitimate workflow that
cannot be fixed another way, and only with the owner's written approval naming
this script.

Safeguards built into the script:

- It does nothing unless the operator runs this line first, in the same session:

```sql
SET b2p.confirm_reopen_office_tables = 'I accept that all signed-in accounts regain access';
```

- It stops while the feature is installed or any account holds a role other
  than owner, admin or staff. Run part C first.
- It stops if a policy it is about to drop was changed after part B created it.

A narrower alternative, if one table is the problem, is to drop the policy on
that table alone after review; the other eighteen stay protected. That, too,
needs separate approval.

---

## How re-running is made safe

`CREATE TABLE IF NOT EXISTS` and `CREATE OR REPLACE FUNCTION` are not treated
as proof of safe idempotency. On their own they would silently keep a wrong
table or overwrite someone else's function.

- Before changing anything, parts A and B check every table, function, policy
  and trigger they own. Each must be **absent**, or **exactly what the
  migration last created**, compared by a recorded fingerprint of its full
  definition (columns, constraints, indexes, source text, policy expressions).
- An object with the same name that the migrations did not create, or that was
  changed afterwards, stops the script with an error and nothing is changed.
- The two existing CHECK constraints are replaced only if they are exactly the
  definitions inspected in production, or already the new ones.
- Tables are never dropped or rewritten by a migration, so existing visits,
  events and memberships survive a re-run unchanged.
- Each script is one transaction. A failure at any point rolls all of it back.

Section 9 of the verification script reports any object that has drifted.

## Membership guards and concurrency

Invariant: a user with role `sales` never has an `app_company_members` row,
and only a user with role `sales` has `field_sales_members` rows.

Three triggers enforce it, on `app_members`, `app_company_members` and
`field_sales_members`. Each one checks a different table from the one being
written, so two transactions changing the same user at the same moment could
each pass their check before either commits. To prevent that, the guard takes
one transaction-level advisory lock per **affected user** before any check.

**Which statements are guarded**

- Every INSERT and every UPDATE on the three tables. On `app_members` the
  trigger fires for any UPDATE, not only `UPDATE OF role`, so a statement that
  changes only `user_id` is guarded too.
- An `app_members` update that changes neither `user_id` nor `role` (for
  example `active = false`) returns at once: no lock, no checks.

**Which users are locked**

- INSERT, or UPDATE that keeps `user_id`: that row's user.
- UPDATE that changes `user_id`, on any of the three tables: both the user the
  row leaves (old) and the user it goes to (new).
- When two users are locked, the locks are always taken in ascending user-id
  order, whichever is old and whichever is new. Two transactions moving rows
  between the same two users in opposite directions queue instead of deadlocking.
- No lock is taken for a user the statement does not touch, so changes for
  different users do not wait for each other.

**What is checked**

| Table | New user | Old user (only when `user_id` changes) |
|---|---|---|
| `app_members` | `sales` must have no normal membership; any other role must have no field membership | Is left without an account, so must have no membership of either kind |
| `app_company_members` | Must not be `sales` | Only loses a membership, which cannot break the invariant; locked so a concurrent role change waits |
| `field_sales_members` | Must be `sales` | Same |

**Other rules**

- Locks are held until the transaction ends. A second transaction for the same
  user waits, then checks again and sees what the first one committed.
- Membership changes are refused in `REPEATABLE READ` and `SERIALIZABLE`
  transactions, because those would not see the other transaction's commit.
  The SQL editor uses `READ COMMITTED`, so normal provisioning is unaffected.
- A transaction that changes several users in separate statements, in an
  order opposite to another transaction, can still deadlock. Postgres detects
  it and aborts one, which keeps the invariant. Retry the aborted one.

**What the two fixes in the last review actually closed**

- *`user_id`-only updates on `app_members`* were a real gap. Re-pointing a
  `sales` account at a new user id while another transaction inserted normal
  membership for that user id could commit both, if the account move committed
  between the other statement's guard check and its foreign-key check. A
  negative-control test reproduces exactly that with the old trigger.
- *Locking the old user* makes outcomes deterministic. Without it, a role
  change for the old user decides on uncommitted data: it is refused even
  though the move then commits. I could not construct a case where omitting
  this lock alone lets an invalid state commit, because the foreign keys from
  both membership tables to `app_members` refuse it; the negative control
  therefore demonstrates the lost waiting and the wrong refusal, not an
  invalid commit.

An advisory lock was chosen over a row lock on `auth.users` because it needs no
privilege on the Supabase-owned `auth` schema (which could not be checked
without querying production) and cannot delay sign-in or other tables' foreign
keys. The lock only coordinates these three triggers; a session that disables
the triggers bypasses it, and the field-visit functions still fail closed for a
`sales` user who has normal membership.

## Audit history and the administrator exception

`field_visit_events` is append-only, and `field_visits` rows are never deleted.

- No application role has INSERT, UPDATE, DELETE or TRUNCATE on either table.
  Rows are written only by the three workflow functions.
- Triggers additionally refuse UPDATE, DELETE and TRUNCATE on
  `field_visit_events`, and DELETE and TRUNCATE on `field_visits`, for **any
  statement that arrives through the API**: anonymous, signed-in, or the
  server-side service key. This also stops SECURITY DEFINER functions from
  changing history on a caller's behalf.
- Consequence: a company profile that has field visits cannot be deleted from
  the app, because the cascade would delete audit history.

**The exception.** A direct database session with no API request role (the
Supabase SQL editor, or a direct connection as the `postgres` role) can still
update and delete. This is deliberate: it is required for part C and for
legally required erasure. Anyone with that access can also disable the
triggers. Treat SQL-editor access as fully privileged and restrict who has it.

## Function security review

All functions are owned by the role that runs the migration (`postgres` in
production: not a superuser, but able to bypass row-level security) and have a
fixed, empty `search_path`.

| Function | SECURITY DEFINER | Executable by | Identity and company |
|---|---|---|---|
| `save_field_visit` | yes | authenticated | Salesperson is `auth.uid()`; e-mail read from `auth.users`; company from the payload is checked against the caller's membership, and ignored once the visit exists |
| `review_field_visit` | yes | authenticated | Role must be owner/admin; company taken from the stored visit |
| `convert_field_visit_to_lead` | yes | authenticated | Same; assignee and any linked lead must belong to the visit's company |
| `my_field_sales_companies` | yes | authenticated | Returns only the caller's companies |
| `field_visit_assignees` | yes | authenticated | Owner/admin of that company only |
| `field_sales_internal.can_submit`, `can_review` | yes | authenticated | Answer only about the caller; needed by the read policy on `field_visits` |
| `field_sales_internal.assignee_ok` | yes | nobody | Internal |
| `field_sales_internal.normalize_phone` | no | nobody | Pure |
| `field_sales_internal.guard_membership`, `audit_guard` | no | nobody | Triggers |
| `b2p_migration_internal.*` | no | nobody | Administrator only |

- `PUBLIC` and `anon` can execute none of them.
- `can_submit` and `can_review` must be executable by `authenticated` because
  Postgres evaluates policy expressions with the caller's privileges. They are
  in a schema the HTTP API does not expose, so an app user cannot call them
  directly. This depends on the project's exposed-schema setting, which must
  be confirmed in the dashboard (verification script, section 7).
- With no identity in the token, every entry point refuses.

## Adding a salesperson

Do not create real accounts until security patch 1 is live.

1. Authentication → Users → Add user: email and password, "Auto Confirm User"
   on. Do not use the web sign-up form.
2. SQL Editor:

```sql
-- Role: sales. Never add app_company_members for this user (the database refuses it).
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

Other changes:

- **Move to another company:** delete and insert the `field_sales_members`
  row. Earlier visits stay with the original company and the salesperson can
  no longer read them.
- **Pause for one company:** set `field_sales_members.active = false`.
- **Pause the account:** set `app_members.active = false`. Reactivating
  restores exactly the field memberships that are still active.
- **Staff becomes sales:** delete their `app_company_members` rows, set the
  role to `sales`, add `field_sales_members`. The database refuses the role
  change while normal memberships exist.
- **Sales becomes staff:** delete their `field_sales_members` rows, change the
  role, add `app_company_members`. The database refuses the role change while
  field memberships exist.

## Removing a salesperson

1. If possible, ask them to open the app online so pending visits sync.
2. SQL Editor (takes effect on their next request):

```sql
UPDATE public.app_members SET active = false
WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = lower('<salesperson email>'));

DELETE FROM public.field_sales_members
WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = lower('<salesperson email>'));
```

3. Authentication → Users → the user → Ban user, then sign out their sessions.
   Prefer a ban to deletion: visits keep a copy of the e-mail either way, but a
   ban also keeps the account id the audit history refers to.
4. Verify. Expect zero rows:

```sql
SELECT u.email FROM auth.users u JOIN public.app_members m ON m.user_id = u.id
WHERE lower(u.email) = lower('<salesperson email>') AND m.active;
```

5. To remove the account completely (required before part C):

```sql
DELETE FROM public.app_members
WHERE role = 'sales' AND user_id = (SELECT id FROM auth.users WHERE lower(email) = lower('<salesperson email>'));
```

Visits they did not sync before removal stay on their phone and cannot be
recovered by the server.

---

## Tests

No test connects to production or to any remote database. The helper refuses
any host that is not a local Unix socket or the loopback address.

```bash
npm test
```

```bash
tests/helpers/with-local-postgres.sh node --test tests/field-sales-db.test.mjs tests/field-sales-concurrency.test.mjs
```

The first runs everything on an in-memory Postgres (PGlite); the six
two-connection tests are skipped there. The second starts a throwaway local
PostgreSQL in a temporary directory, runs the same database tests plus the
concurrency tests on it, and deletes it.

On the local PostgreSQL the test database is owned by a role that, like
production's `postgres`, is not a superuser but can bypass row-level security.

| Area | What is proved |
|---|---|
| Hardening | Before it, a no-role account reads all 19 tables. After it, owner, admin and staff keep read, update, insert and delete on each; no-role, sales and anonymous callers are denied on each, using the real production columns |
| Hardening safety | An unexpected or modified `office_roles_only` policy stops the script; a re-run changes nothing; the registry is private |
| Feature safety | Refuses to run without part B, or with any of the 19 policies missing, modified, re-created with a different expression, or unrecorded; installs when all 19 are unchanged; stops with nothing changed for a same-named function, table or schema, for constraints that differ from production, and for a missing live column |
| Re-run | Visits, events, memberships, leads, follow-ups and all recorded definitions are byte-identical after two re-runs; a hand-edited function, table, policy, trigger or index stops the script |
| Failure recovery | A failure part-way through rolls back completely; the script succeeds once the cause is removed |
| Unrelated CRM data | Sales cannot reach leads, activities, follow-ups, customers, services, quotations, templates, telecalling, documents, WhatsApp, devices, report dispatches or profiles |
| Identity changes (2 connections) | `app_members.user_id` changed without touching role; a sales account re-pointed at a user who is concurrently given normal membership; the old user's role changing while their normal or field membership moves to another user, in both orders, commit and rollback; opposite-direction moves with the lock order forced by a third connection, plus thirty uncoordinated ones, with no deadlock |
| All pairs (2 connections) | 13 membership operations on the same users, every ordered pair, 8 starting states, commit and rollback: 2,704 combinations, none commits an invalid state |
| Negative controls (2 connections) | With the old `UPDATE OF role` trigger a sales user ends up with normal membership. Without the old-user lock the role change neither waits nor decides correctly. With unsorted locks the opposite-direction moves deadlock |
| Membership guards (2 connections) | Role `sales` vs. new normal membership, and new field membership vs. role away from `sales`, in both orders: the second transaction is shown to wait and then fails, or succeeds if the first rolls back. Whole multi-statement transitions racing each other. Forty uncoordinated races with exactly one winner each. Compatible changes both succeed; a cross-user deadlock is detected |
| Membership guards | Refused outside READ COMMITTED. Owner/admin/staff provisioning and role changes work as before; a sales user cannot get normal membership by insert, upsert, bulk insert or update; role changes in both directions; moving between companies; deactivation and reactivation |
| Function security | Owner, empty `search_path`, SECURITY DEFINER only where listed, exact execute grants, no anon or PUBLIC access; behaviour with no identity, unknown identity and a forged e-mail claim |
| Workflow | Server-controlled identity, validation, idempotent save, cross-company isolation, review rules and self-review audit |
| Audit integrity | Updates, deletes and truncates are refused for every application role, directly and through SECURITY DEFINER functions, including the service key; the administrator exception works |
| Conversion | One lead, activities, optional follow-up owned by the lead assignee; never the salesperson; atomic on failure; duplicate protection |
| Concurrency (2 connections) | Same visit by two reviewers: exactly one lead, one follow-up, one event, with the second caller proven to be waiting. Rollback of the first lets the second complete. Twenty uncoordinated races. Two visits with the same company and phone: one lead, the other told of the duplicate. Ten uncoordinated same-phone races. Same visit saved from two devices |
| Rollbacks | Part C keeps all 19 policies identical and enforced and leaves every lead row unchanged and valid; part D refuses without confirmation, while the feature is installed, and for modified policies |

## Limits

- **Not production.** Tests run on PGlite and on local PostgreSQL 16.
  Production is PostgreSQL 17.6. The schema is a capture of production's
  catalog taken on 2026-11-10; anything changed in production since then is
  not reflected.
- **Fixture stubs.** Roles, the `auth` schema and Supabase's default
  privileges are hand-written stand-ins. `auth.uid()` and `auth.role()` use
  production's function bodies; `auth.jwt()` uses the standard Supabase body,
  which was not captured. `auth.users` has only the five columns the functions read.
- **Ownership.** In tests every object is owned by the role that loads the
  fixture. The capture did not record ownership of individual objects beyond
  confirming that production's tables and functions are owned by `postgres`.
- **Exposed schemas.** Whether `field_sales_internal` is unreachable through
  the HTTP API depends on a project setting that SQL cannot read. It has not
  been checked.
- **API layer.** Tests call the database as the roles PostgREST uses, with the
  same request settings. They do not go through PostgREST, Realtime or
  pg_graphql themselves.
- **Concurrency scope.** Two connections, on one machine. Higher contention,
  connection pooling and statement timeouts (production sets 8 seconds for
  `authenticated`) are not exercised. A reviewer whose conversion waits behind
  another for more than 8 seconds would receive a timeout error and nothing
  would be created.
- **PostgreSQL 17 formatting.** Verification query 8b compares normalised
  expressions so that it does not depend on one exact printed form, but it was
  only run on PostgreSQL 16. If a boolean is false on production, read the raw
  expression shown beside it before concluding anything.
- **Fingerprints and server upgrades.** Fingerprints are computed from how the
  server prints a definition. A major PostgreSQL upgrade could print the same
  definition differently, which would make the migrations and section 9 report
  an object as modified when it is not. That would stop a re-run safely, but
  would need an administrator to re-record the fingerprints.
- **Coverage of the all-pairs test.** It runs single statements from two
  connections. Three-way interleavings and longer multi-statement
  transactions are covered only by the specific scenarios listed, not
  exhaustively.
- **Membership lock scope.** The per-user lock was tested with two
  connections. It is taken inside the three guard triggers only; a statement
  run with those triggers disabled is not serialised. A transaction waiting
  for the lock is subject to the session's lock and statement timeouts.
- **Administrator exception.** Nothing prevents a database administrator from
  altering audit history or disabling the guard triggers.
- **Known open issues.** The two security patches in "Release gates" are
  outside this branch.
- **Application code.** The mobile and web screens, offline outbox and sync
  worker are not written yet and have no tests.
