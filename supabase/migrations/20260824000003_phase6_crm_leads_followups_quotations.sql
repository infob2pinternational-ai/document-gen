-- =====================================================================
-- B2P INTERNATIONAL ERP: PHASE 6 — CRM CLOUD PERSISTENCE
-- Prepared Migration (LOCAL ONLY — NOT APPLIED TO PRODUCTION SUPABASE)
--
-- Full-project audit follow-up (2026-08-24, third pass). Until now,
-- leadService.ts and officeService.ts (leads, lead activities,
-- follow-ups, the CRM quotation-approval workflow, and the internal
-- booking calendar) were 100% localStorage - every browser/device had
-- its own independent CRM with no sync, unlike documents/customers/
-- finance which are already Supabase-backed. This migration adds the
-- missing tables, following the exact same conventions already
-- established across the Phase 4 finance migrations:
--   - company_id REFERENCES profiles(id), never a non-existent
--     "companies" table.
--   - RLS: auth.role() = 'authenticated' shared-staff model, matching
--     every other table in this schema (see the note in
--     20260823000001_phase4_1_core_accounting.sql for why - this is a
--     single organization with shared staff access, not multi-tenant).
--   - Line items / approval fields embedded as JSONB where a child
--     table would need an unverified multi-statement transaction
--     through the Supabase JS client (crm_quotations.items), matching
--     the precedent in phase4_7/phase4_8.
--   - All new primary keys are genuine UUID - unlike the finance
--     module's hardcoded default chart of accounts, nothing here ships
--     as a compile-time seed with a human-readable id, so there is no
--     UUID/TEXT mismatch risk to widen against (see the note in
--     phase4_1 for that specific, unrelated defect).
--
-- WhatsApp conversations/messages (Phase 6 as originally labelled in
-- types.ts) and the Notification Center (Phase 7) are deliberately NOT
-- included here. WhatsAppInbox.tsx is an explicitly local/simulated
-- conversation log (see its own `handleSendSimulatedAttachment` name),
-- not a real WhatsApp Business API integration - cloud-syncing a
-- simulated inbox would not make it a real integration and was judged
-- not worth the added risk/complexity in this pass. Notifications are
-- inherently per-device/ephemeral (browser notification center); kept
-- local-only.
-- =====================================================================

-- 1. Leads
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  lead_number TEXT,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
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
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT unique_lead_number_per_company UNIQUE (company_id, lead_number)
);

-- 2. Lead Activities (audit trail of status transitions / notes)
CREATE TABLE IF NOT EXISTS lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 3. Follow-ups
CREATE TABLE IF NOT EXISTS follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  lead_number TEXT,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
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

-- 4. CRM Quotation Approval Workflow (pre-Document staging/approval -
--    distinct in purpose from the real `documents` table: this is the
--    Admin-drafts / Owner-approves step BEFORE a formal quotation
--    Document is generated, not a duplicate of Document itself).
CREATE TABLE IF NOT EXISTS crm_quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number TEXT NOT NULL,
  company_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  lead_number TEXT,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  company_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  service_required TEXT NOT NULL,
  vehicle_service_type TEXT,
  campaign_location TEXT NOT NULL,
  required_date DATE NOT NULL,
  number_of_days INT NOT NULL DEFAULT 1,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  tax_total NUMERIC NOT NULL DEFAULT 0,
  discount_total NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  terms TEXT,
  approval_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (approval_status IN ('DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'REVISED')),
  created_by_email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  approved_by_email TEXT,
  approved_at TIMESTAMP WITH TIME ZONE,
  owner_remarks TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  sent_by_email TEXT,
  CONSTRAINT unique_crm_quotation_number_per_company UNIQUE (company_id, quotation_number)
);

-- =====================================================================
-- Row Level Security (RLS) Policies
-- =====================================================================

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_quotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads_auth_all" ON leads
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "lead_activities_auth_all" ON lead_activities
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "follow_ups_auth_all" ON follow_ups
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "crm_quotations_auth_all" ON crm_quotations
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- =====================================================================
-- Indexes
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_leads_company ON leads(company_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(company_id, status);
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_company ON lead_activities(company_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_company ON follow_ups(company_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due ON follow_ups(company_id, due_date);
CREATE INDEX IF NOT EXISTS idx_follow_ups_lead ON follow_ups(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_quotations_company ON crm_quotations(company_id);
CREATE INDEX IF NOT EXISTS idx_crm_quotations_lead ON crm_quotations(lead_id);

-- =====================================================================
-- 5. Booking Calendar cloud-completion: the real `resources`/`bookings`
--    tables already existed (20260824000001_phase5_unified_quotations.sql)
--    but were built ONLY for the public-website automated-quotation RPC
--    - the internal staff BookingCalendar.tsx UI read from a completely
--    separate, disconnected local officeService store instead, so a
--    website-originated booking hold was invisible to staff and vice
--    versa. Additive-only ALTERs below let BOTH paths share one real
--    table without touching the existing RPC (which only ever sets the
--    original columns - the new ones are nullable and simply blank for
--    RPC-created rows unless/until the internal UI enriches them).
-- =====================================================================

-- 5a. resources.id was UUID but is a UUID-generated table already (no
--     compile-time hardcoded ids reference it outside this project's
--     own SEED_RESOURCES fleet-inventory defaults, which - like the
--     finance module's default chart of accounts - use human-readable
--     ids ('res-van-1', etc). Widened to TEXT for the same reason
--     account_heads/account_groups were (see phase4_1's note) so those
--     defaults can be synced without an id-type mismatch.
ALTER TABLE public.resources ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.resources ALTER COLUMN id TYPE TEXT;
ALTER TABLE public.resources ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.bookings ALTER COLUMN resource_id TYPE TEXT;

-- 5a-2. The internal calendar books whole days via start_date/end_date
--       (added below), not the RPC's precise start_time/end_time - both
--       NOT NULL in the original schema, which would reject every
--       internal-UI insert outright. Relaxed to nullable; a CHECK
--       constraint's NULL operands are treated as satisfied by Postgres
--       (neither TRUE nor FALSE), so leaving them unset for
--       internal-UI-created rows doesn't trip valid_time_range either.
--       The automated RPC is unaffected - it always supplies both.
ALTER TABLE public.bookings ALTER COLUMN start_time DROP NOT NULL;
ALTER TABLE public.bookings ALTER COLUMN end_time DROP NOT NULL;

-- 5b. Denormalized display columns the internal calendar UI needs
--     (booking_number, customer contact info, lead/quotation linkage,
--     resource_name cache, free-text location, staffing, notes) that
--     the original minimal automated-RPC schema never carried. All
--     nullable - the RPC path is completely unaffected.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS booking_number TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS lead_number TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS quotation_id UUID REFERENCES crm_quotations(id) ON DELETE SET NULL;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS quotation_number TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS resource_name TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS assigned_staff_email TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS driver_or_operator TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW());
-- The internal UI books whole days (start_date/end_date), while the
-- automated RPC books precise slots (start_time/end_time) - both kept,
-- neither forced into the other's semantics.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS end_date DATE;
-- The internal calendar's local BookingStatus vocabulary ('TENTATIVE',
-- 'COMPLETED') differs from the automated RPC's ('HOLD', 'EXPIRED') -
-- widened rather than forcing one path to adopt the other's semantics.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('HOLD', 'TENTATIVE', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED'));

CREATE INDEX IF NOT EXISTS idx_bookings_lead ON public.bookings(lead_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON public.bookings(company_id, start_date, end_date);
