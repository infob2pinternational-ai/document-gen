-- Run in Supabase SQL Editor. Does not change document or comparison rows.
-- Text comparisons support both UUID-based and legacy text-based document IDs.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_public_comparison_data(p_document_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config jsonb;
  v_currency text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.documents
    WHERE id::text = p_document_id
      AND document_type IN ('comparison_quotation', 'comparison_invoice')
  ) THEN
    RETURN NULL;
  END IF;

  IF to_regclass('public.comparison_document_data') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT options_data::jsonb INTO v_config
  FROM public.comparison_document_data
  WHERE document_id::text = p_document_id
  LIMIT 1;

  IF v_config IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT to_jsonb(p)->>'currency' INTO v_currency
  FROM public.profiles p
  JOIN public.documents d ON d.company_id::text = p.id::text
  WHERE d.id::text = p_document_id;

  -- Only the printable comparison configuration, never table metadata.
  RETURN jsonb_build_object(
    'currency', COALESCE(v_currency, 'INR'),
    'comparison', jsonb_build_object(
    'layout', v_config->'layout',
    'themeColor', v_config->'themeColor',
    'options', v_config->'options',
    'selectedOptionId', v_config->'selectedOptionId',
    'notes', v_config->'notes',
    'terms', v_config->'terms'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_comparison_data(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_comparison_data(text) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
