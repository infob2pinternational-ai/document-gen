# Project Handoff — document-gen-main (B2P International)

This document exists so a new Claude Code session (or any developer) can pick up
exactly where this conversation left off, without re-deriving decisions already
made. It supplements `PROJECT_DOCUMENTATION.md` (architecture reference) with
the actual chronological history of what was built, why, and what's still open.

---

## 1. What this project is

React 19 + TypeScript + Vite SPA for B2P International (outdoor advertising,
Kerala) — invoicing/quotation/CRM system. Supabase (Postgres + Auth + Realtime)
backend, no custom server except a small Vercel function. Deployed to
production already (staff web app, `dist/billing`). A native Android app for
the business owner is now also in progress (Capacitor, `dist/mobile`).

**Live Supabase project:** `generator` (`rqovkmjsdwzggebvwvdk`, ap-southeast-2).

---

## 2. Chronological history — what's actually been done

### Pre-work: Regression investigation + architecture refactor (shipped to production)
Root-caused a class of recurring bugs to duplicated data-loading logic across
`App.tsx`. Consolidated into a single `refreshCompanyData()` loader, made
`Customers.tsx`/`Services.tsx` fully controlled components, fixed Realtime to
merge payloads instead of refetching, added a DB-level `UNIQUE` constraint on
`(company_id, document_number)` after finding and manually resolving one real
duplicate in production data. **This was released to production** before any
of the work below began — production is stable and this is the baseline.

### Security hardening (shipped to production, same release)
Found and closed a real vulnerability: anonymous users could enumerate every
document/customer/profile via the public REST API (`qual: true` RLS policies).
Replaced with a `SECURITY DEFINER` Postgres function (`get_public_document`)
that whitelists exactly the fields the public share view needs, plus
authenticated-only RLS policies. Public share links (`/doc/:id`, `/q/:number`,
`/#doc=:id`) all still work through this function.

### Phase A — Draft Recovery (A1–A5, complete, on dev branch)
Hybrid sessionStorage/localStorage draft system (`src/utils/drafts.ts`),
integrated into both `DocumentEditor.tsx` and `ComparisonEditor.tsx`. 5s
debounced session layer, 30s-floor recovery layer, type-scoped draft keys,
"last saved" only updates on confirmed write success, multi-draft dashboard
banner in `App.tsx`. Fully verified with 121+ automated assertions run against
the real compiled module. **Not yet merged/released** — sitting on the dev
branch alongside everything below.

### Phase B — Google Sheets Sync Redesign (B1–B4, complete, dev branch)
Replaced the old `mode: 'no-cors'` fire-and-forget sync with a durable,
Supabase-backed queue:
- **B1:** `google_sync_settings`, `google_sync_queue` (with dead-letter via
  `max_attempts`/`failed_permanently`, locking via `locked_at`/`locked_by`),
  `google_sync_log` tables + a `claim_sync_queue_rows()` Postgres function for
  atomic, race-free claiming (shared by browser worker and a future cron
  worker — the cron worker itself was never built, flagged honestly).
- **B2:** `db.ts`'s sync functions now enqueue instead of fetching directly;
  browser worker (`sheetsSyncQueue.ts`) drains the queue on load/online-event/
  60s interval. Old direct-fetch functions kept (renamed `...Legacy`, unused)
  per explicit instruction not to delete until fully verified.
