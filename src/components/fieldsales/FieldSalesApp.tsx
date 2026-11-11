import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import {
  FieldVisitStore, createSupabaseFieldSalesApi, emptyVisit, inputFromVisit, validateVisit, toFieldSalesError,
  fieldSalesAccessCache, REQUIREMENT_OPTIONS, STATUS_LABEL
} from '../../services/fieldVisitService';
import type {
  FieldErrors, FieldSalesApi, FieldSalesCompany, FieldVisit, FieldVisitEvent, FieldVisitInput, FieldVisitStatus, LocalVisit, RequirementKey
} from '../../services/fieldVisitService';
import { EVENT_LABEL, requirementText } from './fieldSalesText';
import './fieldSales.css';

/**
 * The salesperson's whole app: dashboard, new-visit form, visit detail.
 *
 * Works without a connection. Whatever is typed is written to the phone
 * first and sent afterwards; the server decides who the salesperson is and
 * whether the visit is accepted.
 */
interface FieldSalesAppProps {
  userId: string;
  userEmail: string;
  role: string;
  onLogout: () => void | Promise<void>;
  /** Tests can supply an API; the app uses Supabase. */
  api?: FieldSalesApi;
}

type Filter = 'all' | 'local' | FieldVisitStatus;
type View =
  | { name: 'home' }
  | { name: 'form'; input: FieldVisitInput; correctionOf: FieldVisitStatus | null; reviewNote: string }
  | { name: 'detail'; visitId: string };

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
const LOCAL_LABEL = { draft: 'Draft', pending: 'Waiting to send', error: 'Not sent' } as const;

