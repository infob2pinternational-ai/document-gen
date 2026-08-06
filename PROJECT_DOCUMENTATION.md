# B2P Document Portal — Technical Documentation

**Project:** `document-gen-antigravity` (repo: `document-gen`, aliases: `document-gen-main`, `generator-main`)
**Owner:** B2P International, Puranattukara, Thrissur, Kerala
**Stack:** React 19 + TypeScript + Vite 8, Supabase (Postgres 17 + Auth + Realtime), deployed on Vercel
**Live Supabase project:** `generator` (`rqovkmjsdwzggebvwvdk`, ap-southeast-2)

This document reflects the application as of the current development branch, after the architecture/security hardening work and the Draft Recovery feature (Phase A). It is intended as the onboarding and reference document for anyone working on this codebase next.

---

## 1. System Architecture

This is a single-page application with **no custom backend for data** — the browser talks directly to Supabase (Postgres + Auth + Realtime) via `src/services/db.ts`. The only server-side code the app owns is one Vercel serverless function (`api/doc.js`) used for push notifications and social-preview metadata on shared links.

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React SPA)                                         │
│  ┌───────────┐   ┌──────────────┐   ┌─────────────────────┐  │
│  │  App.tsx  │──▶│ dbService     │──▶│ Supabase JS client   │  │
│  │ (state    │   │ (src/services │   │ (@supabase/supa-    │  │
│  │  owner)   │   │  /db.ts)      │   │  base-js)           │  │
│  └───────────┘   └──────────────┘   └──────────┬──────────┘  │
│        │                                        │             │
│        ▼                                        ▼             │
│  Presentational components              Postgres REST API     │
│  (Dashboard, Documents,                 + Realtime (WS)        │
│   Customers, Services,                  + RPC functions        │
│   DocumentEditor,                                              │
│   ComparisonEditor,                                            │
│   DocumentPreview, Settings)                                  │
└─────────────────────────────────────────────────────────────┘
                    │                              │
                    ▼                              ▼
        localStorage / sessionStorage      Supabase Postgres
        (offline mode + draft recovery)    (RLS-protected tables
                                            + 1 SECURITY DEFINER
                                             function)
                    │
                    ▼
          Vercel serverless function (api/doc.js)
          → Firebase Cloud Messaging (push notifications)
