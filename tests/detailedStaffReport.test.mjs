import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDetailedStaffReport,
  formatDetailedReportWhatsAppMessages,
  getIstDayBoundariesUtc,
  isDay,
  TARGET_STAFF_EMAIL
} from '../server/detailedStaffReport.js';
import { requireOwner } from '../server/auth.js';
import handler from '../api/detailed-staff-report.js';

const d = '2026-09-29';
const stamp = '2026-09-29T10:12:40Z';

// ─── 1. Backward-compatible tests from PR #14 ──────────────────────────────────
test('includes modified existing records, not only newly created rows', () => {
  const result = buildDetailedStaffReport({
    date: d,
    telecalling: [{
      company_name: 'Damro Furniture',
      created_by_email: 'brutf5354@gmail.com',
      created_at: '2026-09-24T08:00:00Z',
      updated_at: stamp,
      call_status: 'Interested / Details Shared'
    }],
    leads: [{
      lead_number: 'B2P-LD-1014',
      company_name: 'Palat',
      assigned_telecaller_email: 'brutf5354@gmail.com',
      created_at: '2026-09-21T07:25:51Z',
      updated_at: stamp
    }]
  });
  assert.equal(result.counts['Existing telecalling records updated'], 1);
  assert.equal(result.counts['Existing leads updated'], 1);
  assert.match(result.markdown, /Damro Furniture/);
  assert.match(result.markdown, /Palat/);
});

test('does not count unrelated staff or another IST day', () => {
  const result = buildDetailedStaffReport({
    date: d,
    telecalling: [
      { created_by_email: 'other@example.com', updated_at: stamp },
      { created_by_email: 'brutf5354@gmail.com', updated_at: '2026-09-29T19:00:00Z' } // 00:30 IST next day
    ]
  });
  assert.equal(result.counts['Existing telecalling records updated'], 0);
});

test('rejects reports for other staff', () => {
  assert.throws(() => buildDetailedStaffReport({ date: d, staffEmail: 'other@example.com' }));
});

test('deletion counts require explicit staff attribution', () => {
  const result = buildDetailedStaffReport({
    date: d,
    activities: [
      { type: 'Follow-up Deleted', performed_by: 'other@example.com', created_at: stamp },
      { type: 'Follow-up Deleted', performed_by: 'brutf5354@gmail.com', created_at: stamp }
    ]
  });
  assert.equal(result.counts['Follow-up deletions (logged events)'], 1);
  assert.equal(result.counts['Follow-ups deleted'], 1);
});

// ─── 2. IST Date Boundary Precision ──────────────────────────────────────────
test('IST date boundary precision (23:59:50 IST vs 00:00:10 IST next day)', () => {
  const boundaries = getIstDayBoundariesUtc('2026-09-29');
  assert.equal(boundaries.startIso, '2026-09-28T18:30:00.000Z'); // 00:00:00 IST
  assert.equal(boundaries.endIso, '2026-09-29T18:29:59.999Z');   // 23:59:59.999 IST

  // Timestamp at 23:58:00 IST on 29 Sep (18:28:00 UTC)
  const lateIST = '2026-09-29T18:28:00.000Z';
  assert.equal(isDay(lateIST, '2026-09-29'), true);
  assert.equal(isDay(lateIST, '2026-09-30'), false);

  // Timestamp at 00:02:00 IST on 30 Sep (18:32:00 UTC on 29 Sep)
  const earlyNextIST = '2026-09-29T18:32:00.000Z';
  assert.equal(isDay(earlyNextIST, '2026-09-29'), false);
  assert.equal(isDay(earlyNextIST, '2026-09-30'), true);
});

