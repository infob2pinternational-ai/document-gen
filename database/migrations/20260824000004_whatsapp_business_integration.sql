-- =====================================================================
-- B2P INTERNATIONAL ERP: PHASE 6+ — WHATSAPP BUSINESS API INTEGRATION
-- Prepared Migration (LOCAL ONLY — NOT APPLIED TO PRODUCTION SUPABASE)
--
-- Replaces the Phase 6 local-storage WhatsAppInbox prototype with real
-- cloud-persisted tables supporting:
--   1. Meta Cloud API inbound webhooks (customer replies & status receipts)
--   2. Real-time multi-agent shared team inbox (Supabase Realtime)
--   3. Outbound transactional document/PDF & template dispatch
--   4. CRM auto-lead generation from inbound inquiries
--
-- Follows established schema conventions:
--   - company_id REFERENCES profiles(id) ON DELETE CASCADE
--   - Shared authenticated RLS policies
--   - Genuine UUID primary keys
--   - Realtime publication registration
-- =====================================================================

-- 1. WhatsApp Conversations
CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  lead_number TEXT,
  customer_name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT NOT NULL,
  last_message TEXT DEFAULT '',
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  unread_count INT NOT NULL DEFAULT 0,
  assigned_staff_email TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'pending')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT unique_conv_phone_per_company UNIQUE (company_id, phone)
);

-- 2. WhatsApp Messages
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  wa_message_id TEXT, -- Meta message ID (wamid.HBg...)
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'staff', 'system')),
  sender_name TEXT NOT NULL,
  sender_email TEXT,
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'template', 'document', 'image', 'location', 'interactive')),
  text TEXT NOT NULL DEFAULT '',
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
  attachment_url TEXT,
  attachment_type TEXT CHECK (attachment_type IN ('pdf', 'image', 'route_map', 'document')),
  attachment_name TEXT,
  error_message TEXT,
  raw_payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 3. WhatsApp Templates (Meta Pre-approved Templates)
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  category TEXT NOT NULL DEFAULT 'UTILITY' CHECK (category IN ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  meta_status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (meta_status IN ('APPROVED', 'PENDING', 'REJECTED')),
  header_type TEXT DEFAULT 'NONE',
  body_text TEXT NOT NULL,
  variables JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT unique_template_name_per_company UNIQUE (company_id, template_name)
);

-- 4. WhatsApp Webhooks Log (Audit trail for incoming Meta webhooks)
CREATE TABLE IF NOT EXISTS public.whatsapp_webhooks_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- =====================================================================
-- Row Level Security (RLS) Policies
-- =====================================================================

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_webhooks_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_conversations_auth_all" ON public.whatsapp_conversations
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "whatsapp_messages_auth_all" ON public.whatsapp_messages
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "whatsapp_templates_auth_all" ON public.whatsapp_templates
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "whatsapp_webhooks_log_auth_all" ON public.whatsapp_webhooks_log
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- =====================================================================
-- Indexes
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_wa_conv_company ON public.whatsapp_conversations(company_id);
CREATE INDEX IF NOT EXISTS idx_wa_conv_phone ON public.whatsapp_conversations(phone);
CREATE INDEX IF NOT EXISTS idx_wa_conv_lead ON public.whatsapp_conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_wa_conv_customer ON public.whatsapp_conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_wa_conv_updated ON public.whatsapp_conversations(company_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_msg_conversation ON public.whatsapp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_wa_msg_company ON public.whatsapp_messages(company_id);
CREATE INDEX IF NOT EXISTS idx_wa_msg_wa_id ON public.whatsapp_messages(wa_message_id);
CREATE INDEX IF NOT EXISTS idx_wa_msg_created ON public.whatsapp_messages(conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_wa_templates_company ON public.whatsapp_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_wa_webhooks_log_processed ON public.whatsapp_webhooks_log(processed, created_at);

-- =====================================================================
-- Realtime Publications
-- =====================================================================

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END $$;
