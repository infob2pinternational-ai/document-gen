-- =====================================================================
-- B2P INTERNATIONAL ERP: TELECALLING OPERATIONS & CRM TABLES
-- Migration: 20260917000001_telecalling_operations.sql
--
-- Self-healing & idempotent: Ensures public.leads, public.lead_activities,
-- and public.follow_ups exist first, then adds telecalling columns,
-- indexes, and RLS policies. Safe to run on fresh or existing databases.
-- =====================================================================

-- 0. Ensure base CRM tables exist (standalone and decoupled from specific profiles/customers tables)
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID,
  lead_number TEXT,
  customer_id UUID,
  customer_name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT NOT NULL,
  whatsapp_number TEXT,
  address TEXT,
  location TEXT,
  business_type TEXT,
  lead_source TEXT NOT NULL DEFAULT 'other',
  source_details TEXT,
  service_required TEXT,
  vehicle_service_type TEXT,
  required_date DATE,
  campaign_location TEXT,
  number_of_days INT,
  priority TEXT NOT NULL DEFAULT 'WARM',
  assigned_telecaller_email TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  next_follow_up_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  company_id UUID,
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  lead_number TEXT,
  customer_id UUID,
  customer_name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT,
  assigned_staff_email TEXT NOT NULL,
  due_date DATE NOT NULL,
  due_time TEXT NOT NULL DEFAULT '10:00',
  reason TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'SNOOZED', 'CANCELLED', 'OVERDUE')),
  created_by_email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  completed_at TIMESTAMP WITH TIME ZONE,
  completion_note TEXT,
  snoozed_until TIMESTAMP WITH TIME ZONE,
  next_follow_up_id UUID
);

-- 1. Additive columns on public.leads for current calling state
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS alternate_phone TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_call_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_call_outcome TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_call_remark TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS call_count INT NOT NULL DEFAULT 0;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_contacted_by_email TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS is_telecalling_lead BOOLEAN NOT NULL DEFAULT true;

-- 2. Additive columns on public.lead_activities for immutable call audit trail
ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS activity_type TEXT NOT NULL DEFAULT 'call';
ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS call_outcome TEXT;
ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS phone_used TEXT;
ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS contact_person TEXT;
ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS next_follow_up_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW());

-- 3. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_leads_telecaller ON public.leads(assigned_telecaller_email);
CREATE INDEX IF NOT EXISTS idx_leads_last_call ON public.leads(company_id, last_call_at);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON public.leads(phone);
CREATE INDEX IF NOT EXISTS idx_lead_activities_outcome ON public.lead_activities(company_id, call_outcome);
CREATE INDEX IF NOT EXISTS idx_lead_activities_user_created ON public.lead_activities(user_email, created_at);
CREATE INDEX IF NOT EXISTS idx_lead_activities_created ON public.lead_activities(company_id, created_at);

-- 4. Error & Operational Diagnostics Logging Table
CREATE TABLE IF NOT EXISTS public.app_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID,
  user_email TEXT NOT NULL,
  lead_id UUID,
  operation TEXT NOT NULL,
  screen TEXT,
  error_message TEXT NOT NULL,
  error_code TEXT,
  metadata JSONB,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created ON public.app_error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_user ON public.app_error_logs(user_email, created_at DESC);

-- 5. Enable Row Level Security (RLS) & Standard Authenticated Policies
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_error_logs ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'leads' AND policyname = 'leads_auth_all') THEN
    CREATE POLICY "leads_auth_all" ON public.leads FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'lead_activities' AND policyname = 'lead_activities_auth_all') THEN
    CREATE POLICY "lead_activities_auth_all" ON public.lead_activities FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'follow_ups' AND policyname = 'follow_ups_auth_all') THEN
    CREATE POLICY "follow_ups_auth_all" ON public.follow_ups FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_error_logs' AND policyname = 'error_logs_auth_all') THEN
    CREATE POLICY "error_logs_auth_all" ON public.app_error_logs FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;

-- 6. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
