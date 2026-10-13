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
 * Traduce códigos de error de Firebase a mensajes amigables en español
 */
function translateFirebaseError(error) {
  const code = error.code || '';
  switch (code) {
    case 'auth/invalid-email':
      return 'El formato del correo electrónico no es válido.';
    case 'auth/user-disabled':
      return 'Esta cuenta de usuario ha sido inhabilitada.';
    case 'auth/user-not-found':
      return 'No se encontró ninguna cuenta con este correo electrónico.';
    case 'auth/wrong-password':
      return 'Contraseña incorrecta. Por favor, verifica tus datos.';
    case 'auth/invalid-credential':
      return 'Credenciales inválidas. Verifica tu correo y contraseña.';
    case 'auth/email-already-in-use':
      return 'Este correo electrónico ya se encuentra registrado. Intenta iniciar sesión.';
    case 'auth/operation-not-allowed':
      return 'El proveedor de correo/contraseña no está habilitado en la consola de Firebase.';
    case 'auth/weak-password':
      return 'La contraseña debe tener al menos 6 caracteres.';
    case 'auth/network-request-failed':
      return 'Error de conexión. Comprueba tu conexión a internet.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos fallidos. Inténtalo más tarde.';
    default:
      return error.message || 'Ocurrió un error inesperado al autenticar.';
  }
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
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
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
      showAlert(loginAlert, 'Firebase aún no está configurado con tus credenciales. Haz clic en el botón "⚙️ Configurar Firebase" arriba a la derecha para ingresar tus datos, o bien prueba con el modo demo.', 'warning');
      return;
    }

    try {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Iniciando sesión...';

      await window.auth.signInWithEmailAndPassword(email, password);
      // El observador onAuthStateChanged se encargará de cambiar la vista
    } catch (err) {
      console.error('Error de login:', err);
      showAlert(loginAlert, translateFirebaseError(err), 'danger');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i class="bi bi-box-arrow-in-right me-2"></i>Iniciar Sesión';
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
      showAlert(registerAlert, 'Las contraseñas no coinciden. Por favor verifícalas.', 'warning');
      return;
    }

    if (password.length < 6) {
      showAlert(registerAlert, 'La contraseña debe tener al menos 6 caracteres.', 'warning');
      return;
    }

    if (!window.isFirebaseConfigured) {
      showAlert(registerAlert, 'Firebase aún no está configurado con tus credenciales reales. Haz clic en el botón "⚙️ Configurar Firebase" arriba para ingresar tus datos de Firebase Console.', 'warning');
      return;
    }

    try {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Registrando usuario...';

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

      showAlert(registerAlert, '¡Cuenta creada con éxito! Redirigiendo a tu bandeja de entrada...', 'success');
    } catch (err) {
      console.error('Error al registrar usuario:', err);
      showAlert(registerAlert, translateFirebaseError(err), 'danger');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i class="bi bi-person-plus-fill me-2"></i>Crear Cuenta';
    }
  });
}

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