// ─── 3. Historical Verification: 29 September 2026 ─────────────────────────────
test('Historical verification for 29 September 2026 dataset', () => {
  // 17 existing leads updated
  const leadNames = [
    'Palat', 'Navya Bake', 'Nilkamal Homes', 'Duroflex', 'Client 5',
    'Client 6', 'Client 7', 'Client 8', 'Client 9', 'Client 10',
    'Client 11', 'Client 12', 'Client 13', 'Client 14', 'Client 15',
    'Client 16', 'Client 17'
  ];
  const historicalLeads = leadNames.map((name, i) => ({
    id: `lead-hist-29-${i + 1}`,
    lead_number: `B2P-LD-10${10 + i}`,
    company_name: name,
    customer_name: `${name} Contact`,
    assigned_telecaller_email: TARGET_STAFF_EMAIL,
    status: 'working',
    created_at: '2026-09-20T05:00:00.000Z', // Created earlier
    updated_at: '2026-09-29T11:00:00.000Z'  // Updated on 29 Sep IST
  }));

  // 13 existing telecalling records updated
  const tcNames = [
    'Damro Furniture', 'TC Corp 2', 'TC Corp 3', 'TC Corp 4', 'TC Corp 5',
    'TC Corp 6', 'TC Corp 7', 'TC Corp 8', 'TC Corp 9', 'TC Corp 10',
    'TC Corp 11', 'TC Corp 12', 'TC Corp 13'
  ];
  const historicalTc = tcNames.map((name, i) => ({
    id: `tc-hist-29-${i + 1}`,
    company_name: name,
    contact_person: `${name} Rep`,
    call_status: i === 0 ? 'Appointment Confirmed' : 'Follow-up Required',
    feedback: `Discussion notes for ${name}`,
    created_by_email: TARGET_STAFF_EMAIL,
    created_at: '2026-09-22T06:00:00.000Z', // Created earlier
    updated_at: '2026-09-29T12:00:00.000Z'  // Updated on 29 Sep IST
  }));

  // 3 follow-ups created
  const historicalFollowUps = [
    {
      id: 'fu-29-1',
      lead_id: 'lead-hist-29-1',
      customer_name: 'Palat',
      due_date: '2026-10-02',
      reason: 'Quote follow-up',
      created_by_email: TARGET_STAFF_EMAIL,
      assigned_staff_email: TARGET_STAFF_EMAIL,
      created_at: '2026-09-29T09:30:00.000Z',
      status: 'PENDING'
    },
    {
      id: 'fu-29-2',
      lead_id: 'lead-hist-29-2',
      customer_name: 'Navya Bake',
      due_date: '2026-10-03',
      reason: 'Proposal discussion',
      created_by_email: TARGET_STAFF_EMAIL,
      assigned_staff_email: TARGET_STAFF_EMAIL,
      created_at: '2026-09-29T10:00:00.000Z',
      status: 'PENDING'
    },
    {
      id: 'fu-29-3',
      lead_id: 'lead-hist-29-3',
      customer_name: 'Nilkamal Homes',
      due_date: '2026-10-04',
      reason: 'Requirements gathering',
      created_by_email: TARGET_STAFF_EMAIL,
      assigned_staff_email: TARGET_STAFF_EMAIL,
      created_at: '2026-09-29T10:30:00.000Z',
      status: 'PENDING'
    }
  ];

  // 4 follow-ups deleted (including Lakshya and Trinity)
  const historicalActivities = [
    {
      id: 'act-del-1',
      lead_id: 'lead-lakshya',
      company_name: 'Lakshya',
      action: 'Follow-up Deleted',
      note: 'Removed follow-up: "Initial inquiry" (due 2026-09-28)',
      user_email: TARGET_STAFF_EMAIL,
      created_at: '2026-09-29T08:00:00.000Z'
    },
    {
      id: 'act-del-2',
      lead_id: 'lead-trinity',
      company_name: 'Trinity',
      action: 'Follow-up Deleted',
      note: 'Removed follow-up: "Callback scheduled" (due 2026-09-27)',
      user_email: TARGET_STAFF_EMAIL,
      created_at: '2026-09-29T08:15:00.000Z'
    },
    {
      id: 'act-del-3',
      lead_id: 'lead-del-3',
      company_name: 'Client Alpha',
      action: 'Follow-up Deleted',
      note: 'Removed follow-up: "Check sample" (due 2026-09-26)',
      user_email: TARGET_STAFF_EMAIL,
      created_at: '2026-09-29T08:30:00.000Z'
    },
    {
      id: 'act-del-4',
      lead_id: 'lead-del-4',
      company_name: 'Client Beta',
      action: 'Follow-up Deleted',
      note: 'Removed follow-up: "Pricing negotiation" (due 2026-09-25)',
      user_email: TARGET_STAFF_EMAIL,
      created_at: '2026-09-29T08:45:00.000Z'
    }
  ];

  const report = buildDetailedStaffReport({
    date: '2026-09-29',
    telecalling: historicalTc,
    leads: historicalLeads,
    activities: historicalActivities,
    followups: historicalFollowUps
  });

  // Verify exact counts
  assert.equal(report.counts['Existing leads updated'], 17);
  assert.equal(report.counts['Existing telecalling records updated'], 13);
  assert.equal(report.counts['Follow-ups created'], 3);
  assert.equal(report.counts['Follow-ups deleted'], 4);

  // Verify critical customer names are included in report markdown
  assert.match(report.markdown, /Palat/);
  assert.match(report.markdown, /Navya Bake/);
  assert.match(report.markdown, /Nilkamal Homes/);
  assert.match(report.markdown, /Damro Furniture/);
  assert.match(report.markdown, /Duroflex/);

  // Verify Lakshya and Trinity deleted follow-ups are included in owner attention
  assert.ok(report.ownerAttention.some(item => item.includes('Lakshya')));
  assert.ok(report.ownerAttention.some(item => item.includes('Trinity')));
});

