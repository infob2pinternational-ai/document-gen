import { useEffect } from 'react';
import { hydrateCrmFromCloud } from '../services/officeService';

export function useCrmRefresh(userId?: string, companyId?: string, enabled = false): void {
  useEffect(() => {
    if (!enabled || !userId || !companyId) return;
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (disposed || refreshing || document.visibilityState === 'hidden') return;
      refreshing = true;
      try {
        await hydrateCrmFromCloud(companyId, () => !disposed);
      } catch (error) {
        console.error('CRM refresh failed:', error);
      } finally {
        refreshing = false;
      }
    };
    // Initial hydration is already performed at login/company selection.
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [userId, companyId, enabled]);
}
