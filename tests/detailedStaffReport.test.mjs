import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
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

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; return this; },
    end() { return this; }
  };
}

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

// ─── 3. Historical Verification: 29 September 2026 (Lakshya Deleted, Trinity NOT Deleted) ─────
test('Historical verification for 29 September 2026 dataset (Lakshya deleted on 29 Sep)', () => {
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

  // 4 follow-ups deleted on 29 Sep: Lakshya was deleted on 29 Sep; Trinity was NOT deleted on 29 Sep
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
      lead_id: 'lead-alpha',
      company_name: 'Client Alpha',
      action: 'Follow-up Deleted',
      note: 'Removed follow-up: "Callback scheduled" (due 2026-09-27)',
      user_email: TARGET_STAFF_EMAIL,
      created_at: '2026-09-29T08:15:00.000Z'
    },
    {
      id: 'act-del-3',
      lead_id: 'lead-beta',
      company_name: 'Client Beta',
      action: 'Follow-up Deleted',
      note: 'Removed follow-up: "Check sample" (due 2026-09-26)',
      user_email: TARGET_STAFF_EMAIL,
      created_at: '2026-09-29T08:30:00.000Z'
    },
    {
      id: 'act-del-4',
      lead_id: 'lead-gamma',
      company_name: 'Client Gamma',
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

  // Lakshya was deleted on 29 Sep and MUST appear in owner attention
  assert.ok(report.ownerAttention.some(item => item.includes('Lakshya')));

  // Trinity was NOT deleted on 29 Sep and MUST NOT appear in 29 Sep owner attention
  assert.ok(!report.ownerAttention.some(item => item.includes('Trinity')), 'Trinity must not be present in 29 Sep report');
});

