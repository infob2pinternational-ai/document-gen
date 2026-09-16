# Repository review and fixes — 16 September 2026

Reviewed baseline: `0a91d51`. Scope: installation/build checks and targeted review of document calculations, draft recovery, company service loading, WhatsApp messaging and push endpoints. This is not a certification of every module or the production database.

## Fixed

- Clean installation failed because `@emnapi/runtime` was missing from the lockfile. Regenerated dependency metadata without changing declared dependency versions.
- Draft migration deleted source data even when destination storage failed. Both migration paths now preserve the original until required writes succeed; index-write failures propagate as failed saves.
- Closing an editor after the session autosave but before the recovery timer left the durable draft stale. Flush now writes both layers, editor cleanup cancels timers, and pagehide flushes pending state. Timers start only after edits, avoiding timers from discarded React initializers.
- Draft tab IDs now use the existing UUID compatibility helper.
- Company data loading fetched all services. It now supplies the selected company ID.
- Amount-in-words formatting could produce undefined text when paise rounded to 100, and Infinity could recurse indefinitely. Round to whole paise before separating rupees and paise, and reject non-finite input.
- WhatsApp and push dispatch endpoints accepted unauthenticated requests. They now validate bearer sessions with Supabase Auth and query company access using the caller's JWT. Browser callers supply the session token. This relies on existing RLS policies; it does not add role-specific authorization or repair broad database policies.
- Incoming WhatsApp events were trusted without a signature. Verify HMAC-SHA256 on the original request bytes before processing; fail closed when the app secret is absent. Removed the hardcoded verification-token fallback.
- WhatsApp missing credentials and network failures could be presented as sent. Missing credentials now return 503; client failures persist as failed. A successful send requires an actual Meta message ID. The local cache now receives the final status instead of remaining queued.
- Successful inbox sends were inserted by both the server and client. Removed the duplicate server insert; the existing authenticated client remains responsible for message-history persistence.
- Push responses exposed private-key fragments and diagnostics in `X-Key-*` headers. Removed those headers.
- A normal configuration predicate named `useCloud` caused six false React-hook lint errors. Renamed it to `isCloudEnabled` without changing its behavior.

## Validation

- `npm ci --ignore-scripts --no-audit --no-fund`: passes (the original lockfile failed).
- `npm test`: 22 passing tests covering calculation edge cases, storage failures and migration retries, timer cleanup, API authentication, signed/tampered webhooks, and final WhatsApp statuses. HTTP and cloud integrations are mocked; no customer messages are sent.
- `npm run build`: passes.
- `npm run build:mobile`: passes; this builds web assets, not an Android APK.
- `npm run lint`: exits successfully with existing warnings; six baseline errors removed.
- `git diff --check`: passes.

## Before deployment

Set `WHATSAPP_APP_SECRET` to the Meta App Secret in the server environment. Ensure `WHATSAPP_VERIFY_TOKEN` is explicitly configured to match Meta, and `SUPABASE_URL` / `SUPABASE_ANON_KEY` (or their existing VITE fallbacks) are available for session verification. Do not put the app secret in a VITE variable.

Verify signed webhooks, authenticated WhatsApp and push delivery, and the Android client in a preview environment before production. Raw-body handling follows Vercel's Node request helper implementation: https://github.com/vercel/vercel/blob/main/packages/node/src/serverless-functions/helpers.ts

## Remaining risks identified

- `saveDocument` updates the header, deletes old line items, then inserts replacements through separate requests. Insert failure can leave missing line items. A complete fix needs a transactional database RPC plus caller changes and database testing; no database changes were made in this patch.
- Company isolation and role enforcement depend on deployed RLS policies. The handoff documents broad authenticated access; production policies were not inspected. The new API checks do not claim to close that separate database issue.
- Client-generated document numbers can race. A database uniqueness constraint may reject the duplicate, but an atomic server-side allocation flow remains separate work.
- Company data requests can finish out of order during rapid profile switching; the service filter fix does not address that broader request race.
- WhatsApp delivery acceptance and history persistence are separate operations. A browser failure after Meta accepts a send can still lose the history entry. Webhook retries can also duplicate inbound processing; a durable server-side idempotency design remains needed.
- Push dispatch checks session/company visibility, but role-specific sending permissions, registered-token enforcement and rate limits remain follow-up hardening.
- Existing React dependency warnings and large-bundle warnings remain. No live database, production deployment, Google Apps Script deployment or physical Android-device verification was performed.
