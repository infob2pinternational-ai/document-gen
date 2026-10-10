# PR #16: controlled follow-up timeline release

This is a release gate, not authorization to deploy. PR #16 was already merged
externally as `5047051` before the safety fixes were pushed. These fixes require
a separate review and explicit approval of the exact commit and maintenance plan.
Keep production release blocked until that review is complete. The frontend
build does **not** apply the migration. No production SQL or promotion is part
of the tests.

## Required gates

- Identify the release operator, maintenance window and authorized test account.
- Save/export unsaved drafts before closing tabs or refreshing sessions. Do not
  clear all localStorage or site data. The fix invalidates only the activity
  cache on identity change; it does not remove draft keys.
- Establish and test a separately reviewed, database-enforced write hold on
  follow-up writes and client completion-activity inserts. A website banner or
  sign-out request does not block old sessions calling Supabase directly.
  Retain company authorization and allow only the controlled test account if
  needed. Do not lift the hold until verification and session refresh finish.
- Drain in-flight writes and prove an old test session cannot write during the
  hold. This repository does not supply a maintenance-hold implementation;
  the operator must have it reviewed and approved before release.
- Confirm production environment targets Supabase **generator**, reference
  **rqovkmjsdwzggebvwvdk**. Retain public-key configuration; never use a
  service-role key in the frontend. Confirm Vercel production branch and
  automatic promotion settings; record the current deployment for rollback.

## Migration: separate SQL Editor operation after approval

Use the existing repository SQL Editor workflow, not a blanket `db push` or
`database/APPLY_ALL_MIGRATIONS.sql`. This release is under `database/migrations`,
not the CLI's `supabase/migrations`; older baseline SQL differs from the deployed
schema.

1. Open <https://supabase.com/dashboard/project/rqovkmjsdwzggebvwvdk/sql/new> and
   confirm the project name/reference.
2. Execute **only** the approved commit's
   `database/migrations/20261010053916_followup_timeline_atomic.sql`, prefixed
   with `BEGIN;` and followed by `NOTIFY pgrst, 'reload schema'; COMMIT;`.
   Stop on error; do not bypass permissions or reset the database.
3. Record commit, filename, operator and execution time. Manual SQL Editor use
   does not automatically register Supabase CLI migration history.
4. Check `SELECT public.followup_timeline_version();` returns `1`. Check all
   three enabled row triggers: `followup_timeline_activity` and
   `preserve_followup_completion_time` on `follow_ups`, and
   `guard_followup_completion_activity` on `lead_activities`. Check all four
   release functions are SECURITY INVOKER, authenticated has EXECUTE, anon does
   not, and existing table/company RLS remains enabled and unchanged.

## Mixed-version guarantee and boundaries

The task's AFTER trigger creates the canonical completion in the same
transaction. A BEFORE INSERT activity guard reserves `Follow-up Completed`
(case insensitive) for nested trigger inserts. The original older client's
independent random-ID API upsert is skipped at trigger depth 1; the atomic task
insert runs at depth 2 and is retained. There is no note/time matching or deletion.
An already-completed task update preserves its original completion timestamp.
Notes edited after completion can still create a separate call-remarks event.

Regression tests execute the original completion method from base commit
`3aed419203cae9ec9eeae97ca184ec66a42717da`, including task ON CONFLICT upserts
and independent activity ON CONFLICT upserts, against both supported activity
schemas. Stale retries produce one canonical completion; distinct tasks with
identical remarks keep separate activities. Activity insertion/RLS failure
still rolls back the task transaction.

The guarantee covers the reviewed old/new clients' direct INSERT/upsert path.
Direct/manual creation of this reserved completion activity is intentionally
ignored; integrations must complete the task instead. Arbitrary privileged
writers, activity UPDATEs, or other nested database triggers are not a general
deduplication guarantee. Inventory production triggers/integrations before
approval; if another completion writer bypasses this path, keep deployment
blocked until it is reviewed and tested. Existing duplicate history is retained.

The migration supports `type/notes/performed_by` and
`action/note/user_email`. That does not make the whole new frontend compatible
with a legacy-only database: direct note/schedule serialization still expects
the deployed schema. Apply only to the confirmed generator project.

## Frontend and session refresh

1. After approval, stage the exact reviewed commit in the existing Vercel
   **document-gen** project (`prj_O1AGfBuyeGEiFbfoneoU7QRKGzUu`), with production
   environment values and production domains unassigned. Keep the hold active.
   Verify routing/build output (`dist/billing`) and the delivered commit.
2. Verify with the designated account, then promote the staged deployment only
   after explicit deployment approval. Never let a merge auto-promote ahead of
   the migration or maintenance window.
3. Preserve drafts, close older browser/mobile/PWA sessions, reopen the
   production URL, hard refresh and sign in. Confirm the approved build for
   every permitted device/account before lifting the hold. Ordinary sign-out
   does not guarantee every old JWT is invalidated. Do not blindly clear site
   storage; if a stale installed-app cache exists, clear only that verified
   cache after drafts are preserved.
4. Finish the smoke test below and record evidence before restoring writes.

## Production smoke test after approval

Use a clearly named test lead and authorized company. Keep its records for
audit; do not delete activities as cleanup.

- Create Due Today and Overdue tasks. Enter distinct remarks and complete each.
  Verify one completion per task, correct lead/company, JWT actor and time.
- Retry completion and double-click save. Confirm count and original completion
  time remain unchanged. In a separately controlled old session, verify its
  independent completion upsert does not add a second row.
- Schedule a future task with preparation notes. Verify it stays pending and
  creates no false historical call; scheduling history is retained. Edit call
  remarks/date and confirm history and next due date are both correct.
- Add a lead-detail note; verify immediate display, close/reopen and reload.
  Check another refreshed authorized session, and account/company switching.
- Check optional empty remarks use the existing fallback. Check no activity
  appears on an unrelated lead/company. Watch database/application errors.
- Exercise deliberately delayed responses, missing migration and denied writes
  in local/staging tests; do not intentionally break production permissions.

## Rollback preserving data

Re-establish the approved write hold first. Prefer a forward fix while keeping
the canonical trigger and guard. A frontend-only rollback retains duplicate
protection when this guard stays installed, but restores old UI/cache behavior.

If a full rollback is approved, promote the recorded previous frontend under
the hold and remove only these release objects in a reviewed transaction:

```sql
BEGIN;
DROP TRIGGER IF EXISTS followup_timeline_activity ON public.follow_ups;
DROP TRIGGER IF EXISTS preserve_followup_completion_time ON public.follow_ups;
DROP TRIGGER IF EXISTS guard_followup_completion_activity ON public.lead_activities;
DROP FUNCTION IF EXISTS public.log_followup_timeline_activity();
DROP FUNCTION IF EXISTS public.preserve_followup_completion_time();
DROP FUNCTION IF EXISTS public.guard_followup_completion_activity();
DROP FUNCTION IF EXISTS public.followup_timeline_version();
NOTIFY pgrst, 'reload schema';
COMMIT;
```

Never use CASCADE, delete rows, clear notes or rerun historical schema SQL.
Confirm all sessions use the previous frontend before lifting the hold: the
new frontend safely refuses follow-up writes without the version function.
Record that the previous missing-timeline behavior has returned. All follow-up
and activity data remains intact. No backfill or existing-row deletion is
included in this migration or rollback.
