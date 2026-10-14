/**
 * Server message localization for the use-case apps.
 *
 * Routers keep answering in Spanish (es-MX, the source language). Each case may ship
 * cases/<id>/i18n/server.js exporting a CATALOG { "<Spanish template>": { "en-US": "...", "pt-BR": "..." } };
 * templates may carry {placeholders} that are captured from the Spanish text and re-inserted.
 * The middleware rewrites the user-facing fields of every JSON response according to the
 * X-Studio-Lang header sent by the pages; fields: message, error, details, help (callers without it, like Scaler, get Spanish).
 */
const SUPPORTED_LANGS = ['es-MX', 'en-US', 'pt-BR'];
const SOURCE_LANG = 'es-MX';
const LOCALIZED_KEYS = new Set(['message', 'error', 'details', 'help']);

function resolveLang(headerValue, acceptLanguage) {
  const candidates = [headerValue, ...String(acceptLanguage || '').split(',').map(p => p.split(';')[0])];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const c = candidate.trim().toLowerCase();
    const lang = SUPPORTED_LANGS.find(l => l.toLowerCase() === c || l.slice(0, 2).toLowerCase() === c.slice(0, 2));
    if (lang) return lang;
  }
  return SOURCE_LANG;
}

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(template) {
  let pattern = '';
  let last = 0;
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    pattern += escapeRegex(template.slice(last, m.index)) + `(?<${m[1]}>[\\s\\S]+?)`;
    last = m.index + m[0].length;
  }
  return new RegExp(`^${pattern}${escapeRegex(template.slice(last))}$`);
}

function createLocalizer(catalog) {
  const exact = new Map();
  const patterns = [];
  for (const [source, translations] of Object.entries(catalog)) {
    if (/\{\w+\}/.test(source)) patterns.push([compile(source), translations]);
    else exact.set(source, translations);
  }

  function localize(text, lang) {
    if (lang === SOURCE_LANG || typeof text !== 'string' || !text) return text;
    const entry = exact.get(text);
    if (entry) return entry[lang] ?? text;
    for (const [re, translations] of patterns) {
      const m = text.match(re);
      if (m && translations[lang]) {
        // Captured values may themselves be catalogued messages
        return translations[lang].replace(/\{(\w+)\}/g, (all, name) =>
          m.groups[name] !== undefined ? localize(m.groups[name], lang) : all);
      }
    }
    return text;
  }

  function localizePayload(data, lang) {
    if (lang === SOURCE_LANG) return data;
    if (Array.isArray(data)) return data.map(v => localizePayload(v, lang));
    if (data && typeof data === 'object') {
      return Object.fromEntries(Object.entries(data).map(([k, v]) =>
        [k, LOCALIZED_KEYS.has(k) && typeof v === 'string' ? localize(v, lang) : localizePayload(v, lang)]));
    }
    return data;
  }

  function middleware(req, res, next) {
    const lang = resolveLang(req.get('X-Studio-Lang'), req.get('Accept-Language'));
    req.lang = lang;
    const json = res.json.bind(res);
    res.json = body => json(localizePayload(body, lang));
    next();
  }

  return { localize, localizePayload, middleware };
}

module.exports = { SUPPORTED_LANGS, SOURCE_LANG, resolveLang, createLocalizer };
