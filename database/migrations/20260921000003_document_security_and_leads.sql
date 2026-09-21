-- Requires 20260918000000_live_crm_fields.sql. Run as the database administrator.
-- Preserves data. Existing approved UUID links continue to work; number-only links stop.
BEGIN;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS sub_district text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS lead_number text;

CREATE TABLE IF NOT EXISTS public.app_members (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','staff')),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS public.app_company_members (
  user_id uuid REFERENCES public.app_members(user_id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, company_id)
);
ALTER TABLE public.app_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_company_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_members, public.app_company_members FROM PUBLIC, anon, authenticated;
-- Explicitly provision only the four existing office accounts, never user-editable metadata.
WITH seeded AS (INSERT INTO public.app_members(user_id,role)
SELECT id, CASE lower(email) WHEN 'sarathjohnpanengadan@gmail.com' THEN 'owner'
  WHEN 'fransonputhukkara@gmail.com' THEN 'admin' ELSE 'staff' END
FROM auth.users WHERE lower(email) IN ('sarathjohnpanengadan@gmail.com',
 'fransonputhukkara@gmail.com','brutf5354@gmail.com','sivasatheesan33@gmail.com')
 AND email_confirmed_at IS NOT NULL AND deleted_at IS NULL
ON CONFLICT (user_id) DO NOTHING RETURNING user_id)
INSERT INTO public.app_company_members SELECT s.user_id,p.id FROM seeded s CROSS JOIN public.profiles p ON CONFLICT DO NOTHING;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.app_members m JOIN auth.users u ON u.id=m.user_id
 WHERE m.role='owner' AND m.active AND lower(u.email)='sarathjohnpanengadan@gmail.com') THEN
  RAISE EXCEPTION 'Confirmed owner account not found. Check that this is the live app database before proceeding';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.current_app_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT m.role FROM public.app_members m JOIN auth.users u ON u.id=m.user_id
 WHERE m.user_id=auth.uid() AND m.active AND u.deleted_at IS NULL
 AND u.email_confirmed_at IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
$$;
CREATE OR REPLACE FUNCTION public.can_access_company(p_company_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT public.current_app_role() IS NOT NULL AND
 (public.current_app_role()='owner' OR EXISTS(SELECT 1 FROM public.app_company_members
 WHERE user_id=auth.uid() AND company_id=p_company_id))
$$;
REVOKE ALL ON FUNCTION public.current_app_role(), public.can_access_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_app_role(), public.can_access_company(uuid) TO authenticated;

-- Replace permissive policies on the CRM and document tables with office membership checks.
DO $$ DECLARE t text; p record; expression text;
BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','customers','services','leads','lead_activities',
 'follow_ups','crm_quotations','documents','document_items','comparison_document_data','comparison_templates','approver_devices'] LOOP
  IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
   EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,t);
  END LOOP;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM PUBLIC, anon, authenticated',t);
  IF t='profiles' THEN expression := 'public.can_access_company(id)';
  ELSIF t IN ('document_items','comparison_document_data') THEN
   expression := 'EXISTS(SELECT 1 FROM public.documents d WHERE d.id=document_id AND public.can_access_company(d.company_id))';
  ELSE expression := 'public.can_access_company(company_id)'; END IF;
  EXECUTE format('CREATE POLICY office_read ON public.%I FOR SELECT TO authenticated USING (%s)',t,expression);
  IF t NOT IN ('documents','document_items','comparison_document_data') THEN
   IF t='profiles' THEN expression := 'public.current_app_role() IN (''owner'',''admin'')'; END IF;
   IF t='approver_devices' THEN expression := 'public.can_access_company(company_id) AND public.current_app_role()=''owner'''; END IF;
   EXECUTE format('CREATE POLICY office_write ON public.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',t,expression,expression);
  END IF;
 END LOOP;
END $$;
-- Documents can only be mutated through the validated transactional RPCs below.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.documents,
 public.document_items, public.comparison_document_data FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON public.documents, public.document_items, public.comparison_document_data FROM PUBLIC, anon;
GRANT SELECT ON public.documents, public.document_items, public.comparison_document_data TO authenticated;

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
   WHERE id=(it->>'service_id')::uuid AND company_id=d.company_id) THEN RAISE EXCEPTION 'Invalid service'; END IF;
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

