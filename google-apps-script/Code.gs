/**
 * B2P Document Sync — Google Apps Script (Phase B3 redesign)
 *
 * Deploy as a Web App:
 *   Deploy > New deployment > Type: Web app
 *   Execute as: Me
 *   Who has access: Anyone
 * Copy the resulting /exec URL into google_sync_settings.webhook_url
 * for the relevant company (do NOT overwrite the old URL until you've
 * verified this new deployment works — see the B3 rollback strategy).
 *
 * ─── CONFIGURATION — edit this block to match your actual sheet ───────
 */
const CONFIG = {
  SPREADSHEET_ID: 'PASTE_YOUR_SPREADSHEET_ID_HERE',
  DATA_SHEET_NAME: 'Documents',       // the sheet/tab holding one row per document
  LOG_SHEET_NAME: 'Sync Log',         // auto-created if missing
  // Column order in DATA_SHEET_NAME. document_id MUST be present and
  // should be column A (index 0) for the lookup index to be efficient.
  // Add/reorder columns here to match your real sheet - nothing else
  // in this script needs to change if you do.
  COLUMNS: [
    'document_id',        // A - permanent unique key, never shown to users
    'document_number',    // B
    'document_type',       // C
    'company_name',        // D
    'customer_name',        // E
    'customer_email',       // F
    'customer_phone',       // G
    'customer_address',     // H
    'customer_gstin',       // I
    'date',                 // J
    'subtotal',             // K
    'discount_total',       // L
    'taxable_amount',       // M
    'tax_total',            // N
    'total',                // O
    'items_summary',        // P - human-readable line items, one cell
    'last_synced_at'        // Q
  ]
};

/**
 * ─── CORS ────────────────────────────────────────────────────────────
 * IMPORTANT (corrected): earlier revisions of this script called
 * .setHeaders(...) on the TextOutput returned by ContentService. That
 * method does not exist - confirmed directly against Google's official
 * Apps Script reference for the TextOutput class, which lists only:
 * append, clear, downloadAsFile, getContent, getFileName, getMimeType,
 * setContent, setMimeType. There is no way to set custom response
 * headers (including Access-Control-Allow-Origin) from Apps Script at
 * all - not a workaround-able gap, a hard platform limitation.
 *
 * This isn't actually a problem in practice: the frontend deliberately
 * sends Content-Type: text/plain (not application/json), which avoids
 * a CORS preflight (OPTIONS) entirely - browsers only preflight
 * "non-simple" requests. Apps Script Web App responses are served with
 * a permissive CORS policy by the platform itself for this kind of
 * request, with no header-setting required or possible on the script's
 * side. doOptions() below is kept only as a harmless no-op for
 * completeness (it will essentially never be invoked given the
 * request shape above) - it does NOT and CANNOT provide real CORS
 * preflight compliance, since Apps Script has no mechanism for that.
 * If a genuinely preflighted request is ever needed later (custom
 * headers, application/json content-type), Apps Script cannot serve
 * as a CORS preflight responder at all - the fallback is a same-origin
 * proxy (e.g. a Vercel serverless function), not another attempt at
 * this.
 */
