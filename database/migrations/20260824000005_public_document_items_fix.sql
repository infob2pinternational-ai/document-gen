-- =====================================================================
-- 20260824000005_public_document_items_fix.sql
-- Public share-link document item payload repair.
--
-- The React document preview recalculates totals from line items. Public
-- WhatsApp links use get_public_document(), so the RPC must return every
-- non-sensitive item field needed by that calculation and display path.
-- =====================================================================

ALTER TABLE public.document_items
  ADD COLUMN IF NOT EXISTS gst_percentage NUMERIC DEFAULT 0;

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
  IF (p_id IS NULL AND p_document_number IS NULL) OR (p_id IS NOT NULL AND p_document_number IS NOT NULL) THEN
    RETURN NULL;
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_doc FROM public.documents WHERE id = p_id;
  ELSE
    v_normalized_num := lower(regexp_replace(p_document_number, '[^a-zA-Z0-9]', '', 'g'));
    SELECT * INTO v_doc FROM public.documents
    WHERE lower(regexp_replace(document_number, '[^a-zA-Z0-9]', '', 'g')) = v_normalized_num
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'document_id', document_id,
      'service_id', service_id,
      'description', description,
      'quantity', quantity,
      'days', days,
      'rate', rate,
      'unit', unit,
      'hsn_sac', hsn_sac,
      'gst_percentage', gst_percentage,
      'amount', amount,
      'sort_order', sort_order
    ) ORDER BY sort_order ASC, id ASC
  ) INTO v_items
  FROM public.document_items
  WHERE document_id = v_doc.id;

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

NOTIFY pgrst, 'reload schema';
