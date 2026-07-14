const CACHE_NAME = 'b2p-portal-cache-v1';
const urlsToCache = [
  '/billing/',
  '/billing/index.html',
  '/billing/logo_b2p.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

// Handle Background Push Notifications from FCM
self.addEventListener('push', event => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { notification: { title: 'B2P Document Portal', body: event.data.text() } };
    }
  }

  // Extract FCM payload
  const notification = data.notification || {};
  const payloadData = data.data || {};
  const title = notification.title || payloadData.title || 'B2P Document Portal';
  const body = notification.body || payloadData.body || 'A new document requires action.';

  const options = {
    body: body,
    icon: '/billing/logo_b2p.png',
    badge: '/billing/favicon.svg',
    tag: payloadData.documentId || 'approval-alert',
    data: {
      documentId: payloadData.documentId,
      documentNumber: payloadData.documentNumber
    },
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    requireInteraction: true
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Handle Notification Actions & Tapping (Deep Linking)
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const docId = event.notification.data?.documentId;
  // Route to the app with the previewDocId query param
  const url = docId ? `/billing/?previewDocId=${docId}` : '/billing/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing window and navigate if available
      for (let client of windowClients) {
        if (client.url.includes('/billing/') && 'focus' in client) {
          return client.focus().then(() => {
            if ('navigate' in client) {
              return client.navigate(url);
            }
          });
        }
      }
      // Open new window if none exists
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
