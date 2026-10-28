export type ReviewTask = { follow_up_id: string; customer_name: string; assigned_staff_email: string; original_due: string; original_due_verified: boolean; current_due: string; postponement_count: number; consecutive_without_contact: number; last_reason: string; current_status: string };
export type ReviewAction = { id: string | number; follow_up_id: string; customer_name: string; actor_email: string; event_type: string; outcome: string; reason: string; previous_due?: string; new_due?: string; created_at: string };
export type DailyFilter = 'all' | 'completed' | 'postponed' | 'rescheduled' | 'customer_callback' | 'no_answer' | 'not_contacted';
export type AttentionFilter = 'all' | 'overdue' | 'repeated' | 'no_contact';
export const normalizeEmail = (value: string) => (value || '').trim().toLowerCase();
export const isOpenTask = (task: ReviewTask) => !['completed', 'cancelled'].includes((task.current_status || '').toLowerCase());
export function matchesDaily(action: ReviewAction, filter: DailyFilter) {
  if (filter === 'all') return true;
  if (['completed','postponed','rescheduled'].includes(filter)) return action.event_type === filter;
  return action.event_type !== 'completed' && action.outcome === filter;
}
export function matchesAttention(task: ReviewTask, filter: AttentionFilter, today: string) {
  if (filter === 'all') return true;
  if (!isOpenTask(task)) return false;
  if (filter === 'overdue') return Boolean(task.current_due) && task.current_due.slice(0,10) < today;
  if (filter === 'repeated') return task.postponement_count >= 2;
  return task.consecutive_without_contact >= 2;
}
export function scopeReview<T extends ReviewTask | ReviewAction>(rows: T[], staff: string, search: string): T[] {
  const term = search.trim().toLowerCase();
  return rows.filter(row => (staff === 'all' || normalizeEmail('actor_email' in row ? row.actor_email : row.assigned_staff_email) === normalizeEmail(staff)) && (!term || (row.customer_name || '').toLowerCase().includes(term)));
}
export function sortReviewTasks(rows: ReviewTask[], sort: string) {
  return [...rows].sort((a,b) => {
    const difference = sort === 'postponements' ? b.postponement_count - a.postponement_count
      : sort === 'due' ? (a.current_due || '9999').localeCompare(b.current_due || '9999')
      : (a.customer_name || '').localeCompare(b.customer_name || '');
    return difference || a.follow_up_id.localeCompare(b.follow_up_id);
  });
}
export function reviewPage<T>(rows: T[], requested: number, size = 10) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.max(1, Math.min(requested, pages));
  return { rows: rows.slice((page-1)*size, page*size), page, pages };
}
