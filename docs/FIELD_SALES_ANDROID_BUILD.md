# Field Sales: Android build and install instructions

This covers building the B2P ONE Capacitor Android app with the Field Sales screens and
installing it for internal testing. **Nothing here deploys or publishes anything** — it stops at
an installable `.apk` file.

## What was actually verified in this session, and what was not

This cloud session has no Android SDK, no emulator, no physical device, and no network access to
download the Android SDK or Gradle dependencies (confirmed: `./gradlew tasks --offline` fails with
`No cached version of com.android.tools.build:gradle:8.13.0 available for offline mode`). So:

- **Verified here:** `npm run cap:sync` (which runs `npm run build:mobile` — the web build that
  includes the new Field Sales screens — then `npx cap sync android`) completes successfully. The
  Field Sales screens are correctly bundled into `dist/mobile` and copied into
  `android/app/src/main/assets/public`. This confirms the web→native handoff works; it does not
  confirm the native Android build itself compiles or that the app runs correctly inside the
  WebView.
- **Not verified here, and genuinely requires a machine with the Android SDK:** `./gradlew
  assembleDebug` (or opening the project in Android Studio), installing the APK, and any on-device
  behavior (push notifications, status bar, back-button handling, WebView quirks, real offline/online
  transitions on a cellular connection).

Do this on a developer machine with Android Studio installed, not in this cloud session.

## 1. Build

```bash
npm install
npm run cap:sync
```

This runs, in order: `tsc -b`, the mobile Vite build (`vite.mobile.config.ts` → `dist/mobile`),
then `npx cap sync android` (copies the web bundle into the native project and updates Capacitor
plugins). Re-run this any time the web code changes; it is safe to run repeatedly.

`.env.local` must have real values before this build for the sync queue and Supabase client to
work at runtime (see `.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and
`VITE_PUBLIC_BASE_URL` (needed because Capacitor's `window.location.origin` is a synthetic local
address, which would otherwise break WhatsApp share links sent from the native app — this is
pre-existing, documented in `PROJECT_HANDOFF.md`, unrelated to Field Sales).

## 2. Open and build in Android Studio

```bash
npm run cap:open
```

This opens `android/` in Android Studio (it must already be installed, with an Android SDK —
Android Studio's first-run wizard installs one if you do not have it). Let Gradle sync finish (it
needs internet access the first time, to download the Android Gradle Plugin and dependencies).

To build a debug APK without opening the IDE:

```bash
cd android
./gradlew assembleDebug
```

The output APK is at `android/app/build/outputs/apk/debug/app-debug.apk`.

## 3. Install on a physical device (recommended) or emulator

**Physical device** (recommended — this is explicitly a field-use, often-offline, touch-driven
app; an emulator cannot exercise real airplane-mode/cellular transitions or real touch-target
sizing):

1. On the phone: Settings → About phone → tap "Build number" 7 times to enable Developer
   Options, then Settings → Developer Options → enable "USB debugging".
2. Connect the phone via USB, accept the "Allow USB debugging?" prompt on the phone.
3. `adb devices` should list it.
4. From Android Studio, click Run, or: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`

**Emulator:** create one via Android Studio's Device Manager (a mid-range device profile, Android
13+ is a reasonable default matching most field devices), then Run from Android Studio.

## 4. On-device test script (to run once a device is available)

This exercises exactly the items the security review asked to be checked on Android, using a real
`sales` test account (see `database/FIELD_SALES_DEPLOYMENT.md`, "Adding a salesperson" — create a
throwaway one for this, and remove it afterward with "Removing a salesperson").

1. **Role gating on Android.** Sign in as the test `sales` account. Confirm only the Field Visits
   screens appear (no Documents/Customers/Services tabs, no owner/admin screens reachable by
   typing a URL — there is no URL bar in the WebView, so this is a stronger boundary on Android
   than on the web browser build).
2. **New visit, large touch targets.** Create a visit. Confirm every button and input is
   comfortably tappable with a thumb, the on-screen keyboard does not cover the field being typed
   into, and the numeric keypad appears for the phone field.
3. **Real offline behavior.** Enable Airplane Mode on the device (not just the app's own "offline"
   simulation — a real radio-off state). Create and submit a visit. Confirm it shows "Waiting to
   send". Force-close the app (not just background it) from Android's recent-apps view. Reopen it.
   Confirm the draft/waiting visit is still there (this proves storage survives a real process
   kill, which the browser tests cannot simulate exactly the same way Android does).
4. **Reconnect.** Disable Airplane Mode. Confirm the visit sends automatically within the next
   sync interval, without reopening the app.
5. **Shared-device sign-out.** With the visit still unsent, enable Airplane Mode again, submit
   another visit, then sign out while still offline. Confirm sign-out succeeds and returns to the
   login screen (this is the exact bug fixed earlier in this engagement for the web build —
   confirm the same fix holds on Android's WebView, which has its own, separate localStorage from
   the desktop browser used for the earlier Playwright tests).
6. Sign in as a **different** test account on the same device. Confirm the first salesperson's
   unsent visit is not visible or sendable from the second account.
7. **Office review, if an owner/admin test account is also used on this device:** approve a visit,
   convert it to a lead, confirm it appears correctly (this screen is desktop-oriented; on a phone
   screen it should still be usable per the existing phone-width Playwright test, but worth a
   glance on a real device).

Record the device model, Android version, and pass/fail for each numbered item in this file's
section above (or wherever the team tracks test results) before considering this internally
deployable — the browser-based tests in this repository use a real browser engine but not the
Capacitor WebView or Android's own process-lifecycle, backup, and storage behavior.

## 5. Known gaps specific to the native build

- `android:allowBackup` was changed from `true` to `false` in this review (see
  `android/app/src/main/AndroidManifest.xml`) because Android's device backup would otherwise
  include the WebView's localStorage — which can hold unsynced field-visit drafts (business name,
  phone, contact, location, remarks) in plain text. This has not been tested on a device; confirm
  the app still installs, runs and (if the team relies on Android's backup/restore for anything
  else in this app, which nothing in the codebase currently does) that nothing else depended on it.
- No photo, GPS, or map capture (unchanged from the original Field Sales scope).
- Push notifications (`@capacitor/push-notifications`) are wired for the existing owner approval
  flow; Field Sales does not add any new push notification, and none was added or tested here.