// ─── 4. Historical Verification: 30 September 2026 ─────────────────────────────
test('Historical verification for 30 September 2026 dataset', () => {
  // 6 existing leads updated
  const leadNames30 = ['Client A', 'Client B', 'Client C', 'Client D', 'Client E', 'Client F'];
  const leads30 = leadNames30.map((name, i) => ({
    id: `lead-30-${i + 1}`,
    lead_number: `B2P-LD-20${10 + i}`,
    company_name: name,
    customer_name: `${name} Contact`,
    assigned_telecaller_email: TARGET_STAFF_EMAIL,
    status: 'working',
    created_at: '2026-09-25T05:00:00.000Z',
    updated_at: '2026-09-30T10:00:00.000Z'
  }));

  // 1 follow-up deleted
  const acts30 = [
    {
      id: 'act-del-30-1',
      lead_id: 'lead-30-1',
      company_name: 'Client A',
      action: 'Follow-up Deleted',
      note: 'Removed follow-up: "Demo call" (due 2026-09-29)',
      user_email: TARGET_STAFF_EMAIL,
      created_at: '2026-09-30T09:00:00.000Z'
    }
  ];

  const report = buildDetailedStaffReport({
    date: '2026-09-30',
    leads: leads30,
    activities: acts30
  });

  assert.equal(report.counts['Existing leads updated'], 6);
  assert.equal(report.counts['Follow-ups deleted'], 1);
  assert.ok(report.ownerAttention.some(item => item.includes('Client A')));
});

// ─── 5. Follow-up Replacement Status Detection ─────────────────────────────────
test('Missing replacement detection distinguishes replaced vs unreplaced deletions', () => {
  const activities = [
    {
      id: 'del-rep',
      lead_id: 'lead-with-rep',
      company_name: 'Replaced Client',
      action: 'Follow-up Deleted',
      note: 'Removed follow-up: "Old discussion"',
      user_email: TARGET_STAFF_EMAIL,
      created_at: '2026-09-29T10:00:00.000Z'
    },
    {
      id: 'del-norep',
      lead_id: 'lead-no-rep',
      company_name: 'Orphan Client',
      action: 'Follow-up Deleted',
      note: 'Removed follow-up: "Crucial contract"',
      user_email: TARGET_STAFF_EMAIL,
      created_at: '2026-09-29T10:30:00.000Z'
    }
  ];

  const followups = [
    // Replacement created for lead-with-rep
    {
      id: 'fu-replacement',
      lead_id: 'lead-with-rep',
      customer_name: 'Replaced Client',
      status: 'PENDING',
      due_date: '2026-10-05',
      created_at: '2026-09-29T10:05:00.000Z'
    }
  ];

  const report = buildDetailedStaffReport({
    date: '2026-09-29',
    activities,
    followups
  });

  // Replaced client marked with replacement
  assert.match(report.markdown, /Replaced Client/);
  assert.match(report.markdown, /Replacement exists/);

  // Orphan client flagged as NO REPLACEMENT in owner attention
  assert.match(report.markdown, /NO REPLACEMENT \(Attention Required\)/);
  assert.ok(report.ownerAttention.some(item => item.includes('Orphan Client')));
});

// ─── 6. Database Query Failures Flagged (Never Silent Zero) ─────────────────────
test('Upstream query failure is explicitly recorded and does not silently substitute zero', () => {
  const report = buildDetailedStaffReport({
    date: '2026-09-29',
    queryErrors: ['telecalling_entries query timed out (HTTP 504)']
  });

  assert.match(report.markdown, /Incomplete source checks:.*telecalling_entries query timed out/);
  assert.ok(report.ownerAttention.some(item => item.includes('Incomplete data query detected')));
});

