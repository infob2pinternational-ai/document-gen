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

export const getFCMToken = async (serviceWorkerRegistration?: ServiceWorkerRegistration): Promise<string | null> => {
  if (!messaging) {
    console.warn('FCM is not initialized or not supported.');
    return null;
  }
  try {
    const permissionGranted = await requestNotificationPermission();
    if (!permissionGranted) {
      console.warn('Notification permission was not granted.');
      return null;
    }
    
    if (!vapidKey) {
      console.warn('VITE_FIREBASE_VAPID_KEY is missing from environment variables.');
      return null;
    }
    
    // Resolve the active service worker registration dynamically
    let swReg = serviceWorkerRegistration;
    if (!swReg && 'serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        swReg = regs.find(r => r.active || r.waiting || r.installing) || regs[0];
      } catch (err) {
        console.warn('Failed to get registrations:', err);
      }
      
      if (!swReg) {
        swReg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<any>((resolve) => setTimeout(() => resolve(null), 3000))
        ]);
      }
    }
    
    const token = await getToken(messaging, { 
      vapidKey,
      serviceWorkerRegistration: swReg
    });
    return token;
  } catch (err) {
    console.error('Error retrieving FCM token:', err);
    return null;
  }
};

export const onMessageListener = (callback: (payload: any) => void) => {
  if (messaging) {
    return onMessage(messaging, callback);
  }
  return () => {};
};
