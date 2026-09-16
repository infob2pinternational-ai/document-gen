-- =====================================================================
-- 20260824000000_base_document_generator_schema.sql
-- Base Document Generator Schema for Isolated Staging (xkgytoygtzmsszaogwxi)
-- =====================================================================

-- 0. Schema Permissions & Grants
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

-- 1. Profiles (Company entities)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    logo_url TEXT,
    seal_url TEXT,
    gstin TEXT,
    pan TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    website TEXT,
    currency TEXT DEFAULT 'INR',
    bank_name TEXT,
    bank_account_no TEXT,
    bank_ifsc TEXT,
    bank_holder TEXT,
    bank_branch TEXT,
    default_terms TEXT,
    
    -- Column headings
    col_name_description TEXT DEFAULT 'Description',
    col_name_quantity TEXT DEFAULT 'Quantity',
    col_name_unit TEXT DEFAULT 'Unit',
    col_name_rate TEXT DEFAULT 'Rate',
    col_name_amount TEXT DEFAULT 'Amount',
    
    -- Sequencing settings
    invoice_prefix TEXT DEFAULT 'INV/',
    invoice_start_number INT DEFAULT 1001,
    proforma_prefix TEXT DEFAULT 'PI/',
    proforma_start_number INT DEFAULT 1001,
    quotation_prefix TEXT DEFAULT 'QTN/',
    quotation_start_number INT DEFAULT 1001,
    work_order_prefix TEXT DEFAULT 'WO/',
    work_order_start_number INT DEFAULT 1001,
    non_tax_prefix TEXT DEFAULT 'NT/',
    non_tax_start_number INT DEFAULT 1001,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 2. Customers
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    gstin TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 3. Services
CREATE TABLE IF NOT EXISTS public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    default_rate NUMERIC DEFAULT 0,
    unit TEXT DEFAULT 'nos',
    hsn_sac TEXT,
    gst_percentage NUMERIC DEFAULT 18,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 4. Documents (Invoices, Proforma Invoices, Quotations, Work Orders)
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL CHECK (document_type IN ('invoice', 'proforma_invoice', 'quotation', 'work_order')),
    document_number TEXT NOT NULL,
    sequence_number INT NOT NULL,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT,
    customer_phone TEXT,
    customer_address TEXT,
    customer_gstin TEXT,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    -- Custom Column Headings
    col_name_description TEXT NOT NULL DEFAULT 'Description',
    col_name_quantity TEXT NOT NULL DEFAULT 'Quantity',
    col_name_unit TEXT NOT NULL DEFAULT 'Unit',
    col_name_rate TEXT NOT NULL DEFAULT 'Rate',
    col_name_amount TEXT NOT NULL DEFAULT 'Amount',
    
    -- Calculations
    subtotal NUMERIC NOT NULL DEFAULT 0,
    tax_total NUMERIC NOT NULL DEFAULT 0,
    discount_total NUMERIC NOT NULL DEFAULT 0,
    total NUMERIC NOT NULL DEFAULT 0,
    advance NUMERIC NOT NULL DEFAULT 0,
    notes TEXT,
    terms TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    
    -- Uniqueness constraint to prevent duplicate numbering per company
    CONSTRAINT unique_company_doc_number UNIQUE (company_id, document_number)
);

-- 5. Document Line Items
CREATE TABLE IF NOT EXISTS public.document_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
    service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 1,
    days NUMERIC NOT NULL DEFAULT 1,
    rate NUMERIC NOT NULL DEFAULT 0,
    unit TEXT DEFAULT 'nos',
    hsn_sac TEXT,
    amount NUMERIC NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0
);

-- 6. Approver Devices (Push notification registrations)
CREATE TABLE IF NOT EXISTS public.approver_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    device_name TEXT,
    last_active TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 7. Indexes on Foreign Keys for Performance
