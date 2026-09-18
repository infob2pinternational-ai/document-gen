import type { Lead, FollowUp } from '../types';

export interface StaffOption {
  email: string;
  name: string;
  label: string;
}

const KNOWN_ACTIVE_STAFF: Array<{ email: string; name: string }> = [
  { email: 'sarathjohnpanengadan@gmail.com', name: 'Sarath John Panengadan' },
  { email: 'fransonputhukkara@gmail.com', name: 'Franson Puthukkara' },
  { email: 'sivasatheesan33@gmail.com', name: 'Sivasatheesan33' },
  { email: 'brutf5354@gmail.com', name: 'Brutf5354' }
];

// Display/assignment compatibility only; never use this to authorize a login.
export function normalizeStaffEmail(email?: string | null): string {
  const clean = (email || '').toLowerCase().trim();
  return clean === 'sarathjohnpanegdan@gmail.com'
    ? 'sarathjohnpanengadan@gmail.com'
    : clean;
}

/**
 * Formats an email into a professional, human-readable staff name.
 * Recognizes core leadership and formats standard email formats nicely.
 */
export function formatStaffDisplayName(email?: string | null): string {
  if (!email || email.trim() === '' || email.toLowerCase() === 'unassigned') {
    return 'Unassigned';
  }
  const clean = email.toLowerCase().trim();

  // Known company staff / leaders
  if (clean === 'fransonputhukkara@gmail.com') return 'Franson Puthukkara';
  if (clean === 'sarathjohnpanengadan@gmail.com' || clean === 'sarathjohnpanegdan@gmail.com') return 'Sarath John Panengadan';
  if (clean === 'sivasatheesan33@gmail.com') return 'Sivasatheesan33';
  if (clean === 'brutf5354@gmail.com') return 'Brutf5354';
  if (clean === 'owner@b2p.com') return 'Sarath John Panengadan (Owner)';
  if (clean === 'admin@b2p.com') return 'Franson Puthukkara (IT Admin)';
  if (clean === 'accounts@b2p.com') return 'Accounts Desk';
  if (clean === 'telecaller@b2p.com') return 'Telecaller Desk';

  const local = clean.split('@')[0];
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function isDummyStaffEmail(email?: string | null): boolean {
  if (!email) return false;
  const clean = email.toLowerCase().trim();
  // Only generic placeholders without human identity are filtered
  return ['dummy@b2p.com'].includes(clean);
}

/**
 * Returns the list of real, active staff options dynamically derived from
 * the logged-in user, existing leads, and follow-ups.
 */
export function getAvailableStaffList(
  currentUserEmail?: string,
  leads?: Lead[],
  followUps?: FollowUp[]
): StaffOption[] {
  const staffMap = new Map<string, string>();

  // Always ensure known confirmed app users are available for assignment.
  KNOWN_ACTIVE_STAFF.forEach(staff => {
    staffMap.set(normalizeStaffEmail(staff.email), staff.name);
  });

  // Add currently logged in user if valid
  if (currentUserEmail && currentUserEmail.includes('@') && !isDummyStaffEmail(currentUserEmail)) {
    staffMap.set(normalizeStaffEmail(currentUserEmail), formatStaffDisplayName(currentUserEmail));
  }

  // Add staff from existing leads
  if (leads && leads.length > 0) {
    leads.forEach(l => {
      const email = normalizeStaffEmail(l.assigned_telecaller_email);
      if (email && email.includes('@') && !isDummyStaffEmail(email)) {
        if (!staffMap.has(email)) {
          staffMap.set(email, formatStaffDisplayName(email));
        }
      }
    });
  }

  // Add staff from existing follow-ups
  if (followUps && followUps.length > 0) {
    followUps.forEach(f => {
      const email = normalizeStaffEmail(f.assigned_staff_email);
      if (email && email.includes('@') && !isDummyStaffEmail(email)) {
        if (!staffMap.has(email)) {
          staffMap.set(email, formatStaffDisplayName(email));
        }
      }
    });
  }

  const currentClean = normalizeStaffEmail(currentUserEmail);

  // Convert to array and sort: current user first, then alphabetically by name
  const list: StaffOption[] = Array.from(staffMap.entries()).map(([email, name]) => {
    const isCurrent = Boolean(currentClean && email === currentClean);
    return {
      email,
      name,
      label: isCurrent ? `${name} (You)` : `${name} (${email})`
    };
  });

  list.sort((a, b) => {
    if (a.email === currentClean) return -1;
    if (b.email === currentClean) return 1;
    return a.name.localeCompare(b.name);
  });

  return list;
}
