import type { Lead, LeadActivity, CallOutcome, LeadStatus } from '../types';
import { leadService } from './leadService';
import { officeService } from './officeService';
import { metricsService } from './metricsService';
import { errorService } from './errorService';
import { 
  getIstTodayDateStr, 
  getIstDateStr, 
  formatIstTime, 
  formatIstDateTime,
  isTimestampOnIstDate,
  parseFlexibleDateToIso 
} from '../utils/dateUtils';
import { formatStaffDisplayName } from '../utils/staffUtils';

export interface LogCallResultResult {
  lead: Lead;
  activity: LeadActivity;
  followUpError?: string;
}

export interface LogCallResultParams {
  leadId: string;
  telecallerEmail: string;
  callOutcome: CallOutcome;
  remarks: string;
  submissionToken?: string;
  contactPerson?: string;
  phoneUsed?: string;
  alternatePhone?: string;
  email?: string;
  location?: string;
  serviceRequired?: string;
  statusOverride?: LeadStatus;
  followUpDate?: string; // YYYY-MM-DD
  followUpTime?: string; // HH:mm
  followUpReason?: string;
}

export interface TelecallerDayStats {
  email: string;
  name: string;
  assigned: number;
  called: number;
  remaining: number;
  totalCalls: number;
  connected: number;
  noAnswer: number;
  notReachable: number;
  switchedOff: number;
  invalid: number;
  interested: number;
  notInterested: number;
  followUpsCreated: number;
  requirementsCollected: number;
  appointments: number;
  meetings: number;
  detailsSent: number;
  other: number;
}

export interface DetailedCallActivityItem {
  id: string;
  timeStr: string;
  istDateTimeStr: string;
  createdAt: string;
  leadId: string;
  companyName: string;
  contactPerson: string;
  phone: string;
  telecallerEmail: string;
  telecallerName: string;
  outcome: CallOutcome | string;
  remarks: string;
  nextFollowUpAt?: string;
}

export interface DailyActivityReportData {
  dateStr: string;
  selectedStaff: string;
  overall: {
    assigned: number;
    called: number;
    remaining: number;
    totalActivities: number;
    totalCalls: number;
    connected: number;
    noAnswer: number;
    notReachable: number;
    switchedOff: number;
    invalid: number;
    interested: number;
    notInterested: number;
    followUpsCreated: number;
    requirementsCollected: number;
    appointments: number;
    meetings: number;
    detailsSent: number;
    other: number;
  };
  telecallers: TelecallerDayStats[];
  activityTimeline: DetailedCallActivityItem[];
  pendingWork: {
    uncontactedLeads: Lead[];
    followUpsDueTomorrow: any[];
    overdueFollowUps: any[];
    interestedRequiringAttention: Lead[];
    appointmentsScheduled: any[];
  };
}

export interface ImportedLeadRow {
  company_name: string;
  customer_name?: string;
  phone: string;
  alternate_phone?: string;
  email?: string;
  location?: string;
  date?: string;
  remarks?: string;
}

export interface ImportPreviewResult {
  totalRows: number;
  newRows: ImportedLeadRow[];
  duplicateRows: { row: ImportedLeadRow; existingLead: Lead; matchReason: string }[];
}

/**
 * Maps unstructured feedback remarks from Excel into structured CallOutcome
 */
