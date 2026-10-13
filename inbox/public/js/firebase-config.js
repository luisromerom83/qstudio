/**
 * Configuración de Firebase para la aplicación cliente.
 * 
 * Puedes ingresar aquí tus credenciales directamente, o bien ingresarlas
 * a través del botón "⚙️ Configurar Firebase" en la interfaz de la aplicación,
 * la cual las guardará de forma segura en el LocalStorage de tu navegador.
 */

// Credenciales activas de Firebase
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyADWBBgbALAnf1yFUzK2wKmYM4ptlqHpJ4",
  authDomain: "quadient-latam-app-demo.firebaseapp.com",
  projectId: "quadient-latam-app-demo",
  storageBucket: "quadient-latam-app-demo.firebasestorage.app",
  messagingSenderId: "342103810833",
  appId: "1:342103810833:web:10f01ce15c8682f5ba62b0",
  measurementId: "G-9W4L1WDWGS"
};

// Clave pública VAPID para Web Push
const DEFAULT_VAPID_KEY = "BI8LfcRgoaF0c3nUSNkjitD2Pn-ONPheA85LyfHcmRBKevI7j9jIezB10_l7ef6u28mU3UTNhR1wShVxObVx1mg";

/**
 * Obtener configuración activa (localStorage o defecto)
 */
function getActiveFirebaseConfig() {
  try {
    const saved = localStorage.getItem('APP_FIREBASE_CONFIG');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.apiKey && parsed.projectId && !parsed.apiKey.includes('TU_API_KEY')) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error leyendo Firebase config de localStorage', e);
  }
  return DEFAULT_FIREBASE_CONFIG;
}

/**
 * Obtener VAPID Key activa
 */
function getActiveVapidKey() {
  const savedVapid = localStorage.getItem('APP_FIREBASE_VAPID_KEY');
  if (savedVapid && !savedVapid.includes('TU_VAPID_PUBLIC_KEY')) {
    return savedVapid;
  }
  return DEFAULT_VAPID_KEY;
}

/**
 * Guardar nueva configuración en localStorage
 */
function saveActiveFirebaseConfig(configObj, vapidKey) {
  if (configObj) {
    localStorage.setItem('APP_FIREBASE_CONFIG', JSON.stringify(configObj));
  }
  if (vapidKey) {
    localStorage.setItem('APP_FIREBASE_VAPID_KEY', vapidKey.trim());
  }
  window.location.reload();
}

/**
 * Limpiar configuración y restaurar por defecto
 */
function resetFirebaseConfigToDefault() {
  localStorage.removeItem('APP_FIREBASE_CONFIG');
  localStorage.removeItem('APP_FIREBASE_VAPID_KEY');
  window.location.reload();
}

// Variables globales para servicios de Firebase
window.firebaseConfig = getActiveFirebaseConfig();
window.firebaseVapidKey = getActiveVapidKey();
window.isFirebaseConfigured = Boolean(
  window.firebaseConfig &&
  window.firebaseConfig.apiKey &&
  !window.firebaseConfig.apiKey.includes('TU_API_KEY') &&
  !window.firebaseConfig.projectId.includes('TU_PROYECTO')
);

let auth = null;
let db = null;
let messaging = null;

try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) {
      firebase.initializeApp(window.firebaseConfig);
    }
    auth = firebase.auth();
    db = firebase.firestore();

    // Habilitar persistencia de auth local
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(err => {
      console.warn('Error persistencia auth:', err);
    });

    // Inicializar Messaging si es soportado por el navegador
    if (firebase.messaging && firebase.messaging.isSupported()) {
      messaging = firebase.messaging();
    } else {
      console.warn('Firebase Messaging no es soportado en este navegador.');
    }
  }
} catch (err) {
  console.error('Error inicializando Firebase SDK:', err);
}

// Exportar en window para acceso global
window.auth = auth;
window.db = db;
window.messaging = messaging;
window.saveActiveFirebaseConfig = saveActiveFirebaseConfig;
window.resetFirebaseConfigToDefault = resetFirebaseConfigToDefault;
