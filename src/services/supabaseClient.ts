/**
 * Supabase client singleton - extracted from db.ts (Phase B2) so that
 * services which db.ts itself depends on (e.g. sheetsSyncQueue.ts,
 * which db.ts calls into for Google Sheets sync) can import the client
 * directly, without creating a circular import between the two files.
 *
 * db.ts re-exports both of these for backward compatibility - every
 * existing `import { supabase } from '../services/db'` call site
 * (App.tsx, AuthPanel.tsx, ComparisonService.ts) continues to work
 * completely unchanged.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Hardcoded Supabase credentials for production deployment.
const supabaseUrl = 'https://rqovkmjsdwzggebvwvdk.supabase.co';

const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxb3ZrbWpzZHd6Z2dlYnZ3dmRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNDQ0MzMsImV4cCI6MjA5ODcyMDQzM30.A_4pG8rG4KDTxa85DSjJ1Y6wGwqMwXPL9DrlzoYjZ9M';

export const isSupabaseConfigured = (): boolean => {
  return !!(supabaseUrl && supabaseAnonKey);
};

export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;