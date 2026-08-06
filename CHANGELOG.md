# Changelog

## B2P ONE Mobile — v2.0.0 (unreleased)

Relaunch of the owner-only mobile app as **B2P ONE** — a single application
for every employee, with role-based module access.

### Added
- **Role-based access** (`src/mobile/roles.ts`): one app for every employee
  (Owner, Manager, Sales, Accounts, Designer, Technician, Staff). Which tabs
  and actions are visible is driven by a single role → module map, read
  from the same `user_metadata.role` field the desktop app already uses.
  No separate apps, no new backend schema.
- **Approve / Reject** documents from the mobile app, gated by the same
  `approver_email` rule as desktop, layered under the role check.
- **Edit** documents from mobile — reuses the desktop `DocumentEditor`
  component directly (same save/GST/draft logic, not reimplemented).
- **Push notifications** (native FCM via `@capacitor/push-notifications`)
  with tap-to-deep-link straight to the relevant document. Registration is
  restricted to the designated approver only (the backend's
  `approver_devices` table holds one device per company — registering for
  every employee would let anyone's device silently steal the approver's
  notification slot; fixed before this could ship).
- **Dashboard**: Revenue and Outstanding tiles, sharing one calculation
  (`src/utils/dashboardStats.ts`) with the desktop Dashboard instead of a
  second copy of the same logic.
- **Logout** and **pull-to-refresh** (previously missing from the mobile
  shell).
- Rebranded throughout: **B2P Owner / Owner App / Owner Mobile → B2P ONE**.

### Fixed
- **Mobile data loading**: Home/Documents/Customers/Services were rendering
  empty despite a working login — `dbService`'s cloud/local routing flag
  was never being set by the mobile app's own auth flow, so every query
  silently read from empty local storage instead of Supabase.
- **Draft Recovery**: a draft was lost when switching browser tabs,
  minimizing, or moving to another window (desktop). Root cause was an
  editor re-initialization effect re-running on unrelated state churn.
- **GST visibility**: non-GST documents (Preview, PDF/Print, and the save
  confirmation dialog) no longer show a "GST 0%" / "₹0.00" row.
- Two duplicated utility functions found during the mobile build
  (document-type label, phone-number normalization) and one duplicated
  style object, consolidated to single shared implementations.

### Known limitations
- **No release APK/AAB was produced by this change** — this development
  environment has no Android SDK, and the Android Gradle Plugin's own
  Maven repository (`dl.google.com`) is blocked by network policy, so
  `gradle assembleRelease`/`bundleRelease` cannot run here. All code,
  config, and the Capacitor-synced Android project are ready to build on
  a machine with the Android SDK.
- **Push notifications require `android/app/google-services.json`** — a
  real file from this app's Firebase console registration, not included
  in source control. The build succeeds without it; notifications simply
  won't be delivered until it's added.
- No release keystore/signing config is present — required for
  `assembleRelease`/`bundleRelease` to produce an installable, distributable
  artifact.
- The default role → module permission matrix in `src/mobile/roles.ts` is
  a proposed starting point, not a confirmed business decision — review
  and adjust if it doesn't match actual company policy.
- No offline cache in the mobile app.
- No automated tests (unit or Android instrumentation) exist for this
  project.
