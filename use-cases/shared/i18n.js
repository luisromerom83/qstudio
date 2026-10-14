// Interface language for the use-case apps (es-MX, en-US, pt-BR).
// Each page loads its dictionaries (<script> files that register into I18N_MESSAGES) before this file.
// Studio Manager opens the apps with ?lang=<code>; that choice is remembered for this origin.
(function () {
  const SUPPORTED_LANGS = [
    { code: "es-MX", label: "Español (México)" },
    { code: "en-US", label: "English (US)" },
    { code: "pt-BR", label: "Português (Brasil)" }
  ];
  const FALLBACK_LANG = "es-MX";
  const STORAGE_KEY = "usecases.lang";
  window.I18N_MESSAGES = window.I18N_MESSAGES || {};

  function matchLang(value) {
    if (!value) return null;
    const v = String(value).toLowerCase();
    const exact = SUPPORTED_LANGS.find(l => l.code.toLowerCase() === v);
    if (exact) return exact.code;
    const prefix = SUPPORTED_LANGS.find(l => l.code.slice(0, 2).toLowerCase() === v.slice(0, 2));
    return prefix ? prefix.code : null;
  }

  function readStored() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function store(code) {
    try { localStorage.setItem(STORAGE_KEY, code); } catch (e) { /* storage blocked */ }
  }

  // ?lang= (from Studio Manager) > saved choice > browser > es-MX
  function detectLang() {
    const fromUrl = matchLang(new URLSearchParams(location.search).get("lang"));
    if (fromUrl) {
      store(fromUrl);
      return fromUrl;
    }
    return matchLang(readStored())
      || (navigator.languages || [navigator.language]).map(matchLang).find(Boolean)
      || FALLBACK_LANG;
  }

  let currentLang = detectLang();
  document.documentElement.lang = currentLang;

  // t("kafka.form.topic", { name: "x" }) → message with {name} replaced; falls back to es-MX, then the key
  function t(key, params) {
    const msg = (window.I18N_MESSAGES[currentLang] || {})[key] ?? (window.I18N_MESSAGES[FALLBACK_LANG] || {})[key];
    if (msg === undefined) {
      console.warn(`[i18n] missing key: ${key}`);
      return key;
    }
    if (!params) return msg;
    return msg.replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined ? String(params[name]) : m));
  }

  // data-i18n (text), data-i18n-html (trusted markup from our dictionaries), data-i18n-attr="title:key;placeholder:key2"
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
    store(code);
    document.documentElement.lang = code;
    // Keep ?lang= in sync so a reload or a copied link opens in the same language
    const url = new URL(location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.set("lang", code);
      history.replaceState(history.state, "", url);
    }
    applyI18n();
    window.dispatchEvent(new CustomEvent("studio:languagechange", { detail: { lang: code } }));
  }

  // Compact selector: <select data-lang-select> with ES · MX / EN · US / PT · BR
  function langSelectHtml(className = "") {
    const options = SUPPORTED_LANGS.map(l =>
      `<option value="${l.code}" title="${l.label}">${l.code.replace("-", " · ").toUpperCase()}</option>`).join("");
    return `<select data-lang-select class="${className}" onchange="setLang(this.value)" aria-label="${t("common.language")}" title="${t("common.language")}">${options}</select>`;
  }

  // Server messages come back in the interface language (same-origin requests only)
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.origin === location.origin) {
      const headers = new Headers(init.headers || (typeof input === "string" ? undefined : input.headers));
      headers.set("X-Studio-Lang", currentLang);
      init = { ...init, headers };
    }
    return nativeFetch(input, init);
  };

  Object.assign(window, { t, applyI18n, setLang, langSelectHtml, SUPPORTED_LANGS });
  Object.defineProperty(window, "currentLang", { get: () => currentLang });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => applyI18n());
  } else {
    applyI18n();
  }
})();
