import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import dailyReportHandler, { formatDailyReportMessage } from '../api/daily-report.js';

function loadTsModule(relativePath, stubs = {}) {
  const code = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext }
  });

  for (const [specifier, stubCode] of Object.entries(stubs)) {
    const dataUri = `data:text/javascript;base64,${Buffer.from(stubCode).toString('base64')}`;
    outputText = outputText.replaceAll(`'${specifier}'`, JSON.stringify(dataUri));
    outputText = outputText.replaceAll(`"${specifier}"`, JSON.stringify(dataUri));
  }

  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

// Mock localStorage for node environment
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
}

const {
  getOwnerWhatsAppNumber,
  setOwnerWhatsAppNumber,
  DEFAULT_OWNER_WHATSAPP_NUMBER,
  isOwnerAutoReportEnabled,
  setOwnerAutoReportEnabled,
  getOwnerAutoReportTime,
  setOwnerAutoReportTime
} = await loadTsModule('../src/utils/telecallingShare.ts', {
  './whatsappShare': 'export function normalizeIndianPhone(p) { return String(p).replace(/\\D/g, ""); }',
  './dateUtils': 'export function formatKolkataDisplayDate(d) { return d; }',
  '../types': 'export function isUnresolvedStatus(s) { return ["Follow-up Required", "Call Back"].includes(s); }'
});

test('formatDailyReportMessage formats valid B2P WhatsApp text with status counts and telecallers', () => {
  const dummyReport = {
    date: '2026-09-25',
    totalCalls: 28,
    uniqueCompanies: 22,
    statusCounts: {
      'Appointment Confirmed': 5,
      'Interested / Details Shared': 7,
      'Follow-up Required': 4,
      'Call Back': 2,
      'No Answer / No Response': 6,
      'No Interest': 3,
      'Not Reachable / Switched Off': 1,
      'Wrong / Invalid Number': 0,
      'Other': 0
    },
    telecallerActivity: {
      Franson: 18,
      Staff: 10
    },
    followUpsCount: 6,
    unresolvedCallsCount: 13,
    entries: []
  };

  const message = formatDailyReportMessage('B2P INTERNATIONAL', dummyReport);

  assert.ok(message.includes('*B2P INTERNATIONAL*'));
  assert.ok(message.includes('*TELECALLING DAILY REPORT*'));
  assert.ok(message.includes('Total Calls: 28'));
  assert.ok(message.includes('Unique Companies: 22'));
  assert.ok(message.includes('Unresolved Calls: 13'));
  assert.ok(message.includes('1. Appointment Confirmed: 5'));
  assert.ok(message.includes('2. Interested / Details Shared: 7'));
  assert.ok(message.includes('Franson: 18'));
  assert.ok(message.includes('*Follow-ups Required:* 6'));
  assert.ok(message.includes('Generated from B2P ONE'));
});

test('OPTIONS /api/daily-report returns 200 with CORS headers', async () => {
  let statusCode = 0;
  let ended = false;
  const headers = {};

  const req = { method: 'OPTIONS', query: {}, headers: {} };
  const res = {
    setHeader: (k, v) => { headers[k] = v; },
    status: (c) => {
      statusCode = c;
      return { end: () => { ended = true; } };
    }
  };

  await dailyReportHandler(req, res);
  assert.equal(statusCode, 200);
  assert.equal(ended, true);
  assert.equal(headers['Access-Control-Allow-Origin'], '*');
});

test('POST /api/daily-report rejects sending to business own sender number (+91 81390 09034)', async () => {
  let statusCode = 0;
  let jsonResult = null;

  const req = {
    method: 'POST',
    query: { action: 'send-report' },
    headers: {},
    body: {
      phone: '918139009034'
    }
  };
  const res = {
    setHeader: () => {},
    status: (c) => {
      statusCode = c;
      return { json: (d) => { jsonResult = d; } };
    }
  };

  await dailyReportHandler(req, res);
  assert.equal(statusCode, 400);
  assert.equal(jsonResult.success, false);
  assert.match(jsonResult.error, /Cannot send WhatsApp report to the business's own sender number/);
});

test('Owner WhatsApp settings defaults to 918891074715 and persists in localStorage', () => {
  setOwnerWhatsAppNumber('');
  assert.equal(getOwnerWhatsAppNumber(), DEFAULT_OWNER_WHATSAPP_NUMBER);
  assert.equal(DEFAULT_OWNER_WHATSAPP_NUMBER, '918891074715');

  setOwnerWhatsAppNumber('9847099999');
  assert.equal(getOwnerWhatsAppNumber(), '9847099999');

  setOwnerWhatsAppNumber('');
  assert.equal(getOwnerWhatsAppNumber(), DEFAULT_OWNER_WHATSAPP_NUMBER);
});

test('Owner Auto-Report schedule preferences toggle and persist correctly', () => {
  setOwnerAutoReportEnabled(true);
  assert.equal(isOwnerAutoReportEnabled(), true);

  setOwnerAutoReportEnabled(false);
  assert.equal(isOwnerAutoReportEnabled(), false);

  setOwnerAutoReportTime('19:30');
  assert.equal(getOwnerAutoReportTime(), '19:30');

  setOwnerAutoReportEnabled(true);
  setOwnerAutoReportTime('20:00');
  assert.equal(getOwnerAutoReportTime(), '20:00');
});
