import { supabase } from './supabaseClient';

export async function authenticatedHeaders(): Promise<Record<string, string>> {
  if (!supabase) throw new Error('Sign in to continue.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('Sign in to continue.');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.session.access_token}`,
  };
}
