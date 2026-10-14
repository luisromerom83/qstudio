/**
 * Módulo de Notificaciones Push (Firebase Cloud Messaging - FCM)
 * Gestiona permisos del navegador, registro de Service Worker, obtención de tokens y recepción en primer plano.
 */

const fcmStatusBadge = document.getElementById('fcm-status-badge');
const toastNotification = document.getElementById('toast-push-notification');
const toastNotificationTitle = document.getElementById('toast-push-title');
const toastNotificationBody = document.getElementById('toast-push-body');
const toastNotificationTime = document.getElementById('toast-push-time');
let currentFcmToken = null;
let swRegistration = null;
let fcmBadgeState = null; // último estado mostrado, para redibujarlo al cambiar de idioma

/**
 * Actualiza la apariencia del badge de estado de Notificaciones en la barra superior
 */
function updateFcmBadge(status, iconHtml, labelKey, className = 'bg-secondary') {
  if (!fcmStatusBadge) return;
  fcmBadgeState = { status, iconHtml, labelKey, className };
  fcmStatusBadge.className = `badge badge-fcm ${className}`;
  fcmStatusBadge.innerHTML = `${iconHtml} ${t(labelKey)}`;
}

window.addEventListener('studio:languagechange', () => {
  if (fcmBadgeState) {
    const { status, iconHtml, labelKey, className } = fcmBadgeState;
    updateFcmBadge(status, iconHtml, labelKey, className);
  } else if (fcmStatusBadge) {
    fcmStatusBadge.innerHTML = `<i class="bi bi-bell"></i> ${t('inbox.fcm.checking')}`;
  }
});

/**
 * Registra el Service Worker de FCM
 */
async function registerFCMServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('Este navegador no soporta Service Workers.');
    return null;
  }

  try {
    const configStr = encodeURIComponent(JSON.stringify(window.firebaseConfig || {}));
    const swUrl = `firebase-messaging-sw.js?config=${configStr}`;

    const reg = await navigator.serviceWorker.register(swUrl);
    console.log('✅ Service Worker de FCM registrado con éxito:', reg.scope);
    swRegistration = reg;

    // Escuchar mensajes enviados desde el Service Worker (por ejemplo cuando se hace clic en una notificación)
    navigator.serviceWorker.addEventListener('message', (event) => {
      console.log('Mensaje recibido desde Service Worker:', event.data);
      if (event.data && event.data.type === 'OPEN_INBOX_ITEM' && event.data.inboxId) {
        if (typeof window.selectInboxItem === 'function') {
          window.selectInboxItem(event.data.inboxId);
        }
      }
    });

    return reg;
  } catch (err) {
    console.error('❌ Error registrando Service Worker:', err);
    return null;
  }
}

/**
 * Solicita permiso al usuario y obtiene el Token de FCM
 */
async function checkAndRequestFCMToken(isUserInitiated = false) {
  if (!('Notification' in window)) {
    updateFcmBadge('unsupported', '<i class="bi bi-x-circle"></i>', 'inbox.fcm.unsupported', 'bg-secondary');
    return;
  }

  if (!window.isFirebaseConfigured) {
    updateFcmBadge('pending_config', '<i class="bi bi-gear"></i>', 'inbox.fcm.pendingConfig', 'bg-warning text-dark');
    return;
  }

  const permission = Notification.permission;

  if (permission === 'denied') {
    updateFcmBadge('denied', '<i class="bi bi-slash-circle-fill"></i>', 'inbox.fcm.blocked', 'bg-danger');
    if (isUserInitiated) {
      alert(t('inbox.fcm.blockedAlert'));
    }
    return;
  }

  if (permission === 'default' && !isUserInitiated) {
    updateFcmBadge('prompt', '<i class="bi bi-bell-fill"></i>', 'inbox.fcm.prompt', 'bg-warning text-dark');
    return;
  }

  try {
    updateFcmBadge('loading', '<span class="spinner-border spinner-border-sm me-1"></span>', 'inbox.fcm.connecting', 'bg-info text-dark');

    // Solicitar permiso si no ha sido otorgado
    const userPermission = await Notification.requestPermission();
    if (userPermission !== 'granted') {
      updateFcmBadge('denied', '<i class="bi bi-bell-slash"></i>', 'inbox.fcm.rejected', 'bg-danger');
      return;
    }

    // Registrar Service Worker si no está listo
    if (!swRegistration) {
      swRegistration = await registerFCMServiceWorker();
    }

    if (!window.messaging) {
      updateFcmBadge('error', '<i class="bi bi-exclamation-triangle"></i>', 'inbox.fcm.messagingUnavailable', 'bg-danger');
      return;
    }

    // Opciones para getToken
    const tokenOptions = {
      serviceWorkerRegistration: swRegistration
    };

    if (window.firebaseVapidKey && !window.firebaseVapidKey.includes('TU_VAPID_PUBLIC_KEY')) {
      tokenOptions.vapidKey = window.firebaseVapidKey;
    }

    const token = await window.messaging.getToken(tokenOptions);

    if (token) {
      currentFcmToken = token;
      console.log('🎯 Token FCM obtenido con éxito:', token);
      updateFcmBadge('active', '<span class="pulse-dot"></span>', 'inbox.fcm.active', 'bg-success text-white');

      // Guardar token en Firestore y notificar al servidor
      if (window.currentUser) {
        await saveTokenToFirestore(token, window.currentUser.uid, window.currentUser.email);
      }
    } else {
      console.warn('No se pudo obtener el token de registro de FCM.');
      updateFcmBadge('no-token', '<i class="bi bi-exclamation-circle"></i>', 'inbox.fcm.noToken', 'bg-warning text-dark');
    }
  } catch (err) {
    console.error('Error al obtener Token FCM:', err);
    updateFcmBadge('error', '<i class="bi bi-exclamation-triangle"></i>', 'inbox.fcm.error', 'bg-danger text-white');
  }
}

