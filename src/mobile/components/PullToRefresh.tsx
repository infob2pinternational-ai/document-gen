import React, { useRef, useState } from 'react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
}

const PULL_THRESHOLD = 70;

/**
 * Lightweight pull-to-refresh wrapper for the mobile app's scrollable
 * tab content. No desktop equivalent to reuse (this is a touch-gesture
 * affordance, not business logic) - calls straight into the same
 * loadOwnerData() the app already uses for every other refresh trigger
 * (save, delete, realtime), not a separate data-loading path.
 */
export const PullToRefresh: React.FC<PullToRefreshProps> = ({ onRefresh, children }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (containerRef.current && containerRef.current.scrollTop === 0 && !refreshing) {
      startY.current = e.touches[0].clientY;
    } else {
      startY.current = null;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null || refreshing) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta > 0 && containerRef.current?.scrollTop === 0) {
      setPullDistance(Math.min(delta, PULL_THRESHOLD * 1.5));
    }
  };

  const handleTouchEnd = async () => {
    if (startY.current === null) return;
    const shouldRefresh = pullDistance >= PULL_THRESHOLD;
    startY.current = null;
    setPullDistance(0);
    if (shouldRefresh) {
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className="owner-screen"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {(pullDistance > 0 || refreshing) && (
        <div style={{
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          height: refreshing ? '28px' : `${pullDistance}px`,
          lineHeight: refreshing ? '28px' : `${pullDistance}px`,
          overflow: 'hidden',
          transition: refreshing ? 'none' : 'height 0.1s'
        }}>
          {refreshing ? 'Refreshing…' : pullDistance >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}
        </div>
      )}
      {children}
    </div>
  );
};
