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

// Hardcoded Supabase credentials for production deployment
const supabaseUrl = 'https://rqovkmjsdwzggebvwvdk.supabase.co';
const supabaseAnonKey = 'eyJhbGci••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••';

export const isSupabaseConfigured = (): boolean => {
  return !!(supabaseUrl && supabaseAnonKey);
};

export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;