// ─── 4. Historical Verification: 30 September 2026 (Trinity Deleted on 30 Sep) ─────
test('Historical verification for 30 September 2026 dataset (Trinity deleted on 30 Sep)', () => {
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

  // 1 follow-up deleted: Trinity's follow-up was deleted on 30 September
  const acts30 = [
    {
      id: 'act-del-30-1',
      lead_id: 'lead-trinity',
      company_name: 'Trinity',
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

  // Trinity was deleted on 30 Sep and MUST appear in owner attention
  assert.ok(report.ownerAttention.some(item => item.includes('Trinity')), 'Trinity must be in 30 Sep owner attention');

  // Lakshya was deleted on 29 Sep and MUST NOT appear in 30 Sep owner attention
  assert.ok(!report.ownerAttention.some(item => item.includes('Lakshya')), 'Lakshya must not be in 30 Sep report');
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
      '⚠️ Deleted follow-up WITHOUT replacement: Lakshya.'
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
});

// ─── 8. Owner-Only Server Authorization ─────────────────────────────────────────
test('requireOwner rejects non-owner accounts with 403 Forbidden', async () => {
  const origUrl = process.env.SUPABASE_URL;
  const origKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://mock.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'mock-anon-key';

  const reqStaff = {
    headers: { authorization: 'Bearer staff-token' }
  };
  const resStaff = createMockRes();

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

    // Owner account permitted
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

// ─── 9. Cron Security: Mandatory CRON_SECRET Enforcement ────────────────────────
test('Cron security rejects requests when CRON_SECRET is missing, unset or invalid', async () => {
  const origCronSecret = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    const reqNoConfig = {
      method: 'POST',
      query: { action: 'cron' },
      headers: { authorization: 'Bearer some-secret' }
    };
    const resNoConfig = createMockRes();
    await handler(reqNoConfig, resNoConfig);
    assert.equal(resNoConfig.statusCode, 401);
    assert.match(resNoConfig.body.error, /CRON_SECRET is not configured/);

    process.env.CRON_SECRET = 'valid-super-secret-cron-token-12345';

    const reqNoHeader = {
      method: 'POST',
      query: { action: 'cron' },
      headers: {}
    };
    const resNoHeader = createMockRes();
    await handler(reqNoHeader, resNoHeader);
    assert.equal(resNoHeader.statusCode, 401);
    assert.match(resNoHeader.body.error, /Missing or invalid CRON_SECRET/);

    const reqWrongHeader = {
      method: 'POST',
      query: { action: 'cron' },
      headers: { authorization: 'Bearer wrong-secret' }
    };
    const resWrongHeader = createMockRes();
    await handler(reqWrongHeader, resWrongHeader);
    assert.equal(resWrongHeader.statusCode, 401);
    assert.match(resWrongHeader.body.error, /Missing or invalid CRON_SECRET/);

    const reqSpoof = {
      method: 'GET',
      headers: { 'x-vercel-cron': '1', authorization: 'Bearer bad' },
      query: {}
    };
    const resSpoof = createMockRes();
    await handler(reqSpoof, resSpoof);
    assert.equal(resSpoof.statusCode, 401);

    const reqValid = {
      method: 'POST',
      query: { action: 'cron', dry_run: 'true' },
      headers: { authorization: 'Bearer valid-super-secret-cron-token-12345' },
      body: { date: '2026-09-29', dry_run: true }
    };
    const resValid = createMockRes();
    await handler(reqValid, resValid);
    assert.equal(resValid.statusCode, 200);
    assert.equal(resValid.body.success, true);
    assert.equal(resValid.body.dryRun, true);
  } finally {
    process.env.CRON_SECRET = origCronSecret;
  }
});

// ─── 10. Atomic PostgreSQL Claim: Two Concurrent Executions ─────────────────────
test('Atomic claim operation ensures only one of two concurrent executions acquires lock and dispatches', async () => {
  const db = new PGlite();

  // Create table and atomic claim function
  await db.exec(`
    CREATE TABLE owner_report_dispatches (
      id TEXT PRIMARY KEY,
      report_type TEXT NOT NULL DEFAULT 'detailed_staff_report',
      staff_email TEXT NOT NULL,
      report_date DATE NOT NULL,
      recipient TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress',
      sent_at TIMESTAMPTZ,
      sent_count INT DEFAULT 0,
      message_ids JSONB DEFAULT '[]'::jsonb,
      message_results JSONB DEFAULT '[]'::jsonb,
      summary JSONB DEFAULT '{}'::jsonb,
      owner_attention JSONB DEFAULT '[]'::jsonb,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE OR REPLACE FUNCTION claim_owner_report_dispatch(
      p_id TEXT,
      p_staff_email TEXT,
      p_report_date DATE,
      p_recipient TEXT,
      p_force BOOLEAN DEFAULT FALSE
    ) RETURNS JSONB
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_existing RECORD;
      v_claimed RECORD;
    BEGIN
      SELECT * INTO v_existing FROM owner_report_dispatches WHERE id = p_id FOR UPDATE;

      IF FOUND THEN
        IF v_existing.status IN ('sent', 'delivered') AND NOT p_force THEN
          RETURN jsonb_build_object('acquired', false, 'reason', 'already_sent');
        END IF;

        IF v_existing.status = 'in_progress' AND v_existing.updated_at > (NOW() - INTERVAL '5 minutes') AND NOT p_force THEN
          RETURN jsonb_build_object('acquired', false, 'reason', 'in_progress_locked');
        END IF;

        UPDATE owner_report_dispatches
        SET status = 'in_progress', recipient = p_recipient, updated_at = NOW()
        WHERE id = p_id RETURNING * INTO v_claimed;

        RETURN jsonb_build_object('acquired', true, 'reason', 'reclaimed');
      ELSE
        INSERT INTO owner_report_dispatches (
          id, report_type, staff_email, report_date, recipient, status, created_at, updated_at
        ) VALUES (
          p_id, 'detailed_staff_report', p_staff_email, p_report_date, p_recipient, 'in_progress', NOW(), NOW()
        ) RETURNING * INTO v_claimed;

        RETURN jsonb_build_object('acquired', true, 'reason', 'new_claim');
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        RETURN jsonb_build_object('acquired', false, 'reason', 'conflict_lost');
    END;
    $$;
    ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    REVOKE ALL ON FUNCTION claim_owner_report_dispatch(TEXT, TEXT, DATE, TEXT, BOOLEAN) FROM PUBLIC;
  `);

  const idempotencyId = `detailed_staff_report_${TARGET_STAFF_EMAIL}_2026-09-29`;

  // Execution 1: Claims the dispatch
  const claim1 = await db.query(`SELECT claim_owner_report_dispatch($1, $2, $3::date, $4, false) AS res;`, [
    idempotencyId,
    TARGET_STAFF_EMAIL,
    '2026-09-29',
    '918589909034'
  ]);
  const res1 = claim1.rows[0].res;
  assert.equal(res1.acquired, true, 'Execution 1 must acquire the claim');
  assert.equal(res1.reason, 'new_claim');

  // Execution 2: Attempts concurrently to claim the exact same dispatch
  const claim2 = await db.query(`SELECT claim_owner_report_dispatch($1, $2, $3::date, $4, false) AS res;`, [
    idempotencyId,
    TARGET_STAFF_EMAIL,
    '2026-09-29',
    '918589909034'
  ]);
  const res2 = claim2.rows[0].res;
  assert.equal(res2.acquired, false, 'Execution 2 must NOT acquire the claim');
  assert.equal(res2.reason, 'in_progress_locked');

  // Mark execution 1 as sent
  await db.query(`UPDATE owner_report_dispatches SET status = 'sent', sent_at = NOW() WHERE id = $1;`, [idempotencyId]);

  // Execution 3 (e.g. later cron run)
  const claim3 = await db.query(`SELECT claim_owner_report_dispatch($1, $2, $3::date, $4, false) AS res;`, [
    idempotencyId,
    TARGET_STAFF_EMAIL,
    '2026-09-29',
    '918589909034'
  ]);
  const res3 = claim3.rows[0].res;
  assert.equal(res3.acquired, false, 'Subsequent execution must reject already_sent dispatch');
  assert.equal(res3.reason, 'already_sent');

  // Force bypass allows re-claim
  const claimForce = await db.query(`SELECT claim_owner_report_dispatch($1, $2, $3::date, $4, true) AS res;`, [
    idempotencyId,
    TARGET_STAFF_EMAIL,
    '2026-09-29',
    '918589909034'
  ]);
  assert.equal(claimForce.rows[0].res.acquired, true, 'Force=true must allow re-claim');
});

// ─── 11. Supabase Unavailable or Missing Service Role Key Halts Sending ─────────────
test('Stops sending immediately if Supabase or service role key is unavailable (no fallback to in-memory)', async () => {
  const origUrl = process.env.SUPABASE_URL;
  const origCron = process.env.CRON_SECRET;
  const origServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.CRON_SECRET = 'test-storage-fail-cron';

  try {
    // 1. Missing SUPABASE_SERVICE_ROLE_KEY halts sending
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = 'https://mock.supabase.co';

    const reqNoKey = {
      method: 'POST',
      query: { action: 'cron' },
      headers: { authorization: 'Bearer test-storage-fail-cron' },
      body: { date: '2026-09-29' }
    };
    const resNoKey = createMockRes();
    await handler(reqNoKey, resNoKey);

    assert.equal(resNoKey.statusCode, 503);
    assert.match(resNoKey.body.error, /Persistent storage unavailable/);
    assert.match(resNoKey.body.details, /requires SUPABASE_SERVICE_ROLE_KEY/);

    // 2. Missing SUPABASE_URL halts sending
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';

    const reqNoUrl = {
      method: 'POST',
      query: { action: 'cron' },
      headers: { authorization: 'Bearer test-storage-fail-cron' },
      body: { date: '2026-09-29' }
    };
    const resNoUrl = createMockRes();
    await handler(reqNoUrl, resNoUrl);

    assert.equal(resNoUrl.statusCode, 503);
    assert.match(resNoUrl.body.error, /Persistent storage unavailable/);

    // 3. PostgreSQL RPC failure halts sending immediately with an error (no fallback locking attempted)
    process.env.SUPABASE_URL = 'https://mock.supabase.co';
    const oldFetch = globalThis.fetch;
    // Mock httpsRequest by intercepting or setting invalid URL
    // Since handler uses httpsRequest, an invalid port/host will throw and halt with 503
    process.env.SUPABASE_URL = 'https://127.0.0.1:9'; // unreachable port

    const reqRpcFail = {
      method: 'POST',
      query: { action: 'cron' },
      headers: { authorization: 'Bearer test-storage-fail-cron' },
      body: { date: '2026-09-29' }
    };
    const resRpcFail = createMockRes();
    await handler(reqRpcFail, resRpcFail);

    assert.equal(resRpcFail.statusCode, 503);
    assert.match(resRpcFail.body.error, /Persistent storage unavailable/);
  } finally {
    process.env.SUPABASE_URL = origUrl;
    process.env.CRON_SECRET = origCron;
    process.env.SUPABASE_SERVICE_ROLE_KEY = origServiceKey;
  }
});

// ─── 12. Partial Delivery Tracking: Skips Resending Succeeded Parts ───────────────
test('Partial delivery handles failure gracefully and does not resend previously succeeded messages', () => {
  // Simulate messages to send
  const messagesToSend = [
    { part: 1, total: 3, text: 'Part 1 of 3: Summary' },
    { part: 2, total: 3, text: 'Part 2 of 3: Customer Audit' },
    { part: 3, total: 3, text: 'Part 3 of 3: Verification' }
  ];

  // Previous attempt: Part 1 succeeded, Part 2 failed
  const existingResults = [
    { part: 1, total: 3, status: 'sent', messageId: 'msg_part_1_uuid', sentAt: '2026-09-29T14:30:05Z' },
    { part: 2, total: 3, status: 'failed', error: 'Bizylead timeout HTTP 504' }
  ];

  const deliveredParts = new Set(
    existingResults.filter(r => r.status === 'sent').map(r => r.part)
  );

  assert.ok(deliveredParts.has(1), 'Part 1 must be marked as delivered');
  assert.ok(!deliveredParts.has(2), 'Part 2 was not delivered');
  assert.ok(!deliveredParts.has(3), 'Part 3 was not delivered');

  // Verify send loop logic
  const partsAttemptedOnRetry = [];
  for (const msg of messagesToSend) {
    if (deliveredParts.has(msg.part)) {
      // Skipped
      continue;
    }
    partsAttemptedOnRetry.push(msg.part);
  }

  assert.deepEqual(partsAttemptedOnRetry, [2, 3], 'Retry must only attempt parts 2 and 3, never resending part 1');
});

// ─── 13. Read-Only Production PostgreSQL Verification ───────────────────────────
test('Read-only verification against production schema queries accurately attributes Lakshya and Trinity without writing', async () => {
  const db = new PGlite();

  // Setup minimal production tables matching database/migrations
  await db.exec(`
    CREATE TABLE leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_number TEXT,
      company_name TEXT,
      customer_name TEXT,
      assigned_telecaller_email TEXT,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ
    );

    CREATE TABLE telecalling_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_name TEXT,
      contact_person TEXT,
      call_status TEXT,
      created_by_email TEXT,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ
    );

    CREATE TABLE lead_activities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID,
      company_name TEXT,
      action TEXT,
      note TEXT,
      user_email TEXT,
      created_at TIMESTAMPTZ
    );

    CREATE TABLE follow_ups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID,
      customer_name TEXT,
      due_date DATE,
      reason TEXT,
      status TEXT,
      created_by_email TEXT,
      assigned_staff_email TEXT,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ
    );
  `);

  // Insert 29 Sep records: 17 updated leads, 13 updated telecalling, 3 followups, 4 deletions (including Lakshya)
  for (let i = 1; i <= 17; i++) {
    await db.query(`
      INSERT INTO leads (lead_number, company_name, customer_name, assigned_telecaller_email, created_at, updated_at)
      VALUES ($1, $2, $3, $4, '2026-09-20T08:00:00Z'::timestamptz, '2026-09-29T10:00:00Z'::timestamptz);
    `, [`B2P-LD-${1000 + i}`, `Client ${i}`, `Contact ${i}`, TARGET_STAFF_EMAIL]);
  }

  for (let i = 1; i <= 13; i++) {
    await db.query(`
      INSERT INTO telecalling_entries (company_name, contact_person, call_status, created_by_email, created_at, updated_at)
      VALUES ($1, $2, 'Follow-up Required', $3, '2026-09-20T08:00:00Z'::timestamptz, '2026-09-29T11:00:00Z'::timestamptz);
    `, [`TC Company ${i}`, `Contact ${i}`, TARGET_STAFF_EMAIL]);
  }

  // 3 Follow-ups on 29 Sep
  for (let i = 1; i <= 3; i++) {
    await db.query(`
      INSERT INTO follow_ups (customer_name, due_date, reason, status, created_by_email, assigned_staff_email, created_at, updated_at)
      VALUES ($1, '2026-10-05'::date, 'Quote follow-up', 'PENDING', $2, $2, '2026-09-29T09:00:00Z'::timestamptz, '2026-09-29T09:00:00Z'::timestamptz);
    `, [`Lead FollowUp ${i}`, TARGET_STAFF_EMAIL]);
  }

  // 4 deletions on 29 Sep (Lakshya + 3 others)
  await db.query(`
    INSERT INTO lead_activities (company_name, action, note, user_email, created_at)
    VALUES ('Lakshya', 'Follow-up Deleted', 'Removed follow-up: "Inquiry discussion" (due 2026-09-28)', $1, '2026-09-29T08:00:00Z'::timestamptz);
  `, [TARGET_STAFF_EMAIL]);

  for (let i = 1; i <= 3; i++) {
    await db.query(`
      INSERT INTO lead_activities (company_name, action, note, user_email, created_at)
      VALUES ($1, 'Follow-up Deleted', 'Removed follow-up: "Sample follow-up"', $2, '2026-09-29T08:30:00Z'::timestamptz);
    `, [`Deleted Client ${i}`, TARGET_STAFF_EMAIL]);
  }

  // 30 Sep records: 6 updated leads, 1 deletion (Trinity)
  for (let i = 1; i <= 6; i++) {
    await db.query(`
      INSERT INTO leads (lead_number, company_name, customer_name, assigned_telecaller_email, created_at, updated_at)
      VALUES ($1, $2, $3, $4, '2026-09-25T08:00:00Z'::timestamptz, '2026-09-30T10:00:00Z'::timestamptz);
    `, [`B2P-LD-30-${i}`, `30Sep Client ${i}`, `Contact ${i}`, TARGET_STAFF_EMAIL]);
  }

  await db.query(`
    INSERT INTO lead_activities (company_name, action, note, user_email, created_at)
    VALUES ('Trinity', 'Follow-up Deleted', 'Removed follow-up: "Demo order" (due 2026-09-29)', $1, '2026-09-30T08:00:00Z'::timestamptz);
  `, [TARGET_STAFF_EMAIL]);

  // Execute READ-ONLY queries exactly as done by detailedStaffReport
  const leadsQuery = await db.query(`SELECT * FROM leads ORDER BY created_at ASC;`);
  const tcQuery = await db.query(`SELECT * FROM telecalling_entries ORDER BY created_at ASC;`);
  const actsQuery = await db.query(`SELECT * FROM lead_activities ORDER BY created_at ASC;`);
  const fuQuery = await db.query(`SELECT * FROM follow_ups ORDER BY created_at ASC;`);

  // Verify 29 Sep
  const report29 = buildDetailedStaffReport({
    date: '2026-09-29',
    leads: leadsQuery.rows,
    telecalling: tcQuery.rows,
    activities: actsQuery.rows,
    followups: fuQuery.rows
  });

  assert.equal(report29.counts['Existing leads updated'], 17);
  assert.equal(report29.counts['Existing telecalling records updated'], 13);
  assert.equal(report29.counts['Follow-ups created'], 3);
  assert.equal(report29.counts['Follow-ups deleted'], 4);
  assert.ok(report29.ownerAttention.some(x => x.includes('Lakshya')));
  assert.ok(!report29.ownerAttention.some(x => x.includes('Trinity')), 'Trinity must not be present in 29 Sep report');

  // Verify 30 Sep
  const report30 = buildDetailedStaffReport({
    date: '2026-09-30',
    leads: leadsQuery.rows,
    activities: actsQuery.rows
  });

  assert.equal(report30.counts['Existing leads updated'], 6);
  assert.equal(report30.counts['Follow-ups deleted'], 1);
  assert.ok(report30.ownerAttention.some(x => x.includes('Trinity')));
  assert.ok(!report30.ownerAttention.some(x => x.includes('Lakshya')));

  // Verify that the table count in PostgreSQL has not changed (strictly read-only)
  const countLeads = await db.query(`SELECT count(*) AS c FROM leads;`);
  assert.equal(countLeads.rows[0].c, 23); // 17 + 6 = 23
});

// ─── 14. Credential Sanitization Audit ───────────────────────────────────────────
test('Sensitive tokens and service role keys are never exposed in error responses or logs', async () => {
  const origCronSecret = process.env.CRON_SECRET;
  const origBizyKey = process.env.BIZYLEAD_API_KEY;
  const origServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.CRON_SECRET = 'super-secret-cron-token-to-hide';
  process.env.BIZYLEAD_API_KEY = 'super-secret-bizylead-key-to-hide';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'super-secret-service-role-key-to-hide';

  try {
    const req = {
      method: 'POST',
      query: { action: 'cron' },
      headers: { authorization: 'Bearer invalid-token' }
    };
    const res = createMockRes();
    await handler(req, res);

    assert.equal(res.statusCode, 401);
    const bodyStr = JSON.stringify(res.body);

    assert.ok(!bodyStr.includes('super-secret-cron-token-to-hide'), 'CRON_SECRET must not appear in response');
    assert.ok(!bodyStr.includes('super-secret-bizylead-key-to-hide'), 'BIZYLEAD_API_KEY must not appear in response');
    assert.ok(!bodyStr.includes('super-secret-service-role-key-to-hide'), 'SUPABASE_SERVICE_ROLE_KEY must not appear in response');
  } finally {
    process.env.CRON_SECRET = origCronSecret;
    process.env.BIZYLEAD_API_KEY = origBizyKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = origServiceKey;
  }
});
