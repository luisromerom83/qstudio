// Interface language: one image, three languages (es-MX, en-US, pt-BR).
// Dictionaries live in static/i18n/<lang>.js and register into I18N_MESSAGES.
const SUPPORTED_LANGS = [
  { code: "es-MX", label: "Español (México)", short: "ES" },
  { code: "en-US", label: "English (US)", short: "EN" },
  { code: "pt-BR", label: "Português (Brasil)", short: "PT" }
];
const FALLBACK_LANG = "es-MX";
const LANG_STORAGE_KEY = "studio.lang";
window.I18N_MESSAGES = window.I18N_MESSAGES || {};

function matchLang(value) {
  if (!value) return null;
  const v = String(value).toLowerCase();
  const exact = SUPPORTED_LANGS.find(l => l.code.toLowerCase() === v);
  if (exact) return exact.code;
  const prefix = SUPPORTED_LANGS.find(l => l.code.slice(0, 2).toLowerCase() === v.slice(0, 2));
  return prefix ? prefix.code : null;
}

// Saved choice > installation default (STUDIO_LANG) > browser > es-MX
function detectLang() {
  let saved = null;
  try { saved = localStorage.getItem(LANG_STORAGE_KEY); } catch (e) { /* storage blocked */ }
  return matchLang(saved)
    || matchLang(document.documentElement.dataset.defaultLang)
    || (navigator.languages || [navigator.language]).map(matchLang).find(Boolean)
    || FALLBACK_LANG;
}

let currentLang = detectLang();
document.documentElement.lang = currentLang;

// t("services.title", { name: "x" }) → message with {name} replaced; falls back to es-MX, then the key
function t(key, params) {
  const msg = (window.I18N_MESSAGES[currentLang] || {})[key] ?? (window.I18N_MESSAGES[FALLBACK_LANG] || {})[key];
  if (msg === undefined) {
    console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  if (!params) return msg;
  return msg.replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined ? String(params[name]) : m));
}

// Static markup: data-i18n (text), data-i18n-html (trusted markup from our own dictionaries),
// data-i18n-attr="title:key;placeholder:key2"
function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-html]").forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll("[data-i18n-attr]").forEach(el => {
    el.dataset.i18nAttr.split(";").forEach(pair => {
      const [attr, key] = pair.split(":").map(s => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
  document.querySelectorAll("[data-lang-select]").forEach(sel => { sel.value = currentLang; });
}

function setLang(lang) {
  const code = matchLang(lang) || FALLBACK_LANG;
  if (code === currentLang) return;
  currentLang = code;
  try { localStorage.setItem(LANG_STORAGE_KEY, code); } catch (e) { /* storage blocked */ }
  document.documentElement.lang = code;
  applyI18n();
  window.dispatchEvent(new CustomEvent("studio:languagechange", { detail: { lang: code } }));
}

// Backend messages come back in the interface language
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.startsWith("/api/") || url.startsWith(`${location.origin}/api/`)) {
    const headers = new Headers(init.headers || (typeof input === "string" ? undefined : input.headers));
    headers.set("X-Studio-Lang", currentLang);
    init = { ...init, headers };
  }
  return nativeFetch(input, init);
};

document.addEventListener("DOMContentLoaded", () => applyI18n());
