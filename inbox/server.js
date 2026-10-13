const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Estado de Firebase Admin
let admin = null;
let db = null;
let messaging = null;
let firebaseAdminStatus = {
  initialized: false,
  mode: 'none', // 'service_account', 'env_credentials', 'fallback'
  error: null
};

/**
 * Inicialización segura de Firebase Admin SDK
 */
function initFirebaseAdmin() {
  try {
    const adminSDK = require('firebase-admin');

    // Reutilizar instancia si ya fue inicializada (común en Vercel Serverless)
    if (adminSDK.apps.length > 0) {
      admin = adminSDK;
      db = admin.firestore();
      messaging = admin.messaging();
      firebaseAdminStatus = { initialized: true, mode: 'existing_app', error: null };
      return;
    }

    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(__dirname, 'serviceAccountKey.json');

    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      // Credencial pasada como JSON en variable de entorno (soporta multilínea y Base64)
      let rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY.trim();
      if (!rawKey.startsWith('{')) {
        rawKey = Buffer.from(rawKey, 'base64').toString('utf8');
      }
      const serviceAccount = JSON.parse(rawKey);

      // Corregir posibles saltos de línea escapados en private_key (común en variables de entorno Vercel)
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }

      adminSDK.initializeApp({
        credential: adminSDK.credential.cert(serviceAccount)
      });
      admin = adminSDK;
      db = admin.firestore();
      messaging = admin.messaging();
      firebaseAdminStatus = { initialized: true, mode: 'env_credentials', error: null };
      console.log('✅ Firebase Admin inicializado exitosamente mediante FIREBASE_SERVICE_ACCOUNT_KEY');
    } else if (fs.existsSync(serviceAccountPath)) {
      // Credencial desde archivo local serviceAccountKey.json
      const serviceAccount = require(serviceAccountPath);
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }

      adminSDK.initializeApp({
        credential: adminSDK.credential.cert(serviceAccount)
      });
      admin = adminSDK;
      db = admin.firestore();
      messaging = admin.messaging();
      firebaseAdminStatus = { initialized: true, mode: 'service_account', path: serviceAccountPath, error: null };
      console.log(`✅ Firebase Admin inicializado exitosamente desde ${serviceAccountPath}`);
    } else {
      console.warn('⚠️  No se encontró serviceAccountKey.json ni FIREBASE_SERVICE_ACCOUNT_KEY.');
      console.warn('ℹ️  El servidor funcionará, pero las funciones de API Firebase requerirán configurar las credenciales.');
      firebaseAdminStatus = {
        initialized: false,
        mode: 'pending_setup',
        error: 'serviceAccountKey.json no encontrado. Consulta README.md o la pestaña de configuración en la web.'
      };
    }
  } catch (err) {
    console.error('❌ Error al inicializar Firebase Admin:', err.message);
    firebaseAdminStatus = {
      initialized: false,
      mode: 'error',
      error: err.message
    };
  }
}

initFirebaseAdmin();

// ==========================================
// RUTAS DE LA API
// ==========================================

/**
 * Endpoint de estado y diagnóstico
 * GET /api/status
 */
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    firebaseAdmin: firebaseAdminStatus
  });
});

/**
 * Endpoint para registrar token FCM desde el cliente
 * POST /api/inbox/register-token
 * Body: { userId, userEmail, token, userAgent }
 */
app.post('/api/inbox/register-token', async (req, res) => {
  const { userId, userEmail, token, userAgent } = req.body;

  if (!userId || !token) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos: userId y token' });
  }

  if (!firebaseAdminStatus.initialized) {
    return res.status(503).json({
      error: 'Firebase Admin no configurado en el servidor.',
      details: firebaseAdminStatus.error
    });
  }

  try {
    const tokenDocRef = db.collection('users').doc(userId).collection('fcmTokens').doc(token);
    await tokenDocRef.set({
      token,
      userId,
      userEmail: userEmail || '',
      userAgent: userAgent || '',
      updatedAt: new Date().toISOString()
    }, { merge: true });

    // Actualizar también datos básicos del usuario
    await db.collection('users').doc(userId).set({
      email: userEmail || '',
      lastSeen: new Date().toISOString()
    }, { merge: true });

    return res.json({ success: true, message: 'Token FCM registrado correctamente' });
  } catch (err) {
    console.error('Error registrando token FCM:', err);
    return res.status(500).json({ error: 'Error al registrar token', details: err.message });
  }
});

/**
 * Endpoint principal para aplicaciones externas:
 * POST /api/inbox/send
 * 
 * Recibe:
 * - userEmail (o userId): identificador del destinatario
 * - title: título del elemento en el inbox
 * - html: contenido HTML que se mostrará en el inbox
 * - pushTitle: título de la notificación push
 * - pushBody: contenido/cuerpo de la notificación push
 */
