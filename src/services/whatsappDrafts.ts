export interface WhatsAppDraftScope { userId: string; companyId: string; conversationId: string }
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const WHATSAPP_DRAFT_PREFIX = 'docgen_whatsapp_ui_draft_v1:';
// Text only. This UI release does not claim durable dispatch/retry support.
// A separate namespace preserves any unresolved intents from the backend repair.
export function createWhatsAppDraftStore(storage: () => DraftStorage = () => localStorage) {
 const cache = new Map<string, {text: string; storageOK: boolean}>();
 function key(scope: WhatsAppDraftScope) {
  if (!scope.userId || !scope.companyId || !scope.conversationId) throw new Error('Draft identity is unavailable.');
  return WHATSAPP_DRAFT_PREFIX + JSON.stringify([scope.userId, scope.companyId, scope.conversationId]);
 }
 function entry(scope: WhatsAppDraftScope) {
  const id = key(scope); const cached = cache.get(id); if (cached) return cached;
  const value = {text: '', storageOK: true};
  try {const raw = storage().getItem(id); if (raw !== null) {
   const parsed = JSON.parse(raw);
   if (parsed?.version !== 1 || typeof parsed.text !== 'string') throw new Error('Invalid draft');
   value.text = parsed.text;
  }} catch {value.storageOK = false;}
  cache.set(id, value); return value;
 }
 function save(scope: WhatsAppDraftScope, text: string) {
  const value = entry(scope); value.text = text;
  try {storage().setItem(key(scope), JSON.stringify({version: 1, text})); value.storageOK = true;}
  catch {value.storageOK = false;}
  return value.storageOK;
 }
 return {
  load(scope: WhatsAppDraftScope) {return {...entry(scope)};},
  save,
  confirmSend(scope: WhatsAppDraftScope, submittedDraft: string) {
   const value = entry(scope);
   return value.text === submittedDraft ? save(scope, '') : value.storageOK;
  },
  discard(scope: WhatsAppDraftScope) {return save(scope, '');},
 };
}
export const whatsappDrafts = createWhatsAppDraftStore();