export const FieldSalesApp: React.FC<FieldSalesAppProps> = ({ userId, userEmail, role, onLogout, api: injectedApi }) => {
  const api = useMemo(() => injectedApi || createSupabaseFieldSalesApi(supabase), [injectedApi]);
  const store = useMemo(() => new FieldVisitStore(userId, window.localStorage, api), [userId, api]);

  const [localVisits, setLocalVisits] = useState<LocalVisit[]>(() => store.getLocal());
  const [serverVisits, setServerVisits] = useState<FieldVisit[]>(() => store.getCachedVisits());
  const [companies, setCompanies] = useState<FieldSalesCompany[]>(() => fieldSalesAccessCache.load(window.localStorage, userId)?.companies || []);
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<View>({ name: 'home' });

  useEffect(() => store.subscribe(() => {
    setLocalVisits(store.getLocal());
    setServerVisits(store.getCachedVisits());
  }), [store]);

  // Send whatever is waiting, then bring my visits up to date. Never throws.
  const refresh = useCallback(async (announce = false) => {
    setSyncing(true);
    try {
      const summary = await store.sync();
      if (summary.failed > 0) setNotice({ kind: 'error', text: summary.message });
      else if (summary.waiting > 0) setNotice({ kind: 'warn', text: summary.message });
      else if (summary.sent > 0 || announce) setNotice({ kind: 'ok', text: summary.message || 'Everything is up to date.' });
      try {
        const [list, visits] = await Promise.all([api.companies(), store.refreshVisits()]);
        setCompanies(list);
        setServerVisits(visits);
        fieldSalesAccessCache.save(window.localStorage, userId, role, list);
        setLoadError('');
      } catch (raw) {
        const error = toFieldSalesError(raw);
        setLoadError(error.transient ? (navigator.onLine ? error.message : '') : error.message);
      }
    } finally {
      setSyncing(false);
    }
  }, [api, store, userId, role]);

  useEffect(() => {
    fieldSalesAccessCache.saveIdentity(window.localStorage, { userId, email: userEmail });
    void refresh();
    const goOnline = () => { setOnline(true); void refresh(); };
    const goOffline = () => setOnline(false);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => { if (navigator.onLine) void refresh(); }, 60000);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [refresh, userId, userEmail]);

  const localIds = useMemo(() => new Set(localVisits.map(item => item.id)), [localVisits]);
  const counts = useMemo(() => ({
    drafts: localVisits.filter(v => v.local_state === 'draft').length,
    waiting: localVisits.filter(v => v.local_state !== 'draft').length,
    submitted: serverVisits.filter(v => v.status === 'submitted').length,
    needs_correction: serverVisits.filter(v => v.status === 'needs_correction').length,
    approved: serverVisits.filter(v => v.status === 'approved' || v.status === 'converted').length,
    rejected: serverVisits.filter(v => v.status === 'rejected').length
  }), [localVisits, serverVisits]);
  const unsent = localVisits.length;

  const handleLogout = async () => {
    if (unsent > 0 && !window.confirm(`${unsent} visit${unsent === 1 ? ' is' : 's are'} saved only on this phone and not sent yet. They will stay here and be sent when you sign in again. Sign out?`)) return;
    fieldSalesAccessCache.clearIdentity(window.localStorage);
    await onLogout();
  };

  const openNew = () => setView({ name: 'form', input: emptyVisit(companies.length === 1 ? companies[0].id : ''), correctionOf: null, reviewNote: '' });
  const openLocal = (item: LocalVisit) => {
    const { local_state: _s, sync_error, waiting_reason: _w, attempts: _a, revision: _r, updated_at: _u, correction_of_status, ...input } = item;
    setView({ name: 'form', input, correctionOf: correction_of_status, reviewNote: sync_error });
  };

  if (view.name === 'form') {
    return (
      <VisitForm
        key={view.input.id}
        initial={view.input}
        companies={companies}
        correctionOf={view.correctionOf}
        topNote={view.reviewNote}
        existsLocally={localIds.has(view.input.id)}
        onCancel={() => setView({ name: 'home' })}
        onDiscard={() => { store.discard(view.input.id); setView({ name: 'home' }); setNotice({ kind: 'ok', text: 'Draft deleted.' }); }}
        onSaveDraft={input => { store.saveDraft(input, view.correctionOf); setView({ name: 'home' }); setNotice({ kind: 'ok', text: 'Draft saved on this phone.' }); }}
        onSubmit={async input => {
          store.queueForSubmit(input, view.correctionOf);          // on the phone first
          setView({ name: 'home' });
          setNotice({ kind: 'warn', text: 'Visit saved. Sending…' });
          await refresh(true);
        }}
      />
    );
  }

  if (view.name === 'detail') {
    const visit = serverVisits.find(v => v.id === view.visitId);
    if (visit) {
      return (
        <VisitDetail
          visit={visit}
          api={api}
          companyName={companies.find(c => c.id === visit.company_id)?.name || ''}
          onBack={() => setView({ name: 'home' })}
          onCorrect={() => setView({ name: 'form', input: inputFromVisit(visit), correctionOf: visit.status, reviewNote: visit.review_note || '' })}
        />
      );
    }
  }

  const shownServer = serverVisits
    .filter(v => !localIds.has(v.id))
    .filter(v => filter === 'all' || (filter === 'approved' ? v.status === 'approved' || v.status === 'converted' : v.status === filter))
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  const shownLocal = filter === 'all' || filter === 'local' ? localVisits : [];
  const tile = (key: Filter, value: number, label: string) => (
    <button type="button" className={`fs-tile ${filter === key ? 'active' : ''}`} onClick={() => setFilter(filter === key ? 'all' : key)} aria-pressed={filter === key}>
      <strong>{value}</strong><span>{label}</span>
    </button>
  );

  return (
    <div className="fs-shell" data-testid="field-sales-app">
      <header className="fs-header">
        <div>
          <h1>Field Visits</h1>
          <small><span className={`fs-dot ${online ? '' : 'offline'}`} aria-hidden="true" />{online ? 'Online' : 'Offline'} · {userEmail}</small>
        </div>
        <button type="button" className="btn-secondary fs-btn fs-btn-small" onClick={handleLogout}>Sign out</button>
      </header>

      <main className="fs-body">
        {!online && (
          <div className="fs-banner warn" role="status">You are offline. You can keep adding visits; they are saved on this phone and sent when the connection returns.</div>
        )}
        {unsent > 0 && (
          <div className={`fs-banner ${localVisits.some(v => v.local_state === 'error') ? 'error' : 'warn'}`} role="status" data-testid="sync-status">
            <span>
              {counts.waiting > 0 && `${counts.waiting} waiting to send`}{counts.waiting > 0 && counts.drafts > 0 && ' · '}{counts.drafts > 0 && `${counts.drafts} draft${counts.drafts === 1 ? '' : 's'}`}
            </span>
            <button type="button" className="btn-secondary fs-btn fs-btn-small" disabled={syncing} onClick={() => refresh(true)}>{syncing ? 'Sending…' : 'Send now'}</button>
          </div>
        )}
        {notice && <div className={`fs-banner ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} data-testid="notice">{notice.text}</div>}
        {loadError && <div className="fs-banner error" role="alert">{loadError}</div>}

        <button type="button" className="btn-primary fs-btn fs-btn-block" onClick={openNew} style={{ marginBottom: '1rem' }}>+ New visit</button>

        <div className="fs-tiles">
          {tile('local', unsent, 'On this phone')}
          {tile('submitted', counts.submitted, 'Pending review')}
          {tile('needs_correction', counts.needs_correction, 'Needs correction')}
          {tile('approved', counts.approved, 'Approved')}
          {tile('rejected', counts.rejected, 'Rejected')}
          {tile('all', unsent + serverVisits.filter(v => !localIds.has(v.id)).length, 'All visits')}
        </div>

        {shownLocal.length > 0 && (
          <>
            <div className="fs-section-title">On this phone</div>
            <div className="fs-card">
              {shownLocal.map(item => (
                <button type="button" key={item.id} className="fs-row" onClick={() => openLocal(item)}>
                  <div className="fs-row-main">
                    <div className="fs-row-title">{item.business_name || 'Untitled visit'}</div>
                    <div className="fs-row-sub">{[item.phone, item.location].filter(Boolean).join(' · ') || 'No details yet'}</div>
                    {item.local_state === 'pending' && <div className="fs-row-sub">{item.waiting_reason || 'Will be sent automatically.'}</div>}
                    {item.local_state === 'error' && <div className="fs-row-note">Not sent: {item.sync_error} Tap to fix and send again.</div>}
                  </div>
                  <span className={`fs-pill ${item.local_state}`}>{LOCAL_LABEL[item.local_state]}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="fs-section-title">{filter === 'all' || filter === 'local' ? 'Recent activity' : STATUS_LABEL[filter as FieldVisitStatus] || 'Visits'}</div>
        <div className="fs-card">
          {filter !== 'local' && shownServer.map(visit => (
            <button type="button" key={visit.id} className="fs-row" onClick={() => setView({ name: 'detail', visitId: visit.id })}>
              <div className="fs-row-main">
                <div className="fs-row-title">{visit.business_name}</div>
                <div className="fs-row-sub">{[visit.phone, formatDate(visit.created_at)].filter(Boolean).join(' · ')}</div>
                {visit.status === 'needs_correction' && <div className="fs-row-note">Office note: {visit.review_note} Tap to correct.</div>}
                {visit.status === 'rejected' && visit.review_note && <div className="fs-row-note">Reason: {visit.review_note}</div>}
              </div>
              <span className={`fs-pill ${visit.status}`}>{STATUS_LABEL[visit.status]}</span>
            </button>
          ))}
          {(filter === 'local' ? shownLocal.length === 0 : shownServer.length === 0) && (
            <div className="fs-empty">
              {filter === 'all' && unsent === 0 ? 'No visits yet. Tap “New visit” after your first shop.' : 'Nothing here.'}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

// ─── New / edit visit ──────────────────────────────────────────────────────

interface VisitFormProps {
  initial: FieldVisitInput;
  companies: FieldSalesCompany[];
  correctionOf: FieldVisitStatus | null;
  topNote: string;
  existsLocally: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSaveDraft: (input: FieldVisitInput) => void;
  onSubmit: (input: FieldVisitInput) => Promise<void>;
}

const VisitForm: React.FC<VisitFormProps> = ({ initial, companies, correctionOf, topNote, existsLocally, onCancel, onDiscard, onSaveDraft, onSubmit }) => {
  const [input, setInput] = useState<FieldVisitInput>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const busyRef = useRef(false);                     // blocks a second tap before React re-renders
  const dirty = JSON.stringify(input) !== JSON.stringify(initial);
  const set = <K extends keyof FieldVisitInput>(key: K, value: FieldVisitInput[K]) => {
    setInput(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }));
  };
  const toggleRequirement = (key: RequirementKey) =>
    set('requirements', input.requirements.includes(key) ? input.requirements.filter(k => k !== key) : [...input.requirements, key]);

  const run = async (mode: 'draft' | 'submit') => {
    if (busyRef.current) return;
    const found = validateVisit(input, mode);
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      setFailure('Please fix the highlighted fields.');
      const first = Object.keys(found)[0];
      document.getElementById(`fs-${first}`)?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setFailure('');
    try {
      if (mode === 'draft') onSaveDraft(input); else await onSubmit(input);
    } catch (raw) {
      setFailure(toFieldSalesError(raw).message);     // e.g. the phone could not store it: stay on the form
      busyRef.current = false;
      setBusy(false);
    }
  };
  const cancel = () => {
    if (dirty && !window.confirm('Leave without saving? What you typed on this screen will be lost.')) return;
    onCancel();
  };
  const field = (key: keyof FieldVisitInput) => ({ id: `fs-${key}`, className: `fs-input ${errors[key] ? 'invalid' : ''}`, 'aria-invalid': Boolean(errors[key]) });
  const errorText = (key: keyof FieldVisitInput) => errors[key] ? <div className="fs-error" role="alert">{errors[key]}</div> : null;

  return (
    <div className="fs-shell" data-testid="field-visit-form">
      <header className="fs-header">
        <h1>{correctionOf === 'needs_correction' ? 'Correct visit' : existsLocally ? 'Edit visit' : 'New visit'}</h1>
        <button type="button" className="btn-secondary fs-btn fs-btn-small" onClick={cancel}>Back</button>
      </header>
      <form className="fs-body" noValidate onSubmit={event => { event.preventDefault(); void run('submit'); }}>
        {topNote && <div className="fs-banner warn" role="status">{correctionOf === 'needs_correction' ? `Office note: ${topNote}` : topNote}</div>}

        {companies.length !== 1 && (
          <div className="fs-field">
            <label htmlFor="fs-company_id">Company</label>
            <select {...field('company_id')} value={input.company_id} onChange={e => set('company_id', e.target.value)} disabled={Boolean(correctionOf)}>
              <option value="">{companies.length === 0 ? 'No company available yet (saved as draft only)' : 'Choose a company'}</option>
              {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
            {errorText('company_id')}
          </div>
        )}

        <div className="fs-field">
          <label htmlFor="fs-business_name">Business name</label>
          <input {...field('business_name')} value={input.business_name} onChange={e => set('business_name', e.target.value)} autoComplete="organization" maxLength={200} />
          {errorText('business_name')}
        </div>
        <div className="fs-field">
          <label htmlFor="fs-phone">Phone number</label>
          <input {...field('phone')} value={input.phone} onChange={e => set('phone', e.target.value)} type="tel" inputMode="tel" autoComplete="tel" maxLength={40} />
          {errorText('phone')}
        </div>
        <div className="fs-field">
          <label htmlFor="fs-contact_person">Contact person <span className="fs-optional">(optional)</span></label>
          <input {...field('contact_person')} value={input.contact_person} onChange={e => set('contact_person', e.target.value)} autoComplete="name" maxLength={200} />
          {errorText('contact_person')}
        </div>
        <div className="fs-field">
          <label htmlFor="fs-location">Location / address <span className="fs-optional">(optional)</span></label>
          <input {...field('location')} value={input.location} onChange={e => set('location', e.target.value)} maxLength={300} />
          {errorText('location')}
        </div>

        <div className="fs-field">
          <span className="fs-label" id="fs-requirements-label">What do they need?</span>
          <div className="fs-chips" role="group" aria-labelledby="fs-requirements-label">
            {REQUIREMENT_OPTIONS.map(option => (
              <button type="button" key={option.value} className={`fs-chip ${input.requirements.includes(option.value) ? 'on' : ''}`}
                aria-pressed={input.requirements.includes(option.value)} onClick={() => toggleRequirement(option.value)}>{option.label}</button>
            ))}
          </div>
        </div>
        {input.requirements.includes('other') && (
          <div className="fs-field">
            <label htmlFor="fs-requirement_other">Other requirement</label>
            <input {...field('requirement_other')} value={input.requirement_other} onChange={e => set('requirement_other', e.target.value)} maxLength={300} />
            {errorText('requirement_other')}
          </div>
        )}

        <div className="fs-field">
          <label htmlFor="fs-estimated_budget">Estimated budget (₹) <span className="fs-optional">(optional)</span></label>
          <input {...field('estimated_budget')} value={input.estimated_budget} onChange={e => set('estimated_budget', e.target.value)} inputMode="decimal" />
          {errorText('estimated_budget')}
        </div>
        <div className="fs-field">
          <label htmlFor="fs-remarks">Remarks <span className="fs-optional">(optional)</span></label>
          <textarea {...field('remarks')} value={input.remarks} onChange={e => set('remarks', e.target.value)} maxLength={2000} />
          {errorText('remarks')}
        </div>
        <div className="fs-field">
          <label htmlFor="fs-follow_up_date">Next follow-up date <span className="fs-optional">(optional)</span></label>
          <input {...field('follow_up_date')} value={input.follow_up_date} onChange={e => set('follow_up_date', e.target.value)} type="date" />
          {errorText('follow_up_date')}
        </div>

        {failure && <div className="fs-banner error" role="alert">{failure}</div>}
        {existsLocally && !correctionOf && (
          <button type="button" className="fs-link" onClick={() => { if (window.confirm('Delete this visit from this phone? It has not been sent to the office.')) onDiscard(); }}>Delete this draft</button>
        )}

        <div className="fs-actions">
          <button type="button" className="btn-secondary fs-btn" disabled={busy} onClick={() => run('draft')}>Save draft</button>
          <button type="submit" className="btn-primary fs-btn" disabled={busy}>{busy ? 'Saving…' : correctionOf === 'needs_correction' ? 'Resubmit' : 'Submit visit'}</button>
        </div>
      </form>
    </div>
  );
};

// ─── One submitted visit ───────────────────────────────────────────────────

const VisitDetail: React.FC<{ visit: FieldVisit; api: FieldSalesApi; companyName: string; onBack: () => void; onCorrect: () => void }> = ({ visit, api, companyName, onBack, onCorrect }) => {
  const [events, setEvents] = useState<FieldVisitEvent[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  useEffect(() => {
    let active = true;
    setEvents(null); setHistoryError('');
    api.listEvents(visit.id).then(list => { if (active) setEvents(list); })
      .catch(raw => { if (active) setHistoryError(toFieldSalesError(raw).transient ? 'History will load when you are back online.' : toFieldSalesError(raw).message); });
    return () => { active = false; };
  }, [api, visit.id, visit.updated_at]);

  return (
    <div className="fs-shell" data-testid="field-visit-detail">
      <header className="fs-header">
        <h1>Visit</h1>
        <button type="button" className="btn-secondary fs-btn fs-btn-small" onClick={onBack}>Back</button>
      </header>
      <main className="fs-body fs-detail">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem', overflowWrap: 'anywhere' }}>{visit.business_name}</h2>
          <span className={`fs-pill ${visit.status}`}>{STATUS_LABEL[visit.status]}</span>
        </div>
        {visit.status === 'needs_correction' && (
          <div className="fs-banner warn" role="status">
            <span>Office note: {visit.review_note}</span>
            <button type="button" className="btn-primary fs-btn fs-btn-small" onClick={onCorrect}>Correct and resubmit</button>
          </div>
        )}
        {visit.status === 'rejected' && <div className="fs-banner error" role="status">Rejected{visit.review_note ? `: ${visit.review_note}` : '.'}</div>}
        {visit.status === 'converted' && <div className="fs-banner ok" role="status">The office turned this visit into a lead.</div>}
        <div className="fs-card" style={{ padding: '0.9rem' }}>
          <dl>
            {companyName && <><dt>Company</dt><dd>{companyName}</dd></>}
            <dt>Phone</dt><dd>{visit.phone}</dd>
            <dt>Contact</dt><dd>{visit.contact_person || '—'}</dd>
            <dt>Location</dt><dd>{visit.location || '—'}</dd>
            <dt>Requirements</dt><dd>{requirementText(visit.requirements, visit.requirement_other) || '—'}</dd>
            <dt>Budget</dt><dd>{visit.estimated_budget !== null && visit.estimated_budget !== '' ? `₹${Number(visit.estimated_budget).toLocaleString('en-IN')}` : '—'}</dd>
            <dt>Remarks</dt><dd>{visit.remarks || '—'}</dd>
            <dt>Follow-up</dt><dd>{formatDate(visit.follow_up_date) || '—'}</dd>
            <dt>Submitted</dt><dd>{formatDateTime(visit.created_at)}</dd>
          </dl>
        </div>
        <div className="fs-section-title">History</div>
        <div className="fs-card" style={{ padding: '0 0.9rem' }}>
          {historyError && <div className="fs-empty">{historyError}</div>}
          {!historyError && events === null && <div className="fs-empty">Loading…</div>}
          {events && events.length === 0 && <div className="fs-empty">No history yet.</div>}
          {events && events.length > 0 && (
            <ul className="fs-history">
              {events.map(event => (
                <li key={event.id}>
                  <strong>{EVENT_LABEL[event.action] || event.action}</strong>
                  {event.note && <div>{event.note}</div>}
                  <time>{formatDateTime(event.created_at)} · {event.actor_email}</time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
};
