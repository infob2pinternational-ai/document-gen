import type { FollowUp } from '../types';

export function isFollowUpAssignedToUser(
  followUp: FollowUp,
  userEmail?: string | null,
  isOwner?: boolean
): boolean {
  if (!userEmail) return false;
  const cleanUser = userEmail.toLowerCase().trim();
  const assigned = (followUp.assigned_staff_email || '').toLowerCase().trim();

  // Direct email match
  if (assigned === cleanUser) return true;

  // Owner aliases
  const ownerEmails = [
    'owner@b2p.com',
    'sarathjohnpanengadan@gmail.com',
    'sarathjohnpanegdan@gmail.com'
  ];

  if (isOwner || ownerEmails.includes(cleanUser)) {
    if (ownerEmails.includes(assigned)) return true;
    // If no one is explicitly assigned, the owner is responsible
    if (!assigned) return true;
  }

  return false;
}

export interface DueFollowUpItem {
  followUp: FollowUp;
  isOverdue: boolean;
  isDueNow: boolean;
  dueDateTimeStr: string;
}

/**
 * Returns all follow-ups that require active attention right now or today
 * for the given assigned user.
 */
export function getDueFollowUpsForUser(
  allFollowUps: FollowUp[],
  userEmail?: string | null,
  isOwner?: boolean
): DueFollowUpItem[] {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const currentHours = String(now.getHours()).padStart(2, '0');
  const currentMinutes = String(now.getMinutes()).padStart(2, '0');
  const currentTimeStr = `${currentHours}:${currentMinutes}`;

  const dueItems: DueFollowUpItem[] = [];

  for (const f of allFollowUps) {
    // Ignore completed or cancelled follow-ups
    if (f.status === 'COMPLETED' || f.status === 'CANCELLED') continue;

    // Check staff assignment
    if (!isFollowUpAssignedToUser(f, userEmail, isOwner)) continue;

    const isOverdue = f.due_date < todayStr;
    const isToday = f.due_date === todayStr;

    if (isOverdue) {
      dueItems.push({
        followUp: f,
        isOverdue: true,
        isDueNow: true,
        dueDateTimeStr: `${f.due_date} ${f.due_time || '11:00'}`
      });
    } else if (isToday) {
      // Due today
      const dueTime = f.due_time || '11:00';
      const isDueNow = dueTime <= currentTimeStr;

      dueItems.push({
        followUp: f,
        isOverdue: false,
        isDueNow,
        dueDateTimeStr: `Today at ${dueTime}`
      });
    }
  }

  // Sort: Overdue first, then Due Now, then remaining due today
  return dueItems.sort((a, b) => {
    if (a.isOverdue && !b.isOverdue) return -1;
    if (!a.isOverdue && b.isOverdue) return 1;
    if (a.isDueNow && !b.isDueNow) return -1;
    if (!a.isDueNow && b.isDueNow) return 1;
    return (a.followUp.due_time || '').localeCompare(b.followUp.due_time || '');
  });
}
