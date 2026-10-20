import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { LeadActivity } from '../types';
import { leadService } from '../services/leadService';
import { metricsService } from '../services/metricsService';

type TimelineState = {
  activities: LeadActivity[];
  status: 'loading' | 'loaded' | 'error';
  error: string;
};

// Each drawer selection owns a separate store. A late response can never update
// the state for a different lead, company, or signed-in user.
export function createLeadTimeline(leadId: string, companyId: string, service = leadService) {
  const scoped = (rows: LeadActivity[]) => rows.filter(row =>
    row.lead_id === leadId && row.company_id === companyId);
  const cached = () => scoped(service.getLeadActivities(leadId));
  let state: TimelineState = { activities: cached(), status: 'loading', error: '' };
  let pending: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: TimelineState) => {
    state = next;
    listeners.forEach(listener => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    syncCache() {
      // The timeline is append-only. A partial bulk cache refresh must not erase
      // records already fetched specifically for this lead. Only a successful
      // targeted fetch replaces the complete displayed list.
      const rows = new Map(state.activities.map(row => [row.id, row]));
      cached().forEach(row => rows.set(row.id, row));
      const activities = [...rows.values()].sort((a, b) =>
        Date.parse(b.created_at) - Date.parse(a.created_at));
      publish({ ...state, activities });
    },
    refresh() {
      if (pending) return pending;
      publish({ ...state, status: 'loading', error: '' });
      pending = Promise.resolve().then(async () => {
        try {
          const result = await service.refreshLeadActivities(leadId, companyId);
          if (result.status === 'discarded') {
            throw new Error('The timeline refresh was interrupted by another update. Please retry.');
          }
          publish({ activities: scoped(result.activities), status: 'loaded', error: '' });
        } catch (error) {
          publish({ ...state, status: 'error', error: error instanceof Error ? error.message : 'Unable to load the timeline. Please retry.' });
        } finally {
          pending = undefined;
        }
      });
      return pending;
    }
  };
}

export function useLeadActivities(leadId: string, companyId: string, userEmail: string, isOpen: boolean) {
  const sessionId = localStorage.getItem('supabase_user');
  const timeline = useMemo(() => createLeadTimeline(leadId, companyId), [leadId, companyId, userEmail, sessionId, isOpen]);
  const state = useSyncExternalStore(timeline.subscribe, timeline.getSnapshot);
  useEffect(() => {
    if (!isOpen || !leadId || !companyId) return;
    const unsubscribe = metricsService.subscribe(timeline.syncCache);
    void timeline.refresh();
    return unsubscribe;
  }, [timeline, isOpen, leadId, companyId]);
  return { ...state, retry: timeline.refresh };
}
