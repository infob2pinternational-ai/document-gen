-- Matches the production schema report supplied on 2026-09-18.
-- Run before deploying fix/live-crm-schema. Existing records are preserved.
BEGIN;

-- An enquiry may need a follow-up before it has become a customer.
ALTER TABLE public.follow_ups ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_number text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS created_by_email text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_note text;

ALTER TABLE public.follow_ups DROP CONSTRAINT IF EXISTS follow_ups_status_check;
ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_status_check
  CHECK (status IN ('pending', 'completed', 'cancelled', 'snoozed', 'overdue'));

ALTER TABLE public.crm_quotations
  ADD COLUMN IF NOT EXISTS lead_number text,
  ADD COLUMN IF NOT EXISTS customer_address text,
  ADD COLUMN IF NOT EXISTS service_required text,
  ADD COLUMN IF NOT EXISTS vehicle_service_type text,
  ADD COLUMN IF NOT EXISTS campaign_location text,
  ADD COLUMN IF NOT EXISTS required_date date,
  ADD COLUMN IF NOT EXISTS number_of_days integer,
  ADD COLUMN IF NOT EXISTS tax_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS terms text,
  ADD COLUMN IF NOT EXISTS sent_by_email text;

NOTIFY pgrst, 'reload schema';
COMMIT;
