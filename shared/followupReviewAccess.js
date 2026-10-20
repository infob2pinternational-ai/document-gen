// Explicit review access; this does not grant the Owner role.
export function isAdditionalFollowupReviewer(email) {
  return typeof email === 'string' && email.trim().toLowerCase() === 'fransonputhukkara@gmail.com';
}
