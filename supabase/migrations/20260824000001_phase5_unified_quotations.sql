-- 20260824000001_phase5_unified_quotations.sql

-- 1. Create resources table
CREATE TABLE IF NOT EXISTS public.resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    service_id UUID REFERENCES public.services(id) ON DELETE SET NULL, -- Ensure compatibility
    name TEXT NOT NULL,       -- e.g., "3 Side LED Van - Van 01"
    category TEXT NOT NULL,   -- e.g., "LED_VAN"
    specs JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY resources_auth_all ON public.resources FOR ALL TO authenticated USING (true);
-- Restricted catalog retrieval for the frontend instead of full table access.

-- 2. Create bookings table
CREATE TABLE IF NOT EXISTS public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
    resource_id UUID REFERENCES public.resources(id) ON DELETE CASCADE,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('HOLD', 'CONFIRMED', 'CANCELLED', 'EXPIRED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY bookings_auth_all ON public.bookings FOR ALL TO authenticated USING (true);

-- 3. Modify documents
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual_staff';

-- 4. Secure Read-Only RPC for frontend resource listing
CREATE OR REPLACE FUNCTION public.get_public_catalog()
RETURNS TABLE (
    service_id UUID,
    service_name TEXT,
    resource_id UUID,
    resource_name TEXT,
    default_rate NUMERIC
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT s.id, s.name, r.id, r.name, s.default_rate
    FROM public.services s
    JOIN public.resources r ON r.service_id = s.id
    WHERE s.company_id = (SELECT id FROM public.profiles ORDER BY created_at ASC LIMIT 1);
END;
$$;

-- 5. The core RPC
CREATE OR REPLACE FUNCTION public.request_automated_quotation(
    p_customer_name TEXT,
    p_customer_email TEXT,
    p_customer_phone TEXT,
    p_resource_id UUID,
    p_service_id UUID,
    p_start_time TIMESTAMP WITH TIME ZONE,
    p_end_time TIMESTAMP WITH TIME ZONE,
    p_notes TEXT
) RETURNS UUID 
LANGUAGE plpgsql
SECURITY DEFINER 
SET search_path = public
AS $$
DECLARE
    v_company_id UUID;
    v_email TEXT;
    v_phone TEXT;
    v_customer_id UUID;
    v_service_rate NUMERIC;
    v_service_name TEXT;
    v_gst_percentage NUMERIC;
    v_hsn_sac TEXT;
    v_unit TEXT;
    v_seq_num INT;
    v_prefix TEXT;
    v_doc_number TEXT;
    v_doc_id UUID;
    v_subtotal NUMERIC;
    v_tax_total NUMERIC;
    v_total NUMERIC;
    v_mapped_service_id UUID;
BEGIN
    -- Resolve company
    SELECT id INTO v_company_id FROM public.profiles ORDER BY created_at ASC LIMIT 1;

    -- Validate Resource <-> Service Compatibility
    SELECT service_id INTO v_mapped_service_id FROM public.resources WHERE id = p_resource_id;
    IF v_mapped_service_id IS NULL OR v_mapped_service_id != p_service_id THEN
        RAISE EXCEPTION 'Resource is not compatible with the requested service.';
    END IF;

    -- Concurrency Protection for Resource (Prevents Overlap Race Conditions)
    PERFORM id FROM public.resources WHERE id = p_resource_id FOR UPDATE;

    -- Overlap Check
    IF EXISTS (
        SELECT 1 FROM public.bookings
        WHERE resource_id = p_resource_id
        AND status IN ('HOLD', 'CONFIRMED')
        AND (start_time < p_end_time AND end_time > p_start_time)
        AND (status = 'CONFIRMED' OR created_at >= NOW() - INTERVAL '24 hours')
    ) THEN
        RAISE EXCEPTION 'Resource is unavailable for the selected time.';
    END IF;

    -- Pricing Resolution
    SELECT default_rate, name, gst_percentage, hsn_sac, unit
    INTO v_service_rate, v_service_name, v_gst_percentage, v_hsn_sac, v_unit
    FROM public.services 
    WHERE id = p_service_id AND company_id = v_company_id;

    IF v_service_rate IS NULL THEN
        RAISE EXCEPTION 'Invalid service.';
    END IF;

    -- Customer Matching (Normalized)
    v_email := LOWER(TRIM(COALESCE(p_customer_email, '')));
    v_phone := REGEXP_REPLACE(COALESCE(p_customer_phone, ''), '\D', '', 'g');
    
    SELECT id INTO v_customer_id FROM public.customers 
    WHERE company_id = v_company_id 
    AND ( (email = v_email AND v_email <> '') OR (phone = v_phone AND v_phone <> '') )
    LIMIT 1;

    IF v_customer_id IS NULL THEN
        INSERT INTO public.customers (company_id, name, email, phone)
        VALUES (v_company_id, TRIM(p_customer_name), v_email, v_phone)
        RETURNING id INTO v_customer_id;
    END IF;

    -- Safe Sequence Generation (Handles Concurrency Loop)
    SELECT COALESCE(quotation_prefix, 'QT/'), COALESCE(quotation_start_number, 1001)
    INTO v_prefix, v_seq_num
    FROM public.profiles WHERE id = v_company_id;

    <<seq_loop>>
    LOOP
        SELECT COALESCE(MAX(sequence_number), v_seq_num - 1) + 1 INTO v_seq_num
        FROM public.documents
        WHERE company_id = v_company_id AND document_type = 'quotation';
        
        v_doc_number := v_prefix || v_seq_num;
        
        BEGIN
            v_subtotal := v_service_rate * 1; 
            v_tax_total := v_subtotal * (v_gst_percentage / 100.0);
            v_total := v_subtotal + v_tax_total;

            INSERT INTO public.documents (
                company_id, document_type, document_number, sequence_number,
                customer_id, customer_name, customer_email, customer_phone,
                date, subtotal, tax_total, total, source, notes
            ) VALUES (
                v_company_id, 'quotation', v_doc_number, v_seq_num,
                v_customer_id, TRIM(p_customer_name), v_email, v_phone,
                CURRENT_DATE, v_subtotal, v_tax_total, v_total, 'website_auto', p_notes
            ) RETURNING id INTO v_doc_id;

            EXIT seq_loop; -- Success! Break out of the loop.
        EXCEPTION WHEN unique_violation THEN
            -- Another transaction grabbed this sequence number first! 
            -- The loop will repeat and calculate the next max sequence_number safely.
        END;
    END LOOP;

    -- Insert Items & Booking
    INSERT INTO public.document_items (document_id, service_id, description, quantity, rate, amount, hsn_sac, unit)
    VALUES (v_doc_id, p_service_id, v_service_name, 1, v_service_rate, v_subtotal, v_hsn_sac, v_unit);

    INSERT INTO public.bookings (company_id, document_id, resource_id, start_time, end_time, status)
    VALUES (v_company_id, v_doc_id, p_resource_id, p_start_time, p_end_time, 'HOLD');

    RETURN v_doc_id;
END;
$$;