/**
 * Guarda el token en Firestore y llama al endpoint de registro
 */
async function saveTokenToFirestore(token, userId, userEmail) {
  try {
    // 1. Guardar en Firestore directamente
    if (window.db) {
      await window.db.collection('users').doc(userId).collection('fcmTokens').doc(token).set({
        token: token,
        userAgent: navigator.userAgent,
        updatedAt: new Date().toISOString(),
        userEmail: userEmail || ''
      }, { merge: true });
    }

    // 2. Notificar al backend Express
    await fetch('api/inbox/register-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        userEmail,
        token,
        userAgent: navigator.userAgent
      })
    });

    console.log('💾 Token FCM guardado en Firestore y servidor');
  } catch (err) {
    console.warn('Advertencia al registrar token en servidor:', err.message);
  }
}

/**
 * Manejador de notificaciones recibidas en PRIMER PLANO (Foreground)
 */
if (window.messaging) {
  window.messaging.onMessage((payload) => {
    console.log('📬 Notificación Push recibida en primer plano:', payload);

    const title = payload.notification?.title || payload.data?.pushTitle || payload.data?.title || t('inbox.toast.fallbackTitle');
    const body = payload.notification?.body || payload.data?.pushBody || t('inbox.toast.fallbackBody');
    const inboxId = payload.data?.inboxId;

    // Mostrar Toast de Bootstrap
    showPushToast(title, body, inboxId);

    // Sonido sutil opcional
    playNotificationChime();
  });
}

/**
 * Muestra el Toast de Bootstrap 5 con el contenido de la push notification
 */
function showPushToast(title, body, inboxId) {
  if (!toastNotification) return;

  if (toastNotificationTitle) toastNotificationTitle.textContent = title;
  if (toastNotificationBody) toastNotificationBody.textContent = body;
  if (toastNotificationTime) toastNotificationTime.textContent = t('inbox.toast.now');

  const toastElement = new bootstrap.Toast(toastNotification, {
    autohide: true,
    delay: 8000
  });

  // Al hacer clic en el toast, abrir el elemento correspondiente
  toastNotification.onclick = () => {
    if (inboxId && typeof window.selectInboxItem === 'function') {
      window.selectInboxItem(inboxId);
    }
  };

  toastElement.show();
}

/**
 * Efecto de audio agradable para notificación
 */
function playNotificationChime() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.35);
  } catch (e) {
    // Ignorar si el audio context está bloqueado por el navegador
  }
}

// Evento al hacer clic en el badge para solicitar permisos
if (fcmStatusBadge) {
  fcmStatusBadge.addEventListener('click', () => {
    checkAndRequestFCMToken(true);
  });
}

// Inicializar Service Worker al cargar la página
window.addEventListener('load', () => {
  registerFCMServiceWorker();
});

// Exportar funciones globalmente
window.checkAndRequestFCMToken = checkAndRequestFCMToken;
window.showPushToast = showPushToast;
