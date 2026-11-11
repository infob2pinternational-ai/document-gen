# Field Sales: staging Supabase verification procedure

**Not executed in this session.** This session has no staging Supabase project, no credentials
for one, and is explicitly barred from touching production. This document is a procedure for
someone with a staging Supabase project (or willing to create one) to run before internal
deployment. It exists because the in-memory/local-Postgres tests in this repository (PGlite and a
throwaway local PostgreSQL — see `database/FIELD_SALES_DEPLOYMENT.md`, "Tests") prove the SQL and
RLS logic in isolation, but do **not** exercise:

- Real Supabase Auth (JWT issuance, refresh, session expiry, the real `auth.users` table and its
  triggers/webhooks, if any are configured on the project).
- The real PostgREST layer (how it parses `rpc`/`select` calls, its own error-shape/status-code
  mapping, connection pooling, statement timeouts under load).
- The project's actual "exposed schemas" setting (whether `field_sales_internal` and
  `b2p_migration_internal` are truly unreachable through the HTTP API — this can only be confirmed
  against a real Supabase project's API settings, not from SQL).
- Realtime (not used by Field Sales today, but worth confirming nothing new leaks through it).

## 0. Create the staging project

1. In the Supabase dashboard, create a **new** project (e.g. `document-gen-staging`). Do not
   reuse or branch from the production project (`rqovkmjsdwzggebvwvdk`).
2. Note its project URL and anon key; these go into a **separate** `.env.staging.local` (never
   `.env.local`, which is reserved for the production values per `.env.example`).
3. Apply the base schema. The simplest approach: use the Supabase dashboard's schema-diff/restore
   tooling to copy production's schema (not its data) into staging, or run
   `database/APPLY_ALL_MIGRATIONS.sql` followed by every file in `database/migrations/` **in
   filename order** against the fresh staging project, ending with:
   - `20261110000001_security_office_roles_only.sql`
   - `20261110000002_field_sales_data_collection.sql`
   - `20261111000001_fix_telecalling_sync_queue_claim_authorization.sql`
4. Seed staging-only test accounts (never real B2P email addresses): one each of `owner`, `admin`,
   `staff`, and two `sales` accounts for two different companies, following the exact provisioning
   steps in `database/FIELD_SALES_DEPLOYMENT.md` ("Adding a salesperson").
5. Seed two `profiles` rows (companies) and a handful of existing `leads` with a few shared phone
   numbers, so duplicate-detection has something real to find.

## 1. Point a local build at staging

```bash
cp .env.example .env.staging.local
# fill in the staging project's VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
cp .env.staging.local .env.local   # temporarily, for this verification pass only
npm run dev
```

Do this on a machine/session that is **not** this one, or at minimum confirm `VITE_SUPABASE_URL`
really points at the staging project (not production) before running anything below. Restore the
real `.env.local` afterward; never commit either file (both are gitignored).

## 2. Authentication (real Supabase Auth)

- [ ] Sign in as each seeded test account through the actual login screen. Confirm a session is
      issued and `supabase.auth.getSession()` returns a real JWT.
- [ ] Sign in as the `sales` account, open DevTools → Application → Local Storage, and confirm a
      real `sb-<project-ref>-auth-token` key exists (proves the browser is really talking to
      Supabase Auth, not a mock).
- [ ] Let a session sit idle past Supabase's access-token expiry (default 1 hour) with the tab
      open; confirm the Supabase client's automatic token refresh keeps the field-visit sync
      working without requiring a fresh sign-in.
- [ ] Sign out, then try calling `save_field_visit` via the browser console with the now-invalid
      token still in a manually-constructed request header; confirm a 401, not a stale success.

## 3. PostgREST + RPC execution (not just the SQL function body)

- [ ] As the `sales` account, open the New Visit form, submit a real visit. Confirm, in the
      Network tab, the actual request is `POST .../rest/v1/rpc/save_field_visit` and the response
      is `200` with the visit row — this proves PostgREST itself routes and executes the function,
      not just that the function is correct in isolation.
- [ ] As the `sales` account, attempt `supabase.rpc('field_visit_assignees', {...})` from the
      browser console (a function this role should never reach). Confirm PostgREST returns 403,
      not a silently empty array that could be mistaken for "no assignees."
- [ ] Confirm `GET .../rest/v1/field_visits` as the `sales` account returns only that salesperson's
      own rows (PostgREST applying RLS correctly over the real HTTP API, not just via `psql`).
- [ ] From the Supabase dashboard's API settings, confirm the exposed schemas list is exactly
      `public` (and `graphql_public` if GraphQL is enabled) — **not** `field_sales_internal` or
      `b2p_migration_internal`. If either shows up, that is a real, previously-undetectable gap (it
      cannot be checked from SQL — see `database/FIELD_SALES_DEPLOYMENT.md`, "Part A... Section 7").

## 4. RLS under real concurrent load

- [ ] Open the office review screen in two browser windows (two different staff members, or the
      same owner account twice), both looking at the same approved visit. Click "Convert to lead"
      in both within a second of each other. Confirm exactly one lead and one follow-up are
      created (this repeats the local-PostgreSQL concurrency tests in
      `tests/field-sales-concurrency.test.mjs`, but through the real network and real PostgREST
      connection pool rather than two local `pg` client connections).

## 5. End-to-end workflow, once, for real

- [ ] Full cycle: sales account submits a visit (including with the device offline, using a real
      network disconn/reconnect, not just Playwright's `context.setOffline`) → owner reviews,
      requests a correction → sales account corrects and resubmits → owner approves → converts to
      a lead with a follow-up → confirm the lead and follow-up appear correctly in the existing
      Leads and Follow-ups screens, with the salesperson's name preserved in the lead's
      `source_details` and activity timeline.

## 6. Clean-up

- [ ] Delete the staging project's test data, or the whole staging project, when done. Restore
      `.env.local` to production values on any machine where it was temporarily changed. Never
      point a shared/cloud session's `.env.local` at a staging project without being certain which
      file is which — the `.env.example` comments say `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
      are the only values a client build needs, so a mix-up is easy to make silently.

## Remaining gap after this procedure is run

Even a full pass of the above does not test the production Vercel deployment's own environment
variables, which previous sessions in this engagement flagged as still unverified (whether
`VITE_SUPABASE_URL`/`SUPABASE_URL` on Vercel actually point at `rqovkmjsdwzggebvwvdk`). That is a
separate, Vercel-dashboard-only check, not something a staging Supabase project can substitute for.
