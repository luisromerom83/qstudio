/**
 * Módulo de Autenticación con Firebase Auth
 * Gestiona Login, Registro de Nuevos Usuarios, Cierre de Sesión y Estado del Usuario.
 */

// Elementos del DOM
const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
const userEmailDisplay = document.getElementById('user-email-display');
const userIdDisplay = document.getElementById('user-id-display');

// Formularios
const formLogin = document.getElementById('form-login');
const formRegister = document.getElementById('form-register');
const btnLogout = document.getElementById('btn-logout');

// Alertas de Auth
const loginAlert = document.getElementById('login-alert');
const registerAlert = document.getElementById('register-alert');

/**
 * Traduce códigos de error de Firebase a mensajes amigables en el idioma de la interfaz
 */
const FIREBASE_AUTH_ERROR_KEYS = {
  'auth/invalid-email': 'invalidEmail',
  'auth/user-disabled': 'userDisabled',
  'auth/user-not-found': 'userNotFound',
  'auth/wrong-password': 'wrongPassword',
  'auth/invalid-credential': 'invalidCredential',
  'auth/email-already-in-use': 'emailInUse',
  'auth/operation-not-allowed': 'operationNotAllowed',
  'auth/weak-password': 'weakPassword',
  'auth/network-request-failed': 'network',
  'auth/too-many-requests': 'tooManyRequests'
};

function translateFirebaseError(error) {
  const key = FIREBASE_AUTH_ERROR_KEYS[error.code || ''];
  if (key) return t(`inbox.auth.errors.${key}`);
  return error.message || t('inbox.auth.errors.unexpected');
}

/**
 * Mostrar mensaje de alerta
 */
function showAlert(element, message, type = 'danger') {
  if (!element) return;
  element.className = `alert alert-${type} alert-dismissible fade show`;
  element.innerHTML = `
    <i class="bi ${type === 'success' ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'} me-2"></i>
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="${t('inbox.common.close')}"></button>
  `;
  element.classList.remove('d-none');
}

/**
 * Ocultar alerta
 */
function hideAlert(element) {
  if (!element) return;
  element.classList.add('d-none');
  element.innerHTML = '';
}

/**
 * Manejador de Inicio de Sesión (Login)
 */
if (formLogin) {
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(loginAlert);

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btnSubmit = formLogin.querySelector('button[type="submit"]');

    if (!window.isFirebaseConfigured) {
      // Modo demostración si aún no han configurado las claves
      showAlert(loginAlert, t('inbox.auth.notConfiguredLogin'), 'warning');
      return;
    }

    try {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${t('inbox.auth.signingIn')}`;

      await window.auth.signInWithEmailAndPassword(email, password);
      // El observador onAuthStateChanged se encargará de cambiar la vista
    } catch (err) {
      console.error('Error de login:', err);
      showAlert(loginAlert, translateFirebaseError(err), 'danger');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `<i class="bi bi-box-arrow-in-right me-2"></i><span data-i18n="inbox.auth.loginButton">${t('inbox.auth.loginButton')}</span>`;
    }
  });
}

/**
 * Manejador de Registro de Nuevos Usuarios
 */
if (formRegister) {
  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(registerAlert);

    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    const passwordConfirm = document.getElementById('register-password-confirm').value;
    const btnSubmit = formRegister.querySelector('button[type="submit"]');

    if (password !== passwordConfirm) {
      showAlert(registerAlert, t('inbox.auth.passwordMismatch'), 'warning');
      return;
    }

    if (password.length < 6) {
      showAlert(registerAlert, t('inbox.auth.errors.weakPassword'), 'warning');
      return;
    }

    if (!window.isFirebaseConfigured) {
      showAlert(registerAlert, t('inbox.auth.notConfiguredRegister'), 'warning');
      return;
    }

    try {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${t('inbox.auth.registering')}`;

      const userCredential = await window.auth.createUserWithEmailAndPassword(email, password);
      const user = userCredential.user;

      // Crear documento inicial del usuario en Firestore
      if (window.db) {
        await window.db.collection('users').doc(user.uid).set({
          email: user.email,
          createdAt: new Date().toISOString(),
          lastSeen: new Date().toISOString()
        }, { merge: true });
      }

      showAlert(registerAlert, t('inbox.auth.accountCreated'), 'success');
    } catch (err) {
      console.error('Error al registrar usuario:', err);
      showAlert(registerAlert, translateFirebaseError(err), 'danger');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `<i class="bi bi-person-plus-fill me-2"></i><span data-i18n="inbox.auth.createButton">${t('inbox.auth.createButton')}</span>`;
    }
  });
}

// Las alertas ya mostradas quedarían en el idioma anterior: se ocultan al cambiarlo
window.addEventListener('studio:languagechange', () => {
  hideAlert(loginAlert);
  hideAlert(registerAlert);
});

/**
 * Cierre de Sesión (Logout)
 */
if (btnLogout) {
  btnLogout.addEventListener('click', async () => {
    try {
      if (window.auth) {
        await window.auth.signOut();
      }
      // Limpiar datos en memoria de Inbox
      if (typeof window.clearInboxState === 'function') {
        window.clearInboxState();
      }
    } catch (err) {
      console.error('Error cerrando sesión:', err);
    }
  });
}

/**
 * Observador del estado de autenticación en Firebase
 */
if (window.auth) {
  window.auth.onAuthStateChanged(async (user) => {
    if (user) {
      console.log('👤 Usuario autenticado:', user.email, 'UID:', user.uid);
      window.currentUser = user;

      // Actualizar UI
      const userDropdown = document.getElementById('user-dropdown-container');
      if (userDropdown) userDropdown.classList.remove('d-none');
      if (userEmailDisplay) userEmailDisplay.textContent = user.email;
      if (userIdDisplay) userIdDisplay.textContent = user.uid;

      // Autocompletar en el simulador de API externa
      const testerUserEmail = document.getElementById('tester-user-email');
      const testerUserId = document.getElementById('tester-user-id');
      if (testerUserEmail) testerUserEmail.value = user.email;
      if (testerUserId) testerUserId.value = user.uid;

      // Mostrar sección de la app y ocultar login/registro
      authSection.classList.add('d-none');
      appSection.classList.remove('d-none');

      // Inicializar servicios dependientes del usuario
      if (typeof window.initInboxListener === 'function') {
        window.initInboxListener(user.uid);
      }
      if (typeof window.checkAndRequestFCMToken === 'function') {
        window.checkAndRequestFCMToken(false);
      }
      if (typeof window.updateApiExamples === 'function') {
        window.updateApiExamples();
      }
    } else {
      console.log('🔒 Ningún usuario autenticado');
      window.currentUser = null;

      const userDropdown = document.getElementById('user-dropdown-container');
      if (userDropdown) userDropdown.classList.add('d-none');

      // Mostrar pantalla de login y ocultar app
      authSection.classList.remove('d-none');
      appSection.classList.add('d-none');

      if (typeof window.detachInboxListener === 'function') {
        window.detachInboxListener();
      }
    }
  });
}
