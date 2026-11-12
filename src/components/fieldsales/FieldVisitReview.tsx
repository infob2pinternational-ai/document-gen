import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { createSupabaseFieldSalesApi, normalizePhone, toFieldSalesError, STATUS_LABEL } from '../../services/fieldVisitService';
import type { ConvertResult, FieldSalesApi, FieldVisit, FieldVisitAssignee, FieldVisitEvent, FieldVisitStatus, LeadMatch } from '../../services/fieldVisitService';
import { EVENT_LABEL, requirementText } from './fieldSalesText';
import './fieldSales.css';

/**
 * Office review of field visits (owner and admin).
 *
 * Reads visits the server allows this user to see and changes them only
 * through review_field_visit and convert_field_visit_to_lead. The buttons
 * shown here are a convenience: the database decides what is permitted.
 */
export interface ReviewCompany { id: string; name: string }
/** Just enough of an existing CRM lead to flag a likely duplicate before converting. */
export interface KnownLead { id: string; company_id?: string; phone?: string | null; whatsapp_number?: string | null; lead_number?: string | null; customer_name?: string | null; company_name?: string | null }

interface FieldVisitReviewProps {
  companies: ReviewCompany[];
  activeCompanyId: string;
  currentUserEmail: string;
  knownLeads?: KnownLead[];
  /** Called after a visit became (or was linked to) a lead, so the CRM can refresh its lead and follow-up lists. */
  onLeadsChanged?: () => void | Promise<void>;
  api?: FieldSalesApi;
}

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const formatDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const formatDateTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};
const salespersonName = (email: string) => (email || '').split('@')[0] || email;

type StatusFilter = 'all' | FieldVisitStatus;

