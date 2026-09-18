-- Read-only: run in the Supabase project used by the deployed app.
-- Share the results if leads still do not appear on another account.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('leads', 'lead_activities')
ORDER BY table_name, ordinal_position;

SELECT company_id, count(*) AS saved_leads, max(created_at) AS latest_lead
FROM public.leads
GROUP BY company_id;

SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('leads', 'lead_activities', 'profiles');
