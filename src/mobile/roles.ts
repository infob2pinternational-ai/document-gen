/**
 * Role-based module access for B2P ONE (Phase 8, section 3/11).
 *
 * This is new - the desktop app only ever distinguished `role === 'admin'`
 * (full access) from everyone else (Customers.tsx, Services.tsx,
 * Documents.tsx, Dashboard.tsx, Settings.tsx, GoogleSyncDashboard.tsx all
 * gate a handful of admin-only actions this same way). There is no
 * existing multi-role permission matrix anywhere in this codebase to
 * reuse, so this file is a genuinely new, single, centralized mapping -
 * not a duplicate of anything - built specifically so future roles or
 * future modules (CRM, Inventory, etc. - section 11) can be added here
 * without touching any screen's code.
 *
 * Role source: the exact same `user.user_metadata.role` field the
 * desktop app already reads (App.tsx) - no new Supabase schema, no new
 * table, fully compatible with the existing backend and however roles
 * are already being assigned to users today. 'admin' (the desktop's
 * existing full-access role name) and 'owner' are treated as the same
 * tier, so nothing changes for any user who already has role: 'admin'
 * set today.
 *
 * DEFAULT MATRIX BELOW IS A PROPOSED STARTING POINT, not a business
 * decision I'm positioned to make - adjust ROLE_MODULES to match your
 * actual org's permissions. Everything else in the app reads from this
 * one map, so changes here are the only change needed.
 */

export type EmployeeRole =
  | 'owner' | 'admin'
  | 'manager'
  | 'sales'
  | 'accounts'
  | 'designer'
  | 'technician'
  | 'staff';

export type ModuleKey =
  | 'dashboard'         // Home tab (counts, Revenue/Outstanding)
  | 'documents'         // Documents tab (view/search/filter)
  | 'pending_approval'  // Pending tab + Approve/Reject actions
  | 'edit_documents'    // Edit action on a document
  | 'customers'         // Customers tab
  | 'services';         // Services tab

const ROLE_MODULES: Record<EmployeeRole, ModuleKey[]> = {
  owner: ['dashboard', 'documents', 'pending_approval', 'edit_documents', 'customers', 'services'],
  admin: ['dashboard', 'documents', 'pending_approval', 'edit_documents', 'customers', 'services'],
  manager: ['dashboard', 'documents', 'pending_approval', 'edit_documents', 'customers', 'services'],
  accounts: ['dashboard', 'documents', 'customers'],
  sales: ['documents', 'edit_documents', 'customers', 'services'],
  designer: ['documents'],
  technician: ['documents'],
  staff: ['documents', 'customers', 'services']
};

/**
 * Roles not recognized (unset, typo'd, or a role name not in the table
 * above) default to the most restrictive tier rather than silently
 * granting full owner-level access - unlike the desktop app's existing
 * `role || 'admin'` fallback, which was safe when this was implicitly a
 * single-owner tool but would not be once every employee logs into the
 * same app. Deliberately NOT changing that desktop fallback (out of
 * scope, working logic) - this is a separate, mobile-only default.
 */
const FALLBACK_ROLE: EmployeeRole = 'staff';

export function normalizeRole(rawRole: string | undefined | null): EmployeeRole {
  const r = (rawRole || '').toLowerCase().trim();
  if (r in ROLE_MODULES) return r as EmployeeRole;
  return FALLBACK_ROLE;
}

export function getRoleModules(rawRole: string | undefined | null): ModuleKey[] {
  return ROLE_MODULES[normalizeRole(rawRole)];
}

export function canAccessModule(rawRole: string | undefined | null, module: ModuleKey): boolean {
  return getRoleModules(rawRole).includes(module);
}

/** Human-readable label for the role badge shown in the app (e.g. Settings/profile area). */
export function roleLabel(rawRole: string | undefined | null): string {
  const role = normalizeRole(rawRole);
  if (role === 'admin') return 'Owner';
  return role.charAt(0).toUpperCase() + role.slice(1);
}
