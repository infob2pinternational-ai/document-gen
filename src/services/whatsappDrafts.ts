export interface WhatsAppDraftScope { userId: string; companyId: string; conversationId: string }
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const WHATSAPP_DRAFT_PREFIX = 'docgen_whatsapp_ui_draft_v1:';
interface PendingSend { id: string; text: string; startedAt: string; providerMessageId?: string }
interface DraftEntry { text: string; storageOK: boolean; pending?: PendingSend }
// Local intent tracking only; this does not provide server-side idempotency.
// A separate namespace preserves any unresolved intents from the backend repair.
export function createWhatsAppDraftStore(storage: () => DraftStorage = () => localStorage) {
 const cache = new Map<string, DraftEntry>();
 function key(scope: WhatsAppDraftScope) {
  if (!scope.userId || !scope.companyId || !scope.conversationId) throw new Error('Draft identity is unavailable.');
  return WHATSAPP_DRAFT_PREFIX + JSON.stringify([scope.userId, scope.companyId, scope.conversationId]);
 }
 function entry(scope: WhatsAppDraftScope) {
  const id = key(scope); const cached = cache.get(id); if (cached) return cached;
  const value: DraftEntry = {text: '', storageOK: true};
  try {const raw = storage().getItem(id); if (raw !== null) {
   const parsed = JSON.parse(raw);
   if (parsed?.version !== 1 || typeof parsed.text !== 'string') throw new Error('Invalid draft');
   value.text = parsed.text;
   if (parsed.pending !== undefined) {
    const p = parsed.pending;
    if (typeof p?.id !== 'string' || !p.id || typeof p.text !== 'string' || typeof p.startedAt !== 'string') throw new Error('Invalid pending send');
    value.pending = p;
   }
  }} catch {value.storageOK = false;}
  cache.set(id, value); return value;
 }
 function save(scope: WhatsAppDraftScope, text: string) {
  const value = entry(scope); value.text = text;
  try {storage().setItem(key(scope), JSON.stringify({version: 1, text, ...(value.pending ? {pending: value.pending} : {})})); value.storageOK = true;}
  catch {value.storageOK = false;}
  return value.storageOK;
 }
 return {
  load(scope: WhatsAppDraftScope) {return {...entry(scope)};},
  save,
  beginSend(scope: WhatsAppDraftScope, text: string) {
   const value = entry(scope);
   if (value.pending) throw new Error('An earlier send is unresolved. Check delivery before sending again.');
   if (!value.storageOK) throw new Error('Draft storage is unavailable. Sending is paused to protect this draft.');
   const pending = {id: crypto.randomUUID(), text, startedAt: new Date().toISOString()};
   value.pending = pending;
   if (!save(scope, value.text)) { delete value.pending; throw new Error('Could not save the send reference. Your draft is kept; nothing was sent.'); }
   return pending.id;
  },
  rejectSend(scope: WhatsAppDraftScope, requestId: string) {
   const value = entry(scope);
   if (value.pending?.id === requestId) delete value.pending;
   return save(scope, value.text);
  },
  recordAcceptance(scope: WhatsAppDraftScope, requestId: string, providerMessageId: string) {
   const value = entry(scope);
   if (value.pending?.id === requestId) value.pending.providerMessageId = providerMessageId;
   return save(scope, value.text);
  },
  confirmSend(scope: WhatsAppDraftScope, submittedDraft: string) {
   const value = entry(scope);
   delete value.pending;
   return save(scope, value.text === submittedDraft ? '' : value.text);
  },
  discard(scope: WhatsAppDraftScope) {return save(scope, '');},
 };
}
export const whatsappDrafts = createWhatsAppDraftStore();
