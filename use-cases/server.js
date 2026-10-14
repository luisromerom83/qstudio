/**
 * Contenedor de casos de uso
 * --------------------------
 * Cada carpeta de cases/ es un caso de uso: case.json (metadatos) + router.js (rutas y
 * estáticos). Se monta en /<id>/ y el portal en / lista los habilitados.
 * ENABLED_CASES=kafka-csv,push-inbox limita cuáles se cargan (vacío = todos).
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { createLocalizer } = require('./shared/i18n-server');

const PORT = process.env.PORT || 3000;
const CASES_DIR = path.join(__dirname, 'cases');
const enabledIds = (process.env.ENABLED_CASES || '').split(',').map(s => s.trim()).filter(Boolean);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

function loadCases() {
  return fs.readdirSync(CASES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(CASES_DIR, d.name, 'case.json')))
    .map(d => ({ ...JSON.parse(fs.readFileSync(path.join(CASES_DIR, d.name, 'case.json'), 'utf8')), id: d.name }))
    .filter(c => enabledIds.length === 0 || enabledIds.includes(c.id))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
    .map(c => ({ ...c, module: require(path.join(CASES_DIR, c.id, 'router.js')) }));
}

const cases = loadCases();

// Server messages in the page's language: each case may ship cases/<id>/i18n/server.js with its CATALOG
const catalog = {};
for (const c of cases) {
  const file = path.join(CASES_DIR, c.id, 'i18n', 'server.js');
  if (fs.existsSync(file)) Object.assign(catalog, require(file).CATALOG);
}
const localizer = createLocalizer(catalog);
app.use(localizer.middleware);

// Shared front-end helpers (i18n core) for the portal and every case
app.use('/shared', express.static(path.join(__dirname, 'shared'), { index: false }));

for (const c of cases) {
  const base = `/${c.id}`;
  // Sin la barra final las rutas relativas del frontend resolverían fuera del caso
  app.use(base, (req, res, next) => {
    if (req.originalUrl === base || req.originalUrl.startsWith(`${base}?`)) {
      return res.redirect(301, base + '/' + req.originalUrl.slice(base.length));
    }
    next();
  }, c.module.router);

  for (const prefix of c.module.legacyPaths || []) {
    app.use((req, res, next) => (req.path.startsWith(prefix) ? c.module.router(req, res, next) : next()));
  }
}

app.get('/api/cases', (req, res) => {
  // case.json may carry i18n: { "en-US": { name, description }, ... }; Spanish is the base text
  res.json(cases.map(({ module, i18n, ...meta }) => ({
    ...meta,
    ...((i18n || {})[req.lang] || {}),
    path: `/${meta.id}/`,
    status: typeof module.status === 'function' ? module.status() : { ready: true }
  })));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'online', cases: cases.map(c => c.id) });
});

// Android (TWA) busca assetlinks.json en la raíz del dominio; lo aporta el inbox si está habilitado
app.get('/.well-known/assetlinks.json', (req, res, next) => {
  const file = path.join(CASES_DIR, 'push-inbox', 'public', '.well-known', 'assetlinks.json');
  if (!cases.some(c => c.id === 'push-inbox') || !fs.existsSync(file)) return next();
  res.sendFile(file);
});

app.use(express.static(path.join(__dirname, 'portal')));

app.listen(PORT, () => {
  console.log(`🚀 Casos de uso en http://localhost:${PORT}`);
  for (const c of cases) console.log(`   • ${c.name}: http://localhost:${PORT}/${c.id}/`);
  if (cases.length === 0) console.log('   (ningún caso habilitado)');
});
