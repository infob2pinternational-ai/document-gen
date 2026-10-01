-- =====================================================================
-- B2P INTERNATIONAL ERP: OWNER REPORT DISPATCHES & ATOMIC CLAIM LEDGER
-- Migration: 20261001000001_detailed_owner_report_dispatches.sql
--
-- Provides persistent, multi-container idempotency tracking for automatic
-- 8:00 PM IST daily reports dispatched to the company owner.
--
-- Replaces read-then-upsert checks with an atomic PostgreSQL claim operation.
-- Guarantees at-most-once delivery per staff member per report date, even if
-- Vercel Cron fires multiple times or multiple serverless containers run in parallel.
-- Prevents resending already delivered messages in multi-part dispatches.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.owner_report_dispatches (
  id TEXT PRIMARY KEY, -- e.g. detailed_staff_report_brutf5354@gmail.com_2026-10-01
  report_type TEXT NOT NULL DEFAULT 'detailed_staff_report',
  staff_email TEXT NOT NULL,
  report_date DATE NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'sent', 'delivered', 'failed', 'partially_sent', 'skipped', 'requires_manual_review')),
  sent_at TIMESTAMPTZ,
  sent_count INT DEFAULT 0,
  message_ids JSONB DEFAULT '[]'::jsonb,
  message_results JSONB DEFAULT '[]'::jsonb,
  summary JSONB DEFAULT '{}'::jsonb,
  owner_attention JSONB DEFAULT '[]'::jsonb,
  error TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_owner_report_dispatches_lookup 
  ON public.owner_report_dispatches (report_type, staff_email, report_date, status);

CREATE INDEX IF NOT EXISTS idx_owner_report_dispatches_updated 
  ON public.owner_report_dispatches (updated_at DESC);

-- Atomic claim function ensuring only one execution acquires the lock
CREATE OR REPLACE FUNCTION public.claim_owner_report_dispatch(
  p_id TEXT,
  p_staff_email TEXT,
  p_report_date DATE,
  p_recipient TEXT,
  p_force BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing RECORD;
  v_claimed RECORD;
BEGIN
  -- Row-level lock on existing dispatch row
  SELECT * INTO v_existing FROM public.owner_report_dispatches WHERE id = p_id FOR UPDATE;

  IF FOUND THEN
    -- If already sent or delivered and not force, claim rejected
    IF v_existing.status IN ('sent', 'delivered') AND NOT p_force THEN
      RETURN jsonb_build_object(
        'acquired', false,
        'reason', 'already_sent',
        'dispatch', to_jsonb(v_existing)
      );
    END IF;

    -- If flagged for manual review and not force, claim rejected to protect against automatic duplicates
    IF v_existing.status = 'requires_manual_review' AND NOT p_force THEN
      RETURN jsonb_build_object(
        'acquired', false,
        'reason', 'manual_review_required',
        'dispatch', to_jsonb(v_existing)
      );
    END IF;

    -- If in_progress and updated within last 5 minutes and not force, active lock exists
    IF v_existing.status = 'in_progress' AND v_existing.updated_at > (TIMEZONE('utc', NOW()) - INTERVAL '5 minutes') AND NOT p_force THEN
      RETURN jsonb_build_object(
        'acquired', false,
        'reason', 'in_progress_locked',
        'dispatch', to_jsonb(v_existing)
      );
    END IF;

    -- Update to in_progress to atomically claim (for failed, partially_sent, expired or forced)
    UPDATE public.owner_report_dispatches
    SET status = 'in_progress',
        recipient = p_recipient,
        updated_at = TIMEZONE('utc', NOW())
    WHERE id = p_id
    RETURNING * INTO v_claimed;

    RETURN jsonb_build_object(
      'acquired', true,
      'reason', 'reclaimed',
      'dispatch', to_jsonb(v_claimed)
    );
  ELSE
    -- Row does not exist: perform atomic insert
    INSERT INTO public.owner_report_dispatches (
      id, report_type, staff_email, report_date, recipient, status, created_at, updated_at
    ) VALUES (
      p_id, 'detailed_staff_report', p_staff_email, p_report_date, p_recipient, 'in_progress', TIMEZONE('utc', NOW()), TIMEZONE('utc', NOW())
    ) RETURNING * INTO v_claimed;

    RETURN jsonb_build_object(
      'acquired', true,
      'reason', 'new_claim',
      'dispatch', to_jsonb(v_claimed)
    );
  END IF;
EXCEPTION
  WHEN unique_violation THEN
    -- If concurrent insert collided at the same microsecond:
    SELECT * INTO v_existing FROM public.owner_report_dispatches WHERE id = p_id;
    RETURN jsonb_build_object(
      'acquired', false,
      'reason', 'conflict_lost',
      'dispatch', to_jsonb(v_existing)
    );
END;
$$;

ALTER TABLE public.owner_report_dispatches ENABLE ROW LEVEL SECURITY;

-- Owner role and authenticated office members with owner role can view history
CREATE POLICY owner_report_dispatches_select ON public.owner_report_dispatches
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'owner' OR
    lower(auth.jwt() ->> 'email') IN ('sarathjohnpanengadan@gmail.com', 'sarathjohnpanegdan@gmail.com', 'owner@b2p.com')
  );

-- Owner role can write manual dispatches; service role has full bypass
CREATE POLICY owner_report_dispatches_insert ON public.owner_report_dispatches
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'owner' OR
    lower(auth.jwt() ->> 'email') IN ('sarathjohnpanengadan@gmail.com', 'sarathjohnpanegdan@gmail.com', 'owner@b2p.com')
  );

CREATE POLICY owner_report_dispatches_update ON public.owner_report_dispatches
  FOR UPDATE TO authenticated
  USING (
    public.current_app_role() = 'owner' OR
    lower(auth.jwt() ->> 'email') IN ('sarathjohnpanengadan@gmail.com', 'sarathjohnpanegdan@gmail.com', 'owner@b2p.com')
  )
  WITH CHECK (
    public.current_app_role() = 'owner' OR
    lower(auth.jwt() ->> 'email') IN ('sarathjohnpanengadan@gmail.com', 'sarathjohnpanegdan@gmail.com', 'owner@b2p.com')
  );

REVOKE ALL ON FUNCTION public.claim_owner_report_dispatch(TEXT, TEXT, DATE, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_owner_report_dispatch(TEXT, TEXT, DATE, TEXT, BOOLEAN) TO service_role;
