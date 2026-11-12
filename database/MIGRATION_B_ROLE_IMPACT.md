# Migration B (`20261110000001_security_office_roles_only.sql`) — role impact review

Analysis only. Nothing in this document was applied to any database.

## 0. The most important finding: there is no "manager / accounts / telecaller / designer / technician" role at the database level

The task asked this matrix to cover manager, accounts, telecaller, designer and technician as
well as owner, admin and staff. Having traced every place a role name reaches the database, those
five names **do not exist as real, database-backed roles** in this application today:

- `app_members.role` (the only table that actually grants access) has a `CHECK` constraint
  limiting it to `owner`, `admin`, `staff` — and, after the Field Sales migration, `sales`. Nothing
  else can ever be stored there.
- `current_app_role()`, which every RLS policy and every RPC in the codebase calls to find out
  who is asking, is `SELECT m.role FROM app_members m WHERE m.user_id = auth.uid() ...` — it
  returns one of those four values, or `NULL`.
- In the **web app**, the real (non-dev) role shown to the UI is computed in `src/App.tsx`:
  `isOwner ? 'owner' : isItAdmin ? 'admin' : 'telecaller'`. So in production, **every** signed-in
  account that is not `owner` or `admin` — including every real `staff` account, whatever job the
  person actually does — is simply labeled `'telecaller'` in the UI. `'manager'`, `'accounts'`,
  `'designer'`, `'technician'` only ever appear as the **developer's own local UI preview**
  (`devSimulatedRole`, used only when `import.meta.env.DEV && !isSupabaseConfigured()` — i.e.
  never against a real Supabase session) and as dead branches of `isFinanceRole` and of the
  mobile app's `EmployeeRole` table that the database can never actually produce.

**Consequence for this review:** "existing application roles that currently use it" is answered
correctly by looking at what `app_members.role` can hold (`owner`, `admin`, `staff`, now also
`sales`) and at which *screens* are reachable without any role check at all (see below) — not by
some sophisticated five extra labels that are UI decoration only, backed by no distinct database
permission. I still list them in the matrix per the request, each row says "not a real DB role;
behaves as `staff`."

## 1. The 19 tables, before and after

`current_app_role()` in production today only ever returns `owner`, `admin`, `staff`, or `NULL`
(no role row / inactive / unconfirmed / banned account). Before migration B, **every one of the 19
tables has a plain `authenticated_all: true`-style policy** — any row with `auth.role() =
'authenticated'` passes, regardless of `current_app_role()`. That means today, before this
migration:

- An `owner`, `admin` or `staff` account can read/write all 19 tables (same as after B).
- **A confirmed Supabase account with no `app_members` row at all** (never logged in as staff,
  inactive, or any other signed-in user of the Supabase project) can **also** read/write all 19
  tables, directly via the Supabase REST API, with no application code involved. This is the
  vulnerability migration B closes. A `sales` account introduced by the Field Sales work would
  fall into this same unrestricted bucket if migration B were not applied first — which is why the
  Field Sales migration refuses to install unless migration B is already in place.

