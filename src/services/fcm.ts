import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage, type Messaging } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ''
};

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';

export const isFirebaseConfigured = (): boolean => {
  return !!(
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.messagingSenderId &&
    firebaseConfig.appId
  );
};

let messaging: Messaging | null = null;

try {
  if (isFirebaseConfigured() && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    const apps = getApps();
    const app = apps.length === 0 ? initializeApp(firebaseConfig) : apps[0];
    messaging = getMessaging(app);
  }
} catch (err) {
  console.warn('Firebase Messaging initialization failed:', err);
}

export const requestNotificationPermission = async (): Promise<boolean> => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  const permission = await Notification.requestPermission();
  return permission === 'granted';
};

export const getFCMToken = async (serviceWorkerRegistration?: ServiceWorkerRegistration): Promise<{ token: string | null; error?: string }> => {
  if (!messaging) {
    return { token: null, error: 'FCM is not initialized or not supported.' };
  }
  try {
    const permissionGranted = await requestNotificationPermission();
    if (!permissionGranted) {
      return { token: null, error: 'Notification permission was denied.' };
    }
    
    if (!vapidKey) {
      return { token: null, error: 'VITE_FIREBASE_VAPID_KEY is missing.' };
    }
    
    // Resolve or register the service worker explicitly to ensure Firebase maps it correctly
    let swReg = serviceWorkerRegistration;
    if (!swReg && 'serviceWorker' in navigator) {
      try {
        swReg = await navigator.serviceWorker.register('/billing/sw.js');
        
        // Wait for the Service Worker to become active if it isn't already
        if (swReg && !swReg.active) {
          console.log('[FCM] ServiceWorker is registering but not active yet. Waiting for activation...');
          const activeReg = swReg;
          await new Promise<void>((resolve) => {
            const worker = activeReg.installing || activeReg.waiting;
            if (!worker) {
              resolve();
              return;
            }
            
            const stateChangeHandler = () => {
              if (worker.state === 'activated') {
                worker.removeEventListener('statechange', stateChangeHandler);
                resolve();
              }
            };
            worker.addEventListener('statechange', stateChangeHandler);
            
            // Safety timeout after 5 seconds to prevent hanging the UI
            setTimeout(resolve, 5000);
          });
        }
      } catch (err) {
        console.warn('[FCM] Explicit ServiceWorker registration failed, searching fallbacks:', err);
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          swReg = regs.find(r => r.scope.includes('/billing')) || regs[0];
        } catch (e) {
          console.warn('Failed to get registrations:', e);
        }
      }
    }
    
    const token = await getToken(messaging, { 
      vapidKey,
      serviceWorkerRegistration: swReg || undefined
    });
    return { token };
  } catch (err) {
    console.error('Error retrieving FCM token:', err);
    return { token: null, error: err instanceof Error ? err.message : String(err) };
  }
};

export const onMessageListener = (callback: (payload: any) => void) => {
  if (messaging) {
    return onMessage(messaging, callback);
  }
  return () => {};
};
