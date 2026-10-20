// Additional access is specific to Email; this does not grant the Owner role.
export function isAdditionalEmailUser(email) {
  return typeof email === 'string' && email.trim().toLowerCase() === 'fransonputhukkara@gmail.com';
}
