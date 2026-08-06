/**
 * Draft Management — Hybrid Two-Layer Architecture
 *
 * Session Layer (sessionStorage, per-tab):
 *   Fast, 5-second debounced writes of the full editing state.
 *   Dies automatically when the tab closes — no cleanup needed.
 *   Used for instant restore on same-tab refresh.
 *
 * Recovery Layer (localStorage, shared, durable):
 *   Periodic snapshots for crash recovery and accidental browser close.
 *   Written on significant events (item add/remove, customer select,
 *   doc-type change) and every 30 seconds as a floor.
 *   Survives crashes, tab closes, and device restarts.
 *   Deleted only on successful save or explicit user discard.
 *
 * Draft keys:
 *   Editing existing document → "doc:<documentId>"
 *   Creating new document     → "new:<tabSessionId>"
 *
 * Storage keys:
 *   sessionStorage: "docgen_session:<draftKey>"   — full draft state
 *   sessionStorage: "docgen_tab_id"               — per-tab UUID
 *   localStorage:   "docgen_recovery:<draftKey>"   — crash-recovery snapshot
 *   localStorage:   "docgen_drafts_index"          — lightweight registry
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface DraftPayload {
  // Editor identity
  draftKey: string;
  documentId: string | null; // null when creating new
  editorType: 'document' | 'comparison';

  // All form fields — intentionally typed as `any` here because the
  // two editor components have different field sets, and the draft
  // system's job is to persist and restore opaquely, not to validate.
  fields: Record<string, any>;

  // Metadata
  lastSaved: string; // ISO timestamp
  tabId: string;
}

export interface DraftSummary {
  draftKey: string;
  documentId: string | null;
  editorType: 'document' | 'comparison';
  docType: string;
  customerName: string;
  documentNumber: string;
  lastSaved: string;
  tabId: string;
}

// ─── Tab Identity ───────────────────────────────────────────────────

const TAB_ID_KEY = 'docgen_tab_id';

export function getTabId(): string {
  let tabId = sessionStorage.getItem(TAB_ID_KEY);
  if (!tabId) {
    tabId = crypto.randomUUID();
    sessionStorage.setItem(TAB_ID_KEY, tabId);
  }
  return tabId;
}

// ─── Draft Key Generation ───────────────────────────────────────────
//
// New-document keys are scoped by document type as well as tab, so
// switching document type mid-session (e.g. Invoice -> Quotation via
// the in-editor dropdown) never restores the wrong draft later. Editing
// an existing document is always keyed by its stable id regardless of
// type, since the id alone is already unique.

export function getDraftKey(documentId: string | null, docType?: string): string {
  if (documentId) {
    return `doc:${documentId}`;
  }
  return `new:${docType || 'unknown'}:${getTabId()}`;
}

/** The pre-type-scoping key format used before this change shipped. */
export function getLegacyNewDraftKey(): string {
  return `new:${getTabId()}`;
}

/**
 * One-time migration: if a draft exists under the old (untyped)
 * `new:{tabId}` key format, re-key it to the new `new:{docType}:{tabId}`
 * format (reading the type from the draft's own stored fields) and
 * delete the old key. Returns the migrated draft, or null if there was
 * nothing to migrate.
 */
export function migrateOldNewDraftKeyFormat(): DraftPayload | null {
  const oldKey = getLegacyNewDraftKey();
  const found = restoreDraft(oldKey);
  if (!found) return null;

  const docType = found.draft.fields?.docType || 'unknown';
  const newKey = `new:${docType}:${getTabId()}`;
  const migrated: DraftPayload = { ...found.draft, draftKey: newKey };

  saveRecoveryDraft(migrated);
  if (found.source === 'session') {
    saveSessionDraft(migrated);
  }
  deleteDraft(oldKey);

  return migrated;
}

// ─── Session Layer (sessionStorage) ─────────────────────────────────

const SESSION_PREFIX = 'docgen_session:';

export function saveSessionDraft(draft: DraftPayload): boolean {
  try {
    sessionStorage.setItem(
      `${SESSION_PREFIX}${draft.draftKey}`,
      JSON.stringify(draft)
    );
    return true;
  } catch (err) {
    console.error('[Drafts] Failed to save session draft:', err);
    return false;
  }
}

export function loadSessionDraft(draftKey: string): DraftPayload | null {
  try {
    const raw = sessionStorage.getItem(`${SESSION_PREFIX}${draftKey}`);
    if (!raw) return null;
    return JSON.parse(raw) as DraftPayload;
  } catch {
    return null;
  }
}

export function clearSessionDraft(draftKey: string): void {
  sessionStorage.removeItem(`${SESSION_PREFIX}${draftKey}`);
}

// ─── Recovery Layer (localStorage) ──────────────────────────────────

const RECOVERY_PREFIX = 'docgen_recovery:';
const INDEX_KEY = 'docgen_drafts_index';