app.post('/api/inbox/send', async (req, res) => {
  const { userId, userEmail, title, html, pushTitle, pushBody, metadata } = req.body;

  // 1. Validaciones
  if (!userEmail && !userId) {
    return res.status(400).json({
      error: 'Debe especificar el destinatario usando "userEmail" o "userId".'
    });
  }

  if (!title || typeof title !== 'string') {
    return res.status(400).json({
      error: 'El campo "title" es obligatorio.'
    });
  }

  if (!html || typeof html !== 'string') {
    return res.status(400).json({
      error: 'El campo "html" es obligatorio.'
    });
  }

  if (!pushTitle || !pushBody) {
    return res.status(400).json({
      error: 'Los campos "pushTitle" y "pushBody" son obligatorios para la notificación push.'
    });
  }

  if (!firebaseAdminStatus.initialized) {
    return res.status(503).json({
      error: 'Firebase Admin SDK no está configurado en el servidor.',
      details: firebaseAdminStatus.error,
      help: 'Coloca tu archivo "serviceAccountKey.json" en la raíz del proyecto para habilitar el guardado y el envío de notificaciones push.'
    });
  }

  try {
    let targetUid = userId;
    let targetEmail = userEmail;

    // Si viene por email pero no por UID, buscar UID en Firebase Auth
    if (!targetUid && targetEmail) {
      try {
        const userRecord = await admin.auth().getUserByEmail(targetEmail);
        targetUid = userRecord.uid;
      } catch (authErr) {
        // Si no está en Auth directamente, intentar buscar en la colección de usuarios de Firestore
        const userSnap = await db.collection('users').where('email', '==', targetEmail).limit(1).get();
        if (!userSnap.empty) {
          targetUid = userSnap.docs[0].id;
        } else {
          return res.status(404).json({
            error: `No se encontró ningún usuario con el correo: ${targetEmail}`,
            details: authErr.message
          });
        }
      }
    }

    const now = new Date().toISOString();

    // 2. Guardar el nuevo elemento HTML en Firestore: users/{targetUid}/inbox/{itemId}
    const inboxRef = db.collection('users').doc(targetUid).collection('inbox').doc();
    const inboxItem = {
      id: inboxRef.id,
      userId: targetUid,
      userEmail: targetEmail || '',
      title: title.trim(),
      html: html,
      pushTitle: pushTitle.trim(),
      pushBody: pushBody.trim(),
      metadata: metadata || {},
      read: false,
      createdAt: now,
      updatedAt: now
    };

    await inboxRef.set(inboxItem);
    console.log(`📥 Elemento guardado en Inbox [${inboxRef.id}] para usuario ${targetUid}`);

    // 3. Obtener tokens FCM registrados para este usuario
    const tokensSnap = await db.collection('users').doc(targetUid).collection('fcmTokens').get();
    const tokens = [];
    tokensSnap.forEach(doc => {
      const data = doc.data();
      if (data.token) {
        tokens.push(data.token);
      }
    });

    let pushResult = {
      sent: false,
      tokensTargeted: tokens.length,
      successCount: 0,
      failureCount: 0,
      details: []
    };

    // 4. Enviar Push Notification si hay tokens
    if (tokens.length > 0) {
      const messagePayload = {
        tokens: tokens,
        data: {
          title: pushTitle,
          body: pushBody,
          pushTitle: pushTitle,
          pushBody: pushBody,
          inboxId: inboxRef.id,
          createdAt: now,
          url: `/?inboxId=${inboxRef.id}`,
          click_action: `/?inboxId=${inboxRef.id}`
        },
        webpush: {
          headers: {
            Urgency: 'high'
          },
          fcmOptions: {
            link: `/?inboxId=${inboxRef.id}`
          }
        }
      };

      const response = await messaging.sendEachForMulticast(messagePayload);
      pushResult.sent = true;
      pushResult.successCount = response.successCount;
      pushResult.failureCount = response.failureCount;

      // Limpiar tokens inválidos o expirados
      const invalidTokenPromises = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          pushResult.details.push({ token: tokens[idx].substring(0, 15) + '...', error: errorCode });
          if (
            errorCode === 'messaging/invalid-registration-token' ||
            errorCode === 'messaging/registration-token-not-registered'
          ) {
            console.log(`🧹 Eliminando token FCM expirado: ${tokens[idx]}`);
            invalidTokenPromises.push(
              db.collection('users').doc(targetUid).collection('fcmTokens').doc(tokens[idx]).delete()
            );
          }
        }
      });
      if (invalidTokenPromises.length > 0) {
        await Promise.all(invalidTokenPromises);
      }
    } else {
      console.log(`ℹ️ El usuario ${targetUid} no tiene tokens FCM registrados actualmente.`);
    }

    return res.status(201).json({
      success: true,
      message: 'HTML guardado en Inbox y proceso de push completado.',
      inboxId: inboxRef.id,
      userId: targetUid,
      title: title,
      pushResult
    });

  } catch (err) {
    console.error('Error al procesar /api/inbox/send:', err);
    return res.status(500).json({
      error: 'Error interno del servidor al procesar la solicitud.',
      details: err.message
    });
  }
});