function doOptions() {
  return ContentService.createTextOutput('');
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ─── Entry point ─────────────────────────────────────────────────────
 * IMPORTANT: Apps Script Web Apps always return HTTP 200 for any
 * request handled without an uncaught platform-level crash - there is
 * no API to set a custom status code (verified against current Apps
 * Script documentation). Success/failure is signaled entirely through
 * this JSON body's `success` field, which the frontend worker checks
 * instead of the HTTP status.
 */
function doPost(e) {
  const startedAt = new Date();
  let action = null;
  let documentId = null;

  try {
    // ─── Validation ───────────────────────────────────────────────
    if (!e || !e.postData || !e.postData.contents) {
      return respondAndLog(false, null, null, 'Missing request body', startedAt);
    }

    let data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return respondAndLog(false, null, null, 'Malformed JSON in request body', startedAt);
    }

    action = data.action;

    // full_backup has no document_id (it's a whole-system backup, not
    // tied to one document) - handled before the document-centric
    // validation below. Restored from the original script per the
    // Settings "Backup to Google Drive" button, which still sends
    // exactly this shape (action, timestamp, payload).
    if (action === 'full_backup') {
      saveFullJsonBackup(data.payload);
      return respondAndLog(true, action, null, 'Full backup saved to Drive', startedAt);
    }

    documentId = data.document_id;

    if (!action || (action !== 'save_document' && action !== 'delete_document')) {
      return respondAndLog(false, action, documentId, 'Invalid or missing action (expected save_document, delete_document, or full_backup)', startedAt);
    }
    if (!documentId) {
      return respondAndLog(false, action, documentId, 'Missing document_id', startedAt);
    }
    if (action === 'save_document' && !data.document_number) {
      return respondAndLog(false, action, documentId, 'Missing payload: document_number required for save_document', startedAt);
    }

    // ─── Route ────────────────────────────────────────────────────
    if (action === 'save_document') {
      const row = upsertDocumentRow(data);
      // Restored from the original script: an individual JSON backup
      // file per document in Drive, alongside the sheet row. Wrapped in
      // its own try/catch (the original script didn't do this) so a
      // Drive hiccup can't turn an otherwise-successful sheet save into
      // a reported failure - the sheet row is the primary result.
      try {
        saveJsonBackup(data);
      } catch (backupErr) {
        logRequest(startedAt, new Date(), 'save_document_backup', documentId, false, 'Drive backup failed: ' + (backupErr && backupErr.message ? backupErr.message : String(backupErr)));
      }
      return respondAndLog(true, action, documentId, `Saved to row ${row}`, startedAt, row);
    } else {
      const row = deleteDocumentRow(documentId, data.document_number);
      // Restored from the original script: delete the matching Drive
      // backup file too, keyed by document_number (same key the
      // backup files were always named by) - not document_id, to stay
      // compatible with files the old script already created.
      try {
        deleteBackupFile(data.document_number);
      } catch (backupErr) {
        logRequest(startedAt, new Date(), 'delete_document_backup', documentId, false, 'Drive backup delete failed: ' + (backupErr && backupErr.message ? backupErr.message : String(backupErr)));
      }
      if (row === null) {
        // Idempotent: already gone (e.g. a retried delete) is a success,
        // not an error - the desired end state (no row) is already true.
        return respondAndLog(true, action, documentId, 'Document not found (already deleted) - treated as success', startedAt);
      }
      return respondAndLog(true, action, documentId, `Deleted row ${row}`, startedAt, row);
    }
  } catch (err) {
    return respondAndLog(false, action, documentId, 'Unexpected error: ' + (err && err.message ? err.message : String(err)), startedAt);
  }
}

/**
 * ─── Upsert (save_document) ──────────────────────────────────────────
 * Builds the document_id -> row-number index from a SINGLE bulk read of
 * column A, rather than looping row-by-row - this is what keeps
 * performance acceptable at 10,000+ rows (one getRange/getValues call,
 * not thousands of individual reads).
 */
function upsertDocumentRow(data) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = getOrCreateDataSheet(ss);
  const idColIndex = CONFIG.COLUMNS.indexOf('document_id') + 1; // 1-based
  const numberColIndex = CONFIG.COLUMNS.indexOf('document_number') + 1;

  const existingRow = findExistingRow(sheet, data.document_id, data.document_number, idColIndex, numberColIndex);

  const rowValues = CONFIG.COLUMNS.map(function (col) {
    switch (col) {
      case 'document_id': return data.document_id;
      case 'document_number': return data.document_number || '';
      case 'document_type': return data.document_type || '';
      case 'company_name': return data.company_name || '';
      case 'customer_name': return data.customer_name || '';
      case 'customer_email': return data.customer_email || '';
      case 'customer_phone': return data.customer_phone || '';
      case 'customer_address': return data.customer_address || '';
      case 'customer_gstin': return data.customer_gstin || '';
      case 'date': return data.date || '';
      case 'subtotal': return data.subtotal || 0;
      case 'discount_total': return data.discount_total || 0;
      case 'taxable_amount': return data.taxable_amount || 0;
      case 'tax_total': return data.tax_total || 0;
      case 'total': return data.total || 0;
      case 'items_summary':
        return (data.items || []).map(function (it) {
          return (it.description || '') + ' x' + (it.qty || 1) + ' @ ' + (it.rate || 0);
        }).join('; ');
      case 'last_synced_at': return new Date().toISOString();
      default: return '';
    }
  });

  if (existingRow) {
    // Update in place - this is the fix for the duplicate-row bug. The
    // full row (including document_id in column A) is written every
    // time, so a row found via the document_number fallback below gets
    // its missing document_id backfilled automatically, right here -
    // no separate migration step needed for documents that existed
    // before this script. Restoring a previously-deleted document also
    // lands here: if it was deleted, findExistingRow finds nothing, so
    // it falls to the append branch below and recreates the row - no
    // separate "restore" action is needed.
    sheet.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
    return existingRow;
  } else {
    sheet.appendRow(rowValues);
    return sheet.getLastRow();
  }
}

/**
 * ─── Delete ───────────────────────────────────────────────────────────
 * Returns the deleted row number, or null if no matching row existed
 * (idempotent - a retried delete after the row is already gone is not
 * an error).
 */
