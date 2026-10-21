const express = require('express');
const path = require('path');

/**
 * Custom demos (anonymous Digital Services documents)
 * ---------------------------------------------------
 * Virtual case: it never appears by itself. Each demo defined in Studio Manager › Settings is published as its
 * own use case under /<demo id>/ and opens one document of a Quadient Cloud application that uses the
 * Anonymous Access provider, so there is no sign-in. The anonymous token comes from this server (api/token): Quadient
 * Cloud's token endpoint sends no CORS headers, so the browser can't ask for it, and the SDK takes it through
 * signIn's refreshToken like the Digital Advantage Inbox does.
 *
 * Settings come from Studio Manager via use-cases.env: DAS_DEMOS (Base64 JSON
 * [{ id, name, description, cloud_url, app_id, client_id, document_id }]), only the demos the environment uses.
 * The page reuses the Digital Advantage Inbox stylesheet and SDK (web-runtime.js).
 */
const INBOX_PUBLIC = path.join(__dirname, '..', 'das-inbox', 'public');

function demos() {
  try {
    const raw = (process.env.DAS_DEMOS || '').trim();
    if (!raw) return [];
    const list = JSON.parse(raw.startsWith('[') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    return Array.isArray(list) ? list.filter(d => d && /^demo-[a-z0-9-]+$/.test(d.id)) : [];
  } catch (err) {
    console.error('❌ DAS_DEMOS no es un JSON válido:', err.message);
    return [];
  }
}

function missingSettings(demo) {
  return [
    ['URL', demo.cloud_url],
    ['Application ID', demo.app_id],
    ['Client ID', demo.client_id],
    ['Document ID', demo.document_id]
  ].filter(([, value]) => !String(value || '').trim()).map(([name]) => name);
}

function routerFor(demo) {
  const router = express.Router();

  // The SDK reads CLOUD_URL, CLOUD_APP_ID and CLOUD_CLIENT_ID as globals; must be served before express.static
  router.get('/js/runtime-config.js', (req, res) => {
    const appId = String(demo.app_id || '').trim();
    const globals = {
      CLOUD_URL: String(demo.cloud_url || '').trim().replace(/\/+$/, ''),
      CLOUD_APP_ID: /^\d+$/.test(appId) ? Number(appId) : appId,
      CLOUD_CLIENT_ID: String(demo.client_id || '').trim()
    };
    const page = { name: demo.name || demo.id, documentId: String(demo.document_id || '').trim(), ready: missingSettings(demo).length === 0 };
    res.type('application/javascript').set('Cache-Control', 'no-store');
    res.send(Object.entries(globals)
      .map(([name, value]) => `var ${name} = ${JSON.stringify(value).replace(/</g, '\\u003c')};`)
      .join('\n') + `\nwindow.__DAS_DEMO__ = ${JSON.stringify(page).replace(/</g, '\\u003c')};\n`);
  });

  // Anonymous token in the "access|iframe|seconds" form the SDK accepts from refreshToken
  router.post('/api/token', async (req, res) => {
    const cloudUrl = String(demo.cloud_url || '').trim().replace(/\/+$/, '');
    try {
      const response = await fetch(`${cloudUrl}/idsrv/${encodeURIComponent(demo.app_id)}/connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'ext_refresh_web', client_id: demo.client_id, scope: 'openid dcb dcb.iframe' }),
        signal: AbortSignal.timeout(15000)
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.access_token || !json.ext_dcb_iframe_token) {
        throw new Error(json.error_description || json.error || `HTTP ${response.status}`);
      }
      res.json({ token: `${json.access_token}|${json.ext_dcb_iframe_token}|${json.expires_in || 3600}` });
    } catch (err) {
      console.error(`❌ Token anónimo de ${demo.id}:`, err.message);
      res.status(502).json({ error: `Quadient Cloud rechazó la solicitud del token: ${err.message}` });
    }
  });

  router.use('/css', express.static(path.join(INBOX_PUBLIC, 'css')));
  router.use('/vendor', express.static(path.join(INBOX_PUBLIC, 'vendor')));
  router.use(express.static(path.join(__dirname, 'public')));
  return router;
}

module.exports = {
  // server.js publishes one use case per entry instead of this folder
  cases() {
    return demos().map(demo => ({
      id: demo.id,
      name: demo.name || demo.id,
      description: demo.description || '',
      icon: '📄',
      order: 40,
      router: routerFor(demo),
      status() {
        const missing = missingSettings(demo);
        return missing.length
          ? { ready: false, message: `Demo incompleta (falta: ${missing.join(', ')}). Complétala en Studio Manager.` }
          : { ready: true, message: 'Demo lista' };
      }
    }));
  }
};
