-- Migration: Add sub_district column to leads table
BEGIN;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS sub_district text;

NOTIFY pgrst, 'reload schema';

COMMIT;