```

**Key architectural principle (established during the regression-investigation work):** every piece of shared data has exactly **one owner** and **one loading function**. `App.tsx` owns `documents`/`customers`/`services`/`activeProfile`; `refreshCompanyData()` is the single function that loads them, called explicitly at every point the active company changes (login, profile switch, new-profile creation) rather than through an implicit reactive effect. Child components (`Customers.tsx`, `Services.tsx`) are fully controlled — they hold no local copy of data and never self-fetch.

**Dual storage backend:** `dbService` (in `db.ts`) transparently supports two modes, chosen by `useCloud()`:
- **Cloud mode** — Supabase is configured and the user is authenticated. All reads/writes go through Postgres with RLS enforcement.
- **Offline/local mode** — no Supabase session (or not configured at all). All reads/writes go to `localStorage` under keys like `docgen_documents`, `docgen_customers`, etc. Every `dbService` method has parallel implementations for both modes.

---

## 2. Folder Structure

```
document-gen-main/
├── api/
│   └── doc.js                  # Vercel serverless function: push notifications,
│                                #   social-preview metadata for /doc/:id links
├── public/
│   ├── manifest.json            # PWA manifest ("B2P Portal")
│   ├── sw.js                    # Service worker (cache-first for app shell)
│   └── logo_*.png, seal_*.png   # Company branding assets
├── src/
│   ├── App.tsx                  # Root component - owns all shared state, routing,
│   │                             #   auth lifecycle, public share-link detection,
│   │                             #   Realtime subscription, draft registry
│   ├── main.tsx                 # React root mount
│   ├── types.ts                 # Shared TypeScript interfaces (Document, Customer,
│   │                             #   Service, CompanyProfile, DocumentItem, etc.)
│   ├── App.css / index.css      # Global styles, CSS variables, responsive breakpoints
│   ├── components/
│   │   ├── AuthPanel.tsx         # Login/signup UI
│   │   ├── Sidebar.tsx           # Navigation + company switcher
│   │   ├── Dashboard.tsx         # Stats/overview screen
│   │   ├── Documents.tsx         # Document list/table
│   │   ├── DocumentEditor.tsx    # Create/edit invoice, quotation, proforma,
│   │   │                         #   work order, non-tax invoice - includes
│   │   │                         #   Draft Recovery integration (Phase A2)
│   │   ├── DocumentPreview.tsx   # Print/PDF layout + public share-link view
│   │   ├── DocumentSuccessDialog.tsx  # Post-save confirmation, WhatsApp share
│   │   ├── LineItemModal.tsx     # Add/edit a single line item
│   │   ├── Customers.tsx         # Customer CRM list (fully controlled component)
│   │   ├── Services.tsx          # Service catalog (fully controlled component)
│   │   ├── Settings.tsx          # Company profile, numbering config, backup/restore
│   │   └── comparison/
│   │       ├── ComparisonEditor.tsx    # Create/edit comparison quotation/invoice -
│   │       │                            #   includes Draft Recovery (Phase A4)
│   │       ├── ComparisonPreview.tsx   # Print/PDF layout for comparison docs
│   │       ├── ComparisonService.ts    # Reads/writes comparison_document_data table
│   │       ├── ComparisonTemplates.tsx # Save/load reusable comparison templates
│   │       ├── ComparisonTypes.ts      # Comparison-specific TypeScript types
│   │       └── ComparisonUtils.ts      # Formula evaluation, column reordering
│   ├── services/
│   │   ├── db.ts                # dbService - single data-access layer (cloud +
│   │   │                         #   offline), SQL_SCHEMA reference string
│   │   ├── push.ts               # sendApprovalNotification() - triggers FCM push
│   │   └── fcm.ts                # Firebase Cloud Messaging client setup
│   └── utils/
│       ├── calculations.ts      # calculateDocumentTotals() - tax/subtotal math
│       └── drafts.ts            # Draft Recovery system (Phase A1) - session/
│                                 #   recovery storage layers, debounced saver
├── REGRESSION_CHECKLIST.md      # Pre-release regression checklist
├── SECURITY_AUDIT_REPORT.md     # Historical security audit (pre-dates this work)
├── vercel.json                  # Routing rewrites, CSP + security headers
├── vite.config.ts               # Base path /billing/, build output dist/billing
└── .env.example                 # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
```

---

## 3. Database Schema

Live schema, project `generator` (`rqovkmjsdwzggebvwvdk`). All tables have RLS enabled. No triggers exist anywhere in the schema.

### `profiles` (company profiles — a user can own multiple)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | Owning Supabase auth user |
| `name`, `logo_url`, `seal_url`, `gstin`, `pan`, `email`, `phone`, `address`, `website` | text | Company identity |
| `currency` | text | Default `'INR'` |
| `bank_name`, `bank_account_no`, `bank_ifsc`, `bank_holder`, `bank_branch` | text | Bank details for invoices |
| `show_bank_details` | boolean | Default `true` (note: `DocumentPreview.tsx` currently checks `bank_name` truthiness directly rather than this flag — a known minor inconsistency, not yet fixed) |
| `default_terms` | text | Default terms & conditions text |
| `col_name_description/quantity/unit/rate/amount` | text | Customizable line-item column headers |
| `invoice_prefix`/`invoice_start_number` | text/int | Default `'INV/'` / `1001` |
| `proforma_prefix`/`proforma_start_number` | text/int | Default `'PI/'` / `1001` |
| `quotation_prefix`/`quotation_start_number` | text/int | Default `'QTN/'` / `1001` |
| `work_order_prefix`/`work_order_start_number` | text/int | Default `'WO/'` / `1001` |
| `non_tax_prefix`/`non_tax_start_number` | text/int | Default `'NT/'` / `1001` |
| `google_sheets_url` | text | Apps Script webhook URL for sync |
| `approver_email` | text | Who receives approval-request notifications |

### `documents` (all document types share one table)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id`, `company_id` | uuid | |
| `document_type` | text | `invoice`, `proforma_invoice`, `quotation`, `work_order`, `non_tax_invoice`, `comparison_quotation`, `comparison_invoice` — **no CHECK constraint restricts this** |
| `document_number` | text | e.g. `"INV/1042"` |
| `sequence_number` | int | The numeric part, stored separately |
| `customer_id`, `customer_name`, `customer_email`, `customer_phone`, `customer_address`, `customer_gstin` | | Billing snapshot at time of save (not a live join) |
| `date` | date | |
| `col_name_*` | text | Per-document column header override |
| `subtotal`, `tax_total`, `discount_total`, `total` | numeric | |
| `notes`, `terms` | text | |
| `status` | text | Default `'pending_approval'`; also `approved`, `rejected` |
| `created_by_email`, `whatsapp_sent_by_email`, `whatsapp_sent_at`, `approved_by_email`, `approved_at` | | Audit trail |

