-- Ensure lead_number column exists on public.leads and index for sequence querying
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lead_number text;

CREATE INDEX IF NOT EXISTS idx_leads_lead_number ON public.leads (company_id, lead_number);