export function mapRemarkToOutcome(rawRemark?: string | null): CallOutcome {
  if (!rawRemark) return 'Other';
  const clean = rawRemark.trim().toLowerCase();

  if (clean.includes('no answer') || clean === 'na') return 'No Answer';
  if (clean.includes('no response')) return 'No Response';
  if (clean.includes('not reachable') || clean.includes('unreachable')) return 'Not Reachable';
  if (clean.includes('switched off') || clean.includes('switch off')) return 'Switched Off';
  if (clean.includes('invalid') || clean.includes('wrong number') || clean.includes('not working')) return 'Invalid Number';
  if (clean.includes('not interested') || clean.includes('dont call')) return 'Not Interested';
  if (clean.includes('appointment confirmed') || clean.includes('confirmed appointment')) return 'Appointment Confirmed';
  if (clean.includes('meeting scheduled') || clean.includes('meeting fixed') || clean.includes('meeting')) return 'Meeting Scheduled';
  if (clean.includes('call back') || clean.includes('call again') || clean.includes('call later')) return 'Call Back';
  if (clean.includes('follow up') || clean.includes('followup')) return 'Follow-up Required';
  if (clean.includes('requirement collected') || clean.includes('spec collected')) return 'Requirement Collected';
  if (clean.includes('details sent') || clean.includes('whatsapp sent') || clean.includes('brochure sent')) return 'Details Sent';
  if (clean.includes('existing agency') || clean.includes('already have')) return 'Existing Agency';
  if (clean.includes('contact person') || clean.includes('number expected')) return 'Contact Person Needed';
  if (clean.includes('interested') || clean.includes('spoke with owner')) return 'Interested';

  return 'Other';
}

/**
 * Determines appropriate lead pipeline status based on call outcome
 */
export function determineLeadStatusFromOutcome(outcome: CallOutcome, currentStatus: LeadStatus): LeadStatus {
  switch (outcome) {
    case 'Interested':
      return currentStatus === 'new' ? 'telecaller_working' : currentStatus;
    case 'Requirement Collected':
      return 'requirement_collected';
    case 'Appointment Confirmed':
    case 'Meeting Scheduled':
      return 'telecaller_working';
    case 'Follow-up Required':
    case 'Call Back':
      return 'follow_up';
    case 'Not Interested':
    case 'Invalid Number':
      return currentStatus === 'confirmed' ? currentStatus : 'lost';
    case 'Connected':
    case 'Details Sent':
    case 'Contact Person Needed':
    case 'Existing Agency':
    case 'No Answer':
    case 'No Response':
    case 'Not Reachable':
    case 'Switched Off':
    case 'Other':
      return currentStatus === 'new' ? 'telecaller_working' : currentStatus;
    default:
      return currentStatus;
  }
}

/**
 * Normalizes phone numbers for duplicate detection (keeps digits, extracts last 10)
 */
export function normalizePhoneForLookup(rawPhone?: string | null): string {
  if (!rawPhone) return '';
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits;
}

const inFlightSubmissions = new Set<string>();
const recentSuccessfulSubmissions = new Map<string, { lead: Lead; activity: LeadActivity; timestamp: number }>();

