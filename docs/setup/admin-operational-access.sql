-- Prepared against the repository schema; not applied to production.
-- Review against the live schema before running in the intended project.
BEGIN;
-- Keep the established membership lookup and security-definer boundary.
CREATE OR REPLACE FUNCTION public.can_access_company(p_company_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT public.current_app_role() IS NOT NULL AND
 (public.current_app_role() IN ('owner','admin') OR EXISTS(
 SELECT 1 FROM public.app_company_members WHERE user_id=auth.uid() AND company_id=p_company_id))
$$;
REVOKE ALL ON FUNCTION public.can_access_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_company(uuid) TO authenticated;
-- Device configuration delivers notifications; it does not confer approval rights.
DO $$ BEGIN
 IF to_regclass('public.approver_devices') IS NOT NULL THEN
  DROP POLICY IF EXISTS office_write ON public.approver_devices;
  CREATE POLICY office_write ON public.approver_devices FOR ALL TO authenticated
  USING (public.can_access_company(company_id) AND public.current_app_role() IN ('owner','admin'))
  WITH CHECK (public.can_access_company(company_id) AND public.current_app_role() IN ('owner','admin'));
 END IF;
END $$;
-- Deliberately preserve review_document and quotation approval triggers.
-- app_members remains protected: Admin must not promote themselves to Owner.
COMMIT;
