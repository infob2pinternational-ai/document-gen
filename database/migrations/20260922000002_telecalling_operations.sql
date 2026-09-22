-- Migration: 20260922000002_telecalling_operations.sql
-- Description: Phase 1 Telecalling Operations module schema: telecalling_entries table and dedicated telecalling_google_sync_queue

BEGIN;

-- 1. Create telecalling_entries table
CREATE TABLE IF NOT EXISTS public.telecalling_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  entry_date date NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date,
  company_name text NOT NULL,
  contact_person text,
  phone text NOT NULL,
  other_phone text,
  location text,
  email text,
  call_status text NOT NULL,
  feedback text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- 2. Create indexes for high performance telecalling reporting & queries
CREATE INDEX IF NOT EXISTS idx_telecalling_entries_company_date 
  ON public.telecalling_entries(company_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_telecalling_entries_call_status 
  ON public.telecalling_entries(company_id, call_status);

CREATE INDEX IF NOT EXISTS idx_telecalling_entries_created_by 
  ON public.telecalling_entries(company_id, created_by);

CREATE INDEX IF NOT EXISTS idx_telecalling_entries_phone 
  ON public.telecalling_entries(phone);

-- 3. Enable RLS on telecalling_entries
ALTER TABLE public.telecalling_entries ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies if already defined
DROP POLICY IF EXISTS telecalling_read ON public.telecalling_entries;
DROP POLICY IF EXISTS telecalling_write ON public.telecalling_entries;

-- RLS: Only users authorized for this company can read or write
CREATE POLICY telecalling_read ON public.telecalling_entries
  FOR SELECT TO authenticated
  USING (public.can_access_company(company_id));

CREATE POLICY telecalling_write ON public.telecalling_entries
  FOR ALL TO authenticated
  USING (public.can_access_company(company_id))
  WITH CHECK (public.can_access_company(company_id));

-- 4. Create dedicated telecalling Google sync queue
CREATE TABLE IF NOT EXISTS public.telecalling_google_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  telecalling_entry_id uuid NOT NULL REFERENCES public.telecalling_entries(id) ON DELETE CASCADE,
  action text NOT NULL DEFAULT 'save_telecalling_entry',
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'syncing', 'synced', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  failed_permanently boolean NOT NULL DEFAULT false,
  next_attempt_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  last_error text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT telecalling_google_sync_queue_entry_unique UNIQUE (telecalling_entry_id)
);

CREATE INDEX IF NOT EXISTS idx_telecalling_sync_queue_claim 
  ON public.telecalling_google_sync_queue(company_id, status, next_attempt_at)
  WHERE failed_permanently = false;

ALTER TABLE public.telecalling_google_sync_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telecalling_sync_read ON public.telecalling_google_sync_queue;
DROP POLICY IF EXISTS telecalling_sync_write ON public.telecalling_google_sync_queue;

CREATE POLICY telecalling_sync_read ON public.telecalling_google_sync_queue
  FOR SELECT TO authenticated
  USING (public.can_access_company(company_id));

CREATE POLICY telecalling_sync_write ON public.telecalling_google_sync_queue
  FOR ALL TO authenticated
  USING (public.can_access_company(company_id))
  WITH CHECK (public.can_access_company(company_id));

-- 5. Atomic queue claiming RPC (reusing standard SKIP LOCKED pattern)
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
GRANT EXECUTE ON FUNCTION public.claim_telecalling_sync_queue_rows(text, integer) TO authenticated;

COMMIT;