function deleteDocumentRow(documentId, documentNumber) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = getOrCreateDataSheet(ss);
  const idColIndex = CONFIG.COLUMNS.indexOf('document_id') + 1;
  const numberColIndex = CONFIG.COLUMNS.indexOf('document_number') + 1;

  const existingRow = findExistingRow(sheet, documentId, documentNumber, idColIndex, numberColIndex);
  if (!existingRow) return null;

  sheet.deleteRow(existingRow);
  return existingRow;
}

/**
 * ─── Lookup ───────────────────────────────────────────────────────────
 * Primary match: document_id (fast, one bulk read - what keeps this
 * fast at 10,000+ rows). Fallback: document_number, but ONLY against
 * rows whose document_id cell is still empty - these are rows written
 * before this script existed. This is what makes old documents
 * self-healing: the first time an old document is edited or deleted
 * after this script goes live, it's found by its old key
 * (document_number), and on save, the full row rewrite backfills the
 * missing document_id - so every subsequent save finds it via the fast
 * primary path, with zero manual migration step.
 */
function findExistingRow(sheet, documentId, documentNumber, idColIndex, numberColIndex) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null; // only header row (or empty) exists

  const ids = sheet.getRange(2, idColIndex, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === documentId) {
      return i + 2; // +2: 1-based, and skip the header row
    }
  }

  if (documentNumber) {
    const numbers = sheet.getRange(2, numberColIndex, lastRow - 1, 1).getValues();
    for (let i = 0; i < numbers.length; i++) {
      if (ids[i][0] === '' && numbers[i][0] === documentNumber) {
        return i + 2;
      }
    }
  }

  return null;
}

function getOrCreateDataSheet(ss) {
  let sheet = ss.getSheetByName(CONFIG.DATA_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.DATA_SHEET_NAME);
    sheet.appendRow(CONFIG.COLUMNS);
  }
  return sheet;
}

/**
 * ─── Logging ──────────────────────────────────────────────────────────
 * Every request: timestamp, action, document_id, success, error.
 */
function respondAndLog(success, action, documentId, message, startedAt, sheetRow) {
  const completedAt = new Date();
  try {
    logRequest(startedAt, completedAt, action, documentId, success, success ? null : message);
  } catch (logErr) {
    // Logging must never block the actual response
  }

  const responseBody = {
    success: success,
    document_id: documentId,
    action: action,
    message: message
  };
  if (sheetRow) responseBody.sheet_row = sheetRow;
  if (!success) responseBody.error = message;

  return jsonResponse(responseBody);
}

function logRequest(startedAt, completedAt, action, documentId, success, errorMessage) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let logSheet = ss.getSheetByName(CONFIG.LOG_SHEET_NAME);
  if (!logSheet) {
    logSheet = ss.insertSheet(CONFIG.LOG_SHEET_NAME);
    logSheet.appendRow(['timestamp', 'action', 'document_id', 'success', 'error', 'duration_ms']);
  }
  logSheet.appendRow([
    startedAt.toISOString(),
    action || '',
    documentId || '',
    success,
    errorMessage || '',
    completedAt.getTime() - startedAt.getTime()
  ]);
}

/**
 * ─── Google Drive backups ────────────────────────────────────────────
 * Restored, essentially unchanged, from the original script (shared
 * back into this conversation) - preserves compatibility with backup
 * files that script already created in your Drive. Three things:
 *  1. saveJsonBackup - one JSON file per document, overwritten on
 *     every save_document, filename keyed by document_number.
 *  2. deleteBackupFile - removes that file on delete_document.
 *  3. saveFullJsonBackup - the whole-system backup from Settings'
 *     "Backup to Google Drive" button, one dated file per run.
 * All three share one "B2P Document Backups" Drive folder, auto-
 * created on first use, exactly as before.
 */
function getBackupFolder() {
  const folderName = 'B2P Document Backups';
  const folders = DriveApp.getFoldersByName(folderName);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
}

function saveJsonBackup(data) {
  if (!data || !data.document_number) return;
  const folder = getBackupFolder();
  const fileName = data.document_number.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';

  const files = folder.getFilesByName(fileName);
  while (files.hasNext()) {
    files.next().setTrashed(true);
  }

  folder.createFile(fileName, JSON.stringify(data, null, 2), MimeType.PLAIN_TEXT);
}

function saveFullJsonBackup(payload) {
  const folder = getBackupFolder();
  const dateStr = new Date().toISOString().split('T')[0];
  const fileName = 'b2p_full_backup_' + dateStr + '.json';

  const files = folder.getFilesByName(fileName);
  while (files.hasNext()) {
    files.next().setTrashed(true);
  }

  folder.createFile(fileName, JSON.stringify(payload, null, 2), MimeType.PLAIN_TEXT);
}

function deleteBackupFile(documentNumber) {
  if (!documentNumber) return;
  const folder = getBackupFolder();
  const fileName = documentNumber.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
  const files = folder.getFilesByName(fileName);

  while (files.hasNext()) {
    files.next().setTrashed(true);
  }
}