export const FieldVisitReview: React.FC<FieldVisitReviewProps> = ({ companies, activeCompanyId, currentUserEmail, knownLeads = [], onLeadsChanged, api: injectedApi }) => {
  const api = useMemo(() => injectedApi || createSupabaseFieldSalesApi(supabase), [injectedApi]);

  const [visits, setVisits] = useState<FieldVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [companyFilter, setCompanyFilter] = useState<string>(activeCompanyId || 'all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('submitted');
  const [salespersonFilter, setSalespersonFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => { setCompanyFilter(activeCompanyId || 'all'); }, [activeCompanyId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listVisits(companyFilter === 'all' ? undefined : companyFilter);
      setVisits(list);
      setError('');
    } catch (raw) {
      const failure = toFieldSalesError(raw);
      setError(failure.code === 'not_installed' ? 'Field Sales is not switched on in the database yet.' : failure.transient ? 'Could not load field visits. Check your connection and try again.' : failure.message);
    } finally {
      setLoading(false);
    }
  }, [api, companyFilter]);
  useEffect(() => { void load(); }, [load]);

  const companyName = useCallback((id: string) => companies.find(c => c.id === id)?.name || '', [companies]);
  const salespeople = useMemo(() => [...new Set(visits.map(v => v.salesperson_email))].sort(), [visits]);

  // Likely duplicates, for a warning only. The server makes the real check at conversion.
  const duplicateInfo = useMemo(() => {
    const byPhone = new Map<string, FieldVisit[]>();
    for (const visit of visits) {
      const key = `${visit.company_id}:${visit.phone_normalized}`;
      byPhone.set(key, [...(byPhone.get(key) || []), visit]);
    }
    const leadPhones = new Map<string, KnownLead[]>();
    for (const lead of knownLeads) {
      for (const phone of [lead.phone, lead.whatsapp_number]) {
        const normalized = normalizePhone(phone || '');
        if (!normalized) continue;
        const key = `${lead.company_id || ''}:${normalized}`;
        if (!(leadPhones.get(key) || []).some(l => l.id === lead.id)) leadPhones.set(key, [...(leadPhones.get(key) || []), lead]);
      }
    }
    return (visit: FieldVisit) => {
      const key = `${visit.company_id}:${visit.phone_normalized}`;
      return {
        otherVisits: (byPhone.get(key) || []).filter(v => v.id !== visit.id),
        leads: (leadPhones.get(key) || []).filter(lead => lead.id !== visit.lead_id)
      };
    };
  }, [visits, knownLeads]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const digits = needle.replace(/[^0-9]/g, '');
    return visits.filter(visit => {
      if (statusFilter !== 'all' && visit.status !== statusFilter) return false;
      if (salespersonFilter !== 'all' && visit.salesperson_email !== salespersonFilter) return false;
      const day = (visit.created_at || '').slice(0, 10);
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      if (!needle) return true;
      return (visit.business_name || '').toLowerCase().includes(needle)
        || (visit.contact_person || '').toLowerCase().includes(needle)
        || (digits.length >= 3 && ((visit.phone_normalized || '').includes(digits) || (visit.phone || '').replace(/[^0-9]/g, '').includes(digits)));
    });
  }, [visits, statusFilter, salespersonFilter, fromDate, toDate, search]);

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: visits.length };
    for (const visit of visits) result[visit.status] = (result[visit.status] || 0) + 1;
    return result;
  }, [visits]);

  const selected = visits.find(v => v.id === selectedId) || null;
  const replaceVisit = (visit: FieldVisit) => setVisits(prev => prev.map(v => (v.id === visit.id ? visit : v)));
  const hasFilters = statusFilter !== 'submitted' || salespersonFilter !== 'all' || fromDate || toDate || search;

  return (
    <div className="fs-review" data-testid="field-visit-review">
      <div className="fs-review-head">
        <div>
          <h2>Field Visits</h2>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Review what the sales team collected and turn approved visits into leads.</div>
        </div>
        <button type="button" className="btn-secondary fs-btn fs-btn-small" onClick={() => load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      {error && <div className="fs-banner error" role="alert"><span>{error}</span><button type="button" className="btn-secondary fs-btn fs-btn-small" onClick={() => load()}>Try again</button></div>}
      {notice && <div className="fs-banner ok" role="status" data-testid="review-notice"><span>{notice}</span><button type="button" className="fs-link" onClick={() => setNotice('')}>Dismiss</button></div>}

      <div className="fs-filters">
        <div>
          <label htmlFor="fsr-search">Search</label>
          <input id="fsr-search" className="fs-input" placeholder="Business, contact or phone" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div>
          <label htmlFor="fsr-status">Status</label>
          <select id="fsr-status" className="fs-input" value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">All ({counts.all || 0})</option>
            {(Object.keys(STATUS_LABEL) as FieldVisitStatus[]).map(status => <option key={status} value={status}>{STATUS_LABEL[status]} ({counts[status] || 0})</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="fsr-salesperson">Salesperson</label>
          <select id="fsr-salesperson" className="fs-input" value={salespersonFilter} onChange={e => setSalespersonFilter(e.target.value)}>
            <option value="all">Everyone</option>
            {salespeople.map(email => <option key={email} value={email}>{salespersonName(email)}</option>)}
          </select>
        </div>
        {companies.length > 1 && (
          <div>
            <label htmlFor="fsr-company">Company</label>
            <select id="fsr-company" className="fs-input" value={companyFilter} onChange={e => { setCompanyFilter(e.target.value); setSelectedId(null); }}>
              <option value="all">All companies</option>
              {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="fsr-from">From</label>
          <input id="fsr-from" className="fs-input" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="fsr-to">To</label>
          <input id="fsr-to" className="fs-input" type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
      </div>

      <div className={`fs-review-grid ${selected ? 'has-selection' : ''}`}>
        <div className="fs-card fs-list" data-testid="visit-list">
          {filtered.map(visit => {
            const dup = duplicateInfo(visit);
            return (
              <button type="button" key={visit.id} className={`fs-row ${visit.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(visit.id)}>
                <div className="fs-row-main">
                  <div className="fs-row-title">{visit.business_name}</div>
                  <div className="fs-row-sub">{[visit.phone, visit.location].filter(Boolean).join(' · ')}</div>
                  <div className="fs-row-sub">{salespersonName(visit.salesperson_email)} · {formatDate(visit.created_at)}{companyFilter === 'all' && companyName(visit.company_id) ? ` · ${companyName(visit.company_id)}` : ''}</div>
                  {visit.status !== 'converted' && (dup.leads.length > 0 || dup.otherVisits.length > 0) && <div className="fs-dup">Possible duplicate</div>}
                </div>
                <span className={`fs-pill ${visit.status}`}>{STATUS_LABEL[visit.status]}</span>
              </button>
            );
          })}
          {!loading && filtered.length === 0 && (
            <div className="fs-empty">
              {visits.length === 0 ? 'No field visits yet. They appear here as soon as a salesperson submits one.'
                : statusFilter === 'submitted' && !hasFilters ? 'Nothing waiting for review.' : 'No visits match these filters.'}
            </div>
          )}
          {loading && visits.length === 0 && <div className="fs-empty">Loading…</div>}
        </div>

        {selected && (
          <VisitPanel
            key={selected.id}
            visit={selected}
            api={api}
            companyName={companyName(selected.company_id)}
            currentUserEmail={currentUserEmail}
            duplicates={duplicateInfo(selected)}
            onClose={() => setSelectedId(null)}
            onChanged={(visit, message) => { replaceVisit(visit); setNotice(message); }}
            onLeadsChanged={onLeadsChanged}
            onOpenVisit={setSelectedId}
          />
        )}
      </div>
    </div>
  );
};

// ─── One visit: details, history, review and conversion ─────────────────────

interface VisitPanelProps {
  visit: FieldVisit;
  api: FieldSalesApi;
  companyName: string;
  currentUserEmail: string;
  duplicates: { otherVisits: FieldVisit[]; leads: KnownLead[] };
  onClose: () => void;
  onChanged: (visit: FieldVisit, message: string) => void;
  onLeadsChanged?: () => void | Promise<void>;
  onOpenVisit: (id: string) => void;
}

const VisitPanel: React.FC<VisitPanelProps> = ({ visit, api, companyName, currentUserEmail, duplicates, onClose, onChanged, onLeadsChanged, onOpenVisit }) => {
  const [events, setEvents] = useState<FieldVisitEvent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [failure, setFailure] = useState('');
  const [noteFor, setNoteFor] = useState<'reject' | 'request_correction' | null>(null);
  const [note, setNote] = useState('');
  const [converting, setConverting] = useState(false);
  const [assignees, setAssignees] = useState<FieldVisitAssignee[]>([]);
  const [assignee, setAssignee] = useState(currentUserEmail.toLowerCase());
  const [followUp, setFollowUp] = useState(visit.follow_up_date && visit.follow_up_date >= todayIso() ? visit.follow_up_date : '');
  const [matches, setMatches] = useState<LeadMatch[] | null>(null);

  const loadEvents = useCallback(() => {
    api.listEvents(visit.id).then(setEvents).catch(() => setEvents([]));
  }, [api, visit.id]);
  useEffect(() => { loadEvents(); }, [loadEvents, visit.updated_at]);

  const guarded = async (work: () => Promise<void>) => {
    if (busyRef.current) return;                     // a second click while the first is still running does nothing
    busyRef.current = true; setBusy(true); setFailure('');
    try { await work(); }
    catch (raw) {
      const error = toFieldSalesError(raw);
      setFailure(error.transient ? 'Could not reach the server. Nothing was changed; try again.' : error.message);
    } finally { busyRef.current = false; setBusy(false); }
  };

  const review = (action: 'approve' | 'reject' | 'request_correction', text?: string) => guarded(async () => {
    const response = await api.review(visit.id, action, text);
    setNoteFor(null); setNote('');
    onChanged(response.visit, action === 'approve' ? `“${visit.business_name}” approved.` : action === 'reject' ? `“${visit.business_name}” rejected.` : `“${visit.business_name}” sent back for correction.`);
    loadEvents();
  });

  const startConvert = () => guarded(async () => {
    const list = await api.assignees(visit.company_id);
    setAssignees(list);
    if (!list.some(a => a.email === assignee) && list.length > 0) setAssignee(list[0].email);
    setMatches(null);
    setConverting(true);
  });

  const finishConvert = (result: ConvertResult) => {
    setConverting(false); setMatches(null);
    const number = result.lead_number || 'the lead';
    onChanged(result.visit, result.result === 'already_converted' ? `Already converted (${number}).`
      : result.mode === 'linked_existing' ? `Linked to existing lead ${number}.` : `Lead ${number} created.`);
    loadEvents();
    void onLeadsChanged?.();
  };
  const convert = (options: { existingLeadId?: string; forceNew?: boolean }) => guarded(async () => {
    const result = await api.convert(visit.id, { assigneeEmail: assignee, followUpDate: followUp || null, ...options });
    if (result.result === 'duplicates_found') { setMatches(result.matches || []); return; }
    finishConvert(result);
  });

  const leadEvent = events?.find(event => event.action.startsWith('converted'));

  return (
    <div className="fs-card fs-panel fs-detail" data-testid="visit-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h3>{visit.business_name}</h3>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            By {visit.salesperson_email} · {formatDateTime(visit.created_at)}{companyName ? ` · ${companyName}` : ''}
          </div>
        </div>
        <span className={`fs-pill ${visit.status}`}>{STATUS_LABEL[visit.status]}</span>
      </div>
      <button type="button" className="fs-link fs-close-panel" onClick={onClose}>← Back to list</button>

      {visit.status === 'converted' && (
        <div className="fs-banner ok" role="status" style={{ marginTop: '0.75rem' }}>
          {visit.conversion_mode === 'linked_existing' ? 'Linked to existing lead' : 'Converted to lead'} {leadEvent?.details?.lead_number || ''}
          {leadEvent?.details?.lead_assignee ? ` · assigned to ${leadEvent.details.lead_assignee}` : ''}. Open it from Leads.
        </div>
      )}
      {(visit.status === 'rejected' || visit.status === 'needs_correction') && visit.review_note && (
        <div className={`fs-banner ${visit.status === 'rejected' ? 'error' : 'warn'}`} role="status" style={{ marginTop: '0.75rem' }}>
          {visit.status === 'rejected' ? 'Rejected' : 'Waiting for the salesperson to correct'}: {visit.review_note}
        </div>
      )}

      <h4>Details</h4>
      <dl>
        <dt>Phone</dt><dd><a href={`tel:${visit.phone}`}>{visit.phone}</a></dd>
        <dt>Contact</dt><dd>{visit.contact_person || '—'}</dd>
        <dt>Location</dt><dd>{visit.location || '—'}</dd>
        <dt>Requirements</dt><dd>{requirementText(visit.requirements, visit.requirement_other) || '—'}</dd>
        <dt>Budget</dt><dd>{visit.estimated_budget !== null && visit.estimated_budget !== '' ? `₹${Number(visit.estimated_budget).toLocaleString('en-IN')}` : '—'}</dd>
        <dt>Remarks</dt><dd>{visit.remarks || '—'}</dd>
        <dt>Follow-up asked</dt><dd>{formatDate(visit.follow_up_date) || '—'}</dd>
      </dl>

      {visit.status !== 'converted' && (duplicates.leads.length > 0 || duplicates.otherVisits.length > 0) && (
        <>
          <h4>Possible duplicates</h4>
          {duplicates.leads.map(lead => (
            <div className="fs-match" key={lead.id}>
              <span>Existing lead <strong>{lead.lead_number || ''}</strong> {lead.company_name || lead.customer_name} · {lead.phone}</span>
            </div>
          ))}
          {duplicates.otherVisits.map(other => (
            <div className="fs-match" key={other.id}>
              <span>Another visit: {other.business_name} · {STATUS_LABEL[other.status]} · {formatDate(other.created_at)}</span>
              <button type="button" className="fs-link" onClick={() => onOpenVisit(other.id)}>Open</button>
            </div>
          ))}
        </>
      )}

      {failure && <div className="fs-banner error" role="alert" style={{ marginTop: '0.9rem' }}>{failure}</div>}

      {/* Review actions */}
      {!converting && !noteFor && (visit.status === 'submitted' || visit.status === 'approved') && (
        <div className="fs-button-row">
          {visit.status === 'submitted' && <button type="button" className="btn-primary fs-btn" disabled={busy} onClick={() => review('approve')}>Approve</button>}
          {visit.status === 'approved' && <button type="button" className="btn-primary fs-btn" disabled={busy} onClick={startConvert}>Convert to lead</button>}
          <button type="button" className="btn-secondary fs-btn" disabled={busy} onClick={() => { setNoteFor('request_correction'); setFailure(''); }}>Request correction</button>
          <button type="button" className="btn-secondary fs-btn" disabled={busy} onClick={() => { setNoteFor('reject'); setFailure(''); }}>Reject</button>
        </div>
      )}

      {noteFor && (
        <div style={{ marginTop: '0.9rem' }}>
          <label className="fs-label" htmlFor="fsr-note">{noteFor === 'reject' ? 'Reason for rejecting' : 'What should the salesperson correct?'}</label>
          <textarea id="fsr-note" className="fs-input" value={note} maxLength={1000} onChange={e => setNote(e.target.value)} autoFocus />
          <div className="fs-button-row">
            <button type="button" className={noteFor === 'reject' ? 'fs-btn fs-btn-danger' : 'btn-primary fs-btn'} disabled={busy || !note.trim()} onClick={() => review(noteFor, note.trim())}>
              {noteFor === 'reject' ? 'Reject visit' : 'Send back'}
            </button>
            <button type="button" className="btn-secondary fs-btn" disabled={busy} onClick={() => { setNoteFor(null); setNote(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {converting && (
        <div style={{ marginTop: '0.9rem' }} data-testid="convert-panel">
          <h4>Convert to lead</h4>
          <div className="fs-field">
            <label htmlFor="fsr-assignee">Assign the lead to</label>
            <select id="fsr-assignee" className="fs-input" value={assignee} onChange={e => setAssignee(e.target.value)}>
              {assignees.map(option => <option key={option.email} value={option.email}>{option.email}{option.email === currentUserEmail.toLowerCase() ? ' (you)' : ''} · {option.role}</option>)}
            </select>
          </div>
          <div className="fs-field">
            <label htmlFor="fsr-followup">Follow-up date <span className="fs-optional">(optional; assigned to the same person)</span></label>
            <input id="fsr-followup" className="fs-input" type="date" min={todayIso()} value={followUp} onChange={e => setFollowUp(e.target.value)} />
            {visit.follow_up_date && visit.follow_up_date < todayIso() && <div className="fs-row-sub">The salesperson asked for {formatDate(visit.follow_up_date)}, which has passed.</div>}
          </div>

          {matches === null && (
            <div className="fs-button-row">
              <button type="button" className="btn-primary fs-btn" disabled={busy || !assignee} onClick={() => convert({})}>{busy ? 'Working…' : 'Create lead'}</button>
              <button type="button" className="btn-secondary fs-btn" disabled={busy} onClick={() => setConverting(false)}>Cancel</button>
            </div>
          )}
          {matches !== null && (
            <div data-testid="duplicate-matches">
              <div className="fs-banner warn" role="alert">This phone number already belongs to {matches.length === 1 ? 'a lead' : `${matches.length} leads`}. Nothing has been created.</div>
              {matches.map(match => (
                <div className="fs-match" key={match.id}>
                  <span><strong>{match.lead_number}</strong> {match.company_name || match.customer_name} · {match.phone} · {String(match.status || '').replace(/_/g, ' ')}{match.assigned_telecaller_email ? ` · ${match.assigned_telecaller_email}` : ''}</span>
                  <button type="button" className="btn-primary fs-btn fs-btn-small" disabled={busy} onClick={() => convert({ existingLeadId: match.id })}>Link to this lead</button>
                </div>
              ))}
              <div className="fs-button-row">
                <button type="button" className="btn-secondary fs-btn" disabled={busy} onClick={() => { if (window.confirm('Create a second lead for the same phone number?')) void convert({ forceNew: true }); }}>Create a new lead anyway</button>
                <button type="button" className="btn-secondary fs-btn" disabled={busy} onClick={() => { setConverting(false); setMatches(null); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      <h4>History</h4>
      {events === null && <div className="fs-empty">Loading…</div>}
      {events && events.length === 0 && <div className="fs-empty">No history.</div>}
      {events && events.length > 0 && (
        <ul className="fs-history" data-testid="visit-history">
          {events.map(event => (
            <li key={event.id}>
              <strong>{EVENT_LABEL[event.action] || event.action}</strong>{event.self_review ? ' (own submission)' : ''}
              {event.note && <div>{event.note}</div>}
              {event.details?.lead_number && <div>Lead {event.details.lead_number}{event.details.lead_assignee ? `, assigned to ${event.details.lead_assignee}` : ''}{event.details.follow_up_id ? ', follow-up created' : ''}</div>}
              {Array.isArray(event.details?.forced_new_despite_matches) && event.details.forced_new_despite_matches.length > 0 && <div>Created although {event.details.forced_new_despite_matches.length} matching lead(s) existed.</div>}
              <time>{formatDateTime(event.created_at)} · {event.actor_email}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