**Constraint:** `documents_company_number_unique UNIQUE (company_id, document_number)` — added to close the duplicate-invoice-number regression (see §9). Deliberately **not** scoped by `document_type`, because `comparison_invoice`/`comparison_quotation` intentionally share the same number pool as `invoice`/`quotation`.

### `document_items`
Line items: `document_id` (FK), `service_id` (FK, optional), `description`, `quantity`, `days`, `rate`, `unit`, `hsn_sac`, `amount`, `sort_order`, `gst_percentage`.

### `customers` / `services`
Per-company CRM/catalog tables: `company_id`, `name`, plus contact fields (customers) or `default_rate`/`unit`/`hsn_sac`/`gst_percentage` (services).

### `comparison_document_data`
One row per comparison document: `document_id` (FK), `options_data` (jsonb — the full comparison layout: options, columns, formulas, theme).

### `comparison_templates`
Reusable comparison layouts a user can save and reapply: `company_id`, `name`, `template_config` (jsonb).

### `approver_devices`
Push-notification device tokens registered for approval workflow: `company_id`, `token`, `device_name`, `last_active`.

### Functions
Exactly one custom function exists: **`get_public_document(p_id uuid, p_document_number text)`** — see §7 (Security Model).

---

## 4. Authentication Flow

1. `App.tsx` mounts and checks `isSupabaseConfigured()`. If false, the app runs entirely in offline/local mode — no auth screen, everything reads/writes `localStorage`.
2. If Supabase is configured, `AuthPanel.tsx` is shown until a session exists. It calls `supabase.auth.signInWithPassword({ email, password })` or `supabase.auth.signUp({ email, password })` directly.
3. On successful auth, `App.tsx`'s `[user]` effect fires `loadData()`: fetches `profiles` for the authenticated `user_id`, picks (or restores from `localStorage`'s `docgen_active_profile_id`) an active profile, then calls `refreshCompanyData(profile.id)` to load documents/customers/services in one pass.
4. **RLS enforcement**, not application code, is what actually restricts data access post-login: every authenticated user can currently read/write **any** company's data (policies are `auth.role() = 'authenticated'`, not scoped by `user_id` ownership). This is a known, intentional simplification for this single-organization deployment — flagged in §7 as a candidate for a future, separate multi-tenant hardening pass if the app ever serves unrelated companies.
5. **Idle logout:** a timer (see `App.tsx`) signs the user out after a period of inactivity.
6. **Public/anonymous access** bypasses this entire flow — see §7.

---

## 5. Draft Recovery Architecture

Implemented across Phases A1–A5. Full module: `src/utils/drafts.ts`. Consumed identically by `DocumentEditor.tsx` and `ComparisonEditor.tsx` — **there is exactly one draft implementation in the codebase**, confirmed by a full-repository audit (no other file touches any `docgen_draft*`/`docgen_session*`/`docgen_recovery*` storage key).

