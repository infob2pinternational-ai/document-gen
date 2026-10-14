# WhatsApp UI-only release

Base: production main cabe69b7dc560899961c288ec615d963df681f32 (includes PR #18).

Includes responsive bounded workspace, independent list/history scrolling, persistent composer, Enter/Shift+Enter and IME handling, synchronous duplicate-click lock, retained scroll position, stale-history response guard, loading/offline/error presentation, and company/user/conversation-scoped local text drafts. Company switching clears the visible conversation; legacy rows without a company are not reassigned or shown as another company's conversations.

API, server, schema, migrations, Vercel configuration, message services, document-send helpers, types and current CRM implementation are byte-for-byte unchanged from the base. Sends still use /api/whatsapp?action=send-message with the existing fields and acceptance response. There is no new persisted flag requirement, request-ID contract, media upload or capability request. Unsupported attachment controls are omitted.

Draft storage is browser-local plaintext convenience, not authorization, encryption or cross-device sync. Only provider acceptance confirmed by the existing service clears an unchanged submitted draft; later text is preserved. Failed/network-loss results retain text and do not automatically retry. The existing backend cannot guarantee idempotent retries or reconcile uncertain delivery; no durable retry feature is claimed. Check delivery before any manual retry. Closing during a storage failure may lose unpersisted text. No hosted Auth/RLS, Storage or recipient delivery is certified.

Local verification: 256 Node tests; 18 desktop/mobile WhatsApp browser scenarios; 47 current-main CRM/document browser scenarios all passed. TypeScript and production-format Vite build passed. Existing lint/build warnings remain recorded in the release report. The initial App prop placement typo was caught by TypeScript and corrected before passing checks.

Run browser tests with the loopback network guard:

    $taskGuard = (Resolve-Path verification/offline-node-network.cjs).Path.Replace('\','/')
    $env:NODE_OPTIONS = '--require="' + $taskGuard + '"'
    node node_modules/@playwright/test/cli.js test --config playwright.whatsapp-ui.config.ts
    node node_modules/@playwright/test/cli.js test --config playwright.isolated-verification.config.ts tests/leads tests/followups tests/regression tests/reliability

The dated CRM fixtures reuse the reviewed fixed clock; no CRM application behavior was changed. Verification fixtures are local DEV entry points, absent from the production build. Logs and generated artifacts are not committed.

Deployment: push this separate branch, verify its Git-integrated Preview, then merge through the repository's PR workflow only after compatible preview checks pass. Main's Git integration deploys the resulting merge commit; do not create a second production deployment. No database or provider configuration operation is required or authorized.
