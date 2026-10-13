/**
 * Firebase Cloud Messaging (FCM) Service Worker
 * Maneja la recepción de notificaciones Push cuando la aplicación web está cerrada o en segundo plano.
 */

importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

// Parámetros de configuración pasados al registrar el Service Worker o valores por defecto
const urlParams = new URLSearchParams(self.location.search);
const configParam = urlParams.get('config');

let firebaseConfig = {
  apiKey: "AIzaSyADWBBgbALAnf1yFUzK2wKmYM4ptlqHpJ4",
  authDomain: "quadient-latam-app-demo.firebaseapp.com",
  projectId: "quadient-latam-app-demo",
  storageBucket: "quadient-latam-app-demo.firebasestorage.app",
  messagingSenderId: "342103810833",
  appId: "1:342103810833:web:10f01ce15c8682f5ba62b0"
};

if (configParam) {
  try {
    firebaseConfig = JSON.parse(decodeURIComponent(configParam));
  } catch (e) {
    console.warn('[SW] No se pudo parsear config param:', e);
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

try {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Mensaje recibido en segundo plano:', payload);

    // IMPORTANTE: Si el mensaje contiene payload.notification, el SDK de Firebase
    // se encarga automáticamente de mostrar la notificación en el sistema.
    // Solo mostramos una notificación manual si es un mensaje data-only (sin payload.notification)
    // para evitar que el usuario reciba NOTIFICACIONES DUPLICADAS.
    if (!payload.notification) {
      const notificationTitle = payload.data?.pushTitle || payload.data?.title || 'Nuevo mensaje en tu Inbox';
      const inboxId = payload.data?.inboxId || '';
      const targetUrl = inboxId ? `/?inboxId=${inboxId}` : (payload.data?.url || '/');

      const notificationOptions = {
        body: payload.data?.pushBody || payload.data?.body || 'Tienes un nuevo contenido disponible.',
        icon: '/assets/icon-192.png',
        badge: '/assets/badge-72.png',
        data: {
          inboxId: inboxId,
          url: targetUrl
        },
        tag: inboxId ? `inbox-${inboxId}` : `push-${Date.now()}`,
        requireInteraction: true
      };

      return self.registration.showNotification(notificationTitle, notificationOptions);
    }
  });
} catch (err) {
  console.log('[SW] Firebase Messaging en SW:', err.message);
}

// Al hacer clic en la notificación recibida en el dispositivo
self.addEventListener('notificationclick', function(event) {
  console.log('[SW] Clic en notificación:', event.notification);
  event.notification.close();

  // Extraer el inboxId y URL tanto de data directa como de la estructura interna FCM_MSG
  const notifData = event.notification.data || {};
  const fcmMsg = notifData.FCM_MSG || {};
  const fcmData = fcmMsg.data || {};

  const inboxId = notifData.inboxId || fcmData.inboxId || notifData.id || fcmData.id || '';
  let targetUrl = notifData.url || fcmData.url || (inboxId ? '/?inboxId=' + inboxId : '/');

  // Convertir a URL absoluta
  const fullTargetUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 1. Si ya hay una ventana/pestaña abierta de la app, enfocarla y enviarle el mensaje
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if (inboxId) {
            client.postMessage({
              type: 'OPEN_INBOX_ITEM',
              inboxId: inboxId
            });
          }
          // Si el cliente no estaba en esa ruta exacta, navegarlo
          if (inboxId && !client.url.includes(`inboxId=${inboxId}`) && 'navigate' in client) {
            client.navigate(fullTargetUrl);
          }
          return client.focus();
        }
      }
      // 2. Si la app estaba cerrada, abrir una nueva ventana con la URL del item
      if (clients.openWindow) {
        return clients.openWindow(fullTargetUrl);
      }
    })
  );
});
