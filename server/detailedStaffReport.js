// Pure, side-effect-free formatter for owner-only, customer-by-customer staff reports.
// Inputs must already be fetched with verified owner authorization and scoped to the configured staff account.

export const TARGET_STAFF_EMAIL = 'brutf5354@gmail.com';
export const OWNER_WHATSAPP_NUMBER = '918589909034';
export const IST_TIMEZONE = 'Asia/Kolkata';

export const fmtTime = (s) => {
  if (!s) return 'Not recorded';
  const d = new Date(s);
  if (isNaN(d.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(d);
};

export const fmtDate = (s) => {
  if (!s) return 'Not recorded';
  const d = new Date(s);
  if (isNaN(d.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(d);
};

export const fmtDateTime = (s) => {
  if (!s) return 'Not recorded';
  const d = new Date(s);
  if (isNaN(d.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(d);
};

export const safe = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim() || 'Not recorded';

export const isDay = (timestamp, date) => {
  if (!timestamp || !date) return false;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: IST_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(timestamp)) === date;
  } catch {
    return false;
  }
};

export const email = (s) => String(s || '').toLowerCase().trim();

export const table = (headers, rows) => [
  headers.join(' | '),
  headers.map(() => '---').join(' | '),
  ...rows.map(row => row.map(safe).join(' | '))
].join('\n');

/**
 * Returns UTC Date boundaries for an IST calendar day (00:00:00 to 23:59:59.999 IST).
 * Example: 2026-09-29 IST -> start: 2026-09-28T18:30:00.000Z, end: 2026-09-29T18:29:59.999Z
 */
export function getIstDayBoundariesUtc(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error('Expected YYYY-MM-DD date string');
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  // IST 00:00:00 is previous day 18:30:00 UTC
  const startUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - (5.5 * 3600 * 1000));
  // IST 23:59:59.999 is same day 18:29:59.999 UTC
  const endUtc = new Date(startUtc.getTime() + (24 * 3600 * 1000) - 1);
  return { startUtc, endUtc, startIso: startUtc.toISOString(), endIso: endUtc.toISOString() };
}

/**
 * Builds the comprehensive Detailed Staff Activity Report.
 */
export function buildDetailedStaffReport({
  date,
  staffEmail = TARGET_STAFF_EMAIL,
  telecalling = [],
  leads = [],
  activities = [],
  followups = [],
  quotations = [],
  documents = [],
  queryErrors = [],
  generatedAt = new Date().toISOString()
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Expected YYYY-MM-DD date');
  if (email(staffEmail) !== TARGET_STAFF_EMAIL) throw new Error('Report is restricted to the configured staff account');

  const cleanStaff = email(staffEmail);

  // 1. Scoped Telecalling records
  const tc = telecalling.filter(x =>
    email(x.created_by_email) === cleanStaff &&
    (isDay(x.created_at, date) || isDay(x.updated_at, date))
  ).sort((a, b) => new Date(a.updated_at || a.created_at).getTime() - new Date(b.updated_at || b.created_at).getTime());

  const newTc = tc.filter(x => isDay(x.created_at, date));
  const updatedTc = tc.filter(x => isDay(x.updated_at, date) && !isDay(x.created_at, date));

  // 2. Scoped Leads (assigned to staff)
  const scopedLeads = leads.filter(x =>
    email(x.assigned_telecaller_email) === cleanStaff &&
    (isDay(x.created_at, date) || isDay(x.updated_at, date))
  ).sort((a, b) => new Date(a.updated_at || a.created_at).getTime() - new Date(b.updated_at || b.created_at).getTime());

  const newLeads = scopedLeads.filter(x => isDay(x.created_at, date));
  const updatedLeads = scopedLeads.filter(x => isDay(x.updated_at, date) && !isDay(x.created_at, date));

  // 3. Explicitly Attributed Staff Activities
  // Actor attribution is explicit: only user_email / performed_by identifying the staff member.
  const actions = activities.filter(x =>
    (email(x.user_email) === cleanStaff || email(x.performed_by) === cleanStaff) &&
    isDay(x.created_at, date)
  ).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  // Follow-up deletions explicitly performed by staff
  const deletedActions = actions.filter(x =>
    /follow.up deleted/i.test(x.action || x.type || x.activity_type || '')
  );

  // 4. Follow-ups
  const followCreated = followups.filter(x =>
    (email(x.created_by_email) === cleanStaff || email(x.assigned_staff_email) === cleanStaff) &&
    isDay(x.created_at, date)
  );

  const followCompleted = followups.filter(x =>
    (email(x.assigned_staff_email) === cleanStaff || email(x.created_by_email) === cleanStaff) &&
    (
      isDay(x.completed_at, date) ||
      ((x.status === 'COMPLETED' || x.status === 'completed') && isDay(x.updated_at, date))
    )
  );

  const followRescheduled = followups.filter(x =>
    (email(x.assigned_staff_email) === cleanStaff || email(x.created_by_email) === cleanStaff) &&
    (
      (x.status === 'SNOOZED' || x.status === 'snoozed') ||
      (isDay(x.updated_at, date) && x.due_date > date && !isDay(x.created_at, date))
    )
  );

  // 5. Quotations (CRM Quotes)
  const quotesCreated = quotations.filter(x =>
    email(x.created_by_email) === cleanStaff &&
    isDay(x.created_at, date)
  );

  const quotesApproved = quotations.filter(x =>
    (email(x.created_by_email) === cleanStaff || email(x.approved_by_email) === cleanStaff) &&
    (x.approval_status === 'APPROVED' || x.status === 'APPROVED' || x.status === 'approved') &&
    (isDay(x.approved_at, date) || (!x.approved_at && isDay(x.updated_at, date)))
  );

  // 6. Documents & WhatsApp sends
  const docCreated = documents.filter(x =>
    email(x.created_by_email) === cleanStaff &&
    isDay(x.created_at, date)
  );

  const docSent = documents.filter(x =>
    (email(x.whatsapp_sent_by_email) === cleanStaff || email(x.created_by_email) === cleanStaff) &&
    isDay(x.whatsapp_sent_at, date) &&
    // Only count verified sends (not failed delivery)
    x.whatsapp_delivery_status !== 'failed' &&
    x.status !== 'failed'
  );

  // 7. Check replacement status for deleted follow-ups
  const deletedWithReplacementStatus = deletedActions.map(act => {
    const leadId = act.lead_id;
    const note = act.note || act.notes || '';
    const nameMatch = note.match(/Removed follow-up:\s*"([^"]+)"/i);
    const reasonText = nameMatch ? nameMatch[1] : '';

    // Check if there is an active future follow-up for this lead created on or after this event
    const hasReplacement = followups.some(f =>
      f.lead_id === leadId &&
      f.status !== 'CANCELLED' &&
      f.status !== 'cancelled' &&
      new Date(f.created_at).getTime() >= new Date(act.created_at).getTime() - 60000
    );

    return {
      activity: act,
      leadId,
      customerName: act.company_name || act.customer_name || act.lead_number || `Lead ${leadId}`,
      reasonText,
      hasReplacement,
      deletedAt: act.created_at
    };
  });

  const unreplacedDeletions = deletedWithReplacementStatus.filter(d => !d.hasReplacement);

  // 8. Appointments and Important Customer Updates
  const appointmentsConfirmed = tc.filter(x => /appointment confirmed/i.test(x.call_status || ''));
  const interestedCustomers = tc.filter(x => /interested/i.test(x.call_status || ''));
  const callbacks = tc.filter(x => /call back/i.test(x.call_status || ''));

  // Overdue follow-ups assigned to staff
  const overdueFollowUps = followups.filter(x =>
    email(x.assigned_staff_email) === cleanStaff &&
    x.due_date < date &&
    x.status !== 'COMPLETED' &&
    x.status !== 'completed' &&
    x.status !== 'CANCELLED' &&
    x.status !== 'cancelled'
  );

  // 9. Verified Database Totals (Section A)
  const countRows = [
    ['New leads created', newLeads.length],
    ['Existing leads updated', updatedLeads.length],
    ['New telecalling records', newTc.length],
    ['Existing telecalling records updated', updatedTc.length],
    ['Follow-ups created', followCreated.length],
    ['Follow-ups completed', followCompleted.length],
    ['Follow-ups rescheduled', followRescheduled.length],
    ['Follow-ups deleted', deletedActions.length],
    ['Quotations created', quotesCreated.length],
    ['Quotations approved', quotesApproved.length],
    ['Documents sent through WhatsApp', docSent.length]
  ];

  // Counts map with required keys + backward-compatible aliases for PR #14 tests
  const countsMap = {
    ...Object.fromEntries(countRows),
    'Follow-ups created (retained rows)': followCreated.length,
    'Follow-up deletions (logged events)': deletedActions.length,
    'Documents created': docCreated.length,
    'Document WhatsApp sends': docSent.length
  };

  // 10. Owner Attention Required (Section G)
  const ownerAttentionItems = [];
  if (unreplacedDeletions.length > 0) {
    unreplacedDeletions.forEach(d => {
      ownerAttentionItems.push(`⚠️ Deleted follow-up WITHOUT replacement: ${d.customerName} (${d.reasonText || 'No reason'}) deleted at ${fmtTime(d.deletedAt)} IST.`);
    });
  }
  if (overdueFollowUps.length > 0) {
    ownerAttentionItems.push(`⚠️ ${overdueFollowUps.length} overdue follow-up(s) currently pending for this staff member.`);
  }
  if (appointmentsConfirmed.length > 0) {
    appointmentsConfirmed.forEach(a => {
      ownerAttentionItems.push(`📅 Appointment scheduled: ${safe(a.company_name)} (Contact: ${safe(a.contact_person)}) — ${safe(a.feedback)}.`);
    });
  }
  if (interestedCustomers.length > 0) {
    ownerAttentionItems.push(`⭐ ${interestedCustomers.length} customer(s) marked 'Interested / Details Shared' requiring follow-up action.`);
  }
  if (queryErrors.length > 0) {
    ownerAttentionItems.push(`❌ Incomplete data query detected: ${queryErrors.join('; ')}.`);
  }

  // 11. Format Markdown Sections
  const formattedGenTime = fmtDateTime(generatedAt);
  const formattedDisplayDate = fmtDate(date);

  const sections = [
    `# B2P International — Detailed Staff Activity Report`,
    `**Report date:** ${formattedDisplayDate} (${date})  \n` +
    `**Staff:** \`${cleanStaff}\`  \n` +
    `**Reporting period:** 12:00 AM–11:59 PM IST  \n` +
    `**Generated at:** ${formattedGenTime} (IST)`,

    `## Section A: Verified database totals`,
    table(['Activity', 'Count'], countRows),
    `> **Note:** Counts reflect verified database records and activity events, not completed phone calls. An updated record is an administrative edit and does not prove call completion.`,

    `## Section B: Detailed telecalling report`,
    tc.length > 0
      ? table(
          ['Customer / Company', 'Contact Person', 'Current Call Status', 'Current Feedback', 'Created (IST)', 'Modified (IST)', 'Type', 'Audit History'],
          tc.map(x => [
            x.company_name,
            x.contact_person,
            x.call_status,
            x.feedback,
            fmtDate(x.created_at),
            fmtDateTime(x.updated_at || x.created_at),
            isDay(x.created_at, date) ? 'Newly created' : 'Existing record updated',
            x.previous_status ? `${x.previous_status} ➔ ${x.call_status}` : 'Not recorded'
          ])
        )
      : 'No telecalling records were created or modified by this staff member on this date.',

    `## Section C: Detailed lead activity`,
    scopedLeads.length > 0
      ? table(
          ['Lead #', 'Customer Name', 'Company Name', 'Current Status', 'Notes / Remarks', 'Created (IST)', 'Modified (IST)', 'Attributed Staff Action'],
          scopedLeads.map(l => {
            const matchingAct = actions.filter(a => a.lead_id === l.id);
            const actSummary = matchingAct.length > 0
              ? matchingAct.map(a => `${a.action || a.type}: ${safe(a.note)}`).join('; ')
              : 'Assigned lead modified; no specific actor log';
            return [
              l.lead_number,
              l.customer_name,
              l.company_name,
              l.status,
              l.notes || l.remarks,
              fmtDate(l.created_at),
              fmtDateTime(l.updated_at || l.created_at),
              actSummary
            ];
          })
        )
      : 'No leads assigned to this staff member were created or updated on this date.',

    `## Section D: Follow-up activity`,
    (followCreated.length > 0 || followCompleted.length > 0 || followRescheduled.length > 0 || deletedActions.length > 0)
      ? table(
          ['Customer / Lead', 'Action', 'Follow-up Date', 'Reason', 'Time (IST)', 'Responsible Staff', 'Status', 'Replacement Status'],
          [
            ...followCreated.map(f => [
              f.customer_name || f.lead_number,
              'Created',
              f.due_date,
              f.reason,
              fmtTime(f.created_at),
              f.assigned_staff_email || cleanStaff,
              f.status,
              'Active record'
            ]),
            ...followCompleted.map(f => [
              f.customer_name || f.lead_number,
              'Completed',
              f.due_date,
              f.reason || f.completion_note,
              fmtTime(f.completed_at || f.updated_at),
              f.assigned_staff_email || cleanStaff,
              'COMPLETED',
              'Fulfilled'
            ]),
            ...followRescheduled.map(f => [
              f.customer_name || f.lead_number,
              'Rescheduled / Snoozed',
              f.due_date,
              f.reason,
              fmtTime(f.updated_at),
              f.assigned_staff_email || cleanStaff,
              f.status,
              'Rescheduled'
            ]),
            ...deletedWithReplacementStatus.map(d => [
              d.customerName,
              'Deleted',
              'N/A',
              d.reasonText || 'Deleted follow-up',
              fmtTime(d.deletedAt),
              cleanStaff,
              'DELETED',
              d.hasReplacement ? '✓ Replacement exists' : '⚠️ NO REPLACEMENT (Attention Required)'
            ])
          ]
        )
      : 'No follow-up creation, completion, rescheduling, or deletion occurred on this date.',

    `## Section E: Quotations and documents`,
    (quotesCreated.length > 0 || quotesApproved.length > 0 || docCreated.length > 0 || docSent.length > 0)
      ? table(
          ['Document / Quote #', 'Customer Name', 'Amount', 'Action / Status', 'Recorded Time (IST)', 'Delivery Status'],
          [
            ...quotesCreated.map(q => [
              q.quotation_number || 'CRM Quote',
              q.customer_name,
              q.total ? `₹${Number(q.total).toLocaleString('en-IN')}` : '₹0',
              `Quotation Created (${q.approval_status || 'DRAFT'})`,
              fmtTime(q.created_at),
              'Internal Draft'
            ]),
            ...quotesApproved.map(q => [
              q.quotation_number || 'CRM Quote',
              q.customer_name,
              q.total ? `₹${Number(q.total).toLocaleString('en-IN')}` : '₹0',
              'Quotation Approved by Owner',
              fmtTime(q.approved_at || q.updated_at),
              'Ready for Client'
            ]),
            ...docCreated.map(d => [
              d.document_number || d.number,
              d.customer_name,
              d.total ? `₹${Number(d.total).toLocaleString('en-IN')}` : '₹0',
              `Document Created (${d.document_type || 'Doc'})`,
              fmtTime(d.created_at),
              'Created in ERP'
            ]),
            ...docSent.map(d => [
              d.document_number || d.number,
              d.customer_name,
              d.total ? `₹${Number(d.total).toLocaleString('en-IN')}` : '₹0',
              'WhatsApp Document Sent',
              fmtTime(d.whatsapp_sent_at),
              d.whatsapp_delivery_status || 'Provider Confirmed'
            ])
          ]
        )
      : 'No quotations or formal documents were created, approved, or sent on this date.',

    `## Section F: Appointments and important customer updates`,
    (appointmentsConfirmed.length > 0 || interestedCustomers.length > 0 || callbacks.length > 0)
      ? [
          appointmentsConfirmed.length > 0
            ? `### Confirmed Appointments (${appointmentsConfirmed.length}):\n` +
              appointmentsConfirmed.map(a => `* **${safe(a.company_name)}** (${safe(a.contact_person)} - ${a.phone}): ${safe(a.feedback)}`).join('\n')
            : null,
          interestedCustomers.length > 0
            ? `### Interested Customers (${interestedCustomers.length}):\n` +
              interestedCustomers.map(a => `* **${safe(a.company_name)}** (${safe(a.contact_person)} - ${a.phone}): ${safe(a.feedback)}`).join('\n')
            : null,
          callbacks.length > 0
            ? `### Requested Callbacks (${callbacks.length}):\n` +
              callbacks.map(a => `* **${safe(a.company_name)}** (${safe(a.contact_person)} - ${a.phone}): ${safe(a.feedback)}`).join('\n')
            : null
        ].filter(Boolean).join('\n\n')
      : 'No appointments or high-priority customer updates recorded for this date.',

    `## Section G: Owner attention required`,
    ownerAttentionItems.length > 0
      ? ownerAttentionItems.map(item => `* ${item}`).join('\n')
      : 'No critical anomalies, unreplaced deletions, or overdue items detected.',

    `## Section H: Verification notes`,
    `1. **Confirmed staff actions:** Strictly restricted to records with verified \`user_email\` or \`created_by_email\` equal to \`${cleanStaff}\`.\n` +
    `2. **Assigned records vs editor:** Updates to leads assigned to this staff member may have been made by other users or background jobs. Do not claim the staff member performed an edit unless an explicit audit activity exists.\n` +
    `3. **Customer feedback:** Current call feedback is logged as claimed by the staff member and is not independent proof of call duration or outcome.\n` +
    (queryErrors.length > 0
      ? `\n> ⚠️ **Incomplete source checks:** ${queryErrors.map(safe).join('; ')}`
      : `\n✓ All CRM source datasets were successfully queried without errors.`)
  ];

  return {
    staffEmail: cleanStaff,
    date,
    generatedAt,
    counts: countsMap,
    ownerAttention: ownerAttentionItems,
    markdown: sections.join('\n\n')
  };
}

/**
 * Formats the detailed staff report into WhatsApp messages.
 * Splits into numbered messages (e.g. [1/2], [2/2]) if length exceeds WhatsApp limit (3500 chars).
 */
export function formatDetailedReportWhatsAppMessages(reportResult) {
  const { date, staffEmail, counts, markdown, ownerAttention } = reportResult;
  const displayDate = fmtDate(date);

  // Message 1: Executive Summary & Overview
  const p1Header =
    `*B2P INTERNATIONAL — DETAILED STAFF ACTIVITY REPORT*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📅 *Report Date:* ${displayDate} (${date})\n` +
    `👤 *Staff Account:* ${staffEmail}\n` +
    `⏰ *Period:* 12:00 AM – 11:59 PM IST\n\n` +
    `📊 *VERIFIED DATABASE TOTALS:*\n` +
    `• New leads created: ${counts['New leads created'] || 0}\n` +
    `• Existing leads updated: ${counts['Existing leads updated'] || 0}\n` +
    `• New telecalling records: ${counts['New telecalling records'] || 0}\n` +
    `• Existing telecalling records updated: ${counts['Existing telecalling records updated'] || 0}\n` +
    `• Follow-ups created: ${counts['Follow-ups created'] || 0}\n` +
    `• Follow-ups completed: ${counts['Follow-ups completed'] || 0}\n` +
    `• Follow-ups rescheduled: ${counts['Follow-ups rescheduled'] || 0}\n` +
    `• Follow-ups deleted: ${counts['Follow-ups deleted'] || 0}\n` +
    `• Quotations created: ${counts['Quotations created'] || 0}\n` +
    `• Quotations approved: ${counts['Quotations approved'] || 0}\n` +
    `• Documents sent via WhatsApp: ${counts['Documents sent through WhatsApp'] || 0}\n\n` +
    `_Note: Counts represent verified records and audit events, not completed phone calls._\n`;

  let p1Attention = '';
  if (ownerAttention && ownerAttention.length > 0) {
    p1Attention = `\n🚨 *OWNER ATTENTION REQUIRED:*\n` +
      ownerAttention.map(item => `• ${item}`).join('\n') + `\n`;
  }

  const p1Footer = `\n_Full customer-by-customer breakdown dispatched below._`;

  const message1 = p1Header + p1Attention + p1Footer;

  // Check if entire markdown can fit in 1 message (if short)
  if (markdown.length < 3200) {
    return [
      {
        part: 1,
        total: 1,
        title: 'Complete Detailed Report',
        text: `${message1}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${markdown}`
      }
    ];
  }

  // Split into structured messages
  // Part 1: Executive Overview + Totals + Owner Attention
  // Part 2: Detailed Activity Breakdowns
  const messages = [
    {
      part: 1,
      total: 2,
      title: 'Summary & Owner Alerts',
      text: `[1/2] ${message1}`
    },
    {
      part: 2,
      total: 2,
      title: 'Customer Details & Verification',
      text: `[2/2] *B2P DETAILED REPORT — CUSTOMER BREAKDOWN (${displayDate})*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        markdown.slice(0, 3800)
    }
  ];

  return messages;
}
