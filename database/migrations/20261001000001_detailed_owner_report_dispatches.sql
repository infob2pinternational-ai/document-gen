-- =====================================================================
-- B2P INTERNATIONAL ERP: OWNER REPORT DISPATCHES & AT-MOST-ONCE IDEMPOTENCY LEDGER
-- Migration: 20261001000001_detailed_owner_report_dispatches.sql
--
-- Provides persistent, multi-container idempotency tracking for automatic
-- 8:00 PM IST daily reports dispatched to the company owner.
--
-- Replaces ephemeral /tmp storage with persistent PostgreSQL / Supabase storage.
-- Guarantees at-most-once delivery per staff member per report date, even if
-- Vercel Cron fires multiple times or multiple serverless containers run in parallel.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.owner_report_dispatches (
  id TEXT PRIMARY KEY, -- e.g. detailed_staff_report_brutf5354@gmail.com_2026-10-01
  report_type TEXT NOT NULL DEFAULT 'detailed_staff_report',
  staff_email TEXT NOT NULL,
  report_date DATE NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('in_progress', 'sent', 'delivered', 'failed', 'skipped')),
  sent_at TIMESTAMPTZ,
  sent_count INT DEFAULT 0,
  message_ids JSONB DEFAULT '[]'::jsonb,
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
