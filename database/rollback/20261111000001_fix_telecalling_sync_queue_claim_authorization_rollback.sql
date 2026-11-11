-- =====================================================================
-- ROLLBACK for 20261111000001_fix_telecalling_sync_queue_claim_authorization.sql
-- Target: Supabase project rqovkmjsdwzggebvwvdk.
--
-- DO NOT RUN WITHOUT REVIEW. This RESTORES the anonymous-callable,
-- unscoped function. Use it only to back out this specific fix, never as a
-- routine step, and only with the same approval that would be needed to
-- reintroduce the original vulnerability on purpose.
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.claim_telecalling_sync_queue_rows(
  p_worker_id text,
  p_limit integer DEFAULT 10
)
RETURNS SETOF public.telecalling_google_sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT id
    FROM public.telecalling_google_sync_queue
    WHERE status IN ('pending', 'failed')
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

REVOKE ALL ON FUNCTION public.claim_telecalling_sync_queue_rows(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_telecalling_sync_queue_rows(text, integer) TO authenticated, anon;

DROP FUNCTION IF EXISTS public.claim_telecalling_sync_queue_rows(text, uuid, integer);

-- Forget the fixed form in the shared registry, if that registry exists.
DO $$
BEGIN
  IF to_regclass('b2p_migration_internal.object_registry') IS NOT NULL THEN
    DELETE FROM b2p_migration_internal.object_registry
     WHERE kind = 'function' AND ident = 'public.claim_telecalling_sync_queue_rows(text,uuid,integer)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
