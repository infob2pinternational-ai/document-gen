/**
 * Safely extracts a human-readable error message from any error value,
 * including native Error instances, Supabase PostgrestError objects, string errors, and raw JSON objects.
 */
export function getErrorMessage(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object') {
    const obj = err as Record<string, any>;
    if (typeof obj.message === 'string' && obj.message.trim()) {
      let msg = obj.message;
      if (typeof obj.details === 'string' && obj.details.trim()) {
        msg += ` (${obj.details.trim()})`;
      } else if (typeof obj.hint === 'string' && obj.hint.trim()) {
        msg += ` (${obj.hint.trim()})`;
      }
      return msg;
    }
    if (typeof obj.details === 'string' && obj.details.trim()) {
      return obj.details.trim();
    }
    if (typeof obj.error_description === 'string' && obj.error_description.trim()) {
      return obj.error_description.trim();
    }
    if (typeof obj.error === 'string' && obj.error.trim()) {
      return obj.error.trim();
    }
    try {
      const json = JSON.stringify(err);
      if (json !== '{}') return json;
    } catch {
      // Ignore JSON stringify errors
    }
  }
  return String(err);
}
