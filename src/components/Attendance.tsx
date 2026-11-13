import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { escapeCsvCell } from '../utils/csvExport';

/**
 * Owner / IT Admin only - gated by the caller (App.tsx checks isOwner ||
 * isItAdmin before rendering this at all), and independently enforced at
 * the database level: every RPC called here raises unless current_app_role()
 * is 'owner' or 'admin' (see database/migrations/
 * 20261113000001_employee_attendance_tracking.sql). Field Sales and Office
 * Telecalling accounts have no path to this screen or this data.
 *
 * "Recorded CRM session time" here means exactly logout_at - login_at for a
 * completed session - not independently verified physical working hours,
 * and never assumed just because someone signed in.
 */

interface AttendanceSession {
  id: string; user_id: string; employee_email: string; session_id: string;
  login_at: string; logout_at: string | null; duration_seconds: number | null; session_status: string;
  login_lat: number | null; login_lng: number | null; login_accuracy_m: number | null; login_location_status: string;
  logout_lat: number | null; logout_lng: number | null; logout_accuracy_m: number | null; logout_location_status: string;
  correction_reason: string | null; corrected_by_email: string | null; corrected_at: string | null; created_at: string;
}
interface Summary {
  date: string; total_field_sales: number; present_today: number; not_logged_in: number;
  active_sessions: number; incomplete_sessions: number; average_session_seconds: number | null; late_arrivals: number | null;
}
interface Settings { configured: boolean; expected_start_time?: string | null; expected_end_time?: string | null; late_after_minutes?: number | null }

const STATUS_LABEL: Record<string, string> = {
  active: 'Active', completed: 'Completed', incomplete: 'Incomplete', admin_corrected: 'Corrected'
};
const LOCATION_LABEL: Record<string, string> = {
  captured: 'Captured', permission_denied: 'Permission denied', unavailable: 'Unavailable', timeout: 'Timed out',
  unsupported: 'Not supported', not_attempted: 'Not attempted'
};

const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const istTimeLabel = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '—';
const istDateLabel = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const durationLabel = (seconds: number | null) => {
  if (seconds === null || seconds === undefined) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};
const mapsLink = (lat: number | null, lng: number | null) => (lat === null || lng === null) ? null : `https://www.google.com/maps?q=${lat},${lng}`;