CREATE OR REPLACE FUNCTION public.review_document(p_id uuid,p_approve boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d public.documents%ROWTYPE;
BEGIN
 IF public.current_app_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Only the owner can approve or reject quotations and invoices'; END IF;
 SELECT * INTO d FROM public.documents WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
 IF p_approve AND d.document_type IN ('comparison_quotation','comparison_invoice') AND NOT EXISTS(
  SELECT 1 FROM public.comparison_document_data WHERE document_id=p_id AND jsonb_typeof(options_data->'options')='array'
  AND jsonb_array_length(options_data->'options')>0) THEN RAISE EXCEPTION 'Save the complete comparison before approval'; END IF;
 UPDATE public.documents SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
 approved_by_email=(SELECT email FROM auth.users WHERE id=auth.uid()),approved_at=now() WHERE id=p_id RETURNING * INTO d;
 RETURN to_jsonb(d);
END $$;
CREATE OR REPLACE FUNCTION public.delete_document_bundle(p_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d public.documents%ROWTYPE;
BEGIN
 SELECT * INTO d FROM public.documents WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT public.can_access_company(d.company_id) OR public.current_app_role() NOT IN ('owner','admin') THEN
  RAISE EXCEPTION 'Document deletion denied'; END IF;
 DELETE FROM public.comparison_document_data WHERE document_id=p_id;
 DELETE FROM public.document_items WHERE document_id=p_id;
 DELETE FROM public.documents WHERE id=p_id; RETURN p_id;
END $$;
CREATE OR REPLACE FUNCTION public.log_document_send(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 UPDATE public.documents SET whatsapp_sent_by_email=(SELECT email FROM auth.users WHERE id=auth.uid()),whatsapp_sent_at=now()
 WHERE id=p_id AND public.can_access_company(company_id) AND status='approved';
 IF NOT FOUND THEN RAISE EXCEPTION 'Approved document not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.save_document_bundle(jsonb,jsonb,jsonb), public.review_document(uuid,boolean),
 public.delete_document_bundle(uuid),public.log_document_send(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_document_bundle(jsonb,jsonb,jsonb), public.review_document(uuid,boolean),
 public.delete_document_bundle(uuid),public.log_document_send(uuid) TO authenticated;

-- CRM quotation approval uses the same protected role, regardless of browser UI.
CREATE OR REPLACE FUNCTION public.guard_crm_approval() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.approval_status IN ('APPROVED','SENT','REJECTED') AND public.current_app_role() IS DISTINCT FROM 'owner' THEN
   RAISE EXCEPTION 'Only the owner can approve quotations'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['updated_at','approval_status','status','approver_name','approver_notes','approved_at','rejected_at','rejection_reason','sent_to_customer_at','sent_by_email'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at','approval_status','status','approver_name','approver_notes','approved_at','rejected_at','rejection_reason','sent_to_customer_at','sent_by_email']) THEN
    NEW.approval_status:='WAITING_APPROVAL'; NEW.status:='WAITING_APPROVAL'; NEW.approved_at:=NULL; NEW.approver_name:=NULL;
  ELSIF (NEW.approval_status IS DISTINCT FROM OLD.approval_status OR NEW.approver_name IS DISTINCT FROM OLD.approver_name
   OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approver_notes IS DISTINCT FROM OLD.approver_notes)
   AND public.current_app_role() IS DISTINCT FROM 'owner' THEN
    IF NOT (OLD.approval_status='APPROVED' AND NEW.approval_status='SENT' AND NEW.approver_name IS NOT DISTINCT FROM OLD.approver_name
     AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at AND NEW.approver_notes IS NOT DISTINCT FROM OLD.approver_notes)
     AND NEW.approval_status NOT IN ('DRAFT','WAITING_APPROVAL') THEN RAISE EXCEPTION 'Only the owner can approve quotations'; END IF;
  END IF;
 END IF;
 IF NEW.approval_status='APPROVED' AND (TG_OP='INSERT' OR OLD.approval_status IS DISTINCT FROM 'APPROVED') THEN
  NEW.approver_name:=auth.jwt()->>'email'; NEW.approved_at:=now(); END IF;
 NEW.status:=NEW.approval_status;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_crm_approval ON public.crm_quotations;
CREATE TRIGGER guard_crm_approval BEFORE INSERT OR UPDATE ON public.crm_quotations FOR EACH ROW EXECUTE FUNCTION public.guard_crm_approval();

-- Public preview functions are defined below. No direct anonymous table reads.
CREATE OR REPLACE FUNCTION public.get_public_document(p_id uuid DEFAULT NULL::uuid, p_document_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_doc documents%ROWTYPE;
  v_items jsonb;
  v_profile jsonb;
BEGIN
  -- The random UUID is the bearer share link. Predictable document numbers are not public credentials.
  IF p_id IS NULL OR p_document_number IS NOT NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_doc FROM public.documents WHERE id=p_id AND status='approved';
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', di.id,
      'description', di.description,
      'quantity', di.quantity,
      'days', di.days,
      'rate', di.rate,
      'unit', di.unit,
      'amount', di.amount,
      'gst_percentage', di.gst_percentage
    ) ORDER BY di.sort_order
  ), '[]'::jsonb)
  INTO v_items
  FROM document_items di
  WHERE di.document_id = v_doc.id;

  SELECT jsonb_build_object(
    'name', p.name,
    'address', p.address,
    'logo_url', p.logo_url,
    'email', p.email,
    'gstin', p.gstin,
    'phone', p.phone,
    'website', p.website,
    'bank_account_no', p.bank_account_no,
    'bank_holder', p.bank_holder,
    'bank_ifsc', p.bank_ifsc,
    'bank_name', p.bank_name,
    'default_terms', p.default_terms,
    'seal_url', p.seal_url, 'currency', p.currency
  )
  INTO v_profile
  FROM profiles p
  WHERE p.id = v_doc.company_id;

  RETURN jsonb_build_object(
    'document', jsonb_build_object(
      'id', v_doc.id,
      'company_id', v_doc.company_id,
      'document_type', v_doc.document_type,
      'document_number', v_doc.document_number,
      'customer_name', v_doc.customer_name,
      'customer_phone', v_doc.customer_phone,
      'customer_address', v_doc.customer_address,
      'customer_gstin', v_doc.customer_gstin,
      'date', v_doc.date,
      'col_name_description', v_doc.col_name_description,
      'col_name_quantity', v_doc.col_name_quantity,
      'col_name_unit', v_doc.col_name_unit,
      'col_name_rate', v_doc.col_name_rate,
      'col_name_amount', v_doc.col_name_amount,
      'subtotal', v_doc.subtotal, 'tax_total', v_doc.tax_total, 'advance', v_doc.advance,
      'discount_total', v_doc.discount_total,
      'notes', v_doc.notes,
      'terms', v_doc.terms,
      'total', v_doc.total,
      'status', v_doc.status
    ),
    'items', v_items,
    'profile', v_profile,
    'comparison', (SELECT options_data FROM public.comparison_document_data WHERE document_id=v_doc.id)
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_public_comparison_data(p_document_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('comparison',c.options_data,'currency',p.currency)
 FROM public.documents d JOIN public.comparison_document_data c ON c.document_id=d.id
 JOIN public.profiles p ON p.id=d.company_id
 WHERE d.id::text=p_document_id AND d.status='approved'
 AND d.document_type IN ('comparison_quotation','comparison_invoice')
$$;
REVOKE ALL ON FUNCTION public.get_public_document(uuid,text),public.get_public_comparison_data(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_document(uuid,text),public.get_public_comparison_data(text) TO anon,authenticated;
-- Stable lead numbers: never resequence valid IDs when a browser reads a list.
CREATE TABLE IF NOT EXISTS public.lead_number_counters (
 company_id uuid PRIMARY KEY REFERENCES public.profiles(id), last_number bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS public.lead_number_repairs (
 lead_id uuid PRIMARY KEY, old_number text, new_number text NOT NULL, repaired_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_number_repairs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_number_counters,public.lead_number_repairs FROM PUBLIC,anon,authenticated;
LOCK TABLE public.leads IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO public.lead_number_counters(company_id,last_number)
 SELECT company_id,greatest(1000,coalesce(max(CASE WHEN lead_number ~ '^B2P-LD-[0-9]{1,12}$'
 THEN substring(lead_number from 8)::bigint END),1000)) FROM public.leads
 WHERE company_id IS NOT NULL GROUP BY company_id
 ON CONFLICT(company_id) DO UPDATE SET last_number=greatest(lead_number_counters.last_number,excluded.last_number);
DO $$ DECLARE l record; seq bigint; new_number text;
BEGIN
 FOR l IN SELECT * FROM (SELECT id,company_id,lead_number,
  row_number() OVER(PARTITION BY company_id,lead_number ORDER BY created_at,id) AS duplicate_position
  FROM public.leads) numbered WHERE lead_number IS NULL OR btrim(lead_number)='' OR duplicate_position>1
  ORDER BY company_id,id LOOP
  UPDATE public.lead_number_counters SET last_number=last_number+1 WHERE company_id=l.company_id RETURNING last_number INTO seq;
  new_number:='B2P-LD-'||seq;
  INSERT INTO public.lead_number_repairs(lead_id,old_number,new_number) VALUES(l.id,l.lead_number,new_number) ON CONFLICT DO NOTHING;
  UPDATE public.leads SET lead_number=new_number WHERE id=l.id;
  UPDATE public.follow_ups SET lead_number=new_number WHERE lead_id=l.id;
  UPDATE public.crm_quotations SET lead_number=new_number WHERE lead_id=l.id;
 END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS unique_lead_number_per_company ON public.leads(company_id,lead_number);
CREATE OR REPLACE FUNCTION public.assign_lead_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing public.leads%ROWTYPE; seq bigint;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN RAISE EXCEPTION 'A lead cannot be moved between companies'; END IF;
  NEW.lead_number:=OLD.lead_number;
  RETURN NEW;
 END IF;
 -- Upsert of an existing lead keeps its ID, even if another browser supplied an obsolete number.
 SELECT * INTO existing FROM public.leads WHERE id=NEW.id;
 IF FOUND THEN
  IF NEW.company_id IS DISTINCT FROM existing.company_id THEN RAISE EXCEPTION 'A lead cannot be moved between companies'; END IF;
  NEW.lead_number:=existing.lead_number; RETURN NEW;
 END IF;
 INSERT INTO public.lead_number_counters(company_id,last_number) VALUES(NEW.company_id,1001)
 ON CONFLICT(company_id) DO UPDATE SET last_number=lead_number_counters.last_number+1 RETURNING last_number INTO seq;
 NEW.lead_number:='B2P-LD-'||seq;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.assign_lead_number() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS assign_lead_number ON public.leads;
CREATE TRIGGER assign_lead_number BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.assign_lead_number();
NOTIFY pgrst, 'reload schema';
COMMIT;