// ─── 7. WhatsApp Formatting and Message Length ─────────────────────────────────
test('formatDetailedReportWhatsAppMessages divides long report without truncating customer details', () => {
  const sampleReport = {
    date: '2026-09-29',
    staffEmail: TARGET_STAFF_EMAIL,
    counts: {
      'New leads created': 0,
      'Existing leads updated': 17,
      'New telecalling records': 0,
      'Existing telecalling records updated': 13,
      'Follow-ups created': 3,
      'Follow-ups completed': 1,
      'Follow-ups rescheduled': 0,
      'Follow-ups deleted': 4,
      'Quotations created': 0,
      'Quotations approved': 0,
      'Documents sent through WhatsApp': 0
    },
    ownerAttention: [
      '⚠️ Deleted follow-up WITHOUT replacement: Lakshya.',
      '⚠️ Deleted follow-up WITHOUT replacement: Trinity.'
    ],
    markdown: 'Detailed customer audit trail rows...\n'.repeat(150)
  };

  const messages = formatDetailedReportWhatsAppMessages(sampleReport);
  assert.ok(Array.isArray(messages));
  assert.ok(messages.length >= 2, 'Long report should be split into multiple parts');

  for (const m of messages) {
    assert.ok(m.text.length <= 4000, `Message length ${m.text.length} must not exceed WhatsApp 4000 limit`);
    assert.ok(m.text.includes(`[${m.part}/${m.total}]`));
  }

  assert.ok(messages[0].text.includes('Lakshya'));
  assert.ok(messages[0].text.includes('Trinity'));
});

// ─── 8. Owner-Only Server Authorization ─────────────────────────────────────────
test('requireOwner rejects non-owner accounts with 403 Forbidden', async () => {
  const origUrl = process.env.SUPABASE_URL;
  const origKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://mock.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'mock-anon-key';

  function createMockRes() {
    return {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(d) { this.body = d; return this; }
    };
  }

  // 1. Staff account blocked
  const reqStaff = {
    headers: { authorization: 'Bearer staff-token' }
  };
  const resStaff = createMockRes();

  // Mock global fetch for auth verification
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (url.includes('/auth/v1/user')) {
        return Response.json({ id: 'staff-uid', email: 'brutf5354@gmail.com' });
      }
      if (url.includes('/rpc/current_app_role')) {
        return Response.json('staff');
      }
      return Response.json({});
    };

    const authStaff = await requireOwner(reqStaff, resStaff);
    assert.equal(authStaff, null);
    assert.equal(resStaff.statusCode, 403);
    assert.equal(resStaff.body.error, 'Access restricted to company owner.');

    // 2. Owner account permitted
    const reqOwner = {
      headers: { authorization: 'Bearer owner-token' }
    };
    const resOwner = createMockRes();

    globalThis.fetch = async (url) => {
      if (url.includes('/auth/v1/user')) {
        return Response.json({ id: 'owner-uid', email: 'sarathjohnpanengadan@gmail.com' });
      }
      return Response.json('owner');
    };

    const authOwner = await requireOwner(reqOwner, resOwner);
    assert.ok(authOwner);
    assert.equal(authOwner.user.email, 'sarathjohnpanengadan@gmail.com');
  } finally {
    globalThis.fetch = oldFetch;
    process.env.SUPABASE_URL = origUrl;
    process.env.SUPABASE_ANON_KEY = origKey;
  }
});

// ─── 9. Serverless API Endpoint Dry-Run Mode ──────────────────────────────────
test('POST /api/detailed-staff-report dry_run=true returns formatted payload without sending', async () => {
  const req = {
    method: 'POST',
    query: { action: 'send', dry_run: 'true' },
    headers: { 'x-vercel-cron': '1' }, // simulates cron/authorized caller
    body: {
      date: '2026-09-29',
      dry_run: true
    }
  };

  let statusCode = 200;
  let jsonBody = null;
  const res = {
    setHeader() {},
    status(c) { statusCode = c; return this; },
    json(d) { jsonBody = d; return this; }
  };

  await handler(req, res);
  assert.equal(statusCode, 200);
  assert.equal(jsonBody.success, true);
  assert.equal(jsonBody.dryRun, true);
  assert.equal(jsonBody.staffEmail, TARGET_STAFF_EMAIL);
  assert.equal(jsonBody.date, '2026-09-29');
  assert.ok(Array.isArray(jsonBody.messagesToSend));
});