- **B3:** Rewrote the Google Apps Script (`google-apps-script/Code.gs`) for
  upsert-by-`document_id`, real JSON responses, validation, logging. **Went
  through two real bug fixes after user testing**, both corrected and
  verified against Google's official API reference (not blog posts, after
  the first mistake):
  1. `.setHeaders()` doesn't exist on Apps Script's `TextOutput` — removed
     entirely; CORS works via the `text/plain` no-preflight trick alone.
  2. The *old* production script (shared back into the conversation) also
     handled `full_backup` (Settings' Drive backup button) and per-document
     Drive JSON backups — features my redesign initially dropped. Merged
     back in, plus made document lookup **self-healing**: old rows (no
     `document_id` yet) are found by `document_number` fallback and
     auto-backfilled on next touch — no manual migration script needed.
- **B4:** `GoogleSyncDashboard.tsx` (new page), per-document sync status
  badges in `Documents.tsx`, Retry/Retry All/Force Full Resync, Realtime on
  both queue and log tables.

**Status: code complete and build/lint verified throughout. NOT end-to-end
verified against the real Apps Script deployment** — that requires the user
to deploy and test (curl commands for exactly this were provided). Last known
state: user was in the process of redeploying the merged script.

### Owner Mobile App — Phase 1 (complete, dev branch)
Capacitor-wrapped **new, separate** UI (`src/mobile/`) — deliberately NOT the
staff web app wrapped in a WebView. Reuses `dbService`, Supabase auth/RLS,
Realtime, and (newly extracted) `src/utils/whatsappShare.ts` — found and fixed
**two pre-existing duplicate copies** of WhatsApp-share logic while
investigating for reuse (`Documents.tsx` and `DocumentPreview.tsx` each had
their own copy; `DocumentPreview.tsx`'s was missing the send-logging call
entirely). Separate Vite build (`vite.mobile.config.ts` → `dist/mobile`),
separate `capacitor.config.ts`, real Android/Gradle project scaffolded
(`android/`).

**Two real bugs found via actual user device testing, both fixed:**
1. Capacitor requires the web entry file to be literally named `index.html`
   — a custom name (`mobile.html`) silently failed `cap add android`.
2. Vite's `envDir` (where `.env.local` is loaded from) defaults to whatever
   `root` is set to, not the project root — when I set `root: 'src/mobile'`
   to fix bug #1, this broke env loading as a side effect. Fixed with
   `envDir: '../../'`. Confirmed working by embedding a test marker value in
   `.env.local` and grepping the compiled bundle for it.

`.env.local` has been created with **real** production credentials (fetched
live via the Supabase connector: project URL, legacy anon key) plus
`VITE_PUBLIC_BASE_URL` — needed specifically because Capacitor's
`window.location.origin` is a synthetic local address, not the real domain,
which would otherwise break WhatsApp share links sent from the native app.

**Scope of Phase 1 (delivered):** Owner login, Home (pending count, today's
count, recent docs), Pending Approval list, Documents list (search/filter),
Document view (reuses `DocumentPreview`), WhatsApp share (link-based, reusing
existing behavior — explicitly NOT PDF file sharing, no jsPDF/html2canvas
introduced per instruction), Customers (view/search/edit/call/WhatsApp),
Services (add/edit/delete).

**Status: last known state was "waiting on user's real-device test results"**
after the env fix. Not yet confirmed working end-to-end by the user.

---

## 3. What's explicitly NOT started yet

- **Mobile Phase 2:** Approve/Reject/Edit actions in the mobile app.
- **Mobile Phase 3:** Firebase Cloud Messaging, push notifications, deep
  linking. User specified the exact notification format wanted (see original
  request in chat: "🔔 B2P International / New Quotation Awaiting Approval /
  Customer / Amount / Tap to Review", tapping opens the exact document via
  deep link). The existing web-push FCM setup (`src/services/fcm.ts`) is
  browser-based and will likely need `@capacitor/push-notifications` (native
  FCM) instead for reliable background/killed-app delivery — flagged but not
  yet investigated in depth.
- **Mobile Phase 4:** Owner Dashboard (revenue/outstanding — distinct from
  Phase 1's simple Home counts), offline cache, performance optimization.
- **A cron-based (server-side) Google Sync worker** — approved in concept
  early in the Google Sync design discussion, never actually built. Currently
  sync only runs when a browser tab with the app open is active.
- **A "link existing rows" migration is NOT needed** for Google Sheets —
  solved via the self-healing lookup in B3 instead.

## 4. Known deferred items (from the original regression/production-readiness review, still open)

- `refreshCompanyData()` still calls `getServices()` with no company filter
  (returns all companies' services mixed together) — one-line fix, flagged,
  never applied.
- Several `.then()` calls in `App.tsx` have no `.catch()` handler.
- No React error boundary anywhere in the app.
- Document numbering relies on the `UNIQUE` DB constraint as a backstop; the
  originally-designed fully-atomic server-side numbering RPC (advisory lock +
  assign-at-save-time) was never implemented — the constraint alone prevents
  the actual defect, but the underlying client-side race still technically
  exists beneath it.
- No RLS ownership scoping (`user_id`) — any authenticated user can read/write
  any company's data. Deliberately out of scope for the security work already
  done; would need its own dedicated review.
- No indexes on foreign keys (`documents.company_id`, etc.) beyond primary
  keys — invisible at current row counts, worth addressing before the tables
  grow.

## 5. Environment setup for a fresh session

```bash
npm install
# .env.local should already exist with real values if using the zip from
# this conversation. If not:
cp .env.example .env.local
# Fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_PUBLIC_BASE_URL

npm run build          # staff web app -> dist/billing
npm run build:mobile   # owner mobile app -> dist/mobile
npm run cap:sync       # build:mobile + sync into android/
npm run cap:open       # opens Android Studio
npm run lint           # oxlint - baseline is 13 warnings / 28 errors, ALL
                        # pre-existing false positives (useCloud naming
                        # collision + a couple of accepted exhaustive-deps
                        # omissions) - do not treat this baseline as "clean
                        # slate", treat NEW warnings beyond this as real
```

`google-apps-script/Code.gs` is not part of the Vite build — it must be
copied into the Google Apps Script editor and deployed manually. It is not
connected to any CI/automation.

## 6. Working conventions established across this whole project (please keep following these)

- **Investigate before implementing** — read the actual current code, don't
  assume. Multiple real bugs in this project were caused by working from
  memory/blog-post assumptions instead of checking (the Apps Script
  `.setHeaders()` incident, the Vite `envDir` incident).
- **Small, verified phases** — build + TypeScript + lint after every
  meaningful change, not just at the end.
- **No duplicate logic** — if similar logic already exists, extract and
  reuse it rather than writing a second copy. This project has had multiple
  real instances of accidental duplication found and fixed this way.
- **Explain before touching** — when a change requires DB schema changes,
  removing/renaming something, or otherwise deviating from an approved plan,
  stop and explain first rather than silently proceeding.
- **Be honest about verification limits** — this working environment cannot
  execute Android builds, cannot deploy/run Google Apps Script, and cannot
  test against a real device. Say so plainly rather than implying more
  confidence than is warranted.
