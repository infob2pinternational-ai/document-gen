-- =====================================================================
-- 20260824000002_minimum_permissions_fix.sql
-- Minimal Hardened Grants for Isolated Staging (xkgytoygtzmsszaogwxi)
--
-- REMEDIATION (2026-08-24, full-project audit pass): originally shared
-- the identical 20260824000000 timestamp prefix with
-- base_document_generator_schema.sql - the exact same
-- filename-order-dependent hazard already found and fixed once in this
-- repo for the phase4.5/4.6 pair (see the note in phase4_5). This file's
-- GRANT EXECUTE on public.get_public_document (below) requires that
-- function to already exist, and base_document_generator_schema.sql is
-- what creates it - applying this file first would fail outright.
-- Renumbered to a strictly later timestamp so the dependency is
-- explicit and no longer relies on "base" happening to sort before
-- "minimum" alphabetically. Also worth noting: base_document_generator_
-- schema.sql already grants EXECUTE on this same function itself (see
-- its own final GRANT statement) - the GRANT below is a harmless
-- no-op re-grant, not a conflict, kept as-is since re-running GRANT is
-- idempotent in Postgres.
-- =====================================================================

-- 1. Schema USAGE
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- 2. Anonymous Access: SELECT only on profiles and services (public branding & catalog)
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT ON public.services TO anon;

-- Explicitly revoke direct anon access on private/sensitive tables
REVOKE ALL ON public.customers FROM anon;
REVOKE ALL ON public.documents FROM anon;
REVOKE ALL ON public.document_items FROM anon;
REVOKE ALL ON public.approver_devices FROM anon;

-- 3. Authenticated Access: Full app access governed by RLS policies
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.customers, public.services, public.documents, public.document_items, public.approver_devices TO authenticated;

-- 4. RPC Execution: Allow get_public_document (SECURITY DEFINER handles document read)
GRANT EXECUTE ON FUNCTION public.get_public_document(uuid, text) TO anon, authenticated;

-- 5. Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