| # | Table | UI screens that use it today | Real DB roles that use it via the UI | After B: who keeps access | Verdict |
|---|---|---|---|---|---|
| 1 | `account_groups` | None directly (chart-of-accounts helper, read by `financeService.ts`) | owner, admin (+ 2 hardcoded owner/admin emails) via `isFinanceRole`; never `staff` in the UI | owner, admin, staff | **Broader than the UI exposes.** No screen ever shows this to `staff`; recommend owner/admin only. |
| 2 | `account_heads` | Chart of Accounts, Expenses, Suppliers dropdowns | owner, admin | owner, admin, staff | Same as above — recommend owner/admin only. |
| 3 | `bank_accounts` | Banking & Cash | owner, admin | owner, admin, staff | Same — recommend owner/admin only. |
| 4 | `bank_reconciliation_statements` | Banking & Cash | owner, admin | owner, admin, staff | Same — recommend owner/admin only. |
| 5 | `customer_receipts` | Sales & Receivables | owner, admin | owner, admin, staff | Same — recommend owner/admin only. |
| 6 | `expenses` | Expenses, Financial Reports, Accounts Dashboard, P&L | owner, admin | owner, admin, staff | Same — recommend owner/admin only. |
| 7 | `financial_audit_logs` | Not rendered in any screen; read only by `financeService.ts` internals | owner, admin (same gate as the rest of finance) | owner, admin, staff | Same, and arguably the most sensitive table in the list (an audit trail) — recommend owner/admin only, most strongly here. |
| 8 | `financial_period_locks` | Year-end closing | owner, admin | owner, admin, staff | Same — recommend owner/admin only. |
| 9 | `financial_year_closures` | Year-end closing | owner, admin | owner, admin, staff | Same — recommend owner/admin only. |
| 10 | `journal_entries` | General Journal & Vouchers | owner, admin | owner, admin, staff | Same — recommend owner/admin only. |
| 11 | `purchase_bills` | Purchases & Payables | owner, admin | owner, admin, staff | Same — recommend owner/admin only. |
| 12 | `supplier_payments` | Purchases & Payables, Suppliers | owner, admin | owner, admin, staff | Same — recommend owner/admin only. |
| 13 | `suppliers` | Suppliers Directory, Purchases & Payables | owner, admin | owner, admin, staff | Same — recommend owner/admin only. |
| 14 | `bookings` | **Calendar** (`BookingCalendar`), Owner Dashboard, Global Search, Customer 360 | owner, admin, **staff** — the Calendar tab has **no role check at all** in `App.tsx` | owner, admin, staff | **Matches real usage exactly.** staff genuinely use this screen today; keep as-is. |
| 15 | `resources` | Calendar (fleet list), Booking modal, Owner Dashboard | owner, admin, staff — same, no gate | owner, admin, staff | Matches real usage. Keep as-is. |
| 16 | `google_sync_log` | Google Sync Dashboard (not on the sidebar; reached as a tab id with no gate) | owner, admin, staff | owner, admin, staff | Matches real usage. Keep as-is. |
| 17 | `google_sync_queue` | Documents list (per-row sync badge), Google Sync Dashboard | owner, admin, staff — Documents is reachable by everyone | owner, admin, staff | Matches real usage. Keep as-is. |
| 18 | `google_sync_settings` | Read internally by `sheetsSyncQueue.ts`'s background worker, which runs for every signed-in session once Supabase is configured | owner, admin, staff | owner, admin, staff | Matches real usage. Keep as-is. |
| 19 | `lead_activity` (singular — **not** `lead_activities`) | **None.** Zero references anywhere in `src/`, `api/`, or `server/`. | none | owner, admin, staff | **Dead/legacy table** (0 rows in the live database on 2026-11-10, confirmed separately absent from this repository's migration history). Restricting it to owner/admin/staff is harmless either way since nothing reads or writes it; no regression possible. No recommendation to change — it is not worth special-casing a table nothing uses. |

### What "every other role" maps to, for completeness

| UI label | Real backing DB role | Effect of migration B |
|---|---|---|
| `manager` | Not a real role; `current_app_role()` can never return it. In production this account would be labeled `telecaller` in the web UI and get the mobile app's `manager` module set (`dashboard, documents, edit_documents, customers, services`) **only** if someone manually typed `role='manager'` into `app_members` — which the live `CHECK` constraint forbids. | None — unreachable today. |
| `accounts` | Same: not a real role. Only reachable via `devSimulatedRole` in local development with no Supabase configured. | None — unreachable against a real database. |
| `telecaller` | This **is** the real-world label for most `staff` accounts (per `App.tsx`'s `authRole` fallback) and is also the literal UI label used throughout Telecalling Operations. Backed by `app_members.role = 'staff'`. | Same as `staff` above: keeps access to all 19 tables. |
| `designer`, `technician` | Not real roles; mobile-only dead branches, `documents` module only, same unreachability as `manager`/`accounts`. | None — unreachable today. |

## 2. Will anything break?

**No existing screen stops working.** Every one of the 19 tables is reachable today, via the UI,
only by `owner`, `admin`, or `staff` (the Calendar/Sync screens have no role gate at all, so any
signed-in office account already uses them; the Finance screens are gated to `owner`/`admin` by
`Sidebar.tsx`'s `isFinanceRole`, and `staff` never sees that menu, so granting `staff` database
access to the finance tables changes nothing a `staff` user can observe in the app). The only
change visible to a real user is: **an account with no office role at all, or a future `sales`
account, can no longer read or write any of these 19 tables via a direct Supabase REST call** —
which is exactly the fix.

## 3. Is the blanket "owner, admin, staff" policy justified for every table?

**Partially.** For `bookings`, `resources`, `google_sync_log`, `google_sync_queue`,
`google_sync_settings` and the dead `lead_activity`, it is an exact match for how those screens
already work — justified, no change recommended.

For the **13 finance tables**, the policy is broader than the application ever intentionally
exposes: `staff` has never been shown Expenses, Suppliers, Journal Entries, or any other finance
screen, and the one existing role gate for finance (`isFinanceRole` in `Sidebar.tsx`) only ever
evaluates true for `owner`/`admin` (plus two specific, already-owner/admin email addresses). A
least-privilege policy would restrict those 13 tables to `owner`/`admin` only, matching the UI
exactly rather than being broader than it for no discernible reason.

**Recommendation, not applied here:** split the one uniform policy migration B uses into two
policy bodies — `owner, admin, staff` for the five operational tables, `owner, admin` for the 13
finance tables and the legacy `lead_activity` table. This is a judgment call with a real, if
modest, security benefit (reducing blast radius if a `staff`/`sales` account is ever compromised,
and keeping the finance ledger's access list in sync with what the UI actually shows); it is **not
implemented in this review** because:

- It changes already-reviewed, already-structured security SQL that has gone through several
  rounds of review in this engagement, and doing so without being specifically asked risks
  reopening settled ground.
- It is a net-narrowing change with zero regression risk to any existing screen (confirmed above),
  so it carries no urgency comparable to the two active vulnerabilities fixed in this same pass.

If you want it, I can implement it as a small, separate, additive migration (one extra
`RESTRICTIVE` policy body for the 14 finance/legacy tables, replacing the shared one) with its own
tests, on your explicit go-ahead.

## 4. Verification

This section was produced entirely by reading the application source and the live-captured
database fixture (`tests/fixtures/live-schema-2026-11-10.sql`) and by re-confirming the DB's role
`CHECK` constraint and `current_app_role()` definition. No new SQL was run anywhere, including
against the local test databases, specifically for this section — it is source-code and schema
analysis, not an executed test suite.
