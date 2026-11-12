import { fieldSalesAccessCache } from '../../services/fieldVisitService';
import type { CachedIdentity } from '../../services/fieldVisitService';
import { supabase } from '../../services/supabaseClient';

/**
 * Make sure this device is signed out, even when the server cannot be reached.
 * Supabase keeps the login on the device if its sign-out request fails, which
 * on a shared phone would leave the previous person signed in. Unsent visits
 * are not touched: they stay under their owner's key.
 */
export async function ensureSignedOutOnThisDevice(): Promise<void> {
  if (!supabase) return;
  let stillSignedIn = false;
  try { stillSignedIn = Boolean((await supabase.auth.getSession()).data?.session); } catch { stillSignedIn = true; }
  if (!stillSignedIn) return;
  for (const key of Object.keys(window.localStorage)) {
    if (/^sb-.*-auth-token/.test(key)) window.localStorage.removeItem(key);
  }
  window.localStorage.removeItem('supabase_user');
  window.location.reload();           // drops the login still held in memory
}

/**
 * Decides whether to show the salesperson screens. This is about what the
 * device displays only: every server call is authorised by the database from
 * the signed-in session, whatever this returns.
 *
 *  - Role verified as "sales"                      -> salesperson screens.
 *  - Role not verified yet (no connection) but this user was verified as
 *    "sales" on this device within the last 7 days -> salesperson screens,
 *    so drafts can be written offline.
 *  - Role verified as anything else                -> never, and the
 *    remembered access is forgotten.
 */
export function shouldShowFieldSales(userId: string | undefined, verified: boolean, role: string): boolean {
  if (!userId) return false;
  if (verified) {
    if (role === 'sales') return true;
    fieldSalesAccessCache.clear(window.localStorage, userId);
    return false;
  }
  return fieldSalesAccessCache.load(window.localStorage, userId)?.role === 'sales';
}

/**
 * The app was opened with no connection and no usable login session, but a
 * salesperson was signed in on this device and has not signed out. Lets them
 * keep writing drafts; nothing can be sent until they are online and signed in.
 */
export function offlineFieldSalesIdentity(): CachedIdentity | null {
  if (typeof navigator !== 'undefined' && navigator.onLine) return null;
  const identity = fieldSalesAccessCache.loadIdentity(window.localStorage);
  if (!identity) return null;
  return fieldSalesAccessCache.load(window.localStorage, identity.userId)?.role === 'sales' ? identity : null;
}
