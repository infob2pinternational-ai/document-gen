/** UI module visibility uses the role returned by current_app_role().
 * Supabase enforces permissions independently. Only owners approve documents. */

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
  admin: ['dashboard', 'documents', 'edit_documents', 'customers', 'services'],
  manager: ['dashboard', 'documents', 'edit_documents', 'customers', 'services'],
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

export function normalizeRole(rawRole: string | undefined | null, _email?: string | null): EmployeeRole {
  const r = (rawRole || '').toLowerCase().trim();
  if (r in ROLE_MODULES) return r as EmployeeRole;
  return FALLBACK_ROLE;
}

export function getRoleModules(rawRole: string | undefined | null, email?: string | null): ModuleKey[] {
  return ROLE_MODULES[normalizeRole(rawRole, email)];
}

export function canAccessModule(rawRole: string | undefined | null, module: ModuleKey, email?: string | null): boolean {
  return getRoleModules(rawRole, email).includes(module);
}

/** Human-readable label for the role badge shown in the app (e.g. Settings/profile area). */
export function roleLabel(rawRole: string | undefined | null, email?: string | null): string {
  const role = normalizeRole(rawRole, email);
  if (role === 'admin') return 'IT Admin';
  if (role === 'owner') return 'Owner';
  return role.charAt(0).toUpperCase() + role.slice(1);
}