const card: React.CSSProperties = { background: 'var(--bg-secondary, #fff)', border: '1px solid var(--border-color, #e5e7eb)', borderRadius: 8, padding: '0.9rem 1rem' };
const cardLabel: React.CSSProperties = { fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#6b7280', marginBottom: '0.3rem' };
const cardValue: React.CSSProperties = { fontSize: '1.5rem', fontWeight: 700 };

export const Attendance: React.FC = () => {
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [correcting, setCorrecting] = useState<AttendanceSession | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const [sessionsRes, summaryRes, settingsRes] = await Promise.all([
        supabase.rpc('list_attendance_sessions', { p_from: from, p_to: to, p_user_id: null }),
        supabase.rpc('attendance_summary', { p_date: to === todayIso() ? null : to }),
        supabase.rpc('get_attendance_settings')
      ]);
      if (sessionsRes.error) throw sessionsRes.error;
      if (summaryRes.error) throw summaryRes.error;
      if (settingsRes.error) throw settingsRes.error;
      setSessions(sessionsRes.data || []);
      setSummary(summaryRes.data);
      setSettings(settingsRes.data);
    } catch (err: any) {
      setError(err?.message || 'Could not load attendance data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [from, to]);

  const exportCsv = () => {
    const headers = ['Employee', 'Login date', 'Login time', 'Logout time', 'Duration', 'Status', 'Login location', 'Logout location', 'Correction reason'];
    const rows = sessions.map(s => [
      s.employee_email, istDateLabel(s.login_at), istTimeLabel(s.login_at), istTimeLabel(s.logout_at),
      durationLabel(s.duration_seconds), STATUS_LABEL[s.session_status] || s.session_status,
      LOCATION_LABEL[s.login_location_status] || s.login_location_status, LOCATION_LABEL[s.logout_location_status] || s.logout_location_status,
      s.correction_reason || ''
    ]);
    const csv = '﻿' + [headers, ...rows].map(row => row.map(escapeCsvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `attendance_${from}_to_${to}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const byEmployee = sessions.reduce<Record<string, AttendanceSession[]>>((acc, s) => {
    (acc[s.employee_email] ||= []).push(s);
    return acc;
  }, {});
  const confirmedSecondsFor = (rows: AttendanceSession[]) =>
    rows.filter(r => r.session_status === 'completed' || r.session_status === 'admin_corrected').reduce((sum, r) => sum + (r.duration_seconds || 0), 0);

  return (
    <div style={{ padding: '1.25rem' }}>
      <h2 style={{ marginTop: 0 }}>Attendance Management</h2>
      <p style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: '-0.5rem' }}>
        Recorded CRM session time only - not independently verified physical working hours. Visible to Owner and IT Admin only.
      </p>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'end', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <label style={{ fontSize: '0.8rem' }}>From<br /><input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
        <label style={{ fontSize: '0.8rem' }}>To<br /><input type="date" value={to} min={from} max={todayIso()} onChange={e => setTo(e.target.value)} /></label>
        <button type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        <button type="button" onClick={exportCsv} disabled={sessions.length === 0}>Export CSV</button>
        <button type="button" onClick={() => setShowSettings(true)}>Office hours settings</button>
      </div>

      {error && <div style={{ color: '#b91c1c', marginBottom: '1rem' }}>{error}</div>}

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <div style={card}><div style={cardLabel}>Total Field Sales</div><div style={cardValue}>{summary.total_field_sales}</div></div>
          <div style={card}><div style={cardLabel}>Present ({summary.date})</div><div style={cardValue}>{summary.present_today}</div></div>
          <div style={card}><div style={cardLabel}>Not logged in</div><div style={cardValue}>{summary.not_logged_in}</div></div>
          <div style={card}><div style={cardLabel}>Active sessions</div><div style={cardValue}>{summary.active_sessions}</div></div>
          <div style={card}><div style={cardLabel}>Incomplete sessions</div><div style={cardValue}>{summary.incomplete_sessions}</div></div>
          <div style={card}><div style={cardLabel}>Avg. session</div><div style={cardValue}>{durationLabel(summary.average_session_seconds)}</div></div>
          <div style={card}><div style={cardLabel}>Late arrivals</div><div style={cardValue}>{summary.late_arrivals === null ? 'Not configured' : summary.late_arrivals}</div></div>
        </div>
      )}

      <h3>Employee-wise daily attendance</h3>
      {Object.keys(byEmployee).length === 0 && !loading && <p style={{ color: '#6b7280' }}>No sessions in this date range.</p>}
      {Object.entries(byEmployee).map(([email, rows]) => (
        <div key={email} style={{ marginBottom: '1.5rem' }}>
          <strong>{email}</strong>
          <span style={{ color: '#6b7280', fontSize: '0.8rem', marginLeft: '0.5rem' }}>
            {rows.length} session{rows.length === 1 ? '' : 's'} · recorded total {durationLabel(confirmedSecondsFor(rows))}
            {rows.some(r => r.session_status === 'incomplete') && <span style={{ color: '#b45309', fontWeight: 700 }}> · has incomplete session(s)</span>}
          </span>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.4rem', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                <th>Login</th><th>Logout</th><th>Duration</th><th>Status</th><th>Login location</th><th>Logout location</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td>{istDateLabel(s.login_at)} {istTimeLabel(s.login_at)}</td>
                  <td>{s.logout_at ? istTimeLabel(s.logout_at) : '—'}</td>
                  <td>{durationLabel(s.duration_seconds)}</td>
                  <td>{STATUS_LABEL[s.session_status] || s.session_status}{s.correction_reason && <span title={s.correction_reason}> ⓘ</span>}</td>
                  <td>
                    {s.login_location_status === 'captured' && mapsLink(s.login_lat, s.login_lng)
                      ? <a href={mapsLink(s.login_lat, s.login_lng)!} target="_blank" rel="noreferrer">Map ({s.login_accuracy_m ? `±${Math.round(s.login_accuracy_m)}m` : '—'})</a>
                      : LOCATION_LABEL[s.login_location_status] || s.login_location_status}
                  </td>
                  <td>
                    {s.logout_location_status === 'captured' && mapsLink(s.logout_lat, s.logout_lng)
                      ? <a href={mapsLink(s.logout_lat, s.logout_lng)!} target="_blank" rel="noreferrer">Map ({s.logout_accuracy_m ? `±${Math.round(s.logout_accuracy_m)}m` : '—'})</a>
                      : LOCATION_LABEL[s.logout_location_status] || s.logout_location_status}
                  </td>
                  <td>{(s.session_status === 'incomplete' || s.session_status === 'active') && <button type="button" onClick={() => setCorrecting(s)}>Review / correct</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {correcting && <CorrectionModal session={correcting} onClose={() => setCorrecting(null)} onSaved={() => { setCorrecting(null); void load(); }} />}
      {showSettings && settings && <SettingsModal settings={settings} onClose={() => setShowSettings(false)} onSaved={s => { setSettings(s); setShowSettings(false); }} />}
    </div>
  );
};

const CorrectionModal: React.FC<{ session: AttendanceSession; onClose: () => void; onSaved: () => void }> = ({ session, onClose, onSaved }) => {
  const toLocalInput = (iso: string | null) => iso ? new Date(iso).toISOString().slice(0, 16) : '';
  const [loginAt, setLoginAt] = useState(toLocalInput(session.login_at));
  const [logoutAt, setLogoutAt] = useState(toLocalInput(session.logout_at));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!supabase) return;
    if (!reason.trim()) { setError('A correction reason is required.'); return; }
    setBusy(true);
    setError('');
    try {
      const { error: rpcError } = await supabase.rpc('correct_attendance_session', {
        p_session_id: session.id,
        p_new_login_at: new Date(loginAt).toISOString(),
        p_new_logout_at: logoutAt ? new Date(logoutAt).toISOString() : null,
        p_reason: reason.trim()
      });
      if (rpcError) throw rpcError;
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Could not save the correction.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: '#fff', borderRadius: 8, padding: '1.25rem', width: 420, maxWidth: '90vw' }}>
        <h3 style={{ marginTop: 0 }}>Review / correct session - {session.employee_email}</h3>
        <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>
          Original: {istDateLabel(session.login_at)} {istTimeLabel(session.login_at)} → {session.logout_at ? istTimeLabel(session.logout_at) : 'no logout recorded'}.
          This change is kept in an audit record and can never be silently overwritten again.
        </p>
        <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.85rem' }}>Login time<br />
          <input type="datetime-local" value={loginAt} onChange={e => setLoginAt(e.target.value)} style={{ width: '100%' }} /></label>
        <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.85rem' }}>Logout time (leave blank to keep incomplete)<br />
          <input type="datetime-local" value={logoutAt} onChange={e => setLogoutAt(e.target.value)} style={{ width: '100%' }} /></label>
        <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.85rem' }}>Correction reason (required)<br />
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} style={{ width: '100%' }} /></label>
        {error && <div style={{ color: '#b91c1c', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</div>}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save correction'}</button>
        </div>
      </div>
    </div>
  );
};

const SettingsModal: React.FC<{ settings: Settings; onClose: () => void; onSaved: (s: Settings) => void }> = ({ settings, onClose, onSaved }) => {
  const [start, setStart] = useState(settings.expected_start_time || '');
  const [end, setEnd] = useState(settings.expected_end_time || '');
  const [lateAfter, setLateAfter] = useState(String(settings.late_after_minutes ?? 15));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!supabase) return;
    setBusy(true);
    setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('set_attendance_settings', {
        p_expected_start_time: start || null, p_expected_end_time: end || null,
        p_late_after_minutes: lateAfter ? Number(lateAfter) : null
      });
      if (rpcError) throw rpcError;
      onSaved(data);
    } catch (err: any) {
      setError(err?.message || 'Could not save office hours.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: '#fff', borderRadius: 8, padding: '1.25rem', width: 360, maxWidth: '90vw' }}>
        <h3 style={{ marginTop: 0 }}>Office hours (optional)</h3>
        <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>Used only to flag late arrivals. Leave blank to turn that off - nothing is assumed.</p>
        <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.85rem' }}>Expected start time<br />
          <input type="time" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.85rem' }}>Expected end time<br />
          <input type="time" value={end} onChange={e => setEnd(e.target.value)} /></label>
        <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.85rem' }}>Grace period before "late" (minutes)<br />
          <input type="number" min={0} value={lateAfter} onChange={e => setLateAfter(e.target.value)} /></label>
        {error && <div style={{ color: '#b91c1c', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{error}</div>}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
};
