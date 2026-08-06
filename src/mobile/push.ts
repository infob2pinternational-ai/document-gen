import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { dbService } from '../services/db';
import type { CompanyProfile } from '../types';

/**
 * Native push notification setup for the owner mobile app (Phase 5).
 *
 * Uses @capacitor/push-notifications (real native FCM, delivered even
 * when the app is backgrounded or killed) instead of the web app's
 * browser-based src/services/fcm.ts - that one depends on a service
 * worker (`/billing/sw.js`) and the browser Notification API, neither
 * of which exist the same way inside a Capacitor native WebView.
 *
 * Registers into the exact same `approver_devices` table via the exact
 * same dbService.registerApproverDevice() the desktop app's Settings
 * page already uses - not a parallel registration path. The server side
 * (src/services/push.ts -> api/doc.js's FCM HTTP v1 call) needs no
 * changes at all: it sends to whatever token it's given, regardless of
 * which platform obtained it.
 *
 * IMPORTANT - approver_devices.company_id is UNIQUE in the schema: there
 * is only ever one registered device per company, by design (it
 * predates this app being used by every employee). Now that B2P ONE is
 * a single app for the whole team (Phase 8, section 3), registering
 * unconditionally here would let ANY employee who opens the app and
 * grants notification permission silently overwrite the real approver's
 * token, stealing their approval notifications. The caller (OwnerApp.tsx)
 * MUST only invoke this for the user who is actually the designated
 * approver (activeProfile.approver_email) - see isApprover below.
 *
 * Requires android/app/google-services.json (a real file generated from
 * this app's Firebase console registration, tied to its signing
 * certificate) to actually receive messages at runtime.
 * android/app/build.gradle already only applies the Firebase Gradle
 * plugin when that file is present, so its absence doesn't break the
 * build - notifications just silently won't arrive until it's added.
 */

let setupStarted = false;

export function isNativePushSupported(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Registers this device for push notifications and wires up the
 * deep-link handler for when a notification is tapped. Safe to call
 * multiple times (e.g. on every login) - only runs its setup once per
 * app session. `isApprover` must be true or this is a no-op - see the
 * file-level comment on why (one device slot per company).
 */
export async function setupPushNotifications(
  activeProfile: CompanyProfile,
  isApprover: boolean,
  onNotificationTapped: (documentId: string) => void
): Promise<void> {
  if (!isNativePushSupported() || setupStarted || !isApprover) return;
  setupStarted = true;

  try {
    let status = await PushNotifications.checkPermissions();
    if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
      status = await PushNotifications.requestPermissions();
    }
    if (status.receive !== 'granted') {
      console.warn('[Mobile Push] Notification permission not granted; skipping registration.');
      return;
    }

    await PushNotifications.addListener('registration', (token) => {
      dbService.registerApproverDevice(activeProfile.id, token.value, 'B2P ONE App')
        .catch(err => console.error('[Mobile Push] Failed to save device token:', err));
    });

    await PushNotifications.addListener('registrationError', (err) => {
      console.error('[Mobile Push] Registration error:', err);
    });

    // Tapped from the notification tray - whether the app was
    // backgrounded or cold-started by the tap - deep-link straight to
    // the document named in the payload's data.documentId (set by
    // sendApprovalNotification in services/push.ts).
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const documentId = action.notification?.data?.documentId;
      if (documentId) onNotificationTapped(documentId);
    });

    await PushNotifications.register();
  } catch (err) {
    console.error('[Mobile Push] Setup failed:', err);
  }
}