export const telecallingService = {
  /**
   * Log the result of a telecalling call.
   * 1. Checks idempotency (token & network retry deduplication)
   * 2. Creates a permanent activity in lead_activities
   * 3. Updates current lead record (status, last_call_*, call_count)
   * 4. Creates/links a FollowUp if scheduled (non-blocking with partial error recovery)
   * 5. Triggers metrics notification
   */
  async logCallResult(params: LogCallResultParams): Promise<LogCallResultResult> {
    // 0. Idempotency Check: if submissionToken was already processed, return cached result immediately
    if (params.submissionToken && recentSuccessfulSubmissions.has(params.submissionToken)) {
      const cached = recentSuccessfulSubmissions.get(params.submissionToken)!;
      return { lead: cached.lead, activity: cached.activity };
    }

    if (inFlightSubmissions.has(params.leadId)) {
      throw new Error('A call save for this contact is already in progress. Please wait.');
    }
    inFlightSubmissions.add(params.leadId);

    try {
      const lead = leadService.getLeadById(params.leadId);
      if (!lead) {
        throw new Error(`Lead with id ${params.leadId} not found`);
      }

      // Secondary Network Retry Idempotency:
      // If the save succeeded on server but network response was lost, and user retries:
      // Detect if an identical call was already recorded for this lead within the last 60 seconds.
      if (
        lead.last_call_at &&
        lead.last_call_outcome === params.callOutcome &&
        lead.last_call_remark === params.remarks &&
        lead.last_contacted_by_email === params.telecallerEmail
      ) {
        const diffMs = Math.abs(Date.now() - new Date(lead.last_call_at).getTime());
        if (diffMs < 60000) {
          const acts = leadService.getLeadActivities(lead.id);
          const recentAct = acts.find(a => 
            a.activity_type === 'call' && 
            a.call_outcome === params.callOutcome &&
            Math.abs(new Date(a.created_at).getTime() - new Date(lead.last_call_at!).getTime()) < 10000
          );
          if (recentAct) {
            if (params.submissionToken) {
              recentSuccessfulSubmissions.set(params.submissionToken, { lead, activity: recentAct, timestamp: Date.now() });
            }
            return { lead, activity: recentAct };
          }
        }
      }

      const nowIso = new Date().toISOString();
      const nextStatus = params.statusOverride || determineLeadStatusFromOutcome(params.callOutcome, lead.status);

      let nextFollowUpIso: string | undefined = undefined;
      if (params.followUpDate) {
        const time = params.followUpTime || '10:00';
        nextFollowUpIso = `${params.followUpDate}T${time}:00`;
      }

      // 1. Create immutable call activity
      const activity = await leadService.addLeadActivity({
        lead_id: lead.id,
        company_id: lead.company_id,
        user_email: params.telecallerEmail,
        action: 'Call Completed',
        activity_type: 'call',
        call_outcome: params.callOutcome,
        phone_used: params.phoneUsed || lead.phone,
        contact_person: params.contactPerson || lead.customer_name,
        note: params.remarks,
        next_follow_up_at: nextFollowUpIso,
        previous_status: lead.status,
        new_status: nextStatus
      });

      // 2. Update Lead current state
      const updatedLeadPayload: Partial<Lead> & { customer_name: string; phone: string } = {
        ...lead,
        customer_name: params.contactPerson ? params.contactPerson.trim() : lead.customer_name,
        alternate_phone: params.alternatePhone !== undefined ? params.alternatePhone.trim() : lead.alternate_phone,
        email: params.email !== undefined ? params.email.trim() : lead.email,
        location: params.location !== undefined ? params.location.trim() : lead.location,
        service_required: params.serviceRequired !== undefined ? params.serviceRequired.trim() : lead.service_required,
        status: nextStatus,
        last_call_at: nowIso,
        last_call_outcome: params.callOutcome,
        last_call_remark: params.remarks,
        call_count: (lead.call_count || 0) + 1,
        last_contacted_by_email: params.telecallerEmail,
        next_follow_up_at: nextFollowUpIso || lead.next_follow_up_at
      };

      const savedLead = await leadService.saveLead(updatedLeadPayload, params.telecallerEmail);

      // 3. Create FollowUp if followUpDate was provided (isolated so follow-up issues don't lose the call activity)
      let followUpError: string | undefined = undefined;
      if (params.followUpDate) {
        try {
          await officeService.saveFollowUp({
            company_id: lead.company_id,
            lead_id: lead.id,
            lead_number: lead.lead_number,
            customer_name: savedLead.customer_name,
            company_name: savedLead.company_name,
            phone: savedLead.phone,
            assigned_staff_email: params.telecallerEmail,
            due_date: params.followUpDate,
            due_time: params.followUpTime || '10:00',
            reason: params.followUpReason || `Follow-up on call (${params.callOutcome})`,
            notes: params.remarks,
            status: 'PENDING'
          }, params.telecallerEmail);
        } catch (fuErr: any) {
          followUpError = fuErr.message || 'Follow-up creation failed';
          console.error('[telecallingService] Follow-up scheduling failed:', fuErr);
          await errorService.logError({
            userEmail: params.telecallerEmail,
            operation: 'save_follow_up',
            errorMessage: followUpError || 'Failed to schedule follow-up',
            companyId: lead.company_id,
            leadId: lead.id,
            screen: 'CallEntryModal',
            metadata: {
              dueDate: params.followUpDate,
              dueTime: params.followUpTime,
              reason: params.followUpReason
            }
          });
        }
      }

      if (params.submissionToken) {
        recentSuccessfulSubmissions.set(params.submissionToken, { lead: savedLead, activity, timestamp: Date.now() });
      }

      metricsService.notifyChange();
      return { lead: savedLead, activity, followUpError };
    } catch (err: any) {
      await errorService.logError({
        userEmail: params.telecallerEmail,
        operation: 'log_call_result',
        errorMessage: err.message || 'Failed to record call result',
        leadId: params.leadId,
        screen: 'CallEntryModal',
        metadata: { outcome: params.callOutcome }
      });
      throw err;
    } finally {
      inFlightSubmissions.delete(params.leadId);
    }
  },

  /**
   * Retries scheduling a follow-up without re-logging the call activity or incrementing call_count.
   */
  async retryFollowUp(params: {
    leadId: string;
    telecallerEmail: string;
    dueDate: string;
    dueTime?: string;
    reason?: string;
    notes?: string;
  }): Promise<void> {
    const lead = leadService.getLeadById(params.leadId);
    if (!lead) {
      throw new Error(`Lead with id ${params.leadId} not found`);
    }

    const time = params.dueTime || '10:00';
    const nextFollowUpIso = `${params.dueDate}T${time}:00`;

    try {
      await officeService.saveFollowUp({
        company_id: lead.company_id,
        lead_id: lead.id,
        lead_number: lead.lead_number,
        customer_name: lead.customer_name,
        company_name: lead.company_name,
        phone: lead.phone,
        assigned_staff_email: params.telecallerEmail,
        due_date: params.dueDate,
        due_time: time,
        reason: params.reason || `Follow-up scheduled`,
        notes: params.notes || lead.last_call_remark,
        status: 'PENDING'
      }, params.telecallerEmail);

      await leadService.saveLead({
        ...lead,
        next_follow_up_at: nextFollowUpIso
      }, params.telecallerEmail);

      metricsService.notifyChange();
    } catch (err: any) {
      await errorService.logError({
        userEmail: params.telecallerEmail,
        operation: 'retry_follow_up',
        errorMessage: err.message || 'Retry follow-up failed',
        companyId: lead.company_id,
        leadId: lead.id,
        screen: 'CallEntryModal'
      });
      throw err;
    }
  },

  /**
   * Generates End-of-Day and Daily Activity Report strictly in Asia/Kolkata timezone.
   */
  getDailyActivityReport(dateInput?: string, staffFilter?: string): DailyActivityReportData {
    const targetDateStr = dateInput || getIstTodayDateStr();
    const leads = leadService.getLeads();
    const allActivities = leadService.getLeadActivities(''); // all activities
    const allFollowUps = officeService.getFollowUps('all');

    // Filter activities belonging to target date in Asia/Kolkata
    const dayActivities = allActivities.filter(a => isTimestampOnIstDate(a.created_at, targetDateStr));

    // Get list of telecallers active or assigned
    const staffEmailSet = new Set<string>();
    leads.forEach(l => {
      if (l.assigned_telecaller_email) {
        staffEmailSet.add(l.assigned_telecaller_email.toLowerCase().trim());
      }
    });
    dayActivities.forEach(a => {
      if (a.user_email) {
        staffEmailSet.add(a.user_email.toLowerCase().trim());
      }
    });

    const staffEmails = Array.from(staffEmailSet);

    // Filtered by selectedStaff if requested
    const filteredActivities = staffFilter && staffFilter !== 'all'
      ? dayActivities.filter(a => (a.user_email || '').toLowerCase().trim() === staffFilter.toLowerCase().trim())
      : dayActivities;

    // Helper to calculate telecaller stats
    const calculateStaffStats = (email: string): TelecallerDayStats => {
      const cleanEmail = email.toLowerCase().trim();
      const staffLeads = leads.filter(l => (l.assigned_telecaller_email || '').toLowerCase().trim() === cleanEmail);
      const staffActs = dayActivities.filter(a => (a.user_email || '').toLowerCase().trim() === cleanEmail);

      const callsOnly = staffActs.filter(a => a.activity_type === 'call' || Boolean(a.call_outcome));
      const calledLeadIds = new Set(callsOnly.map(a => a.lead_id));

      const countOutcome = (o: CallOutcome) => callsOnly.filter(a => a.call_outcome === o).length;

      const connected = callsOnly.filter(a => [
        'Connected', 'Interested', 'Requirement Collected', 'Appointment Confirmed', 
        'Meeting Scheduled', 'Existing Agency', 'Call Back', 'Details Sent'
      ].includes(a.call_outcome as string)).length;

      const followUpsCreated = staffActs.filter(a => Boolean(a.next_follow_up_at) || a.action === 'Follow-up Scheduled').length;

      return {
        email,
        name: formatStaffDisplayName(email),
        assigned: staffLeads.length,
        called: calledLeadIds.size,
        remaining: Math.max(0, staffLeads.length - calledLeadIds.size),
        totalCalls: callsOnly.length,
        connected,
        noAnswer: countOutcome('No Answer'),
        notReachable: countOutcome('Not Reachable'),
        switchedOff: countOutcome('Switched Off'),
        invalid: countOutcome('Invalid Number'),
        interested: countOutcome('Interested'),
        notInterested: countOutcome('Not Interested'),
        followUpsCreated,
        requirementsCollected: countOutcome('Requirement Collected'),
        appointments: countOutcome('Appointment Confirmed'),
        meetings: countOutcome('Meeting Scheduled'),
        detailsSent: countOutcome('Details Sent'),
        other: countOutcome('Other') + countOutcome('Contact Person Needed') + countOutcome('Existing Agency') + countOutcome('No Response')
      };
    };

    const telecallersStats = staffEmails.map(calculateStaffStats);

    // Build overall summary
    const overallCallsOnly = filteredActivities.filter(a => a.activity_type === 'call' || Boolean(a.call_outcome));
    const overallCalledLeadIds = new Set(overallCallsOnly.map(a => a.lead_id));
    const scopedLeads = staffFilter && staffFilter !== 'all'
      ? leads.filter(l => (l.assigned_telecaller_email || '').toLowerCase().trim() === staffFilter.toLowerCase().trim())
      : leads;

    const countOverallOutcome = (o: CallOutcome) => overallCallsOnly.filter(a => a.call_outcome === o).length;
    const overallConnected = overallCallsOnly.filter(a => [
      'Connected', 'Interested', 'Requirement Collected', 'Appointment Confirmed', 
      'Meeting Scheduled', 'Existing Agency', 'Call Back', 'Details Sent'
    ].includes(a.call_outcome as string)).length;

    const overall = {
      assigned: scopedLeads.length,
      called: overallCalledLeadIds.size,
      remaining: Math.max(0, scopedLeads.length - overallCalledLeadIds.size),
      totalActivities: filteredActivities.length,
      totalCalls: overallCallsOnly.length,
      connected: overallConnected,
      noAnswer: countOverallOutcome('No Answer'),
      notReachable: countOverallOutcome('Not Reachable'),
      switchedOff: countOverallOutcome('Switched Off'),
      invalid: countOverallOutcome('Invalid Number'),
      interested: countOverallOutcome('Interested'),
      notInterested: countOverallOutcome('Not Interested'),
      followUpsCreated: filteredActivities.filter(a => Boolean(a.next_follow_up_at) || a.action === 'Follow-up Scheduled').length,
      requirementsCollected: countOverallOutcome('Requirement Collected'),
      appointments: countOverallOutcome('Appointment Confirmed'),
      meetings: countOverallOutcome('Meeting Scheduled'),
      detailsSent: countOverallOutcome('Details Sent'),
      other: countOverallOutcome('Other') + countOverallOutcome('Contact Person Needed') + countOverallOutcome('Existing Agency') + countOverallOutcome('No Response')
    };

    // Lead Map for fast lookup in timeline
    const leadMap = new Map(leads.map(l => [l.id, l]));

    // Build detailed activity timeline (sorted latest first)
    const activityTimeline: DetailedCallActivityItem[] = filteredActivities
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map(act => {
        const matchingLead = leadMap.get(act.lead_id);
        return {
          id: act.id,
          timeStr: formatIstTime(act.created_at),
          istDateTimeStr: formatIstDateTime(act.created_at),
          createdAt: act.created_at,
          leadId: act.lead_id,
          companyName: matchingLead?.company_name || matchingLead?.customer_name || 'Unknown Company',
          contactPerson: act.contact_person || matchingLead?.customer_name || 'Contact',
          phone: act.phone_used || matchingLead?.phone || '—',
          telecallerEmail: act.user_email,
          telecallerName: formatStaffDisplayName(act.user_email),
          outcome: act.call_outcome || act.action || 'Call',
          remarks: act.note || '—',
          nextFollowUpAt: act.next_follow_up_at
        };
      });

    // End-of-Day Pending Work
    // 1. Uncontacted leads today
    const uncontactedLeads = scopedLeads.filter(l => !overallCalledLeadIds.has(l.id));

    // 2. Follow-ups due tomorrow in IST
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = getIstDateStr(tomorrow);
    const followUpsDueTomorrow = allFollowUps.filter(f => f.status === 'PENDING' && f.due_date === tomorrowStr);

    // 3. Overdue follow-ups in IST
    const todayStr = getIstTodayDateStr();
    const overdueFollowUps = allFollowUps.filter(f => f.status === 'PENDING' && f.due_date < todayStr);

    // 4. Interested leads requiring attention (marked interested or working without quote)
    const interestedRequiringAttention = scopedLeads.filter(l => 
      (l.last_call_outcome === 'Interested' || l.status === 'requirement_collected') &&
      l.status !== 'confirmed' && l.status !== 'lost'
    );

    // 5. Scheduled appointments
    const appointmentsScheduled = allFollowUps.filter(f => 
      f.status === 'PENDING' && 
      (f.reason.toLowerCase().includes('appointment') || f.reason.toLowerCase().includes('meeting'))
    );

    return {
      dateStr: targetDateStr,
      selectedStaff: staffFilter || 'all',
      overall,
      telecallers: telecallersStats,
      activityTimeline,
      pendingWork: {
        uncontactedLeads,
        followUpsDueTomorrow,
        overdueFollowUps,
        interestedRequiringAttention,
        appointmentsScheduled
      }
    };
  },

  /**
   * Previews raw spreadsheet rows, detects duplicates against existing leads,
   * and maps fields for confirmation.
   */
  previewExcelImport(rawRows: ImportedLeadRow[]): ImportPreviewResult {
    const existingLeads = leadService.getLeads();

    const existingPhones = new Map<string, Lead>();
    const existingCompanies = new Map<string, Lead>();

    existingLeads.forEach(l => {
      const normPhone = normalizePhoneForLookup(l.phone);
      if (normPhone) existingPhones.set(normPhone, l);

      const normAlt = normalizePhoneForLookup(l.alternate_phone);
      if (normAlt) existingPhones.set(normAlt, l);

      const compName = (l.company_name || l.customer_name || '').trim().toLowerCase();
      if (compName) existingCompanies.set(compName, l);
    });

    const newRows: ImportedLeadRow[] = [];
    const duplicateRows: { row: ImportedLeadRow; existingLead: Lead; matchReason: string }[] = [];
    const seenFilePhones = new Set<string>();
    const seenFileCompanies = new Set<string>();

    rawRows.forEach(row => {
      const normPhone = normalizePhoneForLookup(row.phone);
      const normAlt = normalizePhoneForLookup(row.alternate_phone);
      const compName = (row.company_name || row.customer_name || '').trim().toLowerCase();

      let matchedLead: Lead | undefined = undefined;
      let reason = '';

      if (normPhone && existingPhones.has(normPhone)) {
        matchedLead = existingPhones.get(normPhone);
        reason = `Matches primary phone (${normPhone}) in database`;
      } else if (normAlt && existingPhones.has(normAlt)) {
        matchedLead = existingPhones.get(normAlt);
        reason = `Matches alternate phone (${normAlt}) in database`;
      } else if (compName && existingCompanies.has(compName)) {
        matchedLead = existingCompanies.get(compName);
        reason = `Matches company name ("${row.company_name}") in database`;
      } else if (normPhone && seenFilePhones.has(normPhone)) {
        reason = `Duplicate phone (${normPhone}) within this import file`;
      } else if (compName && seenFileCompanies.has(compName)) {
        reason = `Duplicate company ("${row.company_name}") within this import file`;
      }

      if (matchedLead || reason) {
        duplicateRows.push({ row, existingLead: matchedLead as any, matchReason: reason });
      } else {
        newRows.push(row);
        if (normPhone) seenFilePhones.add(normPhone);
        if (normAlt) seenFilePhones.add(normAlt);
        if (compName) seenFileCompanies.add(compName);
      }
    });

    return {
      totalRows: rawRows.length,
      newRows,
      duplicateRows
    };
  },

  /**
   * Imports rows into the application database.
   * Concurrently converts existing remarks into an initial activity history record.
   */
  async executeExcelImport(
    rowsToImport: ImportedLeadRow[],
    options: {
      assignedTelecallerEmail?: string;
      companyId?: string;
      importUserEmail: string;
      updateDuplicates?: boolean;
    }
  ): Promise<{ importedCount: number; activitiesCreated: number; failedCount: number; errors: string[] }> {
    let importedCount = 0;
    let activitiesCreated = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const row of rowsToImport) {
      if (!row.company_name && !row.customer_name) continue;

      try {
        const customerName = row.customer_name?.trim() || row.company_name.trim();
        const companyName = row.company_name?.trim() || customerName;
        const phone = row.phone?.trim() || '—';
        const outcome = mapRemarkToOutcome(row.remarks);

        const callDate = parseFlexibleDateToIso(row.date);

        const newLeadPayload: Partial<Lead> & { customer_name: string; phone: string } = {
          company_id: options.companyId || leadService.getActiveCompany() || 'default',
          company_name: companyName,
          customer_name: customerName,
          phone: phone,
          alternate_phone: row.alternate_phone?.trim(),
          email: row.email?.trim(),
          location: row.location?.trim(),
          lead_source: 'other',
          priority: outcome === 'Interested' ? 'HOT' : 'WARM',
          assigned_telecaller_email: options.assignedTelecallerEmail,
          status: determineLeadStatusFromOutcome(outcome, 'new'),
          last_call_at: callDate || (row.remarks ? new Date().toISOString() : undefined),
          last_call_outcome: row.remarks ? outcome : undefined,
          last_call_remark: row.remarks?.trim(),
          call_count: row.remarks ? 1 : 0,
          last_contacted_by_email: options.importUserEmail,
          is_telecalling_lead: true
        };

        const savedLead = await leadService.saveLead(newLeadPayload, options.importUserEmail);
        importedCount++;

        // If existing remark exists, convert into an initial Activity/History record
        if (row.remarks && row.remarks.trim()) {
          await leadService.addLeadActivity({
            lead_id: savedLead.id,
            company_id: savedLead.company_id,
            user_email: options.assignedTelecallerEmail || options.importUserEmail,
            action: 'Initial Imported Call',
            activity_type: 'import',
            call_outcome: outcome,
            phone_used: phone,
            contact_person: customerName,
            note: row.remarks.trim(),
            previous_status: 'new',
            new_status: savedLead.status,
            created_at: callDate || new Date().toISOString()
          });
          activitiesCreated++;
        }
      } catch (rowErr: any) {
        failedCount++;
        const msg = `Failed to import "${row.company_name || row.customer_name}": ${rowErr.message || rowErr}`;
        errors.push(msg);
        await errorService.logError({
          userEmail: options.importUserEmail,
          operation: 'excel_import_row',
          errorMessage: msg,
          companyId: options.companyId,
          screen: 'ExcelImportModal',
          metadata: { companyName: row.company_name, phone: row.phone }
        });
      }
    }

    metricsService.notifyChange();
    return { importedCount, activitiesCreated, failedCount, errors };
  }
};