export function saveRecoveryDraft(draft: DraftPayload): boolean {
  try {
    localStorage.setItem(
      `${RECOVERY_PREFIX}${draft.draftKey}`,
      JSON.stringify(draft)
    );
    updateIndex(draft);
    return true;
  } catch (err) {
    console.error('[Drafts] Failed to save recovery draft:', err);
    return false;
  }
}

export function loadRecoveryDraft(draftKey: string): DraftPayload | null {
  try {
    const raw = localStorage.getItem(`${RECOVERY_PREFIX}${draftKey}`);
    if (!raw) return null;
    return JSON.parse(raw) as DraftPayload;
  } catch {
    return null;
  }
}

export function clearRecoveryDraft(draftKey: string): void {
  localStorage.removeItem(`${RECOVERY_PREFIX}${draftKey}`);
  removeFromIndex(draftKey);
}

// ─── Index Management ───────────────────────────────────────────────

function readIndex(): DraftSummary[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as DraftSummary[];
  } catch {
    return [];
  }
}

function writeIndex(index: DraftSummary[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (err) {
    console.error('[Drafts] Failed to write index:', err);
  }
}

function updateIndex(draft: DraftPayload): void {
  const index = readIndex();
  const existing = index.findIndex(e => e.draftKey === draft.draftKey);
  const summary: DraftSummary = {
    draftKey: draft.draftKey,
    documentId: draft.documentId,
    editorType: draft.editorType,
    docType: draft.fields.docType || '',
    customerName: draft.fields.customerName || '',
    documentNumber: draft.fields.docNumber || draft.fields.documentNumber || '',
    lastSaved: draft.lastSaved,
    tabId: draft.tabId,
  };

  if (existing >= 0) {
    index[existing] = summary;
  } else {
    index.push(summary);
  }
  writeIndex(index);
}

function removeFromIndex(draftKey: string): void {
  const index = readIndex();
  const filtered = index.filter(e => e.draftKey !== draftKey);
  writeIndex(filtered);
}

// ─── Public API: Draft Lifecycle ────────────────────────────────────

/**
 * Clear both layers for a given draft key.
 * Called after successful save or explicit user discard.
 */
export function deleteDraft(draftKey: string): void {
  clearSessionDraft(draftKey);
  clearRecoveryDraft(draftKey);
}

/**
 * Get all recovery drafts available for restore on app startup.
 * Returns summaries only — call loadRecoveryDraft(key) for full data.
 */
export function getRecoverableDrafts(): DraftSummary[] {
  const index = readIndex();

  // Prune orphaned index entries (recovery data was cleared but index wasn't)
  const valid = index.filter(entry => {
    const exists = localStorage.getItem(`${RECOVERY_PREFIX}${entry.draftKey}`) !== null;
    return exists;
  });

  if (valid.length !== index.length) {
    writeIndex(valid);
  }

  return valid;
}

/**
 * Attempt to restore a draft for a specific editor session.
 * Priority: sessionStorage (same-tab refresh) > localStorage (crash recovery).
 * Returns { draft, source } or null if no draft exists.
 */
export function restoreDraft(
  draftKey: string
): { draft: DraftPayload; source: 'session' | 'recovery' } | null {
  const session = loadSessionDraft(draftKey);
  if (session) {
    return { draft: session, source: 'session' };
  }
  const recovery = loadRecoveryDraft(draftKey);
  if (recovery) {
    return { draft: recovery, source: 'recovery' };
  }
  return null;
}

// ─── Backward Compatibility: Migrate Old Draft Format ───────────────

const LEGACY_KEY = 'docgen_draft_document';

export function migrateLegacyDraft(): DraftSummary | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;

    const legacy = JSON.parse(raw);
    const documentId = legacy.documentToEdit?.id || null;
    const draftKey = documentId ? `doc:${documentId}` : `new:${getTabId()}`;

    const draft: DraftPayload = {
      draftKey,
      documentId,
      editorType: 'document',
      fields: legacy,
      lastSaved: new Date().toISOString(),
      tabId: getTabId(),
    };

    saveRecoveryDraft(draft);
    localStorage.removeItem(LEGACY_KEY);

    return {
      draftKey,
      documentId,
      editorType: 'document',
      docType: legacy.docType || '',
      customerName: legacy.customerName || '',
      documentNumber: legacy.docNumber || '',
      lastSaved: draft.lastSaved,
      tabId: draft.tabId,
    };
  } catch (err) {
    console.error('[Drafts] Failed to migrate legacy draft:', err);
    localStorage.removeItem(LEGACY_KEY);
    return null;
  }
}

// ─── Debounce Utility ───────────────────────────────────────────────

export interface DraftSaverStatus {
  dirty: boolean;
  lastSaved: string | null; // only set on a CONFIRMED successful write
  saveFailed: boolean; // true if the most recent write attempt failed
}

