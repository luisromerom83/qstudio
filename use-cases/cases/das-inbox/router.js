const express = require('express');
const crypto = require('crypto');
const path = require('path');

/**
 * Digital Advantage Inbox
 * -----------------------
 * Hosts Quadient Cloud Digital Services documents with the Advantage Web SDK (public/vendor/web-runtime.js).
 * Sign-in uses Integrated Server-Side Authentication: this server checks the app user and asks Quadient Cloud
 * for an access token with the API key, so the key never reaches the browser.
 * The documents talk to Quadient Cloud on their own (storeIncomingData / storeAndRetrieveReplyData) and Scaler
 * picks the data up with Digital Services Input; this app only signs the user in and shows the documents.
 *
 * Settings come from Studio Manager via use-cases.env: DAS_CLOUD_URL, DAS_APP_ID, DAS_CLIENT_ID, DAS_API_KEY,
 * DAS_TOKEN_LIFETIME and DAS_USERS (Base64 JSON [{ username, password, subject }]).
 */
const COOKIE = 'das_sid';
const COOKIE_PATH = '/das-inbox';

const router = express.Router();

function settings() {
  let users = [];
  try {
    const raw = (process.env.DAS_USERS || '').trim();
    if (raw) users = JSON.parse(raw.startsWith('[') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  } catch (err) {
    console.error('❌ DAS_USERS no es un JSON válido:', err.message);
  }
  return {
    cloudUrl: (process.env.DAS_CLOUD_URL || '').trim().replace(/\/+$/, ''),
    appId: (process.env.DAS_APP_ID || '').trim(),
    clientId: (process.env.DAS_CLIENT_ID || '').trim(),
    apiKey: (process.env.DAS_API_KEY || '').trim(),
    lifetime: parseInt(process.env.DAS_TOKEN_LIFETIME, 10) || 1500,
    users: Array.isArray(users) ? users : []
  };
}

function missingSettings(cfg = settings()) {
  const missing = [];
  if (!cfg.cloudUrl) missing.push('URL');
  if (!cfg.appId) missing.push('Application ID');
  if (!cfg.clientId) missing.push('Client ID');
  if (!cfg.apiKey) missing.push('API key');
  if (!cfg.users.length) missing.push('usuarios');
  return missing;
}

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
    .join('\n') + `\nwindow.__DAS_READY__ = ${missingSettings(cfg).length === 0};\n`);
});

router.use(express.static(path.join(__dirname, 'public')));

// App sessions live in memory: a container restart signs everybody out, which is fine for a demo
const sessions = new Map();

function readSession(req) {
  const match = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith(`${COOKIE}=`));
  const sid = match && decodeURIComponent(match.slice(COOKIE.length + 1));
  return sid && sessions.has(sid) ? { sid, ...sessions.get(sid) } : null;
}

function setCookie(res, sid, maxAge) {
  res.append('Set-Cookie', `${COOKIE}=${sid}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

async function callCloud(cfg, endpoint, body) {
  // Same request shape as the SDK demo (JSON body sent as text/plain)
  const response = await fetch(`${cfg.cloudUrl}/api/publish/MobileBackend/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify({ ApiKey: cfg.apiKey, ApplicationId: cfg.appId, ...body }),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  if (json.error != null) throw new Error(typeof json.error === 'string' ? json.error : JSON.stringify(json.error));
  return json;
}

router.post('/api/login', (req, res) => {
  const cfg = settings();
  const missing = missingSettings(cfg);
  if (missing.length) {
    return res.status(503).json({ error: `Quadient Cloud sin configurar (falta: ${missing.join(', ')}). Configúralo en Studio Manager.` });
  }
  const { username, password } = req.body || {};
  const user = cfg.users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, { username: user.username, subject: user.subject || user.username, token: null });
  setCookie(res, sid, 12 * 3600);
  res.json({ user: { username: user.username, subject: user.subject || user.username } });
});

// Called by the SDK's refreshToken on sign-in and whenever the Quadient Cloud session is about to expire
router.post('/api/token', async (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: 'No has iniciado sesión' });
  const cfg = settings();
  try {
    const json = await callCloud(cfg, 'CreateServerAuthenticatedAccessToken', {
      Subject: session.subject,
      LifeTimeInSeconds: cfg.lifetime
    });
    if (!json.token) throw new Error('Respuesta sin token');
    sessions.set(session.sid, { username: session.username, subject: session.subject, token: json.token });
    res.json({ token: json.token });
  } catch (err) {
    console.error('❌ CreateServerAuthenticatedAccessToken:', err.message);
    res.status(502).json({ error: `Quadient Cloud rechazó la solicitud del token: ${err.message}` });
  }
});

router.get('/api/me', (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: 'No has iniciado sesión' });
  res.json({ user: { username: session.username, subject: session.subject } });
});

router.post('/api/logout', async (req, res) => {
  const session = readSession(req);
  if (session) {
    sessions.delete(session.sid);
    if (session.token) {
      // Best effort: the token expires on its own anyway
      callCloud(settings(), 'RevokeServerAuthenticatedAccessToken', { Token: session.token })
        .catch(err => console.warn('⚠️ RevokeServerAuthenticatedAccessToken:', err.message));
    }
  }
  setCookie(res, '', 0);
  res.json({ success: true });
});

module.exports = {
  router,
  status() {
    const missing = missingSettings();
    return missing.length
      ? { ready: false, message: `Quadient Cloud sin configurar (falta: ${missing.join(', ')}). Configúralo en Studio Manager.` }
      : { ready: true, message: 'Quadient Cloud configurado' };
  }
};
