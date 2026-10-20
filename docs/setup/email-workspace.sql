-- REVIEW ONLY: proposed setup for the Email window. Not executed by Codex.
-- Run only against the explicitly approved CRM project after backup/review.
BEGIN;
CREATE TABLE IF NOT EXISTS public.crm_email_accounts (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.profiles(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  name text NOT NULL,
  email text NOT NULL,
  imap_host text NOT NULL,
  imap_port integer NOT NULL CHECK (imap_port = 993),
  imap_user text NOT NULL,
  smtp_host text NOT NULL,
  smtp_port integer NOT NULL CHECK (smtp_port IN (465,587)),
  smtp_user text NOT NULL,
  credentials_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id,email)
);
CREATE TABLE IF NOT EXISTS public.crm_email_sends (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.profiles(id),
  account_id uuid REFERENCES public.crm_email_accounts(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL CHECK (status IN ('sending','accepted','failed','uncertain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_email_accounts_company ON public.crm_email_accounts(company_id);
CREATE INDEX IF NOT EXISTS crm_email_sends_company ON public.crm_email_sends(company_id,account_id);
ALTER TABLE public.crm_email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_email_sends ENABLE ROW LEVEL SECURITY;
-- Password ciphertext and send claims are server-only. The API verifies the
-- existing CRM Owner or authorized Franson session, then company access before
-- every service-role query. Module access does not grant a broader CRM role.
REVOKE ALL ON public.crm_email_accounts FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.crm_email_sends FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.crm_email_accounts TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.crm_email_sends TO service_role;
COMMIT;