/**
 * Creates a debounced draft saver. Returns { markDirty, markSignificant,
 * flush, cancel, isDirty, getLastSaved, getStatus }.
 *
 * Success/failure contract (critical - the user must never be told a
 * draft saved when it didn't):
 * - `lastSaved` only updates after a CONFIRMED successful storage write.
 * - If a write fails (quota exceeded, storage disabled, etc.), the
 *   draft stays `dirty`, `lastSaved` is left untouched, and another
 *   attempt is automatically scheduled for the next autosave cycle -
 *   the caller does not need to call markDirty again for the retry
 *   to happen.
 * - `onStatusChange`, if provided, fires after every write attempt
 *   (success or failure) so the UI can show "Saved" / "Save failed,
 *   retrying..." without polling.
 *
 * - markDirty(draft): schedules a session-layer write after `sessionDelayMs`.
 *   If called again within the delay, the timer resets (debounce).
 * - markSignificant(draft): immediately writes to both layers AND
 *   resets the 30-second recovery floor timer.
 * - flush(): writes immediately to both layers if dirty (call on unmount).
 * - cancel(): clears pending timers without writing (call after a
 *   successful document save, once the draft itself is deleted).
 */
export function createDraftSaver(
  sessionDelayMs: number = 5000,
  recoveryFloorMs: number = 30000,
  onStatusChange?: (status: DraftSaverStatus) => void
) {
  let sessionTimer: ReturnType<typeof setTimeout> | null = null;
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingDraft: DraftPayload | null = null;
  let dirty = false;
  let lastSaved: string | null = null;
  let saveFailed = false;

  function emitStatus() {
    if (onStatusChange) {
      onStatusChange({ dirty, lastSaved, saveFailed });
    }
  }

  function attemptSessionWrite() {
    if (!pendingDraft) return;
    const toWrite: DraftPayload = { ...pendingDraft, lastSaved: new Date().toISOString() };
    const ok = saveSessionDraft(toWrite);
    if (ok) {
      dirty = false;
      lastSaved = toWrite.lastSaved;
      saveFailed = false;
      emitStatus();
    } else {
      // Do NOT update lastSaved. Keep dirty. Retry on the next cycle.
      saveFailed = true;
      emitStatus();
      if (sessionTimer) clearTimeout(sessionTimer);
      sessionTimer = setTimeout(attemptSessionWrite, sessionDelayMs);
    }
  }

  function attemptRecoveryWrite() {
    if (!pendingDraft) return;
    const toWrite: DraftPayload = { ...pendingDraft, lastSaved: lastSaved ?? new Date().toISOString() };
    const ok = saveRecoveryDraft(toWrite);
    if (!ok) {
      // Recovery-layer failure alone doesn't need its own retry loop -
      // the session layer's retry (or the 30s floor firing again) will
      // naturally attempt this again. Just surface the failure.
      saveFailed = true;
      emitStatus();
    }
  }

  function scheduleRecoveryFloor() {
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      if (pendingDraft) {
        attemptRecoveryWrite();
      }
      scheduleRecoveryFloor();
    }, recoveryFloorMs);
  }

  // Start the recovery floor timer immediately
  scheduleRecoveryFloor();

  return {
    /** Call on every state change (keystrokes, field edits). */
    markDirty(draft: DraftPayload) {
      pendingDraft = draft;
      dirty = true;
      emitStatus();
      if (sessionTimer) clearTimeout(sessionTimer);
      sessionTimer = setTimeout(attemptSessionWrite, sessionDelayMs);
    },

    /** Call on significant events (item add/remove, customer select, doc-type change). */
    markSignificant(draft: DraftPayload) {
      pendingDraft = draft;
      dirty = true;
      attemptSessionWrite();
      attemptRecoveryWrite();
      // Reset the recovery floor so we don't double-write soon after
      scheduleRecoveryFloor();
    },

    /** Call on editor unmount — writes immediately if anything is pending. */
    flush() {
      if (sessionTimer) clearTimeout(sessionTimer);
      if (dirty && pendingDraft) {
        attemptSessionWrite();
        attemptRecoveryWrite();
      }
    },

    /** Call to tear down timers without writing (e.g., after successful document save). */
    cancel() {
      if (sessionTimer) clearTimeout(sessionTimer);
      if (recoveryTimer) clearTimeout(recoveryTimer);
      sessionTimer = null;
      recoveryTimer = null;
      pendingDraft = null;
      dirty = false;
      saveFailed = false;
    },

    /** Returns true if there are unwritten (or failed-to-write) changes. */
    isDirty() {
      return dirty;
    },

    /** Returns the last CONFIRMED-successful save timestamp, or null if never saved. */
    getLastSaved(): string | null {
      return lastSaved;
    },

    /** Returns the full status snapshot (dirty, lastSaved, saveFailed). */
    getStatus(): DraftSaverStatus {
      return { dirty, lastSaved, saveFailed };
    },
  };
}
