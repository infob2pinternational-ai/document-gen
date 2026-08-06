import React, { useState, useEffect } from 'react';
import type { CompanyProfile } from '../types';
import { supabase, dbService } from '../services/db';
import {
  getSyncLogForCompany,
  retryAllFailed,
  getWorkerStatus,
  type SyncQueueRow,
  type SyncLogRow
} from '../services/sheetsSyncQueue';
import { RefreshCw, AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';

interface GoogleSyncDashboardProps {
  role: string;
  activeProfile: CompanyProfile | null;
  syncQueue: SyncQueueRow[];
  onRefreshQueue: () => void;
}

export const GoogleSyncDashboard: React.FC<GoogleSyncDashboardProps> = ({
  role,
  activeProfile,
  syncQueue,
  onRefreshQueue
}) => {
  const [log, setLog] = useState<SyncLogRow[]>([]);
  const [retryingAll, setRetryingAll] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [workerStatus, setWorkerStatus] = useState(getWorkerStatus());

  // Initial log load + reload whenever the active company changes
  useEffect(() => {
    if (!activeProfile) return;
    getSyncLogForCompany(activeProfile.id).then(setLog);
  }, [activeProfile]);

  // Realtime for google_sync_log (Phase B4, requirement 9) - merges new
  // entries directly rather than refetching, same pattern used
  // throughout this app for documents/queue. Log is append-only, so
  // only INSERT events are meaningful here.
  useEffect(() => {
    if (!supabase || !activeProfile) return;
    const channel = supabase
      .channel(`sync-log-${activeProfile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'google_sync_log' },
        (payload) => {
          const row = payload.new as SyncLogRow & { company_id: string };
          if (row.company_id !== activeProfile.id) return;
          setLog(prev => [row, ...prev].slice(0, 100));
        }
      )
      .subscribe();
    return () => { supabase?.removeChannel(channel); };
  }, [activeProfile]);

  // Lightweight periodic refresh of the worker heartbeat display only -
  // this is NOT polling the database (no requests are made here), just
  // re-reading the in-memory heartbeat so "last execution" stays fresh
  // on screen without needing a page refresh.
  useEffect(() => {
    const interval = setInterval(() => setWorkerStatus(getWorkerStatus()), 5000);
    return () => clearInterval(interval);
  }, []);

  if (!activeProfile) {
    return <div className="animate-fade-in">Select a company to view sync status.</div>;
  }

  const pending = syncQueue.filter(q => q.status === 'pending').length;
  const syncing = syncQueue.filter(q => q.status === 'syncing').length;
  const failed = syncQueue.filter(q => q.status === 'failed').length;
  const synced = syncQueue.filter(q => q.status === 'synced').length;
  const total = syncQueue.length;

  const oldestPending = syncQueue
    .filter(q => q.status === 'pending')
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
  const longestRetry = syncQueue.reduce((max, q) => (q.attempts > (max?.attempts ?? -1) ? q : max), null as SyncQueueRow | null);
  const avgRetryCount = total > 0 ? (syncQueue.reduce((sum, q) => sum + q.attempts, 0) / total).toFixed(1) : '0';

  const recentActivity = log.slice(0, 10);
  const recentErrors = log.filter(l => l.status === 'failed').slice(0, 10);

  const handleRetryAll = async () => {
    setRetryingAll(true);
    try {
      const count = await retryAllFailed(activeProfile.id);
      alert(`Re-queued ${count} failed sync${count === 1 ? '' : 's'} for retry.`);
      onRefreshQueue();
    } finally {
      setRetryingAll(false);
    }
  };

  const handleForceFullResync = async () => {
    if (!window.confirm(
      `This will re-queue EVERY document for ${activeProfile.name} to sync to Google Sheets again. ` +
      `Existing rows will be updated in place (no duplicates), but this may take a while for large document counts. Continue?`
    )) return;

    setResyncing(true);
    try {
      const count = await dbService.forceFullResync(activeProfile.id);
      alert(`Re-queued ${count} document${count === 1 ? '' : 's'} for full resync.`);
      onRefreshQueue();
    } finally {
      setResyncing(false);
    }
  };

  const statCard = (label: string, value: number | string, color: string, icon: React.ReactNode) => (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)',
      padding: '1.25rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color }}>
        {icon}
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
      </div>
      <span style={{ fontSize: '1.75rem', fontWeight: 700 }}>{value}</span>
    </div>
  );

  const healthBlock = (label: string, value: number | string, valueColor?: string) => (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)',
      padding: '0.85rem 1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.3rem'
    }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: '1rem', fontWeight: 600, color: valueColor || 'var(--text-primary)' }}>{value}</span>
    </div>
  );

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>Google Sync Dashboard</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '4px 0 0 0' }}>
            Live status for {activeProfile.name}'s Google Sheets synchronization.
          </p>
        </div>
        {role === 'admin' && (
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button onClick={handleRetryAll} disabled={retryingAll || failed === 0} className="btn-secondary">
              <RefreshCw size={16} className={retryingAll ? 'spin' : ''} />
              <span>Retry All ({failed})</span>
            </button>
            <button onClick={handleForceFullResync} disabled={resyncing} className="btn-primary">
              <RefreshCw size={16} className={resyncing ? 'spin' : ''} />
              <span>{resyncing ? 'Resyncing...' : 'Force Full Resync'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
        {statCard('Pending', pending, '#64748b', <Clock size={16} />)}
        {statCard('Syncing', syncing, '#3b82f6', <Loader2 size={16} />)}
        {statCard('Failed', failed, '#ef4444', <XCircle size={16} />)}
        {statCard('Synced', synced, '#10b981', <CheckCircle2 size={16} />)}
        {statCard('Total Queue', total, 'var(--text-primary)', <RefreshCw size={16} />)}
      </div>

      {/* Queue Health */}
      <div>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>Queue Health</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          {healthBlock('Oldest Pending Item', oldestPending ? new Date(oldestPending.created_at).toLocaleString() : 'None')}
          {healthBlock('Longest Retry', longestRetry ? `${longestRetry.attempts} attempts` : 'None')}
          {healthBlock('Queue Size', total)}
          {healthBlock('Failed Count', failed)}
          {healthBlock('Average Retry Count', avgRetryCount)}
          {healthBlock('Worker Running (this browser tab)', workerStatus.running ? 'Yes' : 'No', workerStatus.running ? '#10b981' : '#ef4444')}
          {healthBlock('Last Worker Execution', workerStatus.lastTickAt ? new Date(workerStatus.lastTickAt).toLocaleTimeString() : 'Not yet')}
        </div>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
          Worker status reflects only this browser tab. No server-side (cron) worker is deployed yet -
          syncing currently depends on at least one browser tab being open.
        </p>
      </div>

      {/* Recent Activity / Recent Errors */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>Recent Activity</h2>
          {recentActivity.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No activity yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {recentActivity.map(entry => (
                <li key={entry.id} style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <span>{entry.document_number || entry.document_id || '-'} · {entry.action}</span>
                  <span style={{ color: entry.status === 'synced' ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                    {entry.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>Recent Errors</h2>
          {recentErrors.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No recent errors.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {recentErrors.map(entry => (
                <li key={entry.id} style={{ fontSize: '0.8rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#ef4444' }}>
                    <AlertTriangle size={12} />
                    <span>{entry.document_number || entry.document_id || '-'}</span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{entry.error_message}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Sync Log */}
      <div>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>Sync Log</h2>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Document Number</th>
                <th>Action</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {log.map(entry => (
                <tr key={entry.id}>
                  <td data-label="Time">{new Date(entry.created_at).toLocaleString()}</td>
                  <td data-label="Document Number" className="mono">{entry.document_number || '-'}</td>
                  <td data-label="Action">{entry.action}</td>
                  <td data-label="Status" style={{ color: entry.status === 'synced' ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                    {entry.status}
                  </td>
                  <td data-label="Attempts">{entry.attempt_number}</td>
                  <td data-label="Error" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {entry.error_message || '-'}
                  </td>
                </tr>
              ))}
              {log.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No sync history yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
