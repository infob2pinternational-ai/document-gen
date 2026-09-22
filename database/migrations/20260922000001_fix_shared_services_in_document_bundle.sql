-- Fix: Allow services from any accessible company profile to be used in document line items
-- Run this in Supabase SQL Editor if needed.

CREATE OR REPLACE FUNCTION public.save_document_bundle(p_document jsonb, p_items jsonb, p_comparison jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d public.documents%ROWTYPE; previous public.documents%ROWTYPE; it jsonb; allowed jsonb;
BEGIN
 IF jsonb_typeof(p_document) IS DISTINCT FROM 'object' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Invalid document payload'; END IF;
 IF NOT public.can_access_company((p_document->>'company_id')::uuid) THEN RAISE EXCEPTION 'Company access denied'; END IF;
 -- Serialize saves for the same ID, including two concurrent initial creates.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_document->>'id',0));
 SELECT * INTO previous FROM public.documents WHERE id=(p_document->>'id')::uuid FOR UPDATE;
 IF FOUND AND (previous.company_id IS DISTINCT FROM (p_document->>'company_id')::uuid) THEN
  RAISE EXCEPTION 'A document cannot be moved to another company'; END IF;
 -- Only these fields are writable: clients cannot supply approver identity or audit fields.
 SELECT jsonb_object_agg(key,value) INTO allowed FROM jsonb_each(p_document) WHERE key=ANY(ARRAY[
 'id','company_id','document_type','document_number','sequence_number','customer_id','customer_name',
 'customer_email','customer_phone','customer_address','customer_gstin','date','col_name_description',
 'col_name_quantity','col_name_unit','col_name_rate','col_name_amount','subtotal','tax_total','discount_total',
 'total','advance','notes','terms']);
 d := jsonb_populate_record(previous,allowed);
 IF d.id IS NULL OR d.document_number IS NULL OR d.customer_name IS NULL THEN RAISE EXCEPTION 'Document details are required'; END IF;
 IF d.customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customers WHERE id=d.customer_id AND company_id=d.company_id) THEN
  RAISE EXCEPTION 'Customer belongs to another company'; END IF;
 IF d.document_type IN ('comparison_quotation','comparison_invoice') AND
 (jsonb_typeof(p_comparison) IS DISTINCT FROM 'object' OR jsonb_typeof(p_comparison->'options') IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_comparison->'options')=0) THEN RAISE EXCEPTION 'Comparison options must be saved with the document'; END IF;
 d.status := 'pending_approval'; d.approved_by_email := NULL; d.approved_at := NULL;
 d.user_id := coalesce(previous.user_id,auth.uid());
 d.created_by_email := coalesce(previous.created_by_email,(SELECT email FROM auth.users WHERE id=auth.uid()));
 d.created_at := coalesce(previous.created_at,now()); d.date := coalesce(d.date,current_date);
 d.col_name_description := coalesce(d.col_name_description,'Description');
 d.col_name_quantity := coalesce(d.col_name_quantity,'Quantity'); d.col_name_unit := coalesce(d.col_name_unit,'Unit');
 d.col_name_rate := coalesce(d.col_name_rate,'Rate'); d.col_name_amount := coalesce(d.col_name_amount,'Amount');
 d.subtotal := coalesce(d.subtotal,0); d.tax_total := coalesce(d.tax_total,0);
 d.discount_total := coalesce(d.discount_total,0); d.total := coalesce(d.total,0); d.advance := coalesce(d.advance,0);
 IF previous.id IS NULL THEN INSERT INTO public.documents SELECT d.*;
 ELSE UPDATE public.documents SET
 document_type=d.document_type,document_number=d.document_number,sequence_number=d.sequence_number,
 customer_id=d.customer_id,customer_name=d.customer_name,customer_email=d.customer_email,
 customer_phone=d.customer_phone,customer_address=d.customer_address,customer_gstin=d.customer_gstin,
 date=d.date,col_name_description=d.col_name_description,col_name_quantity=d.col_name_quantity,
 col_name_unit=d.col_name_unit,col_name_rate=d.col_name_rate,col_name_amount=d.col_name_amount,
 subtotal=d.subtotal,tax_total=d.tax_total,discount_total=d.discount_total,total=d.total,advance=d.advance,
 notes=d.notes,terms=d.terms,status=d.status,approved_by_email=NULL,approved_at=NULL WHERE id=d.id;
 END IF;
 DELETE FROM public.document_items WHERE document_id=d.id;
 FOR it IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF nullif(it->>'service_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.services
   WHERE id=(it->>'service_id')::uuid AND (company_id=d.company_id OR public.can_access_company(company_id))) THEN RAISE EXCEPTION 'Invalid service'; END IF;
  INSERT INTO public.document_items(id,document_id,service_id,description,quantity,days,rate,unit,hsn_sac,gst_percentage,amount,sort_order)
  VALUES(coalesce((it->>'id')::uuid,gen_random_uuid()),d.id,nullif(it->>'service_id','')::uuid,it->>'description',
   (it->>'quantity')::numeric,coalesce((it->>'days')::numeric,1),(it->>'rate')::numeric,it->>'unit',it->>'hsn_sac',
   coalesce((it->>'gst_percentage')::numeric,0),(it->>'amount')::numeric,coalesce((it->>'sort_order')::int,0));
 END LOOP;
 IF d.document_type IN ('comparison_quotation','comparison_invoice') THEN
  INSERT INTO public.comparison_document_data(document_id,options_data) VALUES(d.id,p_comparison)
  ON CONFLICT(document_id) DO UPDATE SET options_data=excluded.options_data;
 ELSE DELETE FROM public.comparison_document_data WHERE document_id=d.id; END IF;
 RETURN to_jsonb(d);
END $$;
