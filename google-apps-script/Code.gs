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
 * The frontend deliberately sends Content-Type: text/plain (not
 * application/json) to avoid triggering a CORS preflight — this is why
 * doOptions below will rarely if ever actually be invoked in practice.
 * It's included for completeness per the requirement, and as a safety
 * net if the request shape ever changes. Apps Script cannot reliably
 * serve as a full CORS preflight responder for genuinely preflighted
 * requests (verified against current documentation) - if that's ever
 * needed, use a same-origin proxy instead of relying on this.
 */
function doOptions() {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({ 'Access-Control-Allow-Origin': '*' });
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
    documentId = data.document_id;

    if (!action || (action !== 'save_document' && action !== 'delete_document')) {
      return respondAndLog(false, action, documentId, 'Invalid or missing action (expected save_document or delete_document)', startedAt);
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
      return respondAndLog(true, action, documentId, `Saved to row ${row}`, startedAt, row);
    } else {
      const row = deleteDocumentRow(documentId);
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

  const existingRow = findRowByDocumentId(sheet, data.document_id, idColIndex);

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
    // Update in place - this is the fix for the duplicate-row bug.
    // Restoring a previously-deleted document also lands here: if it
    // was deleted, findRowByDocumentId finds nothing, so it falls to
    // the append branch below and recreates the row - no separate
    // "restore" action is needed.
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
function deleteDocumentRow(documentId) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = getOrCreateDataSheet(ss);
  const idColIndex = CONFIG.COLUMNS.indexOf('document_id') + 1;

  const existingRow = findRowByDocumentId(sheet, documentId, idColIndex);
  if (!existingRow) return null;

  sheet.deleteRow(existingRow);
  return existingRow;
}

/**
 * ─── Lookup index ─────────────────────────────────────────────────────
 * ONE bulk read of the document_id column, not a per-row scan. Fast
 * even at 10,000+ rows since it's a single getValues() call.
 */
function findRowByDocumentId(sheet, documentId, idColIndex) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null; // only header row (or empty) exists

  const ids = sheet.getRange(2, idColIndex, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === documentId) {
      return i + 2; // +2: 1-based, and skip the header row
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
