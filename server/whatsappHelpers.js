// Pure helpers shared by api/whatsapp.js and api/bizylead-webhook.js.
import crypto from 'crypto';

/**
 * The text of a message that carries a link to a file. Bizylead's API only
 * takes a text body, so a document is sent as caption + link. Both parts must
 * survive: the caption must not replace the link.
 */
export function buildTextWithMedia(text, mediaUrl) {
  return [text, mediaUrl].filter(part => typeof part === 'string' && part.trim()).join('\n');
}

// A message only ever moves forward: queued -> sent -> delivered -> read.
const STATUS_RANK = { queued: 0, sent: 1, delivered: 2, read: 3 };

/** The status values whatsapp_messages accepts from a provider event, or null for anything else. */
export function normaliseProviderStatus(raw) {
  const status = String(raw ?? '').trim().toLowerCase();
  return status === 'failed' || status in STATUS_RANK ? status : null;
}

/**
 * PostgREST path that applies a provider status update only if it moves the
 * message forward. Webhooks can arrive out of order (a late "delivered" after
 * "read"), and a blind update would show the older status again. The id comes
 * from an external request, so it is URL-encoded rather than interpolated.
 */
export function statusUpdatePath(waMessageId, nextStatus) {
  const from = nextStatus === 'failed'
    ? ['queued', 'sent']
    : Object.keys(STATUS_RANK).filter(status => STATUS_RANK[status] < STATUS_RANK[nextStatus]);
  return `whatsapp_messages?wa_message_id=eq.${encodeURIComponent(String(waMessageId))}&status=in.(${from.join(',')})`;
}

/** A provider error as short plain text; providers send a string or an object. */
export function providerErrorText(error) {
  if (error == null || error === '') return null;
  const text = typeof error === 'string' ? error : (error.message || error.title || JSON.stringify(error));
  return String(text).slice(0, 500);
}

/** True when no secret is configured, or the request presents the configured one. */
export function sharedSecretMatches(configured, presented) {
  if (!configured) return true;
  if (typeof presented !== 'string' || !presented) return false;
  const digest = value => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(presented), digest(configured));
}