CREATE INDEX IF NOT EXISTS idx_customers_company_id ON public.customers(company_id);
CREATE INDEX IF NOT EXISTS idx_services_company_id ON public.services(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_company_id ON public.documents(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_customer_id ON public.documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_document_items_document_id ON public.document_items(document_id);

-- 8. Table Level Grants (Security-scoped for PostgREST exposure)
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT ON public.services TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.customers, public.services, public.documents, public.document_items, public.approver_devices TO authenticated;

-- =====================================================================
-- 9. Row Level Security (RLS) Policies
-- =====================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approver_devices ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS profiles_select_public ON public.profiles;
DROP POLICY IF EXISTS profiles_auth_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_auth_update ON public.profiles;
DROP POLICY IF EXISTS profiles_auth_delete ON public.profiles;

DROP POLICY IF EXISTS customers_auth_all ON public.customers;

DROP POLICY IF EXISTS services_auth_all ON public.services;
DROP POLICY IF EXISTS services_anon_read ON public.services;

DROP POLICY IF EXISTS documents_select_public ON public.documents;
DROP POLICY IF EXISTS documents_auth_insert ON public.documents;
DROP POLICY IF EXISTS documents_auth_update ON public.documents;
DROP POLICY IF EXISTS documents_auth_delete ON public.documents;

DROP POLICY IF EXISTS document_items_select_public ON public.document_items;
DROP POLICY IF EXISTS document_items_auth_insert ON public.document_items;
DROP POLICY IF EXISTS document_items_auth_update ON public.document_items;
DROP POLICY IF EXISTS document_items_auth_delete ON public.document_items;

DROP POLICY IF EXISTS approver_devices_auth_all ON public.approver_devices;

-- Profiles
CREATE POLICY profiles_select_public ON public.profiles FOR SELECT USING (true);
CREATE POLICY profiles_auth_insert ON public.profiles FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY profiles_auth_update ON public.profiles FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY profiles_auth_delete ON public.profiles FOR DELETE USING (auth.role() = 'authenticated');

-- Customers
CREATE POLICY customers_auth_all ON public.customers FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Services
CREATE POLICY services_auth_all ON public.services FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY services_anon_read ON public.services FOR SELECT TO anon USING (true);

-- Documents
CREATE POLICY documents_auth_all ON public.documents FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Document Items
CREATE POLICY document_items_auth_all ON public.document_items FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Approver Devices
CREATE POLICY approver_devices_auth_all ON public.approver_devices FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- =====================================================================
-- 10. get_public_document RPC Function (SECURITY DEFINER)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_public_document(p_id uuid DEFAULT NULL, p_document_number text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc record;
  v_items jsonb;
  v_profile jsonb;
  v_normalized_num text;
BEGIN
  -- Exactly one parameter must be supplied
  IF (p_id IS NULL AND p_document_number IS NULL) OR (p_id IS NOT NULL AND p_document_number IS NOT NULL) THEN
    RETURN NULL;
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_doc FROM public.documents WHERE id = p_id;
  ELSE
    -- Normalize document number (alphanumeric only, lowercase)
    v_normalized_num := lower(regexp_replace(p_document_number, '[^a-zA-Z0-9]', '', 'g'));
    SELECT * INTO v_doc FROM public.documents 
    WHERE lower(regexp_replace(document_number, '[^a-zA-Z0-9]', '', 'g')) = v_normalized_num
    LIMIT 1;
  END IF;

  -- Safe record assignment check (prevents unassigned record exception)
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Whitelisted items
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'document_id', document_id,
      'description', description,
      'quantity', quantity,
      'days', days,
      'rate', rate,
      'unit', unit,
      'amount', amount
    ) ORDER BY sort_order ASC, id ASC
  ) INTO v_items
  FROM public.document_items
  WHERE document_id = v_doc.id;

  -- Whitelisted profile
  SELECT jsonb_build_object(
    'id', id,
    'name', name,
    'logo_url', logo_url,
    'seal_url', seal_url,
    'gstin', gstin,
    'email', email,
    'phone', phone,
    'address', address,
    'website', website,
    'bank_name', bank_name,
    'bank_account_no', bank_account_no,
    'bank_ifsc', bank_ifsc,
    'bank_holder', bank_holder,
    'bank_branch', bank_branch,
    'default_terms', default_terms
  ) INTO v_profile
  FROM public.profiles
  WHERE id = v_doc.company_id;

  RETURN jsonb_build_object(
    'document', jsonb_build_object(
      'id', v_doc.id,
      'company_id', v_doc.company_id,
      'document_type', v_doc.document_type,
      'document_number', v_doc.document_number,
      'customer_name', v_doc.customer_name,
      'customer_address', v_doc.customer_address,
      'customer_gstin', v_doc.customer_gstin,
      'date', v_doc.date,
      'col_name_description', v_doc.col_name_description,
      'col_name_quantity', v_doc.col_name_quantity,
      'col_name_unit', v_doc.col_name_unit,
      'col_name_rate', v_doc.col_name_rate,
      'col_name_amount', v_doc.col_name_amount,
      'subtotal', v_doc.subtotal,
      'tax_total', v_doc.tax_total,
      'discount_total', v_doc.discount_total,
      'total', v_doc.total,
      'advance', v_doc.advance,
      'notes', v_doc.notes,
      'terms', v_doc.terms
    ),
    'items', COALESCE(v_items, '[]'::jsonb),
    'profile', COALESCE(v_profile, '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_document(uuid, text) TO anon, authenticated;

-- =====================================================================
-- 11. Synthetic Staging Seed Data (Safe Test Data Only)
-- =====================================================================

DO $$
DECLARE
  v_company_id UUID;
BEGIN
  -- Check if profile already exists
  SELECT id INTO v_company_id FROM public.profiles WHERE name = 'B2P International (Staging)' LIMIT 1;
  
  IF v_company_id IS NULL THEN
    INSERT INTO public.profiles (
      name, email, phone, address, website,
      quotation_prefix, quotation_start_number,
      invoice_prefix, invoice_start_number
    ) VALUES (
      'B2P International (Staging)', 'staging@b2pinternational.com', '+919000000000',
      'Thrissur, Kerala, India', 'https://www.b2pinternational.com',
      'QTN/', 1001,
      'INV/', 1001
    ) RETURNING id INTO v_company_id;
  END IF;

  -- Seed 3 standard synthetic test services
  IF NOT EXISTS (SELECT 1 FROM public.services WHERE company_id = v_company_id AND name = '3 Side LED Van') THEN
    INSERT INTO public.services (company_id, name, description, default_rate, unit, gst_percentage)
    VALUES (v_company_id, '3 Side LED Van', 'Synthetic staging service: 3-side mobile LED van display advertising', 12000, 'day', 18);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.services WHERE company_id = v_company_id AND name = 'LED Wall Setup') THEN
    INSERT INTO public.services (company_id, name, description, default_rate, unit, gst_percentage)
    VALUES (v_company_id, 'LED Wall Setup', 'Synthetic staging service: Large format event visual setup', 35000, 'event', 18);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.services WHERE company_id = v_company_id AND name = 'Lookwalker') THEN
    INSERT INTO public.services (company_id, name, description, default_rate, unit, gst_percentage)
    VALUES (v_company_id, 'Lookwalker', 'Synthetic staging service: Mobile backpack display marketing', 3000, 'day', 18);
  END IF;
END $$;

-- 12. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
