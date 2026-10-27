import { requireUser, requireOwnerOrAdminSession } from './auth.js';
import { isAdditionalEmailUser } from '../shared/emailAccess.js';

export async function requireEmailAccess(req, res) {
  const auth = await requireUser(req, res);
  if (!auth) return null;
  // Only trust the email returned by Supabase Auth for the bearer token.
  if (auth.user.email_confirmed_at && isAdditionalEmailUser(auth.user.email)) return auth;
  return requireOwnerOrAdminSession(auth, res);
}