/**
 * Endpoint para enviar SOLO NOTIFICACIÓN PUSH (sin HTML ni guardar en Inbox):
 * POST /api/push/send
 * 
 * Recibe:
 * - userEmail (o userId): destinatario
 * - title (o pushTitle): título de la notificación
 * - body (o pushBody): cuerpo de la notificación
 * - url (opcional): link al hacer clic
 * - data (opcional): metadata adicional
 */
app.post('/api/push/send', async (req, res) => {
  const { userId, userEmail, title, pushTitle, body, pushBody, url, data } = req.body;

  const finalTitle = (title || pushTitle || '').trim();
  const finalBody = (body || pushBody || '').trim();

  if (!userEmail && !userId) {
    return res.status(400).json({
      error: 'Debe especificar el destinatario usando "userEmail" o "userId".'
    });
  }

  if (!finalTitle) {
    return res.status(400).json({
      error: 'El título de la notificación es obligatorio ("title" o "pushTitle").'
    });
  }

  if (!finalBody) {
    return res.status(400).json({
      error: 'El cuerpo de la notificación es obligatorio ("body" o "pushBody").'
    });
  }

  if (!firebaseAdminStatus.initialized) {
    return res.status(503).json({
      error: 'Firebase Admin SDK no está configurado en el servidor.',
      details: firebaseAdminStatus.error
    });
  }

  try {
    let targetUid = userId;
    let targetEmail = userEmail;

    if (!targetUid && targetEmail) {
      try {
        const userRecord = await admin.auth().getUserByEmail(targetEmail);
        targetUid = userRecord.uid;
      } catch (authErr) {
        const userSnap = await db.collection('users').where('email', '==', targetEmail).limit(1).get();
        if (!userSnap.empty) {
          targetUid = userSnap.docs[0].id;
        } else {
          return res.status(404).json({
            error: `No se encontró ningún usuario con el correo: ${targetEmail}`,
            details: authErr.message
          });
        }
      }
    }

    // Obtener tokens FCM registrados para este usuario
    const tokensSnap = await db.collection('users').doc(targetUid).collection('fcmTokens').get();
    const tokens = [];
    tokensSnap.forEach(doc => {
      const d = doc.data();
      if (d.token) tokens.push(d.token);
    });

    let pushResult = {
      sent: false,
      tokensTargeted: tokens.length,
      successCount: 0,
      failureCount: 0,
      details: []
    };

    if (tokens.length > 0) {
      const customData = Object.assign({}, data || {}, {
        title: finalTitle,
        body: finalBody,
        url: url || '/',
        type: 'push_only',
        timestamp: new Date().toISOString()
      });

      const messagePayload = {
        tokens: tokens,
        data: customData,
        webpush: {
          headers: {
            Urgency: 'high'
          },
          fcmOptions: {
            link: url || '/'
          }
        }
      };

      const response = await messaging.sendEachForMulticast(messagePayload);
      pushResult.sent = true;
      pushResult.successCount = response.successCount;
      pushResult.failureCount = response.failureCount;

      // Limpiar tokens inválidos o expirados
      const invalidTokenPromises = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          pushResult.details.push({ token: tokens[idx].substring(0, 15) + '...', error: errorCode });
          if (
            errorCode === 'messaging/invalid-registration-token' ||
            errorCode === 'messaging/registration-token-not-registered'
          ) {
            invalidTokenPromises.push(
              db.collection('users').doc(targetUid).collection('fcmTokens').doc(tokens[idx]).delete()
            );
          }
        }
      });
      if (invalidTokenPromises.length > 0) {
        await Promise.all(invalidTokenPromises);
      }
    } else {
      console.log(`ℹ️ El usuario ${targetUid} no tiene tokens FCM registrados actualmente.`);
    }

    return res.status(200).json({
      success: true,
      message: tokens.length > 0 ? 'Notificación Push enviada con éxito.' : 'El usuario no tiene tokens FCM registrados en este momento.',
      userId: targetUid,
      title: finalTitle,
      body: finalBody,
      pushResult
    });

  } catch (err) {
    console.error('Error al procesar /api/push/send:', err);
    return res.status(500).json({
      error: 'Error interno del servidor al enviar la notificación push.',
      details: err.message
    });
  }
});

// Ruta de captura para la SPA (Single Page Application)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor solo si se ejecuta directamente (en Vercel se exporta como Serverless Function)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
    console.log(`📁 Frontend disponible en: http://localhost:${PORT}`);
    console.log(`📡 API endpoint: POST http://localhost:${PORT}/api/inbox/send`);
    console.log(`===================================================`);
  });
}

module.exports = app;
