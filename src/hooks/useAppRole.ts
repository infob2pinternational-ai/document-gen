import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';

// UI visibility only. Supabase independently authorizes every protected write.
export function useAppRole(userId?: string) {
  const [result, setResult] = useState<{ userId?: string; role: string; error: string; authorized: boolean }>({ role: 'staff', error: '', authorized: false });
  useEffect(() => {
    let disposed = false;
    async function refresh() {
      if (!userId || !supabase) return;
      try {
        const { data, error } = await supabase.rpc('current_app_role');
        if (error) throw new Error(error.message);
        if (!disposed) setResult({ userId, role: data || 'staff', authorized: Boolean(data), error: data ? '' : 'This account has no active office access. Contact the owner.' });
      } catch {
        // A transient focus-refresh failure must not unmount an open editor and lose its inputs.
        // Keep the last verified UI role for this user only; every write is still authorized by Supabase.
        if (!disposed) setResult(previous => ({
          ...(previous.userId === userId ? previous : { userId, role: 'staff', authorized: false }),
          error: 'Could not refresh your office permissions. Check your connection and retry.'
        }));
      }
    }
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { disposed = true; window.removeEventListener('focus', refresh); };
  }, [userId]);
  return result.userId === userId
    ? { ...result, verified: result.authorized }
    : { role: 'staff', error: '', verified: false };
}
