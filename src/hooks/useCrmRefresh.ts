import { useEffect, useState } from 'react';
import { hydrateCrmFromCloud } from '../services/officeService';

const FOCUS_COOLDOWN_MS = 20000; // 20s cooldown: avoid redundant refetching on rapid window/tab switches
let lastRefreshTime = 0;

export function useCrmRefresh(userId?: string, companyId?: string, enabled = false): string {
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled || !userId || !companyId) return;
    setError('');
    let disposed = false;
    let refreshing = false;

    const refresh = async (isFocusOrVisibility = false) => {
      if (disposed || refreshing || document.visibilityState === 'hidden') return;

      const now = Date.now();
      if (isFocusOrVisibility && now - lastRefreshTime < FOCUS_COOLDOWN_MS) {
        return; // Skip unnecessary refetch when returning quickly to the browser tab
      }

      refreshing = true;
      try {
        await hydrateCrmFromCloud(companyId, () => !disposed);
        lastRefreshTime = Date.now();
        if (!disposed) setError('');
      } catch (error) {
        console.error('CRM refresh failed:', error);
        if (!disposed) setError('CRM refresh failed. Displayed records may be out of date. Retrying automatically; check your connection.');
      } finally {
        refreshing = false;
      }
    };

    void refresh();
    const interval = window.setInterval(refresh, 30000);

    const onFocus = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastRefreshTime < FOCUS_COOLDOWN_MS) return;
      void refresh();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId, companyId, enabled]);
  return error;
}

