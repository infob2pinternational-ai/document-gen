# Security Audit Report — document-gen-main (BDM Pro / B2P Document Portal)

**Scope:** React 19 + TypeScript + Vite SPA, Supabase (Postgres + Auth) backend, one Vercel serverless function (`api/doc.js`), deployed at `b2pinternational.com`.
**No UI or functional changes were made** — only security-relevant code, config, and the database schema script were touched. Build and type-check were run after every change and both pass clean.

---

## 1. Architecture note (why some checklist items don't apply here)

This app has **no custom backend server** — auth, password hashing, JWT issuance/validation, and session tokens are all handled by Supabase's managed Auth service, and there's no custom SQL (all DB calls go through the Supabase client, which parameterizes queries, so classic SQL injection isn't reachable). There's no file-upload-to-server feature (logos/seals are resized client-side and stored as base64), no NoSQL/command/template-injection surface, and no server-rendered templates. I audited these areas but they were already sound by construction; I've noted that explicitly below rather than inventing fixes for non-existent risk.

The one custom server-side code path is `api/doc.js` (renders social-preview metadata for shared document links). That's where most of the server-side findings live.

---

## 2. Vulnerabilities found

| # | Issue | Severity | OWASP category |
|---|---|---|---|
| 1 | **Row Level Security disabled on every database table** | **Critical** | A01:2021 – Broken Access Control |
| 2 | **Live Supabase URL + anon key hardcoded in source** (`api/doc.js`) | High | A02:2021 – Cryptographic Failures / A05 – Security Misconfiguration |
| 3 | Server error responses leaked raw exception text to the client | Medium | A05:2021 – Security Misconfiguration |
| 4 | No security response headers anywhere (CSP, HSTS, X-Frame-Options, etc.) | Medium | A05:2021 – Security Misconfiguration |
| 5 | No `.gitignore` in the repo | Medium | A05:2021 – Security Misconfiguration |
| 6 | `og:title`/`og:description` built with unescaped, DB-sourced strings | Low–Medium | A03:2021 – Injection (HTML injection) |
| 7 | Sensitive data (document/customer details) logged unconditionally to browser console | Low | A09:2021 – Security Logging Failures |
| 8 | No idle-session auto-logout for the cloud (Supabase) session | Low | A07:2021 – Identification & Auth Failures |
| 9 | `id` query param passed into a REST filter without shape validation | Low | A03:2021 – Injection (defense-in-depth) |

### #1 — RLS disabled (Critical) — **the headline finding**
`src/services/db.ts` contained:
```sql
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE services DISABLE ROW LEVEL SECURITY;
ALTER TABLE documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE document_items DISABLE ROW LEVEL SECURITY;
```
Supabase's `anon` API key is *meant* to be public — the security boundary is supposed to be enforced entirely by RLS policies at the database. With RLS off, **any holder of the anon key can read, insert, update, or delete every row in every table for every tenant** — every company's customers, GSTIN numbers, bank account details, invoices, and quotations, not just their own. The app's own client code only *chooses* to filter by `company_id`/`user_id` for convenience; nothing stops a client from querying without that filter. And the anon key isn't even secret in this app — it's shipped to every browser (`import.meta.env.VITE_SUPABASE_ANON_KEY`) and was also hardcoded in `api/doc.js` (finding #2), so it's trivially obtainable.

**This is the most severe class of vulnerability in the OWASP Top 10 (Broken Access Control) and, on a live production system with real customer financial data, should be treated as urgent.**

**Fix applied:** Rewrote the `SQL_SCHEMA` string in `src/services/db.ts` to enable RLS on all five tables and add explicit policies:
- `customers` and `services` — fully private, only the owning `auth.uid()` can read/write.
- `profiles` and `documents` — public **read** only (this app intentionally shares document links over WhatsApp, and shows the issuing company's name/logo on the public view page — I preserved that), but insert/update/delete restricted to the owning user.
- `document_items` — public read (needed to render shared invoices/quotations), writes gated through a subquery confirming the parent `documents.user_id = auth.uid()`.

**⚠️ Action required from you:** This SQL only fixes newly-provisioned databases. **Your live Supabase project currently has RLS disabled right now.** You need to open the Supabase SQL Editor for your production project and run the updated schema block (from `ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;` onward) immediately — copy it from the updated `Settings → Database` tab in the app (which pulls from `SQL_SCHEMA`), or straight from `src/services/db.ts`.

### #2 — Hardcoded live credentials in `api/doc.js` (High)
The file had:
```js
const supabaseUrl = "https://rqovkmjsdwzggebvwvdk.supabase.co";
const apiKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
```
This is your **real production project URL and anon key**, committed in plaintext source. Even though Supabase anon keys are designed to be public-facing, hardcoding them means: (a) they can't be rotated without a code change/redeploy, (b) if this repo is or ever becomes a public GitHub repo, search engines/scanners/GitHub's own secret-scanning will index it, and (c) combined with finding #1, this key was a skeleton key to your entire database.

**Fix applied:** Moved both values to `process.env.SUPABASE_URL` / `process.env.SUPABASE_ANON_KEY`, to be set in Vercel's Project Settings → Environment Variables (not committed). Added `.env.example` documenting all required variables. Added `.gitignore` so `.env*` files are never committed going forward.

**⚠️ Action recommended:** Since this key has been sitting in your source tree, rotate it in Supabase (Project Settings → API → regenerate anon key) once RLS is confirmed enabled, and update it in Vercel's env vars.

### #3 — Raw error messages returned to clients (Medium)
```js
res.status(500).send("Internal Server Error: " + String(err));
```
This can leak file paths, stack traces, or internal exception messages to anyone who requests a malformed document link.

**Fix applied:** The function now logs the full error server-side (`console.error`) and returns a generic `"Something went wrong. Please try again later."` message to the client.

### #4 — Missing security headers (Medium)
No CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, or Permissions-Policy were set anywhere, leaving the app more exposed to clickjacking, MIME-sniffing, and (in the event a dependency is ever compromised) script-injection/data-exfiltration attacks against the Supabase session token stored in `localStorage`.

**Fix applied:** Added a `headers` block in `vercel.json` applying to all routes:
- `Content-Security-Policy` — restricts scripts/connect to `'self'` and Supabase, images to self/https/data URIs, blocks framing (`frame-ancestors 'self'`). `style-src` keeps `'unsafe-inline'` because the app uses React inline `style={{...}}` extensively — removing it would break the UI, which was out of scope.
- `Strict-Transport-Security` — forces HTTPS for a year including subdomains.
- `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` disabling camera/mic/geolocation/payment (none are used by this app).
- The serverless function itself also now sets its own copy of the frame/content-type/referrer headers, in case it's ever invoked outside the `vercel.json` header pipeline.

### #5 — No `.gitignore` (Medium)
There was no `.gitignore` at all, meaning `node_modules/`, `dist/`, and any future `.env` file would be committed by default — this is exactly how secrets like finding #2 end up in git history permanently.

**Fix applied:** Added a standard `.gitignore` covering `node_modules/`, build output, `.env*` files, editor/OS cruft, and logs.

### #6 — Unescaped values interpolated into HTML meta tags (Low–Medium)
`api/doc.js` builds `<title>`/`<meta>` tags using `doc.customer_name` and `doc.document_number` pulled straight from the database, with no HTML-escaping. A customer name or document number containing `<`, `>`, or `"` (however unlikely in normal use) could break out of the attribute/tag context in the rendered HTML.

**Fix applied:** Added an `escapeHtml()` helper and applied it to `title`, `description`, and `logoUrl` before they're spliced into the HTML.

### #7 — Verbose console logging of business data (Low)
Numerous `console.log` calls in `db.ts` and `App.tsx` printed full document objects (customer name, address, GSTIN, totals) to the browser console unconditionally, including in production.

**Fix applied:** Wrapped all such `console.log` calls in `if (import.meta.env.DEV)`, so they still work during local development but are stripped of effect in production builds. No behavior change, no UI change.

### #8 — No idle-session expiry (Low)
Supabase sessions persist indefinitely in `localStorage` with no client-side inactivity timeout, so a logged-in session left open on a shared/public computer stays authenticated forever.

**Fix applied:** Added a 30-minute inactivity timer in `App.tsx` (only active when a Supabase user is logged in) that calls the existing `handleLogout()` after 30 minutes with no mouse/keyboard/touch/scroll activity. Purely additive — doesn't change any existing login/logout flow or UI.

### #9 — No input validation on the `id` query param (Low, defense-in-depth)
`api/doc.js` passed `req.query.id` directly into a Supabase REST filter string. Supabase's PostgREST layer safely handles this server-side, so this wasn't independently exploitable, but validating input shape early is good practice and cheap insurance.

**Fix applied:** Added a UUID-format regex check before using `id` in any query; requests with a malformed ID just fall through to the generic/default OG metadata instead of hitting the database.

---

## 3. Things I checked and found already secure (no changes needed)

- **No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `document.write` anywhere** in the codebase — React's default escaping protects against XSS across all components (Documents, Customers, Services, DocumentEditor, DocumentPreview, Settings).
- **PDF/document generation** uses the browser's native `window.print()` on the already-escaped React DOM — no raw HTML string injection into printed output.
- **No SQL/NoSQL/command injection surface** — all DB access goes through the Supabase JS client, which parameterizes every call; there's no raw SQL built from user input anywhere in application code.
- **WhatsApp share links** (`wa.me/...`) properly `encodeURIComponent()` the message text.
- **File "uploads"** (logo/seal) are never sent to a server — they're resized via `<canvas>` client-side and stored as base64 in the profile record, so arbitrary file-type upload isn't a meaningful attack surface here (a non-image file simply fails to load as an `Image` and never gets converted).
- **`npm audit`** against the committed lockfile reports **0 known vulnerabilities** in current dependencies.
- **CSRF**: not applicable in the traditional sense — this app doesn't use cookie-based session auth for state-changing requests; Supabase's client SDK sends the session token via `Authorization` header, which isn't automatically attached by a browser to cross-site requests the way cookies are.
- **Google Sheets webhook** (`Settings` → integrations) is a user-supplied URL fetched directly from the *browser*, not from a server — so it's not a server-side SSRF vector.

---

## 4. Files modified

| File | Change |
|---|---|
| `src/services/db.ts` | Enabled RLS + added ownership/public-read policies in `SQL_SCHEMA`; gated `console.log` calls behind `DEV` check |
| `api/doc.js` | Removed hardcoded Supabase URL/key → env vars; generic error responses; HTML-escaping; added security headers; UUID validation on `id` |
| `vercel.json` | Added global security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) |
| `src/App.tsx` | Added 30-minute idle-session auto-logout; gated `console.log` calls behind `DEV` check |
| `.gitignore` | **New file** — excludes `node_modules`, `dist`, `.env*`, editor/OS files |
| `.env.example` | **New file** — documents required environment variables for both the Vite app and the serverless function |

No component markup, styling, routing, or feature behavior was changed. `tsc -b` and `vite build` both run clean after all changes.

---

## 5. Recommended next steps (beyond this audit's scope)

1. **Run the updated `SQL_SCHEMA` against your live Supabase project today** — this is the single highest-impact action, since RLS is currently off in production.
2. **Rotate the Supabase anon key** now that it's been in source control, then set the new value only via Vercel environment variables.
3. Check your GitHub repo (`tiaranexus-collab/...`) history — if this file with the hardcoded key was ever pushed, consider it exposed even after removal, since old commits remain in git history unless you rewrite it.
4. Consider enabling **Supabase's built-in leaked-password protection** and requiring stronger passwords in Auth settings (2FA is available as a Supabase Auth feature if you want it — currently not enabled in this app's sign-up flow).
5. Add basic rate limiting in front of `api/doc.js` (e.g., Vercel Firewall / Upstash Ratelimit) since it's an unauthenticated, publicly reachable endpoint.
6. Longer-term: code-split the ~540KB JS bundle (Vite already warns about this) — not a security issue, but worth knowing.
