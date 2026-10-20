const express = require('express');
const crypto = require('crypto');
const path = require('path');

/**
 * Digital Advantage Inbox
 * -----------------------
 * Hosts Quadient Cloud Digital Services documents with the Advantage Web SDK (public/vendor/web-runtime.js).
 * The documents talk to Quadient Cloud on their own (storeIncomingData / storeAndRetrieveReplyData) and Scaler
 * picks the data up with Digital Services Input; this app only signs the user in and shows the documents.
 *
 * Settings come from Studio Manager via use-cases.env: DAS_CLOUD_URL, DAS_APP_ID and DAS_CLIENT_ID;
 * DAS_STATEMENTS_META_NAME and DAS_STATEMENTS_META_VALUE pick the documents the online banking case lists as statements.
 *
 * Users are Quadient Cloud accounts: the application has a user store with Inspire Authentication (a password-based
 * provider), people sign in with their account and can create one from the sign-in page (self-registration). Both
 * calls go from this server: Quadient Cloud's token endpoint sends no CORS headers, so the browser can't make them.
 * The account's userId (the ID token's "sub") is the owner of its documents in Digital Services.
 *
 * createDasRouter() also serves other front ends on the same Quadient Cloud app (the online banking case): each
 * one has its own public folder and session cookie, and shares the SDK in public/vendor.
 */
const VENDOR_DIR = path.join(__dirname, 'public', 'vendor');
// Front-end pieces both front ends use (account creation)
const SHARED_DIR = path.join(__dirname, 'shared');

function settings() {
  return {
    cloudUrl: (process.env.DAS_CLOUD_URL || '').trim().replace(/\/+$/, ''),
    appId: (process.env.DAS_APP_ID || '').trim(),
    clientId: (process.env.DAS_CLIENT_ID || '').trim(),
    statementsMeta: {
      name: (process.env.DAS_STATEMENTS_META_NAME || '').trim(),
      value: (process.env.DAS_STATEMENTS_META_VALUE || '').trim()
    }
  };
}

function missingSettings(cfg = settings()) {
  const missing = [];
  if (!cfg.cloudUrl) missing.push('URL');
  if (!cfg.appId) missing.push('Application ID');
  if (!cfg.clientId) missing.push('Client ID');
  return missing;
}

async function cloudJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
}

// Sign-in providers of the application, cached for a minute
let providersCache = { key: '', at: 0, value: [] };
async function cloudProviders(cfg) {
  const key = `${cfg.cloudUrl}|${cfg.appId}|${cfg.clientId}`;
  if (providersCache.key === key && Date.now() - providersCache.at < 60000) return providersCache.value;
  const response = await fetch(`${cfg.cloudUrl}/api/query/MobileBackend/IdentityProviderSignInData`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ ApplicationId: /^\d+$/.test(cfg.appId) ? Number(cfg.appId) : cfg.appId, AuthenticationClientId: cfg.clientId }),
    signal: AbortSignal.timeout(10000)
  });
  const json = await cloudJson(response);
  if (json.error != null) throw new Error(typeof json.error === 'string' ? json.error : json.error.error || JSON.stringify(json.error));
  const value = (json.identityProviderSignInData || []).map(p => ({
    id: p.authenticationScheme, name: p.displayName, type: p.identityProviderType, passwordBased: !!p.isPasswordBased
  }));
  providersCache = { key, at: Date.now(), value };
  return value;
}

// The Quadient Cloud user store, when the application has one
async function passwordProvider(cfg) {
  try {
    return (await cloudProviders(cfg)).find(p => p.passwordBased) || null;
  } catch (err) {
    console.warn('⚠️ IdentityProviderSignInData:', err.message);
    return null;
  }
}