### Two-layer hybrid storage

```
sessionStorage (per-tab, fast, dies with the tab)
├── docgen_tab_id                          ← one UUID per browser tab
└── docgen_session:{draftKey}              ← full draft, written every 5s if dirty

localStorage (shared across tabs, durable, survives crashes)
├── docgen_recovery:{draftKey}              ← crash-recovery snapshot
└── docgen_drafts_index                     ← lightweight registry for the banner
```

- **Session layer** is written on a 5-second debounce (never on every keystroke) and is checked first on restore — it's the freshest source after an ordinary refresh.
- **Recovery layer** is written on significant events (item add/remove, customer selection) plus a 30-second floor timer, and is the fallback source after a crash (sessionStorage is destroyed, localStorage survives).

### Draft key scheme
- **Editing an existing document:** `doc:{documentId}` — stable regardless of type; two tabs editing the same document intentionally converge to one draft (last write wins), since they're editing the same real row.
- **Creating a new document:** `new:{documentType}:{tabId}` — scoped by both tab *and* type, so switching the in-editor type dropdown (DocumentEditor only — ComparisonEditor's type is a fixed prop) doesn't restore the wrong kind of draft later, and two tabs never collide.

### Lifecycle
| Event | Behavior |
|---|---|
| Typing | Marks the draft dirty; a debounced write follows (never per-keystroke) |
| Navigate away / close editor | **Draft is NOT deleted** — only flushed one final time |
| Successful save | Draft deleted from both layers **immediately** |
| Explicit "Discard Draft" | Confirmation prompt, then deleted from both layers |
| Storage write fails (quota, disabled storage) | `lastSaved` is **never** updated on failure — the UI shows "Draft save failed — retrying..." instead of a false "Saved" state; a retry is automatically scheduled without requiring further input |

### Restoration priority
1. `restoreDraft(draftKey)` — session layer first, recovery layer as fallback.
2. Legacy migration (`DocumentEditor` only — `ComparisonEditor` had no prior draft system): a pre-Phase-A single-global-draft format, and an A2-era untyped `new:{tabId}` format, are each migrated exactly once on first encounter.
3. Normal edit-mode DB fetch or create-mode defaults, if no draft exists.

### UI indicators (identical in both editors)
"● Unsaved changes" · "Draft saved at [time]" (only shown after a **confirmed** successful write) · "Draft save failed — retrying..." · dismissible "Draft restored from your last session" banner.

### Multi-draft dashboard banner (`App.tsx`)
Reads `getRecoverableDrafts()` on startup, showing document type, customer, document number (if any), and last-saved time per entry, with independent Restore/Discard actions. Restoring opens the correct editor (`DocumentEditor` or `ComparisonEditor`) with the matching `documentToEdit` (or the right `comparisonEditorType` for a new comparison draft) — the editor then restores its own content on mount; `App.tsx` never reads draft field data directly.

---

## 6. Realtime Flow

`App.tsx` subscribes to Postgres changes on the `documents` table, scoped to the active company:

```
supabase.channel(...).on('postgres_changes', { table: 'documents', filter: `company_id=eq.${activeProfile.id}` }, handler)
```

The subscription is torn down and recreated whenever `activeProfile`, `user`, or the `supabase` client identity changes (via the effect's dependency array), so a stale subscription never lingers for the wrong company.

**Critically, the handler does not re-fetch the documents list.** It merges the event payload (`payload.new`/`payload.old`, which Postgres already sent in full) directly into local state via a functional `setDocuments(prev => ...)` update — insert, update, or remove the specific row, then re-sort to match `getDocuments()`'s own ordering (`date` desc, then `created_at` desc). This was a deliberate fix: the handler used to re-fetch the entire table on every event, including the client's own writes, doubling network requests for every save. The merge approach means:
- Your own save: the manual `onRefreshDocs()` callback (which does hit the network, as the one authoritative source right after a save) handles your own UI update; the Realtime event that follows is a no-op merge of data already present.
- A remote device's change: zero network requests — the row Postgres already pushed is applied directly.

Approval/rejection notifications (toast + sound) are read from the same payload, independent of this merge.

---

## 7. Security Model

### Row Level Security (current live policies)
| Table | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| `documents`, `document_items`, `profiles`, `comparison_document_data` | `authenticated` role only, `qual: true` (any authenticated user, any company) | `auth.role() = 'authenticated'` |
| `customers`, `services`, `approver_devices` | `ALL` commands: `auth.role() = 'authenticated'` | (same policy covers all commands) |
| `comparison_templates` | `auth.role() = 'authenticated'` | same |

**No policy anywhere scopes by `user_id` or company ownership** — any authenticated user can read/write any company's data. This is an intentional simplification for a single-organization deployment (all users are B2P staff) and is explicitly flagged as a candidate for a **separate**, future multi-tenant hardening pass if that assumption ever changes — it was deliberately not touched during the RLS security work described below, which was scoped specifically to anonymous access.

### Anonymous access — the `get_public_document()` RPC
Public share links (`/doc/:id`, `/view/:id`, `?view=`, `/q/:documentNumber`, `/#doc=:id`) must work without login. Historically this was done with `qual: true` SELECT policies open to the `anon` role — which meant **any** caller with the public Supabase anon key (embedded in the JS bundle by design) could read the **entire** `documents`/`document_items`/`profiles`/`comparison_document_data` tables directly via the REST API, not just one shared document. `getDocumentByNumber()`'s old implementation even did this by accident in normal operation — fetching every document and filtering client-side.

This was closed by replacing anonymous table access with a single `SECURITY DEFINER` Postgres function:

```sql
get_public_document(p_id uuid DEFAULT NULL, p_document_number text DEFAULT NULL) RETURNS jsonb
```

- **Input validation:** exactly one of the two parameters must be supplied; any other combination (both null, both set) returns `NULL` — never an error, so invalid input and "not found" are indistinguishable to a caller (no oracle for probing).
- **Exact-match only, with normalization for `document_number`:** the lookup strips non-alphanumeric characters and lowercases both sides (matching the legacy client behavior, e.g. `/q/INV1004` resolves to `"INV/1004"`) — never a `LIKE`/wildcard match, so a value like `%` matches nothing.
- **Field whitelisting:** the function returns only the specific document/item/profile fields the public preview actually renders (verified by tracing every `document.*`/`activeProfile.*`/`item.*` reference in `DocumentPreview.tsx` and `calculateDocumentTotals()`). Internal/administrative fields — `user_id`, `customer_id`, `customer_email`, `sequence_number`, `created_by_email`, `whatsapp_sent_by_email`, `approved_by_email`, `google_sheets_url`, `approver_email`, `pan`, `currency`, all numbering prefixes/start-numbers, `service_id`, `hsn_sac`, `sort_order` — are never returned.
- **Structurally cannot enumerate:** the return type is a single `jsonb` scalar, not a set — there is no way to ask it for "everything."
- Anonymous SELECT policies on the four affected tables were replaced with `authenticated`-only equivalents **only after** the frontend was fully migrated to the RPC and verified end-to-end — sequenced deliberately so no share-link flow could break mid-migration.

**Frontend:** `dbService.getPublicDocument({ id })` / `{ documentNumber }` in `db.ts` wraps the RPC call. It is used **only** by the genuinely anonymous entry points (`App.tsx`'s public-view detection, `DocumentPreview.tsx`'s `isPublicShare` branch) — the authenticated in-app preview and the `DocumentEditor`'s edit-open flow still use the original `getDocumentById`/`getProfileById` (which need the full row, e.g. for re-editing), since those never run as `anon`.

### Content Security Policy
Set via `vercel.json` response headers: strict `default-src 'self'`, explicit allowances for Supabase (REST + websocket), Google Apps Script (Sheets sync), HSTS, `X-Frame-Options: SAMEORIGIN`, and a locked-down `Permissions-Policy`.

---

## 8. Google Sheets Integration

**Flow:** on every successful document save (`DocumentEditor.tsx`/`ComparisonEditor.tsx`), if `activeProfile.google_sheets_url` is set, `dbService.syncDocumentToGoogleSheets(url, companyName, document, items)` fires a `fetch()` to the configured Google Apps Script web-app URL, POSTing the document/item data as `text/plain` (to sidestep a CORS preflight against Apps Script's response headers).

**Known limitation (documented, not yet fixed — candidate for Phase B):** the fetch is sent with `mode: 'no-cors'`, so the browser receives an **opaque response** regardless of whether the Apps Script actually succeeded, failed, or the URL is wrong — status is always reported as `0`, and the function currently always resolves `true`. This means:
- There is no reliable success/failure signal from Sheets sync today.
- No retry mechanism exists for a failed sync — it's fire-and-forget, wrapped only in a `.catch()` that logs to the console.
- Whether duplicate rows can occur depends entirely on the *receiving* Apps Script's own logic (append vs. upsert-by-document-number) — the frontend has no way to verify or influence this.

A future redesign (Phase B, not yet implemented) would need: a same-origin proxy or a Sheets API call the frontend can actually read the response from, a retry queue for failed syncs, and a visible sync-status indicator per document.

---

## 9. Document Numbering

**Format:** `{prefix}{sequence_number}`, e.g. `"INV/1042"`. Each company profile has independently configurable prefix + start-number pairs per document type (invoice, proforma, quotation, work order, non-tax invoice). `comparison_quotation`/`comparison_invoice` deliberately draw from the **same** number pool as `quotation`/`invoice` respectively (same prefix, same sequence).

**Historical bug (root cause of a real, confirmed production duplicate — resolved):** the number was computed **client-side**, by reading all existing documents and picking `max + 1` — a classic time-of-check/time-of-use race. Two implementations existed independently (`DocumentEditor.tsx` had a collision-retry loop; `ComparisonEditor.tsx` did not), and the number was assigned when the editor **opened**, not when the document was actually **saved** — meaning the race window spanned however long the user took filling out the form, not just a quick database read. A live database audit found exactly one real duplicate from this (`INV/1004` used by two different documents for one company), which was manually resolved (renumbered to `INV/1007`) before the fix shipped.

**Current safeguard:** `UNIQUE (company_id, document_number)` database constraint — this is now the actual source of truth for correctness; it exists independent of whatever client-side logic computes a candidate number, so no future client bug can silently reintroduce a duplicate. (A fully atomic server-side numbering RPC was designed in detail — advisory-locked, computed from the `documents` table itself rather than a separate mutable counter, to avoid yet another "second source of truth" — but implementation was deferred; the constraint alone prevents the actual defect from recurring even without it.)

---

## 10. State Management

No external state library — plain React state, with a single-owner discipline enforced after the regression-investigation work:

- **`App.tsx`** is the sole owner of `documents`, `customers`, `services`, `activeProfile`, `profiles`. Exactly one function, `refreshCompanyData(profileId)`, loads all three per-company collections; it's called explicitly at every point the active company changes (never via an implicit reactive effect keyed off state that function itself sets — that pattern was the original root cause of a duplicate-fetch bug present on every login).
- **`Customers.tsx`/`Services.tsx`** are fully controlled components: no local `useState` mirror of the data they render, no self-fetch fallback. They receive `preloadedCustomers`/`preloadedServices` as required props and call `onRefreshCustomers`/`onRefreshServices` after a mutation.
- **`DocumentEditor.tsx`/`ComparisonEditor.tsx`** own their own large local form state (document fields, line items) plus the Draft Recovery state (`draftStatus`, `draftSaver`, etc., all local to the component instance).
- **Draft persistence** (`src/utils/drafts.ts`) is the one deliberate exception to "React state only" — it's a plain module with no React dependency, called from component effects, backed by `sessionStorage`/`localStorage`.

---

## 11. Deployment Guide

**Hosting:** Vercel. `vite.config.ts` sets `base: '/billing/'` and outputs to `dist/billing`; `vercel.json` rewrites the site root and all non-API paths into that subfolder, and separately routes `/doc/:id*` to the `api/doc.js` serverless function (for social-preview metadata on shared links) before falling through to the SPA.

**Build:**
```bash
npm install
npm run build      # tsc -b && vite build → dist/billing/
```

**Environment variables** (`.env.example`):
| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Client build (`.env.local`, git-ignored) | Public anon key — safe to expose only because RLS restricts what it can do (see §7) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Vercel Project Settings (server-side only) | Used by `api/doc.js` for the same purpose, server-side |

**Database migrations:** applied directly against the live Supabase project via its SQL/migrations interface — there is no migration-file system in this repo; `SQL_SCHEMA` in `db.ts` is a **first-time bootstrap script only** (destructive `DROP TABLE ... CASCADE`) and must never be run against a live database with real data. Any schema change to production must be written as its own additive statement, tested against a duplicate-detection or read-only check first where relevant (as was done for the `UNIQUE` constraint and the RLS policy replacement), and applied directly via the Supabase SQL editor or migration tool.

**PWA:** a manifest and service worker (`public/manifest.json`, `public/sw.js`) provide install-to-homescreen and app-shell caching; the cache name (`b2p-portal-cache-v3`) should be bumped on any deploy that changes cached assets, to force clients to fetch the new shell.

---

## 12. Regression Checklist

The full, standalone checklist (12 categories: duplicate data loading, duplicate business logic, multiple sources of truth, race conditions, state synchronization, database integrity, Realtime synchronization, document numbering, company/profile switching, offline mode, mobile behavior, and security/RLS) lives in **`REGRESSION_CHECKLIST.md`** at the repo root — run it before every release. It should be extended with a Draft Recovery section (restore after refresh/crash, multi-draft independence, discard behavior, storage-failure handling) to reflect the work in this document; that addition is recommended but not yet made to the checklist file itself.

---

## 13. Future Roadmap

Known, deliberately-deferred items, each already scoped from prior investigation:

1. **Google Sheets sync redesign** (§8) — reliable success/failure detection, retry queue, per-document sync status indicator, guaranteed no-duplicate-rows behavior. Next up after this documentation, per the standing project plan.
2. **`getServices()` scoping inconsistency** — `refreshCompanyData()` still calls `getServices()` with no company filter (returns all companies' services mixed together) in one code path, while the Services tab's own refresh correctly scopes by `activeProfile.id`. Low-risk, one-line fix, not yet applied.
3. **Uncaught promise rejections** — seven `.then()` calls in `App.tsx` have no `.catch()` handler; a network failure on any of them fails silently rather than surfacing an error state.
4. **No React error boundary** — a rendering error anywhere in the tree currently produces a full white-screen crash with no recovery UI.
5. **Fully atomic, server-side document numbering** — the `UNIQUE` constraint prevents the defect from recurring, but the designed advisory-locked RPC (computing the next number from `documents` itself, not a separate counter, and assigning it atomically at save time rather than at editor-open time) was never implemented; the client-side race still technically exists underneath the constraint's safety net.
6. **Multi-tenant RLS ownership model** (§7) — any authenticated user can currently read/write any company's data; scoping policies by `user_id`/company ownership is explicitly out of scope for the security work already done and would need its own dedicated review if the app ever needs to isolate unrelated organizations from each other.
7. **Missing indexes** — no index exists on any foreign key (`documents.company_id`, `customers.company_id`, `document_items.document_id`, etc.) beyond primary keys; invisible at current row counts, worth addressing before the tables grow substantially.
8. **`/#doc=` WhatsApp share links** — confirmed fixed as part of the public-view detection effect (now reads `location.hash` in addition to `pathname`/`search`), but worth a dedicated end-to-end test with a real WhatsApp message once mobile testing is performed.
9. **Draft Recovery checklist additions** — extend `REGRESSION_CHECKLIST.md` with the Draft Recovery-specific scenarios verified in Phase A5 (see that file's existing structure for the pattern to follow).
