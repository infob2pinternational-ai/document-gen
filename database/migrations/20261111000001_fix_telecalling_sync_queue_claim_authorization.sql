-- =====================================================================
-- SECURITY FIX: claim_telecalling_sync_queue_rows authorization
-- Target: Supabase project rqovkmjsdwzggebvwvdk.
--
-- DO NOT RUN WITHOUT REVIEW. Independent of the field-sales feature and of
-- the office_roles_only hardening; apply whenever convenient, in any order
-- relative to those two.
--
-- The vulnerability (found during the B2P Field Sales security review)
--   public.claim_telecalling_sync_queue_rows(p_worker_id text, p_limit integer)
--   is SECURITY DEFINER, has no identity or company check in its body, and -
--   per the live grants captured in tests/fixtures/live-schema-2026-11-10.sql -
--   is executable by the "anon" role, i.e. by a caller using nothing but the
--   public Supabase anon key, with no session at all. It claims and returns
--   up to p_limit rows from telecalling_google_sync_queue *for every company*,
--   including each row's full jsonb payload (telecalling entry contents: phone
--   numbers, contact names, feedback). It also flips those rows to
--   status='syncing', which can disrupt the real Google Sheets sync worker.
--   The matching frontend call (telecallingService.ts processSyncQueueOnce)
--   already receives a company_id but never passed it to the function, so
--   even a legitimate signed-in caller claimed every company's rows, not just
--   their own - the frontend author had the right instinct (per-company) but
--   nothing on either side actually enforced it.
--
-- The fix
--   1. The function gains a required p_company_id parameter and raises unless
--      the CALLER (auth.uid(), via current_app_role()/can_access_company,
--      exactly as every other office RPC in this codebase does) has access
--      to that company. No identity or company claim from the caller is
--      trusted without this check.
--   2. The claimed rows are scoped to that company (WHERE company_id = p_company_id).
--   3. EXECUTE is revoked from PUBLIC and anon and granted only to authenticated.
--   4. The old two-argument function is dropped: there is no legitimate
--      caller of the unscoped form left once the frontend is updated (done in
--      this same change set), and leaving it in place would leave the
--      vulnerability reachable under its original signature.
--
-- Re-running
--   Uses the same object-registry fingerprinting as the other migrations in
--   this folder (see 20261110000001_security_office_roles_only.sql): the
--   first run requires b2p_migration_internal to already exist (apply that
--   migration, or 20261110000002_field_sales_data_collection.sql, first).
--   A re-run is a no-op; an object changed by someone else since this script
--   created it stops the script instead of being silently overwritten.
-- =====================================================================
BEGIN;

DO $$
DECLARE
  v_old_def  text;
  v_new_def  text;
  v_normalized text;
  -- The exact body this project shipped in 20260922000002_telecalling_operations.sql, and
  -- independently re-confirmed against the live production catalog on 2026-11-10 (see
  -- tests/fixtures/live-schema-2026-11-10.sql). Compared with whitespace collapsed, since
  -- PostgreSQL major versions format pg_get_functiondef() output slightly differently (this
  -- project's other migrations use the same tolerance - see object_definition() and its
  -- callers in 20261110000001_security_office_roles_only.sql).
  v_known_old_body text := 'BEGIN RETURN QUERY WITH claimable AS ( SELECT id FROM public.telecalling_google_sync_queue WHERE status IN (''pending'', ''failed'') AND failed_permanently = false AND next_attempt_at <= now() AND (locked_at IS NULL OR locked_at < now() - interval ''5 minutes'') ORDER BY next_attempt_at ASC LIMIT p_limit FOR UPDATE SKIP LOCKED ) UPDATE public.telecalling_google_sync_queue q SET status = ''syncing'', locked_at = now(), locked_by = p_worker_id, updated_at = now() FROM claimable c WHERE q.id = c.id RETURNING q.*; END;';
BEGIN
  IF to_regclass('public.telecalling_google_sync_queue') IS NULL THEN
    RAISE EXCEPTION 'Fix stopped: public.telecalling_google_sync_queue not found. Wrong database?';
  END IF;
  IF to_regprocedure('public.can_access_company(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Fix stopped: public.can_access_company(uuid) not found. Wrong database?';
  END IF;

  -- Only check the old two-argument form if it is still there: a previous successful run of
  -- this very script already dropped it (see below), so its absence alone is not a problem.
  IF to_regprocedure('public.claim_telecalling_sync_queue_rows(text,integer)') IS NOT NULL THEN
    v_old_def := pg_get_functiondef('public.claim_telecalling_sync_queue_rows(text,integer)'::regprocedure);
    -- Collapse all whitespace and normalize quoting so the comparison is immune to
    -- formatting-only differences between PostgreSQL versions, exactly as elsewhere in this project.
    v_normalized := regexp_replace(regexp_replace(v_old_def, '\$function\$|\$\$', '', 'g'), '\s+', ' ', 'g');
    IF position(regexp_replace(v_known_old_body, '\s+', ' ', 'g') IN v_normalized) = 0 THEN
      RAISE EXCEPTION 'Fix stopped: public.claim_telecalling_sync_queue_rows(text,integer) does not match the definition this fix expects to replace (it may already have been changed by someone else). Nothing was changed. Investigate before re-running.';
    END IF;
  END IF;

  -- If a prior run of this same script already got as far as creating the new three-argument
  -- form, only proceed past it if it looks like our own fix (a true re-run), never if someone
  -- else has since replaced it with something unexpected.
  IF to_regprocedure('public.claim_telecalling_sync_queue_rows(text,uuid,integer)') IS NOT NULL THEN
    v_new_def := pg_get_functiondef('public.claim_telecalling_sync_queue_rows(text,uuid,integer)'::regprocedure);
    IF position('p_company_id IS NULL OR NOT public.can_access_company(p_company_id)' IN v_new_def) = 0 THEN
      RAISE EXCEPTION 'Fix stopped: public.claim_telecalling_sync_queue_rows(text,uuid,integer) already exists with an unexpected definition. Nothing was changed. Investigate before re-running.';
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.claim_telecalling_sync_queue_rows(
  p_worker_id text,
  p_company_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS SETOF public.telecalling_google_sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_company_id IS NULL OR NOT public.can_access_company(p_company_id) THEN
    RAISE EXCEPTION 'Telecalling sync queue access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH claimable AS (
    SELECT id
    FROM public.telecalling_google_sync_queue
    WHERE company_id = p_company_id
      AND status IN ('pending', 'failed')
      AND failed_permanently = false
      AND next_attempt_at <= now()
      AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes')
    ORDER BY next_attempt_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.telecalling_google_sync_queue q
  SET status = 'syncing',
      locked_at = now(),
      locked_by = p_worker_id,
      updated_at = now()
  FROM claimable c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_telecalling_sync_queue_rows(text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_telecalling_sync_queue_rows(text, uuid, integer) TO authenticated;

-- Remove the old, unscoped, anon-callable signature. Nothing should call it after this change
-- ships together with the telecallingService.ts update in this commit.
DROP FUNCTION IF EXISTS public.claim_telecalling_sync_queue_rows(text, integer);

-- Record in the shared migration registry too, if it is present (field-sales/hardening
-- migrations applied), purely so the read-only production verification script can list this
-- fix alongside the others; this migration does not require the registry to exist.
DO $$
BEGIN
  IF to_regprocedure('b2p_migration_internal.record_object(text,text,text)') IS NOT NULL THEN
    PERFORM b2p_migration_internal.record_object('fix_telecalling_sync_queue_claim', 'function', 'public.claim_telecalling_sync_queue_rows(text,uuid,integer)');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