// Same password grant the SDK uses; the result is the "access|iframe|seconds" token its refreshToken accepts
async function cloudPasswordSignIn(cfg, provider, username, password) {
  const body = new URLSearchParams({
    grant_type: 'ext_password_web', scope: 'openid dcb dcb.iframe', client_id: cfg.clientId, username, password
  });
  if (provider) body.set('exp_idp', provider.id);
  const response = await fetch(`${cfg.cloudUrl}/idsrv/${encodeURIComponent(cfg.appId)}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    const error = new Error(json.error_description || json.error || `HTTP ${response.status}`);
    error.invalidCredentials = json.error === 'invalid_grant';
    throw error;
  }
  let subject = username;
  try {
    subject = JSON.parse(Buffer.from(String(json.id_token).split('.')[1], 'base64url').toString('utf8')).sub || username;
  } catch (err) { /* no ID token: keep the username */ }
  const seconds = Number(json.expires_in) || 3600;
  return {
    subject,
    token: `${json.access_token}|${json.ext_dcb_iframe_token || json.access_token}|${seconds}`,
    expiresAt: Date.now() + seconds * 1000
  };
}

function createDasRouter({ publicDir, cookieName, cookiePath }) {
  const router = express.Router();

  // The SDK reads CLOUD_URL, CLOUD_APP_ID and CLOUD_CLIENT_ID as globals; must be served before express.static
  router.get('/js/runtime-config.js', (req, res) => {
    const cfg = settings();
    const globals = {
      CLOUD_URL: cfg.cloudUrl,
      CLOUD_APP_ID: /^\d+$/.test(cfg.appId) ? Number(cfg.appId) : cfg.appId,
      CLOUD_CLIENT_ID: cfg.clientId
    };
    res.type('application/javascript').set('Cache-Control', 'no-store');
    res.send(Object.entries(globals)
      .map(([name, value]) => `var ${name} = ${JSON.stringify(value).replace(/</g, '\\u003c')};`)
      .join('\n') + `\nwindow.__DAS_READY__ = ${missingSettings(cfg).length === 0};\n`
      + `window.__DAS_STATEMENTS_META__ = ${cfg.statementsMeta.name ? JSON.stringify(cfg.statementsMeta).replace(/</g, '\\u003c') : 'null'};\n`);
  });

  router.use('/vendor', express.static(VENDOR_DIR));
  router.use('/shared-das', express.static(SHARED_DIR));
  router.use(express.static(publicDir));

  // App sessions live in memory: a container restart signs everybody out, which is fine for a demo
  const sessions = new Map();

  function readSession(req) {
    const match = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith(`${cookieName}=`));
    const sid = match && decodeURIComponent(match.slice(cookieName.length + 1));
    return sid && sessions.has(sid) ? { sid, ...sessions.get(sid) } : null;
  }

  function setCookie(res, sid, maxAge) {
    res.append('Set-Cookie', `${cookieName}=${sid}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
  }

  function startSession(res, data) {
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, data);
    setCookie(res, sid, 12 * 3600);
    return { username: data.username, subject: data.subject };
  }

  router.post('/api/login', async (req, res) => {
    const cfg = settings();
    const missing = missingSettings(cfg);
    if (missing.length) {
      return res.status(503).json({ error: `Quadient Cloud sin configurar (falta: ${missing.join(', ')}). Configúralo en Studio Manager.` });
    }
    const username = String((req.body || {}).username || '').trim();
    const password = String((req.body || {}).password || '');
    if (!username || !password) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    const provider = await passwordProvider(cfg);
    if (!provider) return res.status(503).json({ error: 'La aplicación de Quadient Cloud no tiene usuarios con contraseña: asígnale un almacén de usuarios con Inspire Authentication' });
    try {
      const cloud = await cloudPasswordSignIn(cfg, provider, username, password);
      res.json({ user: startSession(res, { username, subject: cloud.subject, cloud }) });
    } catch (err) {
      if (err.invalidCredentials) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
      console.error('❌ Inicio de sesión en Quadient Cloud:', err.message);
      res.status(502).json({ error: `Quadient Cloud rechazó el inicio de sesión: ${err.message}` });
    }
  });

  // What the sign-in page offers: account creation only with a Quadient Cloud user store
  router.get('/api/auth-options', async (req, res) => {
    const cfg = settings();
    const provider = missingSettings(cfg).length ? null : await passwordProvider(cfg);
    res.json({ signUp: !!provider, provider: provider ? provider.name : null });
  });

  // Self-registration in the application's user store (the SDK's _runtime_signUp), then sign-in when the account
  // can be used right away; applications that ask to verify the email leave it pending
  router.post('/api/register', async (req, res) => {
    const cfg = settings();
    const missing = missingSettings(cfg);
    if (missing.length) {
      return res.status(503).json({ error: `Quadient Cloud sin configurar (falta: ${missing.join(', ')}). Configúralo en Studio Manager.` });
    }
    const provider = await passwordProvider(cfg);
    if (!provider) return res.status(400).json({ error: 'Esta aplicación de Quadient Cloud no permite crear cuentas: necesita un almacén de usuarios con autorregistro' });
    const body = req.body || {};
    const username = String(body.username || '').trim();
    const email = String(body.email || '').trim();
    const password = String(body.password || '');
    if (!username || !email || !password) return res.status(400).json({ error: 'Usuario, correo y contraseña son obligatorios' });
    try {
      const response = await fetch(`${cfg.cloudUrl}/api/publish/MobileBackend/SaveIdentityUserSelfRegistration`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          ApplicationId: /^\d+$/.test(cfg.appId) ? Number(cfg.appId) : cfg.appId,
          username, Email: email, newPassword: password,
          FirstName: String(body.firstName || '').trim() || undefined,
          LastName: String(body.lastName || '').trim() || undefined,
          Language: String(body.language || '').trim() || undefined
        }),
        signal: AbortSignal.timeout(15000)
      });
      const json = await cloudJson(response);
      if (json.error != null) throw new Error(typeof json.error === 'string' ? json.error : json.error.error || JSON.stringify(json.error));
    } catch (err) {
      console.error('❌ SaveIdentityUserSelfRegistration:', err.message);
      return res.status(400).json({ error: `Quadient Cloud no creó la cuenta: ${err.message}` });
    }
    try {
      const cloud = await cloudPasswordSignIn(cfg, provider, username, password);
      res.json({ registered: true, user: startSession(res, { username, subject: cloud.subject, cloud }) });
    } catch (err) {
      res.json({ registered: true, pending: true, message: 'Cuenta creada. Revisa tu correo para activarla y después inicia sesión.' });
    }
  });

  // Called by the SDK's refreshToken on sign-in and whenever the Quadient Cloud session is about to expire:
  // the token from the password sign-in, until it expires (then the user signs in again)
  router.post('/api/token', (req, res) => {
    const session = readSession(req);
    if (!session) return res.status(401).json({ error: 'No has iniciado sesión' });
    if (session.cloud.expiresAt - Date.now() > 60000) return res.json({ token: session.cloud.token });
    sessions.delete(session.sid);
    res.status(401).json({ error: 'Tu sesión de Quadient Cloud expiró; vuelve a iniciar sesión' });
  });

  router.get('/api/me', (req, res) => {
    const session = readSession(req);
    if (!session) return res.status(401).json({ error: 'No has iniciado sesión' });
    res.json({ user: { username: session.username, subject: session.subject } });
  });

  router.post('/api/logout', (req, res) => {
    const session = readSession(req);
    if (session) sessions.delete(session.sid);
    setCookie(res, '', 0);
    res.json({ success: true });
  });

  return router;
}

function status() {
  const missing = missingSettings();
  return missing.length
    ? { ready: false, message: `Quadient Cloud sin configurar (falta: ${missing.join(', ')}). Configúralo en Studio Manager.` }
    : { ready: true, message: 'Quadient Cloud configurado' };
}

module.exports = {
  router: createDasRouter({ publicDir: path.join(__dirname, 'public'), cookieName: 'das_sid', cookiePath: '/das-inbox' }),
  status,
  createDasRouter
};
