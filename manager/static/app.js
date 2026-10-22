/**
 * Quadient Inspire Flex - Demo & PoC Studio Frontend Logic
 */

let allEnvironments = [];
let currentFilter = "all";
let activeContainerForLogs = null;
let logPollInterval = null;
let verticals = [];             // from /api/config
let useCaseCatalog = [];        // from /api/config: bundled use cases (use-cases/cases/*/case.json) plus custom demos
let dasDemos = [];
let hostSettings = null;        // from /api/config: {configured, detected} address of this computer on the network              // from /api/config: custom demos (anonymous Quadient Cloud documents)
const busyEnvs = new Map();     // envId -> {kind: "activate"|"stop", label, step, total}
let lastEnvSnapshot = "";

const ENV_REFRESH_MS = 15000;
const PROGRESS_POLL_MS = 2000;

const VERTICAL_ICONS = {
  insurance: "shield-check",
  financials: "landmark",
  telco: "signal",
  healthcare: "heart-pulse",
  retail: "shopping-bag",
  poc: "briefcase",
  other: "layers"
};

// Initialization
document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

// Optional message: t() for catalogs that come from the API (verticals, use cases), falling back to the API text
function tOr(key, fallback, params) {
  const known = key in (window.I18N_MESSAGES[currentLang] || {}) || key in (window.I18N_MESSAGES[FALLBACK_LANG] || {});
  return known ? t(key, params) : fallback;
}

function verticalName(verticalId, fallback) {
  return tOr(`app.verticals.${verticalId || "other"}`, fallback || t("app.catalog.general"));
}

function useCaseText(useCase, field) {
  return tOr(`app.useCases.${useCase.id}.${field}`, useCase[field]);
}

function statusLabel(status) {
  return tOr(`app.status.${status}`, status);
}

// Everything rendered by JS is rebuilt in the new language; static markup is handled by applyI18n()
window.addEventListener("studio:languagechange", () => {
  lastEnvSnapshot = "";
  renderFilterPills();
  renderEnvironments();
  populateServicesSelect();
  renderServicesView();
  renderFirebaseStatus(lastFirebaseStatus);
  renderDasStatus(lastDasStatus);
  loadVolumes();
  ["new", "edit"].forEach(prefix => {
    if (!document.getElementById(`${prefix}-env-modal`)?.open) return;
    renderUseCaseCheckboxes(prefix, selectedUseCases(prefix));
    renderBrandingFields(prefix);
  });
  if (document.getElementById("logs-modal")?.open && activeContainerForLogs) renderLogsSubtitle(activeContainerForLogs);
  if (document.getElementById("volume-locations-modal")?.open && volumeModalEnvId) openVolumeLocationModal(volumeModalEnvId);
  lucide.createIcons();
});

async function initApp() {
  lucide.createIcons();
  initProductHints();
  await checkConfigAndOnboarding();
  await loadEnvironments();
  loadVolumes();

  // Keep card status current (containers can change outside the UI)
  setInterval(() => {
    if (document.visibilityState === "visible" && !document.querySelector("dialog[open]")) {
      loadEnvironments();
    }
  }, ENV_REFRESH_MS);
}

// ------------------------------------------------------------------------------
// Navigation & Tabs
// ------------------------------------------------------------------------------
function switchTab(tabId) {
  ["catalog", "services", "acr", "storage", "settings", "help"].forEach(t => {
    document.getElementById(`view-${t}`).classList.toggle("hidden", t !== tabId);
  });
  // Desktop and mobile navs share the same data-tab buttons
  document.querySelectorAll(".tab-btn[data-tab]").forEach(btn => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle("text-white", active);
    btn.classList.toggle("bg-slate-800", active);
    btn.classList.toggle("border-slate-700", active);
    btn.classList.toggle("text-slate-400", !active);
    btn.classList.toggle("border-transparent", !active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });

  if (tabId === "acr") {
    loadAcrVersions();
  } else if (tabId === "storage") {
    loadVolumes();
  } else if (tabId === "services") {
    populateServicesSelect();
    renderServicesView();
  } else if (tabId === "settings") {
    switchSettingsTab(savedSettingsTab());
    loadInspireVersions();
  } else if (tabId === "help") {
    loadHelp();
  }

  lucide.createIcons();
}

// Ayuda: the user manual, rendered from docs/manual-usuario.<lang>.md (only es-MX for now)
const HELP_LANGS = ["es-MX"];
let helpLoaded = false;
async function loadHelp() {
  const lang = HELP_LANGS.includes(currentLang) ? currentLang : HELP_LANGS[0];
  document.getElementById("help-lang-note").classList.toggle("hidden", lang === currentLang);
  if (helpLoaded) return;
  const box = document.getElementById("help-content");
  try {
    const res = await fetch(`/static/help/manual.${lang}.html`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    box.innerHTML = await res.text();
    helpLoaded = true;
    // Table of contents: scroll inside the page instead of changing the address
    box.querySelector("[data-manual-toc]").addEventListener("click", ev => {
      const link = ev.target.closest("a[href^='#']");
      if (!link) return;
      ev.preventDefault();
      document.getElementById(link.getAttribute("href").slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  } catch (err) {
    box.innerHTML = `<p class="text-sm text-rose-300">${escapeHtml(t("app.help.loadError", { error: err.message }))}</p>`;
  }
}

// ------------------------------------------------------------------------------
// Config & Onboarding
// ------------------------------------------------------------------------------
async function checkConfigAndOnboarding() {
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    
    // Populate settings form
    const creds = data.credentials || {};
    verticals = data.verticals || [];
    useCaseCatalog = data.use_cases || [];
    renderFilterPills();
    document.getElementById("setting-registry").value = creds.registry || "quadientdistribution.azurecr.io";
    document.getElementById("setting-username").value = creds.username || "";
    document.getElementById("setting-lic-server").value = creds.license_server || "";
    renderFirebaseStatus(data.firebase);
    fillDasForm(data.das);
    fillBankingForm(data.banking);
    hostSettings = data.host || null;
    fillHostForm();
    dasDemos = data.das_demos || [];
    renderDemosList();
    resetDemoForm();

    if (data.needs_onboarding) {
      const modal = document.getElementById("onboarding-modal");
      if (modal && !modal.open) {
        modal.showModal();
        lucide.createIcons();
      }
    }
  } catch (err) {
    console.error("Error al cargar configuración:", err);
  }
}

async function handleOnboardingSubmit(e) {
  e.preventDefault();
  const reg = document.getElementById("ob-registry").value.trim();
  const user = document.getElementById("ob-username").value.trim();
  const pwd = document.getElementById("ob-password").value.trim();
  const lic = document.getElementById("ob-lic").value.trim();

  try {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        registry: reg,
        username: user,
        password: pwd,
        license_server: lic
      })
    });
    const result = await res.json();
    if (result.success) {
      closeModal("onboarding-modal");
      showAlert("success", t("app.onboarding.saved"));
      await checkConfigAndOnboarding();
      loadEnvironments();
    } else {
      showAlert("error", result.message || t("app.common.saveError"));
    }
  } catch (err) {
    showAlert("error", t("app.common.networkError", { error: err.message }));
  }
}

async function testOnboardingConnection() {
  const reg = document.getElementById("ob-registry").value.trim();
  const user = document.getElementById("ob-username").value.trim();
  const pwd = document.getElementById("ob-password").value.trim();
  if (!user || !pwd) {
    showAlert("error", t("app.onboarding.missingCreds"));
    return;
  }
  showAlert("info", t("app.onboarding.validating"));
  try {
    const res = await fetch("/api/config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registry: reg, username: user, password: pwd })
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
  } catch (err) {
    showAlert("error", t("app.onboarding.connectFailed", { error: err.message }));
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const reg = document.getElementById("setting-registry").value.trim();
  const user = document.getElementById("setting-username").value.trim();
  const pwd = document.getElementById("setting-password").value.trim();
  const lic = document.getElementById("setting-lic-server").value.trim();

  try {
    const payload = { registry: reg, username: user, license_server: lic };
    if (pwd) payload.password = pwd;

    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
  } catch (err) {
    showAlert("error", t("app.common.networkError", { error: err.message }));
  }
}

let lastFirebaseStatus = null;

function renderFirebaseStatus(fb) {
  lastFirebaseStatus = fb;
  const el = document.getElementById("firebase-status");
  if (!el) return;
  if (fb && fb.configured) {
    el.textContent = t("app.firebase.configured", { project: fb.project_id, email: fb.client_email });
  } else {
    const missing = [
      !(fb && fb.service_account) && t("app.firebase.missing.serviceAccount"),
      !(fb && fb.web_config) && t("app.firebase.missing.webConfig"),
      !(fb && fb.vapid_key) && t("app.firebase.missing.vapidKey")
    ].filter(Boolean);
    el.textContent = t("app.firebase.notConfigured", { missing: missing.join(", ") });
  }
}

// ------------------------------------------------------------------------------
// Custom demos: one anonymous Quadient Cloud document each, published as its own use case
// ------------------------------------------------------------------------------
function renderDemosList() {
  const list = document.getElementById("demos-list");
  if (!list) return;
  list.classList.toggle("hidden", !dasDemos.length);
  document.getElementById("demos-empty").classList.toggle("hidden", dasDemos.length > 0);
  list.innerHTML = dasDemos.map(d => `
    <div class="flex items-start justify-between gap-3 px-3 py-2.5">
      <div class="min-w-0">
        <p class="text-xs font-semibold text-white truncate">${escapeHtml(d.name)} <code class="text-[10px] text-slate-500 font-normal">/${escapeHtml(d.id)}/</code></p>
        <p class="text-[10px] font-mono text-slate-500 truncate">App ${escapeHtml(d.app_id)} · Doc ${escapeHtml(d.document_id)}</p>
        ${d.description ? `<p class="text-[11px] text-slate-400 truncate">${escapeHtml(d.description)}</p>` : ""}
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        ${iconButton("pencil", t("app.demos.edit"), `editDemo('${escapeHtml(d.id)}')`)}
        ${iconButton("trash-2", t("app.demos.delete"), `deleteDemo('${escapeHtml(d.id)}')`, { danger: true })}
      </div>
    </div>`).join("");
  lucide.createIcons();
}

function fillDemoForm(demo) {
  const set = (id, value) => { document.getElementById(id).value = value || ""; };
  set("setting-demo-id", demo.id);
  set("setting-demo-name", demo.name);
  set("setting-demo-description", demo.description);
  // A new demo starts from the Quadient Cloud URL of the Digital Advantage Inbox
  set("setting-demo-url", demo.cloud_url || (lastDasStatus && lastDasStatus.cloud_url));
  set("setting-demo-app-id", demo.app_id);
  set("setting-demo-client-id", demo.client_id);
  set("setting-demo-document-id", demo.document_id);
  const editing = Boolean(demo.id);
  const title = document.getElementById("demo-form-title");
  title.dataset.i18n = editing ? "html.demos.editTitle" : "html.demos.newTitle";
  title.textContent = t(title.dataset.i18n);
  const submit = document.getElementById("demo-submit-label");
  submit.dataset.i18n = editing ? "html.demos.save" : "html.demos.add";
  submit.textContent = t(submit.dataset.i18n);
  document.getElementById("demo-cancel").classList.toggle("hidden", !editing);
}

function resetDemoForm() {
  if (document.getElementById("demo-form")) fillDemoForm({});
}

function editDemo(id) {
  const demo = dasDemos.find(d => d.id === id);
  if (!demo) return;
  fillDemoForm(demo);
  document.getElementById("demo-form").scrollIntoView({ behavior: "smooth", block: "center" });
  document.getElementById("setting-demo-name").focus();
}

function applyDemosResponse(data) {
  dasDemos = data.das_demos || dasDemos;
  if (data.use_cases) useCaseCatalog = data.use_cases;
  renderDemosList();
}

async function handleSaveDemo(e) {
  e.preventDefault();
  const value = id => document.getElementById(id).value.trim();
  const payload = {
    id: value("setting-demo-id"),
    name: value("setting-demo-name"),
    description: value("setting-demo-description"),
    cloud_url: value("setting-demo-url"),
    app_id: value("setting-demo-app-id"),
    client_id: value("setting-demo-client-id"),
    document_id: value("setting-demo-document-id")
  };
  try {
    const res = await fetch("/api/config/das-demos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
    if (data.success) {
      applyDemosResponse(data);
      resetDemoForm();
    }
  } catch (err) {
    showAlert("error", t("app.common.networkError", { error: err.message }));
  }
}

async function deleteDemo(id) {
  const demo = dasDemos.find(d => d.id === id);
  if (!demo) return;
  const usedBy = allEnvironments.filter(env => (env.use_cases || []).includes(id)).map(env => env.name);
  const { action } = await openActionDialog({
    title: t("app.demos.deleteTitle"),
    message: `<p>${t("app.demos.deleteBody", { name: escapeHtml(demo.name) })}</p>` +
      (usedBy.length ? `<p class="text-amber-300">${t("app.demos.deleteUsedBy", { envs: escapeHtml(usedBy.join(", ")) })}</p>` : ""),
    actions: [{ id: "delete", label: t("app.demos.delete"), style: "danger" }]
  });
  if (action !== "delete") return;
  try {
    const res = await fetch(`/api/config/das-demos/${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
    if (data.success) {
      applyDemosResponse(data);
      if (document.getElementById("setting-demo-id").value === id) resetDemoForm();
      if (usedBy.length) loadEnvironments();
    }
  } catch (err) {
    showAlert("error", t("app.common.networkError", { error: err.message }));
  }
}

// ------------------------------------------------------------------------------
// Use cases (one checkbox per bundled case)
// ------------------------------------------------------------------------------
const USE_CASE_REQUIREMENTS = {
  kafka: "app.useCases.requires.kafka",
  firebase: "app.useCases.requires.firebase",
  das: "app.useCases.requires.das"
};

function renderUseCaseCheckboxes(prefix, selected) {
  const container = document.getElementById(`${prefix}-env-use-cases`);
  if (!container) return;
  if (!useCaseCatalog.length) {
    container.innerHTML = `<p class="text-[11px] text-slate-500">${t("app.useCases.noneAvailable")}</p>`;
    return;
  }
  const checkbox = c => {
    const id = `${prefix}-env-uc-${c.id}`;
    const reqs = (c.requires || []).map(r => USE_CASE_REQUIREMENTS[r]).filter(Boolean).map(key => t(key)).join(" ");
    return `
      <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-start gap-3 hover:border-slate-700 transition">
        <input type="checkbox" id="${id}" data-use-case="${escapeHtml(c.id)}" data-requires="${escapeHtml((c.requires || []).join(","))}"
          ${selected.includes(c.id) ? "checked" : ""} onchange="handleUseCaseToggle('${prefix}', this)"
          class="mt-1 w-4 h-4 rounded border-slate-700 text-brand-600 bg-slate-950 focus:ring-brand-500 cursor-pointer">
        <label for="${id}" class="cursor-pointer">
          <span class="block text-xs font-semibold text-white">${escapeHtml(useCaseText(c, "name"))} <code class="text-[10px] text-slate-500 font-normal">/${escapeHtml(c.id)}/</code></span>
          <span class="block text-[11px] text-slate-400 mt-0.5 leading-snug">${escapeHtml(useCaseText(c, "description"))}${reqs ? ` <span class="text-slate-500">${escapeHtml(reqs)}</span>` : ""}</span>
        </label>
      </div>`;
  };
  const bundled = useCaseCatalog.filter(c => !c.custom);
  const custom = useCaseCatalog.filter(c => c.custom);
  container.innerHTML = bundled.map(checkbox).join("") + (custom.length ? `
    <p class="col-span-full pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
      <i data-lucide="file-text" class="w-3.5 h-3.5"></i>${t("html.demos.title")}
    </p>
    ${custom.map(checkbox).join("")}` : "");
  lucide.createIcons();
}

function handleUseCaseToggle(prefix, checkbox) {
  // Selecting a Kafka use case brings the broker along; it can still be unchecked for an external broker
  if (checkbox.checked && checkbox.dataset.requires.split(",").includes("kafka")) {
    const kafka = document.getElementById(`${prefix}-env-enable-kafka`);
    if (kafka) kafka.checked = true;
  }
}

function selectedUseCases(prefix) {
  return Array.from(document.querySelectorAll(`#${prefix}-env-use-cases input[data-use-case]:checked`))
    .map(el => el.dataset.useCase);
}

async function handleSaveFirebase(e) {
  e.preventDefault();
  const fields = {
    service_account: document.getElementById("setting-firebase-key"),
    web_config: document.getElementById("setting-firebase-web"),
    vapid_key: document.getElementById("setting-firebase-vapid")
  };
  const payload = {};
  Object.entries(fields).forEach(([k, el]) => { payload[k] = el.value.trim(); });
  try {
    const res = await fetch("/api/config/firebase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
    if (data.success) {
      Object.values(fields).forEach(el => { el.value = ""; });
      renderFirebaseStatus(data.firebase);
    }
  } catch (err) {
    showAlert("error", t("app.common.networkError", { error: err.message }));
  }
}

let lastDasStatus = null;

function renderDasStatus(das) {
  lastDasStatus = das;
  const el = document.getElementById("das-status");
  if (!el) return;
  el.textContent = das && das.configured
    ? t("app.das.configured", { url: das.cloud_url, app: das.app_id })
    : t("app.das.notConfigured");
}

function fillDasForm(das) {
  if (!das) return;
  document.getElementById("setting-das-url").value = das.cloud_url || "";
  document.getElementById("setting-das-app-id").value = das.app_id || "";
  document.getElementById("setting-das-client-id").value = das.client_id || "";
  renderDasStatus(das);
  // The Digital Services box in the services view links to this cloud URL
  renderServicesView();
}

// ------------------------------------------------------------------------------
// Scaler configuration: export its administration settings to a file and import them (into the same or another
// environment). Scaler imports module by module: each chosen module replaces the whole module in Scaler.
// ------------------------------------------------------------------------------
async function exportScalerConfig(envId) {
  await downloadFromApi(`/api/environments/${encodeURIComponent(envId)}/scaler-config`, `scaler-config-${envId}.json`, "app.scalerConfig.exported");
}

async function exportIcmVariables(envId) {
  await downloadFromApi(`/api/environments/${encodeURIComponent(envId)}/icm-variables`, `ICMEnvVars-${envId}.json`, "app.icmVariables.exported");
}

// Saves a file the API sends as an attachment; API errors come back as JSON and are shown instead
async function downloadFromApi(url, fallbackName, doneKey) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showAlert("error", data.message || `HTTP ${res.status}`);
      return;
    }
    const name = (/filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "") || [])[1] || fallbackName;
    const blobUrl = URL.createObjectURL(await res.blob());
    const link = Object.assign(document.createElement("a"), { href: blobUrl, download: name });
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
    showAlert("success", t(doneKey, { file: name }));
  } catch (err) {
    showAlert("error", t("app.common.networkError", { error: err.message }));
  }
}

// What a module holds: the size of its list, or "settings" for the modules that are a single block
function scalerModuleSummary(module) {
  const list = Object.values(module).find(v => Array.isArray(v));
  if (!list) return { count: null, text: t("app.scalerConfig.settings") };
  return { count: list.length, text: t(list.length === 1 ? "app.scalerConfig.item" : "app.scalerConfig.items", { count: list.length }) };
}

function chooseScalerModules(config, fileName, envLabel) {
  return new Promise(resolve => {
    let dlg = document.getElementById("scaler-config-dialog");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "scaler-config-dialog";
      dlg.className = "bg-slate-900 border border-slate-700 text-slate-100 rounded-xl shadow-2xl p-0 w-[calc(100%-2rem)] max-w-xl";
      document.body.appendChild(dlg);
    }
    const modules = Object.entries(config)
      .filter(([, m]) => m && typeof m === "object" && "importEnabled" in m)
      .map(([name, m]) => ({ name, ...scalerModuleSummary(m), enabled: m.importEnabled !== false }));
    // Empty lists start unchecked: importing them would erase what the target Scaler has in that module
    const checked = m => m.enabled && m.count !== 0;
    dlg.innerHTML = `
      <form method="dialog" class="p-6 space-y-4">
        <h2 class="text-base font-semibold text-white">${t("app.scalerConfig.importTitle")}</h2>
        <p class="text-sm text-slate-300">${t("app.scalerConfig.importIntro", { file: `<span class="font-mono text-white break-all">${escapeHtml(fileName)}</span>`, env: `<strong class="text-white">${escapeHtml(envLabel)}</strong>` })}</p>
        <div class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-200 space-y-1">
          <p>${t("app.scalerConfig.replaceWarning")}</p>
          <p>${t("app.scalerConfig.undeployWarning")}</p>
        </div>
        <div class="flex items-center justify-between text-[11px] text-slate-400">
          <span>${t("app.scalerConfig.modules")}</span>
          <span class="flex gap-3">
            <button type="button" data-select="all" class="hover:text-white underline">${t("app.scalerConfig.selectAll")}</button>
            <button type="button" data-select="content" class="hover:text-white underline">${t("app.scalerConfig.selectContent")}</button>
          </span>
        </div>
        <div class="max-h-72 overflow-y-auto rounded-lg border border-slate-700 divide-y divide-slate-800 bg-slate-950">
          ${modules.map(m => `
            <label class="flex items-center gap-3 px-3 py-1.5 text-xs cursor-pointer hover:bg-slate-900">
              <input type="checkbox" value="${escapeHtml(m.name)}" ${checked(m) ? "checked" : ""} class="w-4 h-4 rounded border-slate-700 text-brand-600 bg-slate-950">
              <span class="font-mono text-slate-200 flex-1">${escapeHtml(m.name)}</span>
              <span class="${m.count === 0 ? "text-slate-600" : "text-slate-400"}">${escapeHtml(m.text)}</span>
            </label>`).join("")}
        </div>
        <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <button value="" class="whitespace-nowrap px-3.5 py-2 rounded-md text-sm font-medium text-slate-300 border border-slate-700 hover:bg-slate-800">${t("app.common.cancel")}</button>
          <button value="import" class="whitespace-nowrap px-3.5 py-2 rounded-md text-sm font-medium ${DIALOG_BUTTON_STYLES.primary}">${t("app.scalerConfig.importAction")}</button>
        </div>
      </form>`;
    const boxes = () => Array.from(dlg.querySelectorAll('input[type="checkbox"]'));
    dlg.querySelector('[data-select="all"]').onclick = () => boxes().forEach(b => { b.checked = true; });
    dlg.querySelector('[data-select="content"]').onclick = () => boxes().forEach(b => { b.checked = checked(modules.find(m => m.name === b.value)); });
    dlg.onclick = ev => { if (ev.target === dlg) dlg.close(""); };
    dlg.addEventListener("close", () => {
      resolve(dlg.returnValue === "import" ? boxes().filter(b => b.checked).map(b => b.value) : null);
    }, { once: true });
    dlg.returnValue = "";
    dlg.showModal();
  });
}

async function importScalerConfig(envId, input) {
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  let config = null;
  try {
    config = JSON.parse(await file.text());
  } catch (_) { /* reported below */ }
  if (!config || typeof config !== "object" || !config.internalSettings) {
    showAlert("error", t("app.scalerConfig.invalid"));
    return;
  }
  const modules = await chooseScalerModules(config, file.name, envName(envId));
  if (!modules) return;
  if (!modules.length) {
    showAlert("error", t("app.scalerConfig.noneChosen"));
    return;
  }
  showAlert("info", t("app.scalerConfig.importing"));
  try {
    const res = await fetch(`/api/environments/${encodeURIComponent(envId)}/scaler-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config, modules })
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
  } catch (err) {
    showAlert("error", t("app.common.networkError", { error: err.message }));
  }
}

// ICM environment variables (ICMEnvVars.json format): AppendOnly adds the new ones, AppendOrOverwrite also
// overwrites the existing ones, Replace leaves exactly the file's variables
const ICM_IMPORT_BEHAVIORS = ["AppendOnly", "AppendOrOverwrite", "Replace"];

function icmVariableNames(node, prefix = "") {
  return (node.Children || []).flatMap(child => {
    const path = prefix ? `${prefix}/${child.Name}` : child.Name;
    return child.EntryType === "Folder" ? icmVariableNames(child, path) : [path];
  });
}

function chooseIcmImportBehavior(variables, fileName, envLabel) {
  return new Promise(resolve => {
    let dlg = document.getElementById("icm-variables-dialog");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "icm-variables-dialog";
      dlg.className = "bg-slate-900 border border-slate-700 text-slate-100 rounded-xl shadow-2xl p-0 w-[calc(100%-2rem)] max-w-lg";
      document.body.appendChild(dlg);
    }
    const names = icmVariableNames(variables.Root);
    dlg.innerHTML = `
      <form method="dialog" class="p-6 space-y-4">
        <h2 class="text-base font-semibold text-white">${t("app.icmVariables.importTitle")}</h2>
        <p class="text-sm text-slate-300">${t("app.icmVariables.importIntro", { file: `<span class="font-mono text-white break-all">${escapeHtml(fileName)}</span>`, env: `<strong class="text-white">${escapeHtml(envLabel)}</strong>`, count: names.length })}</p>
        <div class="max-h-32 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-[11px] text-slate-300 leading-relaxed">
          ${names.map(n => escapeHtml(n)).join("<br>") || `<span class="text-slate-500">${t("app.icmVariables.empty")}</span>`}
        </div>
        <fieldset class="space-y-2">
          <legend class="text-xs text-slate-400 mb-1">${t("app.icmVariables.behavior")}</legend>
          ${ICM_IMPORT_BEHAVIORS.map((b, i) => `
            <label class="flex items-start gap-2.5 rounded-lg border border-slate-800 px-3 py-2 cursor-pointer hover:border-slate-600">
              <input type="radio" name="icm-behavior" value="${b}" ${i === 0 ? "checked" : ""} class="mt-0.5 text-brand-600 bg-slate-950 border-slate-700">
              <span>
                <span class="block text-xs font-semibold ${b === "Replace" ? "text-amber-300" : "text-white"}">${t(`app.icmVariables.behavior.${b}`)}</span>
                <span class="block text-[11px] text-slate-400">${t(`app.icmVariables.behaviorHint.${b}`)}</span>
              </span>
            </label>`).join("")}
        </fieldset>
        <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <button value="" class="whitespace-nowrap px-3.5 py-2 rounded-md text-sm font-medium text-slate-300 border border-slate-700 hover:bg-slate-800">${t("app.common.cancel")}</button>
          <button value="import" class="whitespace-nowrap px-3.5 py-2 rounded-md text-sm font-medium ${DIALOG_BUTTON_STYLES.primary}">${t("app.icmVariables.importAction")}</button>
        </div>
      </form>`;
    dlg.onclick = ev => { if (ev.target === dlg) dlg.close(""); };
    dlg.addEventListener("close", () => {
      resolve(dlg.returnValue === "import" ? dlg.querySelector('input[name="icm-behavior"]:checked').value : null);
    }, { once: true });
    dlg.returnValue = "";
    dlg.showModal();
  });
}

async function importIcmVariables(envId, input) {
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  let variables = null;
  try {
    variables = JSON.parse(await file.text());
  } catch (_) { /* reported below */ }
  if (!variables || typeof variables !== "object" || !variables.Root) {
    showAlert("error", t("app.icmVariables.invalid"));
    return;
  }
  const behavior = await chooseIcmImportBehavior(variables, file.name, envName(envId));
  if (!behavior) return;
  try {
    const res = await fetch(`/api/environments/${encodeURIComponent(envId)}/icm-variables`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variables, behavior })
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
  } catch (err) {
    showAlert("error", t("app.common.networkError", { error: err.message }));
  }
}

// ------------------------------------------------------------------------------
// Settings backup: import a file made with "Export settings" (on this or another machine)
// ------------------------------------------------------------------------------
const SETTINGS_SECTIONS = ["azure", "firebase", "quadient_cloud", "banking", "custom_demos"];

async function handleImportSettings(input) {
  const file = input.files && input.files[0];
  input.value = "";  // the same file can be picked again later
  if (!file) return;
  let doc;
  try {
    doc = JSON.parse(await file.text());
  } catch (_) {
    doc = null;
  }
  if (!doc || doc.format !== "inspire-flex-studio-settings") {
    showAlert("error", t("app.settingsBackup.invalid"));
    return;
  }
  const sections = SETTINGS_SECTIONS.filter(key => key === "azure" ? doc.azure && doc.azure.username : doc[key] != null);
  const label = key => key === "custom_demos"
    ? t("app.settingsBackup.section.custom_demos", { count: Array.isArray(doc.custom_demos) ? doc.custom_demos.length : 0 })
    : t(`app.settingsBackup.section.${key}`);
  const exported = doc.exported_at ? new Date(doc.exported_at).toLocaleString(currentLang) : "";
  const { action } = await openActionDialog({
    title: t("app.settingsBackup.confirmTitle"),
    message: `<p>${t("app.settingsBackup.confirmFile", { file: `<span class="font-mono text-white break-all">${escapeHtml(file.name)}</span>`, date: escapeHtml(exported) })}</p>
      <ul class="list-disc pl-5 space-y-0.5">${sections.map(key => `<li>${escapeHtml(label(key))}</li>`).join("")}</ul>
      <p class="text-amber-300">${t("app.settingsBackup.confirmReplace")}</p>`,
    actions: [{ id: "ok", label: t("app.settingsBackup.confirmAction"), style: "primary" }]
  });
  if (action !== "ok") return;

  showAlert("info", t("app.settingsBackup.importing"));
  try {
    const res = await fetch("/api/settings/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc)
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
    if (data.results && data.results.length) {
      await openActionDialog({
        title: data.message,
        message: `<ul class="space-y-1.5">${data.results.map(r => `
          <li class="flex items-start gap-2">
            <span class="${r.ok ? "text-emerald-400" : "text-rose-400"}">${r.ok ? "✓" : "✕"}</span>
            <span><strong class="text-white">${escapeHtml(label(r.section))}</strong> — ${escapeHtml(r.message)}</span>
          </li>`).join("")}</ul>`,
        actions: [{ id: "ok", label: t("app.settingsBackup.done"), style: "primary" }]
      });
    }
    await checkConfigAndOnboarding();
    inspireVersions = null;
  } catch (err) {
    showAlert("error", t("app.common.networkError", { error: err.message }));
  }
}

// ------------------------------------------------------------------------------
// Inspire version: move an environment to another version published in Azure (Settings)
// ------------------------------------------------------------------------------
let inspireVersions = null;      // [{version, missing: [component]}] from /api/inspire-versions
let inspireVersionsError = "";

async function loadInspireVersions(force = false) {
  if (inspireVersions && !force) return renderVersionEnvs();
  const status = document.getElementById("versions-status");
  if (status) status.textContent = t("app.versions.loading");
  try {
    const res = await fetch("/api/inspire-versions");
    const data = await res.json();
    inspireVersions = data.success ? data.versions : [];
    inspireVersionsError = data.success ? "" : data.message;
  } catch (err) {
    inspireVersions = [];
    inspireVersionsError = err.message;
  }
  renderVersionEnvs();
}

function renderVersionEnvs() {
  const list = document.getElementById("versions-envs");
  const status = document.getElementById("versions-status");
  if (!list || !status) return;
  if (inspireVersions === null) return;
  const complete = inspireVersions.filter(v => !v.missing.length);
  status.textContent = inspireVersionsError
    ? t("app.versions.error", { error: inspireVersionsError })
    : t("app.versions.available", { list: complete.map(v => v.version).join(", ") || "—" });
  list.classList.toggle("hidden", !allEnvironments.length);
  list.innerHTML = allEnvironments.map(env => {
    const busy = busyEnvs.get(env.id);
    const current = env.version || "17.5-latest";
    const options = inspireVersions.map(v => {
      const label = v.missing.length ? `${v.version} — ${t("app.versions.missing", { list: v.missing.join(", ") })}` : v.version;
      return `<option value="${escapeHtml(v.version)}" ${v.missing.length || v.version === current ? "disabled" : ""}>${escapeHtml(label)}${v.version === current ? ` (${t("app.versions.current")})` : ""}</option>`;
    }).join("");
    const firstFree = inspireVersions.find(v => !v.missing.length && v.version !== current);
    return `
      <div class="flex flex-col sm:flex-row sm:items-center gap-3 px-3.5 py-3">
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold text-white truncate">${escapeHtml(env.name)}</p>
          <p class="text-[11px] text-slate-400">${t("app.versions.currentLabel")} <span class="font-mono text-slate-200">${escapeHtml(current)}</span> · ${escapeHtml(statusLabel(env.status))}</p>
          ${busy ? `<p class="text-[11px] text-sky-300 mt-1 flex items-center gap-1.5"><i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i>${escapeHtml(busy.label || "")}</p>` : ""}
        </div>
        <div class="flex items-center gap-2">
          <select id="version-select-${escapeHtml(env.id)}" ${busy || !firstFree ? "disabled" : ""} aria-label="${t("app.versions.newVersion")}"
            class="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-brand-500 disabled:opacity-50">
            ${options}
          </select>
          <button type="button" onclick="upgradeEnvironmentVersion('${escapeHtml(env.id)}')" ${busy || !firstFree ? "disabled" : ""}
            class="whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-40 disabled:pointer-events-none">
            ${t("app.versions.update")}
          </button>
        </div>
      </div>`;
  }).join("");
  // Preselect the newest complete version that isn't the current one
  allEnvironments.forEach(env => {
    const select = document.getElementById(`version-select-${env.id}`);
    const first = inspireVersions.find(v => !v.missing.length && v.version !== (env.version || "17.5-latest"));
    if (select && first) select.value = first.version;
  });
  lucide.createIcons();
}

async function upgradeEnvironmentVersion(envId) {
  const env = allEnvironments.find(e => e.id === envId);
  const version = document.getElementById(`version-select-${envId}`)?.value;
  if (!env || !version || busyEnvs.has(envId)) return;
  const running = env.status === "running" || env.status === "partial";
  const { action } = await openActionDialog({
    title: t("app.versions.confirmTitle"),
    message: `<p>${t("app.versions.confirmBody", { name: `<strong class="text-white">${escapeHtml(env.name)}</strong>`, from: `<span class="font-mono">${escapeHtml(env.version || "17.5-latest")}</span>`, to: `<span class="font-mono text-white">${escapeHtml(version)}</span>` })}</p>
      <p>${t(running ? "app.versions.confirmRunning" : "app.versions.confirmStopped")}</p>
      <p class="text-amber-300">${t("app.versions.confirmBackup")}</p>`,
    actions: [{ id: "ok", label: t("app.versions.confirmAction", { version }), style: "primary" }]
  });
  if (action !== "ok") return;

  busyEnvs.set(envId, { kind: "activate", label: t("app.versions.starting"), step: 0, total: 3 });
  renderVersionEnvs();
  renderEnvironments();
  const poller = setInterval(async () => {
    try {
      const progress = await fetchProgress(envId);
      if (progress && busyEnvs.has(envId)) {
        Object.assign(busyEnvs.get(envId), progress);
        updateProgressUI(envId);
        renderVersionEnvs();
      }
    } catch (_) { /* transient; next tick retries */ }
  }, PROGRESS_POLL_MS);
  try {
    const res = await fetch(`/api/environments/${encodeURIComponent(envId)}/upgrade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version })
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
  } catch (err) {
    showAlert("error", t("app.common.networkError", { error: err.message }));
  } finally {
    clearInterval(poller);
    busyEnvs.delete(envId);
    lastEnvSnapshot = "";
    await loadEnvironments();
    renderVersionEnvs();
  }
}

// Address other machines use to reach this computer (ICM clients, FTP clients): the one typed in Settings, the
// detected one, or the address the Studio was opened with
function hostAddress() {
  if (hostSettings && (hostSettings.configured || hostSettings.detected)) return hostSettings.configured || hostSettings.detected;
  const host = window.location.hostname;
  return host && host !== "127.0.0.1" ? host : "localhost";
}

function fillHostForm() {
  const input = document.getElementById("setting-host-address");
  if (!input) return;
  input.value = (hostSettings && hostSettings.configured) || "";
  input.placeholder = (hostSettings && hostSettings.detected) || "192.168.1.20";
  document.getElementById("host-detected").textContent = hostSettings && hostSettings.detected
    ? t("app.host.detected", { address: hostSettings.detected })
    : t("app.host.notDetected");
}

async function handleSaveHost(e) {
  e.preventDefault();
  try {
    const res = await fetch("/api/config/host", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host_address: document.getElementById("setting-host-address").value.trim() })
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
    if (data.success) {
      hostSettings = data.host;
      fillHostForm();
      renderServicesView();
    }
  } catch (err) {
    showAlert("error", t("app.common.networkError", { error: err.message }));
  }
}

function copyText(text) {
  const done = () => showAlert("success", t("app.host.copied", { text }));
  navigator.clipboard.writeText(text).then(done).catch(() => {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    done();
  });
}

// Online banking: which DAS documents are its monthly statements (it signs in with the Quadient Cloud settings above)
function fillBankingForm(banking) {
  if (!banking) return;
  document.getElementById("setting-banking-meta-name").value = banking.statements_meta_name || "";
  document.getElementById("setting-banking-meta-value").value = banking.statements_meta_value || "";
}

async function handleSaveBanking(e) {
  e.preventDefault();
  const value = id => document.getElementById(id).value.trim();
  try {
    const res = await fetch("/api/config/banking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        statements_meta_name: value("setting-banking-meta-name"),
        statements_meta_value: value("setting-banking-meta-value")
      })
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
    if (data.success) fillBankingForm(data.banking);
  } catch (err) {
    showAlert("error", t("app.common.networkError", { error: err.message }));
  }
}

async function handleSaveDas(e) {
  e.preventDefault();
  const value = id => document.getElementById(id).value.trim();
  const payload = {
    cloud_url: value("setting-das-url"),
    app_id: value("setting-das-app-id"),
    client_id: value("setting-das-client-id")
  };
  try {
    const res = await fetch("/api/config/das", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
    if (data.success) fillDasForm(data.das);
  } catch (err) {
    showAlert("error", t("app.common.networkError", { error: err.message }));
  }
}

async function testAcrConnection() {
  const reg = document.getElementById("setting-registry").value.trim();
  const user = document.getElementById("setting-username").value.trim();
  const pwd = document.getElementById("setting-password").value.trim();
  showAlert("info", t("app.settings.testingAcr"));
  try {
    const res = await fetch("/api/config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registry: reg, username: user, password: pwd })
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
  } catch (err) {
    showAlert("error", t("app.common.error", { error: err.message }));
  }
}

// ------------------------------------------------------------------------------
// Environments / Demos Catalog
// ------------------------------------------------------------------------------
async function loadEnvironments() {
  try {
    const res = await fetch("/api/environments");
    const data = await res.json();
    allEnvironments = (data.environments || []).filter(e => e.id !== "default");

    // Resume progress tracking for activations started elsewhere (or before a reload)
    allEnvironments.forEach(e => {
      if (e.activation && !busyEnvs.has(e.id)) trackRemoteActivation(e.id, e.activation);
    });

    document.getElementById("env-count").innerText = allEnvironments.length;
    populateServicesSelect();

    // Skip re-rendering when nothing changed (auto-refresh runs every few seconds)
    const snapshot = JSON.stringify(allEnvironments.map(e => [e.id, e.name, e.status, e.version, e.description, e.vertical_id, e.demo_mode, e.storage_path, e.ports, e.enable_interactive, e.enable_scaler, e.branding]));
    if (snapshot !== lastEnvSnapshot) {
      lastEnvSnapshot = snapshot;
      renderFilterPills();
      renderEnvironments();
      renderVersionEnvs();
    }
  } catch (err) {
    console.error("Error al cargar ambientes:", err);
  }
}

function verticalIcon(verticalId) {
  return VERTICAL_ICONS[verticalId] || VERTICAL_ICONS.other;
}

function renderFilterPills() {
  const box = document.getElementById("vertical-filter-pills");
  if (!box) return;
  const counts = {};
  allEnvironments.forEach(e => {
    const id = e.vertical_id || "other";
    counts[id] = (counts[id] || 0) + 1;
  });
  // Only sectors that have demos (plus the active filter) to keep the bar compact
  const items = [{ id: "all", name: t("app.filters.all") }, ...verticals.filter(v => counts[v.id] || v.id === currentFilter)];
  box.innerHTML = items.map(v => {
    const active = v.id === currentFilter;
    const count = v.id === "all" ? allEnvironments.length : (counts[v.id] || 0);
    return `
      <button type="button" onclick="filterVertical('${v.id}')" aria-pressed="${active}"
        class="vertical-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition whitespace-nowrap ${active ? "bg-slate-700 text-white border-slate-600" : "text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800"}">
        ${v.id !== "all" ? `<i data-lucide="${verticalIcon(v.id)}" class="w-3.5 h-3.5 opacity-80"></i>` : ""}
        ${escapeHtml(v.id === "all" ? v.name : verticalName(v.id, v.name))}
        <span class="${active ? "text-slate-300" : "text-slate-500"}">${count}</span>
      </button>`;
  }).join("");
  lucide.createIcons();
}

function filterVertical(catId) {
  currentFilter = catId;
  renderFilterPills();
  renderEnvironments();
}

// Customer logo in the card's corner; white chip so dark logos stay visible on the dark card
function envLogo(env) {
  const b = env.branding;
  if (!b || !b.has_logo) return "";
  return `<span class="inline-flex items-center justify-center bg-white rounded-md px-1.5 py-1 shadow-sm">
    <img src="/api/environments/${encodeURIComponent(env.id)}/logo?v=${b.logo_rev}" alt="${escapeHtml(t("app.branding.logoAlt", { name: env.name }))}"
      class="h-7 w-auto max-w-[96px] object-contain"></span>`;
}

function statusBadge(env, busy) {
  if (busy) {
    return `<span class="inline-flex items-center gap-1.5 text-xs font-medium text-amber-300 whitespace-nowrap">
      <i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i>${busy.kind === "stop" ? t("app.status.stopping") : t("app.status.activating")}</span>`;
  }
  if (env.status === "running") {
    return `<span class="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300 whitespace-nowrap">
      <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>${t("app.status.running")}</span>`;
  }
  if (env.status === "partial") {
    return `<span class="inline-flex items-center gap-1.5 text-xs font-medium text-amber-300 whitespace-nowrap" title="${t("app.status.partialHint")}">
      <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>${t("app.status.partial")}</span>`;
  }
  return `<span class="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 whitespace-nowrap">
    <span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span>${t("app.status.stopped")}</span>`;
}

function progressBlock(envId, busy) {
  if (busy.kind === "stop") {
    return `<div id="progress-${envId}" class="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">${t("app.progress.stopping")}</div>`;
  }
  const total = busy.total || 1;
  const pct = Math.round(((busy.step || 0) / total) * 100);
  return `
    <div id="progress-${envId}" class="rounded-md border border-slate-800 bg-slate-950/60 p-3" role="status" aria-live="polite">
      <div class="flex items-center justify-between gap-2 text-xs text-slate-300">
        <span data-role="label">${escapeHtml(busy.label || t("app.progress.preparing"))}</span>
        <span data-role="step" class="font-mono text-slate-500 whitespace-nowrap">${busy.step || 0}/${total}</span>
      </div>
      <div class="mt-2 h-1 rounded-full bg-slate-800 overflow-hidden">
        <div data-role="bar" class="h-full bg-brand-600 transition-all duration-500" style="width:${pct}%"></div>
      </div>
      <p class="mt-2 text-[11px] text-slate-500">${t("app.progress.firstRunHint")}</p>
    </div>`;
}

function updateProgressUI(envId) {
  const busy = busyEnvs.get(envId);
  const box = document.getElementById(`progress-${envId}`);
  if (!busy || !box || busy.kind !== "activate") return;
  const total = busy.total || 1;
  box.querySelector('[data-role="label"]').textContent = busy.label || "";
  box.querySelector('[data-role="step"]').textContent = `${busy.step || 0}/${total}`;
  box.querySelector('[data-role="bar"]').style.width = `${Math.round(((busy.step || 0) / total) * 100)}%`;
}

function iconButton(icon, label, onclick, { danger = false, disabled = false } = {}) {
  return `
    <button type="button" onclick="${onclick}" title="${label}" aria-label="${label}" ${disabled ? "disabled" : ""}
      class="p-1.5 rounded-md text-slate-400 transition disabled:opacity-30 disabled:pointer-events-none ${danger ? "hover:text-rose-300 hover:bg-rose-500/10" : "hover:text-slate-100 hover:bg-slate-800"}">
      <i data-lucide="${icon}" class="w-4 h-4"></i>
    </button>`;
}

// Product descriptions shown as hints in the services view; the text lives in app.hints.<key>.p1/p2
const PRODUCT_HINTS = {
  scaler: { name: "Scaler", key: "scaler" },
  interactive: { name: "Interactive", key: "interactive" },
  "production-server": { name: "Production Server", key: "productionServer" },
  icm: { name: "Content Manager (ICM)", key: "icm" },
  "digital-services": { name: "Digital Services", key: "digitalServices" }
};

// Info button that opens the product's description in the floating hint
function productHint(key, tone = "dark") {
  const hint = PRODUCT_HINTS[key];
  if (!hint) return "";
  const toneClass = tone === "dark" ? "text-slate-900/70 hover:text-slate-950" : "text-slate-400 hover:text-white";
  return `<button type="button" class="product-hint-trigger inline-flex items-center justify-center rounded-full ${toneClass} transition flex-shrink-0" data-product-hint="${key}" aria-label="${escapeHtml(t("app.hints.whatIs", { name: hint.name }))}">
    <i data-lucide="info" class="w-4 h-4"></i>
  </button>`;
}

// One floating tooltip for every hint, positioned against the viewport so group overflow never clips it
function initProductHints() {
  const tip = document.createElement("div");
  tip.id = "product-hint-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.appendChild(tip);
  let current = null;

  const show = trigger => {
    const hint = PRODUCT_HINTS[trigger.dataset.productHint];
    if (!hint) return;
    current = trigger;
    tip.innerHTML = `<p class="product-hint-title">${escapeHtml(hint.name)}</p>${["p1", "p2"].map(p => `<p>${escapeHtml(t(`app.hints.${hint.key}.${p}`))}</p>`).join("")}`;
    tip.hidden = false;
    trigger.setAttribute("aria-describedby", tip.id);
    const r = trigger.getBoundingClientRect();
    const margin = 12;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.min(Math.max(margin, r.left + r.width / 2 - w / 2), window.innerWidth - w - margin);
    const below = r.bottom + 8;
    const top = below + h > window.innerHeight - margin && r.top - h - 8 > margin ? r.top - h - 8 : below;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  const hide = () => {
    if (current) current.removeAttribute("aria-describedby");
    current = null;
    tip.hidden = true;
  };

  const triggerOf = e => e.target.closest?.("[data-product-hint]");
  document.addEventListener("mouseover", e => { const t = triggerOf(e); if (t && t !== current) show(t); });
  document.addEventListener("mouseout", e => { const t = triggerOf(e); if (t && !t.contains(e.relatedTarget)) hide(); });
  document.addEventListener("focusin", e => { const t = triggerOf(e); if (t) show(t); });
  document.addEventListener("focusout", e => { if (triggerOf(e)) hide(); });
  document.addEventListener("click", e => { const t = triggerOf(e); if (t) { e.preventDefault(); show(t); } else hide(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") hide(); });
  window.addEventListener("scroll", hide, true);
}

// Quadient product pictograms (manager/static/img/products), black for light banners, white for dark surfaces
function productIcon(product, color, sizeClass = "w-4 h-4") {
  return `<img src="/static/img/products/${product}-${color}.png" alt="" aria-hidden="true" class="${sizeClass} flex-shrink-0 object-contain">`;
}

function serviceLink(label, url, port, enabled, product) {
  const base = "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition";
  const icon = product ? productIcon(product, "white", `w-4 h-4${enabled ? "" : " opacity-40"}`) : `<i data-lucide="external-link" class="w-3.5 h-3.5"></i>`;
  if (!enabled) {
    return `<span class="${base} border-slate-800 text-slate-500" aria-disabled="true" title="${t("app.catalog.linkDisabled")}">
      <span class="inline-flex items-center gap-2 font-medium">${icon}${label}</span>
      <span class="font-mono text-xs">:${port}</span></span>`;
  }
  return `<a href="${url}" target="_blank" rel="noopener" class="${base} border-slate-700 text-slate-100 hover:bg-slate-800 hover:border-slate-600" title="${t("app.catalog.openInNewTab", { name: label })}">
    <span class="inline-flex items-center gap-2 font-medium">${icon}${label}</span>
    <span class="font-mono text-xs text-slate-400">:${port}</span></a>`;
}

function renderEnvironments() {
  const container = document.getElementById("environments-grid");
  container.innerHTML = "";

  if (allEnvironments.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-16 text-center bg-slate-900/40 rounded-xl border border-dashed border-slate-800">
        <i data-lucide="layout-grid" class="w-8 h-8 mx-auto mb-3 text-slate-500"></i>
        <h3 class="text-base font-semibold text-white mb-1">${t("app.catalog.emptyTitle")}</h3>
        <p class="text-sm text-slate-400 max-w-sm mx-auto mb-4">${t("app.catalog.emptyText")}</p>
        <button type="button" onclick="openNewEnvModal()" class="px-4 py-2 bg-[#C2410C] hover:bg-[#9A3412] text-white rounded-md text-sm font-medium inline-flex items-center gap-2 transition">
          <i data-lucide="plus" class="w-4 h-4"></i> ${t("app.catalog.createFirst")}
        </button>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  const filtered = allEnvironments.filter(e => {
    if (currentFilter === "all") return true;
    return (e.vertical_id || "other").toLowerCase() === currentFilter.toLowerCase();
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-16 text-center text-slate-400 bg-slate-900/30 rounded-xl border border-dashed border-slate-800">
        <i data-lucide="folder-search" class="w-8 h-8 mx-auto mb-2 text-slate-500"></i>
        <p class="text-sm">${t("app.catalog.emptyFilter")}</p>
        <button type="button" onclick="openNewEnvModal()" class="mt-3 text-sm text-brand-400 hover:underline">${t("app.catalog.createNew")}</button>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  const host = window.location.hostname || "localhost";

  filtered.forEach(env => {
    const busy = busyEnvs.get(env.id);
    const isRunning = env.status === "running" || env.status === "partial";
    const ports = env.ports || {};
    const portInter = ports.interactive || 30701;
    const portScaler = ports.scaler || 30600;
    const customStorage = env.storage_path && env.storage_path !== "docker_default";
    const storageLabel = customStorage ? env.storage_path : t("app.catalog.dockerVolumes");

    let primaryAction;
    if (busy) {
      primaryAction = `<button type="button" disabled class="px-3 py-1.5 rounded-md text-sm font-medium inline-flex items-center gap-1.5 bg-slate-800 text-slate-400 cursor-wait">
        <i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i>${busy.kind === "stop" ? t("app.status.stoppingEllipsis") : t("app.status.activatingEllipsis")}</button>`;
    } else if (isRunning) {
      primaryAction = `<button type="button" onclick="stopDemo('${env.id}')" class="px-3 py-1.5 rounded-md text-sm font-medium inline-flex items-center gap-1.5 border border-slate-700 text-slate-200 hover:bg-slate-800 transition">
        <i data-lucide="square" class="w-3.5 h-3.5"></i>${t("app.actions.stop")}</button>`;
    } else {
      primaryAction = `<button type="button" onclick="activateDemo('${env.id}', true)" class="px-3.5 py-1.5 rounded-md text-sm font-medium inline-flex items-center gap-1.5 bg-[#C2410C] hover:bg-[#9A3412] text-white transition">
        <i data-lucide="play" class="w-3.5 h-3.5"></i>${t("app.actions.activate")}</button>`;
    }

    const links = [];
    if (env.enable_interactive !== false) {
      links.push(serviceLink("Interactive", `http://${host}:${portInter}/interactive`, portInter, isRunning && !busy, "interactive"));
    }
    if (env.enable_scaler !== false) {
      links.push(serviceLink("Scaler", `http://${host}:${portScaler}/`, portScaler, isRunning && !busy, "scaler"));
    }

    const card = document.createElement("div");
    card.className = `bg-slate-900 border rounded-xl p-5 flex flex-col justify-between transition-colors hover:border-slate-700 ${busy ? "border-slate-800" : env.status === "running" ? "card-active" : env.status === "partial" ? "card-partial" : "border-slate-800"}`;

    card.innerHTML = `
      <div class="space-y-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
              <span class="inline-flex items-center gap-1 whitespace-nowrap">
                <i data-lucide="${verticalIcon(env.vertical_id)}" class="w-3.5 h-3.5"></i>${escapeHtml(verticalName(env.vertical_id, env.vertical))}
              </span>
              <span class="text-slate-600" aria-hidden="true">·</span>
              <span class="font-mono whitespace-nowrap">v${escapeHtml(env.version || "17.5")}</span>
              ${env.demo_mode ? `<span class="text-slate-600" aria-hidden="true">·</span><span class="whitespace-nowrap" title="${t("app.catalog.demoModeHint")}">Demo Mode</span>` : ""}
            </div>
            <h3 class="mt-1.5 text-base font-semibold text-white line-clamp-2 break-words" title="${escapeHtml(env.name)}">${escapeHtml(env.name)}</h3>
          </div>
          <div class="flex flex-col items-end gap-2 shrink-0">
            ${envLogo(env)}
            ${statusBadge(env, busy)}
          </div>
        </div>

        <p class="text-sm text-slate-400 line-clamp-2">${escapeHtml(env.description || t("app.catalog.noNotes"))}</p>

        ${busy ? progressBlock(env.id, busy) : ""}

        ${links.length ? `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${links.join("")}</div>` : ""}

        <button type="button" onclick="openVolumeLocationModal('${env.id}')" title="${escapeHtml(storageLabel)}" aria-label="${escapeHtml(t("app.catalog.volumesLocation", { path: storageLabel }))}"
          class="w-full inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition min-w-0">
          <i data-lucide="${customStorage ? "folder" : "database"}" class="w-3.5 h-3.5 shrink-0"></i>
          <span class="truncate ${customStorage ? "font-mono" : ""}">${escapeHtml(storageLabel)}</span>
          <i data-lucide="chevron-right" class="w-3 h-3 shrink-0 opacity-60"></i>
        </button>
      </div>

      <div class="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
        ${primaryAction}
        <div class="flex items-center gap-0.5">
          ${iconButton("settings-2", t("app.actions.configureServices"), `openEditEnvModal('${env.id}')`, { disabled: !!busy })}
          ${iconButton("server", t("app.actions.viewServices"), `viewEnvServices('${env.id}')`)}
          <span class="w-px h-4 bg-slate-800 mx-1" aria-hidden="true"></span>
          ${iconButton("trash-2", t("app.actions.deleteEnv"), `deleteEnvironment('${env.id}')`, { danger: true, disabled: !!busy })}
        </div>
      </div>
    `;

    container.appendChild(card);
  });

  lucide.createIcons();
}

// ------------------------------------------------------------------------------
// Demo Activation & Lifecycle
// ------------------------------------------------------------------------------
function envName(envId) {
  const env = allEnvironments.find(e => e.id === envId);
  return env ? env.name : envId;
}

async function fetchProgress(envId) {
  const res = await fetch(`/api/environments/${envId}/progress`);
  const data = await res.json();
  return data.progress;
}

async function activateDemo(envId, exclusive = true) {
  if (busyEnvs.has(envId)) return;  // guard against double clicks
  busyEnvs.set(envId, { kind: "activate", label: t("app.progress.preparing"), step: 0, total: 1 });
  renderEnvironments();

  const poller = setInterval(async () => {
    try {
      const progress = await fetchProgress(envId);
      if (progress && busyEnvs.has(envId)) {
        Object.assign(busyEnvs.get(envId), progress);
        updateProgressUI(envId);
      }
    } catch (_) { /* transient; next tick retries */ }
  }, PROGRESS_POLL_MS);

  try {
    const res = await fetch(`/api/environments/${envId}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exclusive: exclusive })
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
  } catch (err) {
    showAlert("error", t("app.lifecycle.activateError", { error: err.message }));
  } finally {
    clearInterval(poller);
    busyEnvs.delete(envId);
    lastEnvSnapshot = "";
    await loadEnvironments();
  }
}

function trackRemoteActivation(envId, progress) {
  busyEnvs.set(envId, { kind: "activate", ...progress });
  const poller = setInterval(async () => {
    try {
      const p = await fetchProgress(envId);
      if (!p) {
        clearInterval(poller);
        busyEnvs.delete(envId);
        lastEnvSnapshot = "";
        loadEnvironments();
      } else if (busyEnvs.has(envId)) {
        Object.assign(busyEnvs.get(envId), p);
        updateProgressUI(envId);
      }
    } catch (_) { /* transient; next tick retries */ }
  }, PROGRESS_POLL_MS);
}

async function stopDemo(envId) {
  if (busyEnvs.has(envId)) return;
  busyEnvs.set(envId, { kind: "stop" });
  renderEnvironments();
  try {
    const res = await fetch(`/api/environments/${envId}/stop`, {
      method: "POST"
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.success ? t("app.lifecycle.stopped", { name: envName(envId) }) : data.message);
  } catch (err) {
    showAlert("error", t("app.common.error", { error: err.message }));
  } finally {
    busyEnvs.delete(envId);
    lastEnvSnapshot = "";
    await loadEnvironments();
  }
}

async function deleteEnvironment(envId) {
  const name = envName(envId);
  const { action } = await openActionDialog({
    title: t("app.actions.deleteEnv"),
    message: `
      <p>${t("app.deleteEnv.intro", { name: `<strong class="text-white">${escapeHtml(name)}</strong>` })}</p>
      <p class="text-slate-400">${t("app.deleteEnv.keepHint")}</p>`,
    input: {
      label: t("app.deleteEnv.confirmLabel", { name: `<strong class="text-slate-200">${escapeHtml(name)}</strong>` }),
      match: name
    },
    actions: [
      { id: "keep", label: t("app.deleteEnv.keepData"), style: "dangerOutline" },
      { id: "all", label: t("app.deleteEnv.deleteAll"), style: "danger", gate: "match" }
    ]
  });
  if (!action) return;
  const removeVols = action === "all";

  showAlert("info", t("app.deleteEnv.deleting", { name }));
  try {
    const res = await fetch(`/api/environments/${envId}?remove_volumes=${removeVols}`, {
      method: "DELETE"
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
    await loadEnvironments();
    populateServicesSelect();
    renderServicesView();
  } catch (err) {
    showAlert("error", t("app.deleteEnv.error", { error: err.message }));
  }
}

async function deleteSelectedEnvironment() {
  const select = document.getElementById("service-env-select");
  if (!select || !select.value) {
    showAlert("error", t("app.common.noEnvSelected"));
    return;
  }
  deleteEnvironment(select.value);
}

// ------------------------------------------------------------------------------
// Create Environment Modal
// ------------------------------------------------------------------------------
function toggleScalerSharedFolder() {
  const chk = document.getElementById("new-env-enable-scaler");
  const group = document.getElementById("scaler-sharedfolder-group");
  if (!chk || !group) return;
  if (chk.checked) {
    group.classList.remove("hidden");
  } else {
    group.classList.add("hidden");
  }
}

function toggleNewEnvInteractiveGroup() {
  const chk = document.getElementById("new-env-enable-interactive");
  const demoGroup = document.getElementById("new-interactive-demo-group");
  const demoChk = document.getElementById("new-env-demo-mode");
  if (!chk || !demoGroup) return;
  if (chk.checked) {
    demoGroup.classList.remove("opacity-40", "pointer-events-none");
  } else {
    demoGroup.classList.add("opacity-40", "pointer-events-none");
    if (demoChk) demoChk.checked = false;
  }
}

function openNewEnvModal() {
  const modal = document.getElementById("new-env-modal");
  const storageInput = document.getElementById("new-env-storage-path");
  if (storageInput) storageInput.value = "";
  const shareInput = document.getElementById("new-env-scaler-sharedfolder");
  if (shareInput) shareInput.value = "";
  const jobsInput = document.getElementById("new-env-scaler-jobs-dir");
  if (jobsInput) jobsInput.value = "";
  const chkInteractive = document.getElementById("new-env-enable-interactive");
  if (chkInteractive) chkInteractive.checked = true;
  const chkScaler = document.getElementById("new-env-enable-scaler");
  if (chkScaler) chkScaler.checked = true;
  const chkKafka = document.getElementById("new-env-enable-kafka");
  if (chkKafka) chkKafka.checked = false;
  renderUseCaseCheckboxes("new", []);
  resetBrandingDraft("new", null);
  const chkFtp = document.getElementById("new-env-enable-ftp");
  if (chkFtp) chkFtp.checked = false;
  toggleScalerSharedFolder();
  toggleNewEnvInteractiveGroup();
  switchEnvTab("new", "general");
  modal.showModal();
  lucide.createIcons();
}

function handleVerticalChange() {
  const select = document.getElementById("new-env-vertical");
  const opt = select.options[select.selectedIndex];
  const nameInput = document.getElementById("new-env-name");
  if (!nameInput.value || nameInput.value.startsWith("Demo ")) {
    nameInput.value = `Demo ${verticalName(select.value, opt.getAttribute("data-name"))} - `;
  }
}

async function handleCreateEnvSubmit(e) {
  e.preventDefault();
  const select = document.getElementById("new-env-vertical");
  const vertId = select.value;
  const vertName = select.options[select.selectedIndex].getAttribute("data-name");
  const name = document.getElementById("new-env-name").value.trim();
  const desc = document.getElementById("new-env-desc").value.trim();
  const ver = document.getElementById("new-env-version").value.trim();
  const port = document.getElementById("new-env-port").value.trim();
  const storagePath = document.getElementById("new-env-storage-path")?.value.trim() || "";

  const demoModeEl = document.getElementById("new-env-demo-mode");
  const demoMode = demoModeEl ? demoModeEl.checked : false;

  const chkInteractive = document.getElementById("new-env-enable-interactive");
  const enableInteractive = chkInteractive ? chkInteractive.checked : true;
  const chkScaler = document.getElementById("new-env-enable-scaler");
  const enableScaler = chkScaler ? chkScaler.checked : true;
  const scalerSharedfolder = document.getElementById("new-env-scaler-sharedfolder")?.value.trim() || "";
  const scalerJobsDir = document.getElementById("new-env-scaler-jobs-dir")?.value.trim() || "";
  const chkKafka = document.getElementById("new-env-enable-kafka");
  const enableKafka = chkKafka ? chkKafka.checked : false;
  const chkFtp = document.getElementById("new-env-enable-ftp");
  const enableFtp = chkFtp ? chkFtp.checked : false;

  const payload = {
    name: name,
    vertical: vertName,
    vertical_id: vertId,
    description: desc,
    version: ver,
    demo_mode: demoMode,
    enable_interactive: enableInteractive,
    enable_scaler: enableScaler,
    scaler_sharedfolder: scalerSharedfolder,
    scaler_jobs_dir: scalerJobsDir,
    enable_kafka: enableKafka,
    use_cases: selectedUseCases("new"),
    enable_ftp: enableFtp,
    branding: brandingPayload("new")
  };
  if (port) {
    payload.interactive_port = parseInt(port);
  }
  if (storagePath) {
    payload.storage_path = storagePath;
  }

  try {
    const res = await fetch("/api/environments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      closeModal("new-env-modal");
      showAlert("success", t("app.newEnv.created"));
      await loadEnvironments();
    } else {
      showAlert("error", data.message);
    }
  } catch (err) {
    showAlert("error", t("app.common.error", { error: err.message }));
  }
}

// ------------------------------------------------------------------------------
// Environment modal tabs (General, Inspire, Integrations, Use cases, Look & feel)
// ------------------------------------------------------------------------------
// Settings sections: Inspire, Quadient Cloud, Firebase, Backup; the last one opened is remembered
const SETTINGS_TAB_KEY = "studio.settingsTab";

function savedSettingsTab() {
  try {
    const tab = localStorage.getItem(SETTINGS_TAB_KEY);
    if (tab && document.querySelector(`[data-settings-tab="${tab}"]`)) return tab;
  } catch (_) { /* storage unavailable: first tab */ }
  return "inspire";
}

function switchSettingsTab(tab, focus = false) {
  document.querySelectorAll("[data-settings-tab]").forEach(btn => {
    const active = btn.dataset.settingsTab === tab;
    btn.setAttribute("aria-selected", String(active));
    btn.tabIndex = active ? 0 : -1;
    if (active && focus) btn.focus();
  });
  document.querySelectorAll("[data-settings-panel]").forEach(panel => {
    panel.classList.toggle("hidden", panel.dataset.settingsPanel !== tab);
  });
  try { localStorage.setItem(SETTINGS_TAB_KEY, tab); } catch (_) { /* not remembered */ }
}

function handleSettingsTabKey(e) {
  const tabs = Array.from(e.currentTarget.querySelectorAll("[data-settings-tab]"));
  const current = tabs.findIndex(btn => btn.getAttribute("aria-selected") === "true");
  const next = { ArrowDown: current + 1, ArrowRight: current + 1, ArrowUp: current - 1, ArrowLeft: current - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  switchSettingsTab(tabs[(next + tabs.length) % tabs.length].dataset.settingsTab, true);
}

// A required settings field on a hidden section would block its form silently: show that section
document.addEventListener("invalid", (e) => {
  const panel = e.target.closest && e.target.closest("[data-settings-panel]");
  if (panel && panel.classList.contains("hidden")) switchSettingsTab(panel.dataset.settingsPanel);
}, true);

function switchEnvTab(prefix, tab, focus = false) {
  const modal = document.getElementById(`${prefix}-env-modal`);
  if (!modal) return;
  modal.querySelectorAll("[data-env-tab]").forEach(btn => {
    const active = btn.dataset.envTab === tab;
    btn.setAttribute("aria-selected", String(active));
    btn.tabIndex = active ? 0 : -1;
    if (active && focus) btn.focus();
  });
  modal.querySelectorAll("[data-env-tab-panel]").forEach(panel => {
    panel.classList.toggle("hidden", panel.dataset.envTabPanel !== tab);
  });
}

function handleEnvTabKey(prefix, e) {
  const tabs = Array.from(e.currentTarget.querySelectorAll("[data-env-tab]"));
  const current = tabs.findIndex(btn => btn.getAttribute("aria-selected") === "true");
  const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  switchEnvTab(prefix, tabs[(next + tabs.length) % tabs.length].dataset.envTab, true);
}

// A required field left empty on a hidden tab would block the submit silently: bring its tab forward
document.addEventListener("invalid", (e) => {
  const panel = e.target.closest && e.target.closest("[data-env-tab-panel]");
  const modal = panel && panel.closest("dialog");
  if (panel && modal && panel.classList.contains("hidden")) {
    switchEnvTab(modal.id.replace(/-env-modal$/, ""), panel.dataset.envTabPanel);
  }
}, true);

// ------------------------------------------------------------------------------
// Use case branding: logo + primary, secondary and tertiary colors per environment
// ------------------------------------------------------------------------------
const BRAND_COLOR_KEYS = ["primary", "secondary", "tertiary"];
const BRAND_DEFAULT_COLORS = { primary: "#2f5d8a", secondary: "#c2410c", tertiary: "#e8eef5" };
// The logo travels to the use-cases container as an environment variable (Linux caps each at 128 KiB)
const MAX_LOGO_DATA_URL = 120000;
const MAX_LOGO_SIDE = 512;

// prefix -> { logo: undefined (keep stored) | "" (remove) | data URL, preview, customColors, colors }
const brandingDraft = {};

function resetBrandingDraft(prefix, env) {
  const b = (env && env.branding) || {};
  brandingDraft[prefix] = {
    logo: undefined,
    preview: b.has_logo ? `/api/environments/${encodeURIComponent(env.id)}/logo?v=${b.logo_rev}` : "",
    customColors: Boolean(b.colors),
    colors: { ...BRAND_DEFAULT_COLORS, ...(b.colors || {}) }
  };
  renderBrandingFields(prefix);
}

function renderBrandingFields(prefix) {
  const box = document.getElementById(`${prefix}-env-branding`);
  const draft = brandingDraft[prefix];
  if (!box || !draft) return;
  const colorField = (key) => `
    <label class="flex items-center gap-2 bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-2 ${draft.customColors ? "" : "opacity-40 pointer-events-none"}">
      <input type="color" value="${draft.colors[key]}" oninput="handleBrandColor('${prefix}', '${key}', this.value)" ${draft.customColors ? "" : "disabled"}
        class="w-7 h-7 shrink-0 rounded border border-slate-700 bg-transparent cursor-pointer" aria-label="${escapeHtml(t(`app.branding.${key}`))}">
      <span class="min-w-0">
        <span class="block text-xs font-semibold text-white">${escapeHtml(t(`app.branding.${key}`))}</span>
        <span class="block text-[10px] text-slate-500 leading-snug">${escapeHtml(t(`app.branding.${key}Hint`))}</span>
        <span id="${prefix}-brand-${key}-hex" class="block text-[10px] font-mono text-slate-400 uppercase">${draft.colors[key]}</span>
      </span>
    </label>`;
  box.innerHTML = `
    <div class="space-y-3">
      <p class="text-[11px] text-slate-400 leading-snug">${escapeHtml(t("app.branding.hint"))}</p>
      <div class="flex items-center gap-3 bg-slate-900/80 border border-slate-800 rounded-xl p-3">
        <div class="w-24 h-12 shrink-0 rounded-md flex items-center justify-center ${draft.preview ? "bg-white" : "border border-dashed border-slate-700"}">
          ${draft.preview
            ? `<img src="${escapeHtml(draft.preview)}" alt="${escapeHtml(t("app.branding.logoPreview"))}" class="max-h-10 max-w-[88px] object-contain">`
            : `<i data-lucide="image" class="w-5 h-5 text-slate-600"></i>`}
        </div>
        <div class="min-w-0 space-y-1.5">
          <div class="flex flex-wrap gap-2">
            <label class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border border-slate-700 text-slate-100 hover:bg-slate-800 cursor-pointer transition">
              <i data-lucide="upload" class="w-3.5 h-3.5"></i>${escapeHtml(t(draft.preview ? "app.branding.replaceLogo" : "app.branding.uploadLogo"))}
              <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" class="sr-only" onchange="handleBrandLogoFile('${prefix}', this)">
            </label>
            ${draft.preview ? `<button type="button" onclick="removeBrandLogo('${prefix}')" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-slate-400 hover:text-red-300 hover:bg-slate-800 transition">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>${escapeHtml(t("app.branding.removeLogo"))}</button>` : ""}
          </div>
          <p class="text-[10px] text-slate-500 leading-snug">${escapeHtml(t("app.branding.logoHint"))}</p>
        </div>
      </div>
      <label class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
        <input type="checkbox" ${draft.customColors ? "checked" : ""} onchange="toggleBrandColors('${prefix}', this.checked)"
          class="w-4 h-4 rounded border-slate-700 text-brand-600 bg-slate-950 focus:ring-brand-500 cursor-pointer">
        ${escapeHtml(t("app.branding.customColors"))}
      </label>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">${BRAND_COLOR_KEYS.map(colorField).join("")}</div>
    </div>`;
  lucide.createIcons();
}

function toggleBrandColors(prefix, enabled) {
  brandingDraft[prefix].customColors = enabled;
  renderBrandingFields(prefix);
}

function handleBrandColor(prefix, key, value) {
  brandingDraft[prefix].colors[key] = value;
  const hex = document.getElementById(`${prefix}-brand-${key}-hex`);
  if (hex) hex.textContent = value;
}

function removeBrandLogo(prefix) {
  Object.assign(brandingDraft[prefix], { logo: "", preview: "" });
  renderBrandingFields(prefix);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}

// SVGs are kept as they are; bitmaps are scaled down (up to MAX_LOGO_SIDE) until they fit the size limit
async function normalizeLogo(file) {
  const dataUrl = await readFileAsDataUrl(file);
  if (file.type === "image/svg+xml") return dataUrl.length <= MAX_LOGO_DATA_URL ? dataUrl : null;
  const img = await loadImage(dataUrl);
  let scale = Math.min(1, MAX_LOGO_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  for (let i = 0; i < 6; i++, scale *= 0.75) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const [type, quality] of [["image/png"], ["image/webp", 0.9]]) {
      const out = canvas.toDataURL(type, quality);
      if (out.startsWith(`data:${type}`) && out.length <= MAX_LOGO_DATA_URL) return out;
    }
  }
  return null;
}

async function handleBrandLogoFile(prefix, input) {
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  if (!/^image\/(png|jpeg|svg\+xml|webp|gif)$/.test(file.type)) {
    showAlert("error", t("app.branding.invalidLogo"));
    return;
  }
  try {
    const logo = await normalizeLogo(file);
    if (!logo) {
      showAlert("error", t("app.branding.logoTooLarge"));
      return;
    }
    Object.assign(brandingDraft[prefix], { logo, preview: logo });
    renderBrandingFields(prefix);
  } catch (err) {
    showAlert("error", t("app.branding.invalidLogo"));
  }
}

// The logo key is left out when unchanged so the stored one is kept
function brandingPayload(prefix) {
  const draft = brandingDraft[prefix];
  if (!draft) return undefined;
  const payload = { colors: draft.customColors ? { ...draft.colors } : null };
  if (draft.logo !== undefined) payload.logo = draft.logo;
  return payload;
}

// ------------------------------------------------------------------------------
// Edit Environment Modal & Stack Reconfiguration
// ------------------------------------------------------------------------------
function toggleEditScalerGroup() {
  const chk = document.getElementById("edit-env-enable-scaler");
  const group = document.getElementById("edit-scaler-folders-group");
  if (!chk || !group) return;
  if (chk.checked) {
    group.classList.remove("hidden");
  } else {
    group.classList.add("hidden");
  }
}

function toggleEditInteractiveGroup() {
  const chk = document.getElementById("edit-env-enable-interactive");
  const demoGroup = document.getElementById("edit-interactive-demo-group");
  const demoChk = document.getElementById("edit-env-demo-mode");
  if (!chk || !demoGroup) return;
  if (chk.checked) {
    demoGroup.classList.remove("opacity-40", "pointer-events-none");
  } else {
    demoGroup.classList.add("opacity-40", "pointer-events-none");
    if (demoChk) demoChk.checked = false;
  }
}

function openEditEnvModal(envId) {
  const env = allEnvironments.find(e => e.id === envId);
  if (!env) {
    showAlert("error", t("app.common.envNotFound"));
    return;
  }
  document.getElementById("edit-env-id").value = env.id;
  document.getElementById("edit-env-name").value = env.name || "";
  document.getElementById("edit-env-desc").value = env.description || "";
  
  const chkInter = document.getElementById("edit-env-enable-interactive");
  if (chkInter) chkInter.checked = env.enable_interactive !== false;

  const chkScaler = document.getElementById("edit-env-enable-scaler");
  if (chkScaler) chkScaler.checked = env.enable_scaler !== false;

  const shareInput = document.getElementById("edit-env-scaler-sharedfolder");
  if (shareInput) shareInput.value = env.scaler_sharedfolder || "";

  const jobsInput = document.getElementById("edit-env-scaler-jobs-dir");
  if (jobsInput) jobsInput.value = env.scaler_jobs_dir || "";

  const chkKafka = document.getElementById("edit-env-enable-kafka");
  if (chkKafka) chkKafka.checked = Boolean(env.enable_kafka);
  renderConfigBackups(env);

  renderUseCaseCheckboxes("edit", env.use_cases || []);
  resetBrandingDraft("edit", env);

  const chkFtp = document.getElementById("edit-env-enable-ftp");
  if (chkFtp) chkFtp.checked = Boolean(env.enable_ftp);

  const chkDemo = document.getElementById("edit-env-demo-mode");
  if (chkDemo) chkDemo.checked = Boolean(env.demo_mode);

  toggleEditScalerGroup();
  toggleEditInteractiveGroup();
  switchEnvTab("edit", "general");
  document.getElementById("edit-env-modal").showModal();
  lucide.createIcons();
}

// Export / import of Scaler's administration settings and of the ICM environment variables (both through Scaler)
function renderConfigBackups(env) {
  const box = document.getElementById("edit-config-backups");
  if (!box) return;
  if (!env || env.enable_scaler === false) {
    box.innerHTML = "";
    return;
  }
  const running = env.status === "running" || env.status === "partial";
  const id = escapeHtml(env.id);
  const actions = (exportFn, importFn) => `
    <div class="flex items-center gap-2 shrink-0">
      <button type="button" onclick="${exportFn}('${id}')" ${running ? "" : "disabled"}
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-slate-700 text-slate-100 hover:bg-slate-800 hover:border-slate-600 transition disabled:opacity-40 disabled:pointer-events-none">
        <i data-lucide="download" class="w-3.5 h-3.5"></i>${t("app.scalerConfig.export")}
      </button>
      <label class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border border-slate-700 text-slate-100 transition ${running ? "hover:bg-slate-800 hover:border-slate-600 cursor-pointer" : "opacity-40 pointer-events-none"}">
        <i data-lucide="upload" class="w-3.5 h-3.5"></i>${t("app.scalerConfig.import")}
        <input type="file" accept=".json,application/json" class="sr-only" ${running ? "" : "disabled"} onchange="${importFn}('${id}', this)">
      </label>
    </div>`;
  const row = (icon, title, hint, buttons) => `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-3 py-3">
      <div class="min-w-0 space-y-0.5">
        <span class="flex items-center gap-1.5 text-xs font-semibold text-white">${icon}${escapeHtml(title)}</span>
        <span class="block text-[11px] text-slate-400 leading-snug">${escapeHtml(hint)}</span>
      </div>
      ${buttons}
    </div>`;
  box.innerHTML = `
    <div class="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden">
      <div class="flex items-center gap-1.5 px-3 pt-3 text-xs font-bold text-slate-300 uppercase tracking-wider">
        <i data-lucide="file-json" class="w-3.5 h-3.5 text-slate-400"></i>${t("app.configBackups.title")}
      </div>
      ${running ? "" : `<p class="px-3 pt-1 text-[11px] text-amber-300">${t("app.scalerConfig.notRunning")}</p>`}
      <div class="divide-y divide-slate-800">
        ${row(productIcon("scaler", "white", "w-3.5 h-3.5"), t("app.scalerConfig.title"), t("app.scalerConfig.exportHint"), actions("exportScalerConfig", "importScalerConfig"))}
        ${row(productIcon("content-manager", "white", "w-3.5 h-3.5"), t("app.icmVariables.title"), t("app.icmVariables.hint"), actions("exportIcmVariables", "importIcmVariables"))}
      </div>
    </div>`;
  lucide.createIcons();
}

async function handleEditEnvSubmit(e) {
  e.preventDefault();
  const envId = document.getElementById("edit-env-id").value;
  const name = document.getElementById("edit-env-name").value.trim();
  const desc = document.getElementById("edit-env-desc").value.trim();
  const enableInteractive = document.getElementById("edit-env-enable-interactive")?.checked ?? true;
  const enableScaler = document.getElementById("edit-env-enable-scaler")?.checked ?? true;
  const scalerSharedfolder = document.getElementById("edit-env-scaler-sharedfolder")?.value.trim() || "";
  const scalerJobsDir = document.getElementById("edit-env-scaler-jobs-dir")?.value.trim() || "";
  const enableKafka = document.getElementById("edit-env-enable-kafka")?.checked ?? false;
  const enableFtp = document.getElementById("edit-env-enable-ftp")?.checked ?? false;
  const demoMode = document.getElementById("edit-env-demo-mode")?.checked ?? false;

  const payload = {
    name,
    description: desc,
    enable_interactive: enableInteractive,
    enable_scaler: enableScaler,
    scaler_sharedfolder: scalerSharedfolder,
    scaler_jobs_dir: scalerJobsDir,
    enable_kafka: enableKafka,
    use_cases: selectedUseCases("edit"),
    enable_ftp: enableFtp,
    demo_mode: demoMode,
    branding: brandingPayload("edit")
  };

  // Close the modal window immediately upon clicking save
  closeModal("edit-env-modal");

  showAlert("info", t("app.editEnv.updating", { name }));
  try {
    const res = await fetch(`/api/environments/${envId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showAlert("success", data.message || t("app.editEnv.updated"));
      await loadEnvironments();
      renderServicesView();
    } else {
      showAlert("error", data.message);
    }
  } catch (err) {
    showAlert("error", t("app.common.error", { error: err.message }));
  }
}

function editSelectedEnvironment() {
  const select = document.getElementById("service-env-select");
  if (!select || !select.value) {
    showAlert("error", t("app.common.noEnvSelected"));
    return;
  }
  openEditEnvModal(select.value);
}

// ------------------------------------------------------------------------------
// Services View
// ------------------------------------------------------------------------------
function populateServicesSelect() {
  const select = document.getElementById("service-env-select");
  if (!select) return;
  const currVal = select.value;
  select.innerHTML = "";
  allEnvironments.forEach(e => {
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.innerText = `${e.name} (${statusLabel(e.status).toUpperCase()})`;
    select.appendChild(opt);
  });
  if (currVal && allEnvironments.some(e => e.id === currVal)) {
    select.value = currVal;
  }
}

function viewEnvServices(envId) {
  switchTab("services");
  const select = document.getElementById("service-env-select");
  if (select) {
    select.value = envId;
    renderServicesView();
  }
}

function extractHostPort(portsStr, containerPort) {
  if (!portsStr) return null;
  const match = portsStr.match(new RegExp(`:(\\d+)->${containerPort}/`));
  return match ? parseInt(match[1], 10) : null;
}

function getServicePortInfo(c, env) {
  const s = (c.service || c.name || "").toLowerCase();
  const host = window.location.hostname || "localhost";
  const ports = env && env.ports ? env.ports : {};

  let portText = "";
  let accessUrl = null;
  let urlLabel = "";
  let address = "";   // host:port other machines connect to (ICM and FTP clients)

  if (s.includes("interactive") && !s.includes("ips") && !s.includes("prepare")) {
    const port = extractHostPort(c.ports, 30701) || ports.interactive || 30701;
    portText = `${port}`;
    accessUrl = `http://${host}:${port}/interactive`;
    urlLabel = t("app.services.openInteractive");
  } else if (s.includes("scaler") && !s.includes("ips") && !s.includes("prepare")) {
    const port = extractHostPort(c.ports, 30600) || ports.scaler || 30600;
    portText = `${port}`;
    accessUrl = `http://${host}:${port}/`;
    urlLabel = t("app.services.openScaler");
  } else if (s.includes("icm")) {
    const port = extractHostPort(c.ports, 30353) || ports.icm || 30353;
    portText = `${port} (Inspire ICM)`;
    address = `${hostAddress()}:${port}`;
  } else if (s.includes("postgres")) {
    const port = extractHostPort(c.ports, 5432) || ports.postgres || 5432;
    portText = `${port} (PostgreSQL)`;
  } else if (s === "ips" || (s.endsWith("-ips") && !s.includes("interactive"))) {
    const port = extractHostPort(c.ports, 30354) || ports.scaler_ips || 30354;
    portText = `${port} (IPS Scaler)`;
  } else if (s.includes("interactive-ips")) {
    portText = `30354 (IPS Interactive)`;
  } else if (s.includes("prepare")) {
    portText = t("app.services.prepOneShot");
  } else if (s.includes("use-cases")) {
    const port = extractHostPort(c.ports, 3000) || ports.use_cases || 3000;
    portText = `${port}`;
    accessUrl = `http://${host}:${port}/?lang=${currentLang}`;
    urlLabel = t("app.services.openUseCasesPortal");
  } else if (s.includes("kafka")) {
    const port = extractHostPort(c.ports, 29092) || extractHostPort(c.ports, 9092) || ports.kafka || 9092;
    portText = `${port} (KRaft Broker)`;
  } else if (s.includes("ftp")) {
    const port = extractHostPort(c.ports, 21) || ports.ftp || 2121;
    portText = `${port} (system:Password12345*)`;
    address = `${hostAddress()}:${port}`;
  } else {
    const genericMatch = c.ports ? c.ports.match(/:(\d+)->/) : null;
    portText = genericMatch ? genericMatch[1] : (c.ports || "N/A");
  }

  return { portText, accessUrl, urlLabel, address };
}

function renderNodeBox({ title, container, defaultPort, internalPort, type, env, compact = false, hint = null }) {
  const isUp = container && container.state === "running";
  const isHealthy = container && container.status && container.status.includes("healthy");
  const host = window.location.hostname || "localhost";
  const portInfo = container ? getServicePortInfo(container, env) : {
    portText: `${defaultPort}${internalPort ? ` -> ${internalPort}` : ''}`,
    accessUrl: type === "interactive" ? `http://${host}:${defaultPort}/interactive` : (type === "scaler" ? `http://${host}:${defaultPort}/` : (type === "use-cases" ? `http://${host}:${defaultPort}/?lang=${currentLang}` : null)),
    address: type === "icm" || type === "ftp" ? `${hostAddress()}:${defaultPort}` : "",
    urlLabel: type === "interactive" ? t("app.services.openInteractive") : (type === "scaler" ? t("app.services.openScaler") : (type === "use-cases" ? t("app.services.openUseCasesPortal") : ""))
  };

  return `
    <div class="node-box rounded-xl p-4 flex flex-col justify-between space-y-3 shadow-md">
      <div class="space-y-2">
        <!-- Node Title & State -->
        <div class="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-full flex-shrink-0 ${isUp ? 'bg-emerald-400' : 'bg-slate-500'}"></span>
            <h4 class="text-xs font-mono font-bold text-white tracking-wide truncate" title="${escapeHtml(title)}">
              ${escapeHtml(title)}
            </h4>
            ${hint ? productHint(hint, "light") : ""}
          </div>
          <div>
            ${isHealthy ? `
              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 flex items-center gap-1">
                <i data-lucide="check" class="w-3 h-3"></i> healthy
              </span>
            ` : isUp ? `
              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                running
              </span>
            ` : container ? `
              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                ${escapeHtml(container.state || 'stopped')}
              </span>
            ` : `
              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-500 border border-slate-800">
                ${t("app.services.stoppedChip")}
              </span>
            `}
          </div>
        </div>

        <!-- Container name & Port Info -->
        <div class="grid grid-cols-1 ${compact ? "" : "sm:grid-cols-2"} gap-2 text-[11px] pt-1">
          <div class="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 flex items-center justify-between">
            <span class="text-slate-400 font-medium">${t("app.services.port")}</span>
            <span class="font-mono font-semibold ${isUp ? 'text-brand-300' : 'text-slate-400'}">
              ${escapeHtml(portInfo.portText)}
            </span>
          </div>
          <div class="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 flex items-center justify-between truncate" title="${escapeHtml(container ? container.name : t("app.services.notStarted"))}">
            <span class="text-slate-400 font-medium mr-1 flex-shrink-0">ID:</span>
            <span class="font-mono text-[10px] text-slate-300 truncate">
              ${escapeHtml(container ? container.name : '--')}
            </span>
          </div>
          ${portInfo.address ? `
            <div class="${compact ? "" : "sm:col-span-2"} bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 flex items-center justify-between gap-2" title="${escapeHtml(t("app.host.connectHint"))}">
              <span class="text-slate-400 font-medium flex-shrink-0">${t("app.host.connectFrom")}</span>
              <span class="flex items-center gap-1.5 min-w-0">
                <span class="font-mono font-semibold text-sky-300 truncate select-all">${escapeHtml(portInfo.address)}</span>
                <button type="button" onclick="copyText('${escapeHtml(portInfo.address)}')" class="p-0.5 rounded text-slate-400 hover:text-white flex-shrink-0" title="${escapeHtml(t("app.host.copy"))}" aria-label="${escapeHtml(t("app.host.copy"))}">
                  <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                </button>
              </span>
            </div>` : ""}
        </div>

        <!-- Sharedfolder Volume Info for Scaler -->
        ${type === "scaler" && (env.scaler_sharedfolder || (env.volume_locations && env.volume_locations.sharedfolder)) ? `
          <div class="text-[10px] font-mono bg-amber-500/10 border border-amber-500/30 text-amber-300 px-2 py-1 rounded-lg flex items-center justify-between shadow-inner">
            <span class="flex items-center gap-1 font-semibold text-amber-400"><i data-lucide="folder" class="w-3 h-3"></i> /sharedfolder:</span>
            <span class="truncate ml-1 text-slate-300" title="${escapeHtml(env.volume_locations?.sharedfolder || env.scaler_sharedfolder)}">${escapeHtml(env.volume_locations?.sharedfolder || env.scaler_sharedfolder)}</span>
          </div>
        ` : ''}

        <!-- Jobs Directory Volume Info for Scaler -->
        ${type === "scaler" && (env.scaler_jobs_dir || (env.volume_locations && env.volume_locations.jobsdir)) ? `
          <div class="text-[10px] font-mono bg-amber-500/10 border border-amber-500/30 text-amber-300 px-2 py-1 rounded-lg flex items-center justify-between shadow-inner">
            <span class="flex items-center gap-1 font-semibold text-amber-400"><i data-lucide="briefcase" class="w-3 h-3"></i> /opt/scalerSharedFolder:</span>
            <span class="truncate ml-1 text-slate-300" title="${escapeHtml(env.volume_locations?.jobsdir || env.scaler_jobs_dir)}">${escapeHtml(env.volume_locations?.jobsdir || env.scaler_jobs_dir)}</span>
          </div>
        ` : ''}

        <!-- Direct Web Access Button (Interactive / Scaler / Studio) -->
        ${portInfo.accessUrl ? `
          <div class="pt-1">
            <a href="${portInfo.accessUrl}" target="_blank" rel="noopener noreferrer" 
               class="inline-flex items-center justify-between w-full px-3 py-2 rounded-lg text-xs font-semibold ${isUp ? (type === 'studio' ? 'bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 hover:text-white border border-indigo-500/40 shadow-sm' : 'bg-[#C2410C]/20 text-[#E07A50] hover:bg-[#C2410C]/30 hover:text-white border border-[#D9541F]/40 shadow-sm') : 'bg-slate-800/40 text-slate-500 border border-slate-800 pointer-events-none'} transition group"
               title="${escapeHtml(portInfo.urlLabel)}">
              <span class="flex items-center gap-2 truncate">
                <i data-lucide="external-link" class="w-3.5 h-3.5 ${type === 'studio' ? 'text-indigo-400' : 'text-brand-400'} group-hover:scale-110 transition-transform flex-shrink-0"></i>
                <span class="font-mono text-[11px] truncate text-slate-200 group-hover:text-white">${escapeHtml(portInfo.accessUrl)}</span>
              </span>
              <span class="text-[10px] uppercase font-bold text-white ${type === 'studio' ? 'bg-indigo-600' : 'bg-[#C2410C]'} px-2 py-0.5 rounded shadow-sm flex-shrink-0 ml-1.5">${t("app.common.open")}</span>
            </a>
          </div>
        ` : ''}
      </div>

      <!-- Action Buttons Footer -->
      <div class="flex items-center justify-between pt-2 border-t border-slate-800/80 mt-1">
        ${container ? `
          <button onclick="openLogs('${escapeHtml(container.name)}')" class="text-xs text-slate-300 hover:text-emerald-400 flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-slate-800 transition font-medium">
            <i data-lucide="terminal" class="w-3.5 h-3.5 text-emerald-400"></i> Logs
          </button>
          <div class="flex items-center gap-1">
            <button onclick="containerAction('${escapeHtml(container.name)}', 'restart')" class="p-1.5 hover:text-white text-slate-400 rounded-md hover:bg-slate-800 transition" title="${t("app.services.restart")}">
              <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
            </button>
            ${isUp ? `
              <button onclick="containerAction('${escapeHtml(container.name)}', 'stop')" class="p-1.5 hover:text-rose-400 text-slate-400 rounded-md hover:bg-slate-800 transition" title="${t("app.services.stop")}">
                <i data-lucide="square" class="w-3.5 h-3.5"></i>
              </button>
            ` : `
              <button onclick="containerAction('${escapeHtml(container.name)}', 'start')" class="p-1.5 hover:text-emerald-400 text-slate-400 rounded-md hover:bg-slate-800 transition" title="${t("app.services.start")}">
                <i data-lucide="play" class="w-3.5 h-3.5"></i>
              </button>
            `}
          </div>
        ` : `
          <span class="text-[11px] text-slate-500 italic">${t("app.services.containerNotStarted")}</span>
          <button onclick="startSelectedEnvironment()" class="text-xs text-emerald-400 hover:underline flex items-center gap-1">
            <i data-lucide="play" class="w-3 h-3"></i> ${t("app.common.start")}
          </button>
        `}
      </div>
    </div>
  `;
}

function renderServicesView() {
  const container = document.getElementById("services-grid");
  container.innerHTML = "";

  if (allEnvironments.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 text-center text-slate-500 bg-slate-900/30 rounded-2xl border border-dashed border-slate-800">
        <p class="text-sm">${t("app.services.noEnvs")}</p>
        <button onclick="switchTab('catalog'); openNewEnvModal();" class="mt-2 text-xs text-brand-400 hover:underline">+ ${t("app.catalog.createFirst")}</button>
      </div>
    `;
    return;
  }

  const select = document.getElementById("service-env-select");
  const envId = select ? select.value : (allEnvironments[0] ? allEnvironments[0].id : null);
  const env = allEnvironments.find(e => e.id === envId);

  if (!env) {
    container.innerHTML = `
      <div class="py-12 text-center text-slate-500 bg-slate-900/30 rounded-2xl border border-dashed border-slate-800">
        <p class="text-sm">${t("app.services.noEnvSelected")}</p>
      </div>
    `;
    return;
  }

  const rawContainers = env.containers || [];

  // Match core architecture containers
  const interactive = rawContainers.find(c => {
    const s = (c.service || c.name || "").toLowerCase();
    return s.includes("interactive") && !s.includes("ips") && !s.includes("prepare");
  });

  const interactiveIps = rawContainers.find(c => {
    const s = (c.service || c.name || "").toLowerCase();
    return s.includes("interactive-ips") || (s.includes("interactive") && s.includes("ips"));
  });

  const scaler = rawContainers.find(c => {
    const s = (c.service || c.name || "").toLowerCase();
    return s.includes("scaler") && !s.includes("ips") && !s.includes("prepare");
  });

  const scalerIps = rawContainers.find(c => {
    const s = (c.service || c.name || "").toLowerCase();
    return (s === "ips" || s.endsWith("-ips")) && !s.includes("interactive");
  });

  const icm = rawContainers.find(c => {
    const s = (c.service || c.name || "").toLowerCase();
    return s.includes("icm");
  });

  const postgres = rawContainers.find(c => {
    const s = (c.service || c.name || "").toLowerCase();
    return s.includes("postgres");
  });

  const kafka = rawContainers.find(c => {
    const s = (c.service || c.name || "").toLowerCase();
    return s === "kafka" || s.endsWith("-kafka");
  });

  const useCasesContainer = rawContainers.find(c => {
    const s = (c.service || c.name || "").toLowerCase();
    return s.includes("use-cases");
  });

  const ftp = rawContainers.find(c => {
    const s = (c.service || c.name || "").toLowerCase();
    return s.includes("ftp");
  });

  // State of scaler and interactive
  const isScalerRunning = scaler && scaler.state === "running";
  const isInteractiveRunning = interactive && interactive.state === "running";

  // Check prepare containers
  const scalerPrep = rawContainers.find(c => (c.service || c.name || "").toLowerCase().includes("scaler-prepare"));
  const interPrep = rawContainers.find(c => (c.service || c.name || "").toLowerCase().includes("interactive-prepare"));

  // Check extra unmapped containers
  const coreIds = [interactive, interactiveIps, scaler, scalerIps, icm, postgres, scalerPrep, interPrep, kafka, useCasesContainer, ftp]
    .filter(Boolean)
    .map(c => c.name);
  const extraContainers = rawContainers.filter(c => !coreIds.includes(c.name));

  const isRunning = env.status === "running" || env.status === "partial";

  const hasInteractive = env.enable_interactive !== false;
  const hasScaler = env.enable_scaler !== false;
  const hasKafka = Boolean(env.enable_kafka || kafka);
  const envUseCases = (env.use_cases || []).map(id => useCaseCatalog.find(c => c.id === id) || { id, name: id });
  const hasUseCases = Boolean(envUseCases.length || useCasesContainer);
  const hasFtp = Boolean(env.enable_ftp || ftp);

  // Helper to render Interactive Group
  const renderInteractiveGroup = () => `
    <div data-node="interactive" class="group-box flex flex-col rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl">
      <!-- Header Banner (Mint Green as in groups.png) -->
      <div class="bg-[#8FB8A0] text-slate-950 font-black tracking-widest text-center py-2.5 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm flex items-center justify-center gap-2">
        ${productIcon("interactive", "black", "w-5 h-5")}
        <span>INTERACTIVE</span>
        ${productHint("interactive")}
      </div>

      <!-- Group Body: INTERACTIVE BASE SERVER & INTERACTIVE IPS -->
      <div class="p-4 sm:p-5 space-y-4 flex-1 flex flex-col justify-between bg-slate-900/60">
        <!-- INTERACTIVE BASE SERVER -->
        ${renderNodeBox({
          title: "INTERACTIVE BASE SERVER",
          container: interactive,
          defaultPort: env.ports?.interactive || 30701,
          internalPort: 30701,
          type: "interactive",
          env: env
        })}

        <!-- Interior link indicator -->
        <div class="flex items-center justify-center text-slate-600 py-0.5">
          <i data-lucide="chevrons-down" class="w-4 h-4 opacity-50"></i>
        </div>

        <!-- INTERACTIVE IPS -->
        ${renderNodeBox({
          title: "INTERACTIVE IPS",
          container: interactiveIps,
          defaultPort: 30354,
          internalPort: 30354,
          type: "interactive-ips",
          env: env,
          hint: "production-server"
        })}
      </div>
    </div>
  `;

  // Helper to render Scaler Group
  const renderScalerGroup = () => `
    <div data-node="scaler" class="group-box hub-box flex flex-col rounded-2xl border-2 border-[#C99A62] overflow-hidden bg-slate-900/90" data-flow-target>
      <!-- Header Banner: Scaler is the communications hub every integration feeds -->
      <div class="bg-[#C99A62] text-slate-950 font-black tracking-widest text-center py-2.5 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm flex items-center justify-center gap-2 flex-wrap">
        ${productIcon("scaler", "black", "w-5 h-5")}
        <span>${t("app.services.scalerHub")}</span>
        ${productHint("scaler")}
        ${(env.scaler_sharedfolder || env.volume_locations?.sharedfolder) ? `
          <span class="text-[10px] font-mono font-bold bg-slate-950 text-amber-300 px-2 py-0.5 rounded-full border border-slate-800 lowercase tracking-normal flex items-center gap-1 shadow-inner" title="${escapeHtml(t("app.services.volumeTitle", { path: env.volume_locations?.sharedfolder || env.scaler_sharedfolder }))}">
            <i data-lucide="folder" class="w-3 h-3 text-amber-400"></i> sharedfolder
          </span>
        ` : ''}
        ${(env.scaler_jobs_dir || env.volume_locations?.jobsdir) ? `
          <span class="text-[10px] font-mono font-bold bg-slate-950 text-amber-300 px-2 py-0.5 rounded-full border border-slate-800 lowercase tracking-normal flex items-center gap-1 shadow-inner" title="Jobs Dir: ${escapeHtml(env.volume_locations?.jobsdir || env.scaler_jobs_dir)}">
            <i data-lucide="briefcase" class="w-3 h-3 text-amber-400"></i> jobsdir
          </span>
        ` : ''}
      </div>

      <!-- Control tower role -->
      <div class="flex items-start gap-2.5 px-4 sm:px-5 py-3 bg-[#C99A62]/10 border-b border-[#C99A62]/30 text-[11px] leading-relaxed text-amber-100/90">
        <i data-lucide="radar" class="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5"></i>
        <span><span class="font-bold text-amber-200 uppercase tracking-wider">${t("app.services.controlTowerTitle")}</span> ${t("app.services.controlTowerText")}</span>
      </div>

      <!-- Group Body: SCALER SERVER & SCALER IPS -->
      <div class="p-4 sm:p-5 space-y-4 flex-1 flex flex-col justify-between bg-slate-900/60">
        <!-- SCALER SERVER -->
        ${renderNodeBox({
          title: "SCALER SERVER",
          container: scaler,
          defaultPort: env.ports?.scaler || 30600,
          internalPort: 30600,
          type: "scaler",
          env: env
        })}

        <!-- Interior link indicator -->
        <div class="flex items-center justify-center text-slate-600 py-0.5">
          <i data-lucide="chevrons-down" class="w-4 h-4 opacity-50"></i>
        </div>

        <!-- SCALER IPS -->
        ${renderNodeBox({
          title: "SCALER IPS",
          container: scalerIps,
          defaultPort: env.ports?.scaler_ips || 30354,
          internalPort: 30354,
          type: "ips",
          env: env,
          hint: "production-server"
        })}
      </div>

    </div>
  `;

  // Build the complete Architecture Diagram View matching groups.png
  let html = `
    <div class="architecture-canvas rounded-2xl border-2 border-slate-800 p-4 sm:p-6 lg:p-8 space-y-6 shadow-2xl">

      <!-- Header: Architecture Breadcrumb & Group Color Legend -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800/80 gap-3">
        <div class="flex items-center gap-3">
          <div class="w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-emerald-400' : 'bg-slate-500'}"></div>
          <div>
            <h3 class="text-sm font-bold text-white tracking-wide uppercase">${t("app.services.topology")} <span class="text-brand-400 font-mono">${escapeHtml(env.name)}</span></h3>
            <p class="text-[11px] text-slate-400">${t("app.services.topologySubtitle")}</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-3 text-xs">
          ${hasInteractive ? `
            <span class="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
              <span class="w-3 h-3 rounded-sm bg-[#8FB8A0] inline-block border border-slate-700"></span>
              ${productIcon("interactive", "white", "w-3.5 h-3.5")}
              <span class="font-bold text-slate-200">INTERACTIVE</span>
            </span>
          ` : ''}
          ${hasScaler ? `
            <span class="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
              <span class="w-3 h-3 rounded-sm bg-[#C99A62] inline-block border border-slate-700"></span>
              ${productIcon("scaler", "white", "w-3.5 h-3.5")}
              <span class="font-bold text-slate-200">SCALER · HUB</span>
            </span>
          ` : ''}
          <span class="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
            <span class="w-3 h-3 rounded-sm bg-[#8b929d] inline-block border border-slate-700"></span>
            ${productIcon("content-manager", "white", "w-3.5 h-3.5")}
            ${productIcon("postgres", "white", "w-3.5 h-3.5")}
            <span class="font-bold text-slate-200">ICM / POSTGRES</span>
          </span>
          ${hasKafka ? `
            <span class="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
              <span class="w-3 h-3 rounded-sm bg-[#6E6CA3] inline-block border border-slate-700"></span>
              ${productIcon("kafka", "white", "w-3.5 h-3.5")}
              <span class="font-bold text-slate-200">KAFKA</span>
            </span>
          ` : ''}
          ${hasUseCases ? `
            <span class="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
              <span class="w-3 h-3 rounded-sm bg-[#A35F78] inline-block border border-slate-700"></span>
              ${productIcon("use-cases", "white", "w-3.5 h-3.5")}
              <span class="font-bold text-slate-200">${t("app.services.useCasesBanner")}</span>
            </span>
          ` : ''}
          ${hasFtp ? `
            <span class="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
              <span class="w-3 h-3 rounded-sm bg-[#3F7F76] inline-block border border-slate-700"></span>
              ${productIcon("ftp", "white", "w-3.5 h-3.5")}
              <span class="font-bold text-slate-200">FTP</span>
            </span>
          ` : ''}
        </div>
      </div>
      ${layoutToolbarHtml(env)}
  `;

  // Check prepare containers real execution status
  const isScalerPrepRunning = scalerPrep && scalerPrep.state === "running";
  const isInterPrepRunning = interPrep && interPrep.state === "running";
  const isPrepRunning = isScalerPrepRunning || isInterPrepRunning;

  const isScalerPrepFailed = scalerPrep && scalerPrep.state === "exited" && !(scalerPrep.status || "").includes("(0)");
  const isInterPrepFailed = interPrep && interPrep.state === "exited" && !(interPrep.status || "").includes("(0)");
  const isPrepFailed = isScalerPrepFailed || isInterPrepFailed;

  // Show initialization banner only while actively running
  if (isPrepRunning) {
    html += `
      <div class="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-200">
        <div class="flex items-center gap-3">
          <i data-lucide="loader-2" class="w-5 h-5 text-amber-400 animate-spin flex-shrink-0"></i>
          <div>
            <span class="font-bold text-white block">${t("app.services.prepRunningTitle")}</span>
            <span class="text-slate-400">${t("app.services.prepRunningText")}</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          ${isScalerPrepRunning ? `
            <button onclick="openLogs('${escapeHtml(scalerPrep.name)}')" class="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-200 rounded border border-slate-700 flex items-center gap-1 font-mono">
              <i data-lucide="terminal" class="w-3 h-3 text-amber-400"></i> scaler-prep logs
            </button>
          ` : ''}
          ${isInterPrepRunning ? `
            <button onclick="openLogs('${escapeHtml(interPrep.name)}')" class="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-200 rounded border border-slate-700 flex items-center gap-1 font-mono">
              <i data-lucide="terminal" class="w-3 h-3 text-cyan-400"></i> interactive-prep logs
            </button>
          ` : ''}
        </div>
      </div>
    `;
  } else if (isPrepFailed) {
    html += `
      <div class="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-200">
        <div class="flex items-center gap-3">
          <i data-lucide="alert-triangle" class="w-5 h-5 text-rose-400 flex-shrink-0"></i>
          <div>
            <span class="font-bold text-white block">${t("app.services.prepFailedTitle")}</span>
            <span class="text-slate-400">${t("app.services.prepFailedText")}</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          ${isScalerPrepFailed ? `
            <button onclick="openLogs('${escapeHtml(scalerPrep.name)}')" class="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-200 rounded border border-slate-700 flex items-center gap-1 font-mono">
              <i data-lucide="terminal" class="w-3 h-3 text-rose-400"></i> scaler-prep logs
            </button>
          ` : ''}
          ${isInterPrepFailed ? `
            <button onclick="openLogs('${escapeHtml(interPrep.name)}')" class="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-200 rounded border border-slate-700 flex items-center gap-1 font-mono">
              <i data-lucide="terminal" class="w-3 h-3 text-rose-400"></i> interactive-prep logs
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  // Tier frame: BACK-END, FRONT-END and customer systems are drawn as labelled layers
  const tierFrame = ({ zone, title, icon, subtitle, body, extraAttrs = "" }) => `
    <section data-zone="${zone}" class="tier-frame rounded-2xl border-2 border-slate-500/70 bg-slate-950/40 p-4 sm:p-5 space-y-4 h-full flex flex-col" ${extraAttrs}>
      <header class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-slate-300">
          <i data-lucide="${icon}" class="w-4 h-4 text-slate-400"></i>
          ${title}
        </div>
        ${subtitle ? `<span class="text-[11px] text-slate-500">${subtitle}</span>` : ""}
      </header>
      <div class="flex-1">${body}</div>
    </section>
  `;

  // Footer strip that says what a service exchanges with Scaler
  const scalerExchange = (text, arrow) => hasScaler ? `
    <div class="flex items-center gap-2 px-4 py-2.5 border-t-2 border-slate-700 bg-[#C99A62]/10 text-[11px] leading-snug text-amber-100/90">
      <i data-lucide="${arrow}" class="w-3.5 h-3.5 text-amber-300 flex-shrink-0"></i>
      ${productIcon("scaler", "white", "w-3.5 h-3.5")}
      <span>${text}</span>
    </div>
  ` : "";

  const serviceGroup = ({ key, color, icon, title, body, flow, arrow, bidir, protocol }) => `
    <div data-node="${key}" class="group-box flex flex-col h-full rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl" data-flow-source="${key}" ${bidir ? "data-flow-bidir" : ""} data-flow-protocol="${protocol}">
      <div class="bg-[${color}] text-white font-black tracking-widest text-center py-2.5 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm flex items-center justify-center gap-2">
        ${productIcon(icon, "white", "w-5 h-5")}
        <span>${title}</span>
      </div>
      <div class="p-4 sm:p-5 flex-1 flex flex-col justify-start bg-slate-900/60 space-y-4">
        ${body}
      </div>
      ${scalerExchange(flow, arrow)}
    </div>
  `;

  // Same column count for the use case tiles and the row below them, so Digital Services sits under its tile
  const useCaseCols = envUseCases.length >= 3 ? "md:grid-cols-3" : envUseCases.length === 2 ? "md:grid-cols-2" : "";
  // Digital Services sits under the first case that shows Quadient Cloud documents (inbox or online banking)
  const dasIndex = envUseCases.findIndex(c => c.id === "das-inbox" || c.id === "das-banking");
  const hasDigitalServices = dasIndex >= 0;
  const useCaseColCount = Math.min(envUseCases.length, 3) || 1;
  // The direct use cases → Scaler line leaves from the middle of the other tiles, clear of the Digital Services box
  const otherCols = Array.from({ length: useCaseColCount }, (_, i) => i).filter(i => i !== dasIndex);
  const useCasesFlowX = hasDigitalServices && otherCols.length
    ? otherCols.reduce((sum, i) => sum + (i + 0.5) / useCaseColCount, 0) / otherCols.length
    : 0.5;
  const useCasesDirectFlow = !hasDigitalServices || otherCols.length > 0;

  // ── TOP: USE CASES — the case names are the protagonists ──
  const useCasesUp = useCasesContainer && useCasesContainer.state === "running";
  const useCasesBaseUrl = `http://${window.location.hostname || "localhost"}:${env.ports?.use_cases || 3000}`;
  const useCasesSection = hasUseCases ? `
    <div data-node="use-cases" class="group-box flex flex-col rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl" ${useCasesDirectFlow ? `data-flow-source="use-cases" data-flow-bidir data-flow-x="${useCasesFlowX}"` : ""}>
      <div class="bg-[#A35F78] text-white font-black tracking-widest text-center py-2.5 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm flex items-center justify-center gap-2">
        ${productIcon("use-cases", "white", "w-5 h-5")}
        <span>${t("app.services.useCasesBanner")}</span>
      </div>

      <div class="p-4 sm:p-5 bg-slate-900/60 space-y-4">
        <div class="grid grid-cols-1 ${(env.use_cases || []).includes("push-inbox") ? "lg:grid-cols-2" : ""} gap-4 items-start">
          ${renderNodeBox({
            title: t("app.services.useCasesPortal"),
            container: useCasesContainer,
            defaultPort: env.ports?.use_cases || 3000,
            internalPort: 3000,
            type: "use-cases",
            env: env
          })}
          ${(env.use_cases || []).includes("push-inbox") ? `
            <div class="bg-slate-950/80 p-3.5 rounded-xl border border-rose-500/30 flex flex-col gap-2 text-xs">
              <span class="text-rose-300 font-semibold flex items-center gap-1.5">
                <i data-lucide="send" class="w-3.5 h-3.5"></i> ${t("app.services.inboxEndpoint")}
              </span>
              <div class="font-mono text-[11px] bg-slate-900 p-2 rounded-lg border border-slate-800 text-slate-300 break-all">
                POST http://use-cases:3000/push-inbox/api/inbox/send
              </div>
              <span class="text-[10px] text-slate-500">${t("app.services.inboxEndpointNote")}</span>
            </div>
          ` : ""}
        </div>

        <div data-tiles class="grid grid-cols-1 ${useCaseCols} gap-4">
          ${envUseCases.length ? envUseCases.map(c => `
            <a data-node="uc-${escapeHtml(c.id)}" href="${escapeHtml(`${useCasesBaseUrl}/${c.id}/?lang=${currentLang}`)}" target="_blank" rel="noopener noreferrer"
               class="use-case-tile group rounded-xl border-2 p-4 sm:p-5 flex items-start gap-4 transition ${useCasesUp ? "border-[#A35F78]/60 bg-slate-950/80 hover:border-[#A35F78] hover:bg-slate-950" : "border-slate-800 bg-slate-900/40 pointer-events-none opacity-60"}">
              <span class="text-3xl sm:text-4xl leading-none" aria-hidden="true">${escapeHtml(c.icon || "📄")}</span>
              <span class="min-w-0 flex-1 space-y-1.5">
                <span class="block text-lg sm:text-xl font-black text-white leading-tight">${escapeHtml(useCaseText(c, "name"))}</span>
                ${c.description ? `<span class="block text-xs text-slate-400 leading-relaxed">${escapeHtml(useCaseText(c, "description"))}</span>` : ""}
                <span class="flex items-center gap-2 pt-1 text-[11px] font-mono text-rose-300">
                  /${escapeHtml(c.id)}/
                  <i data-lucide="arrow-up-right" class="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"></i>
                </span>
              </span>
            </a>`).join("") : `
            <p class="text-xs text-slate-500">${t("app.services.noUseCasesSelected")}</p>`}
        </div>
      </div>

      ${scalerExchange(t("app.services.flowUseCases"), "arrow-down-up")}
    </div>
  ` : "";

  // ── CLOUD: Digital Services between the Digital Advantage Inbox tile and Scaler ──
  const dsCloudUrl = (lastDasStatus && lastDasStatus.cloud_url) || "";
  const dsUrl = dsCloudUrl ? `${dsCloudUrl}/digitalservices/` : "";
  const dsColStart = ["", "md:col-start-2", "md:col-start-3"][Math.min(dasIndex, 2)] || "";
  const digitalServicesSection = hasDigitalServices ? `
    <div class="grid grid-cols-1 ${useCaseCols} gap-4">
      <div class="${dsColStart} flex flex-col items-center">
        <div class="flex flex-col items-center py-2 text-sky-300" aria-hidden="true">
          <i data-lucide="arrow-up-down" class="w-4 h-4"></i>
          <span class="mt-1 text-[10px] font-mono px-2 py-0.5 rounded-full border border-sky-500/40 bg-slate-950">HTTPS · SDK</span>
        </div>
        <div data-node="digital-services" class="group-box w-full flex flex-col rounded-2xl border-2 border-sky-500/40 overflow-hidden bg-slate-900/90 shadow-xl"
          data-flow-source="digital-services" data-flow-bidir data-flow-protocol="HTTPS · long polling">
          <div class="bg-[#2F6E9E] text-white font-black tracking-widest text-center py-2.5 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm flex items-center justify-center gap-2">
            ${productIcon("digital-services", "white", "w-5 h-5")}
            <span>Digital Services</span>
            ${productHint("digital-services")}
          </div>
          <div class="p-4 bg-slate-900/60 space-y-3">
            <div class="flex items-center justify-center gap-1.5 text-[11px] text-sky-200">
              <i data-lucide="cloud" class="w-3.5 h-3.5"></i> ${t("app.services.dsCloud")}
            </div>
            ${dsUrl ? `
              <a href="${escapeHtml(dsUrl)}" target="_blank" rel="noopener noreferrer"
                 class="flex items-center justify-between gap-2 rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-100 hover:bg-slate-800 hover:border-slate-600 transition"
                 title="${escapeHtml(t("app.catalog.openInNewTab", { name: "Digital Services" }))}">
                <span class="min-w-0">
                  <span class="block font-semibold">${t("app.services.dsOpen")}</span>
                  <span class="block font-mono text-[10px] text-slate-400 truncate">${escapeHtml(dsUrl.replace(/^https?:\/\//, ""))}</span>
                </span>
                <i data-lucide="external-link" class="w-3.5 h-3.5 flex-shrink-0"></i>
              </a>` : `
              <p class="text-[11px] text-amber-300">${t("app.services.dsNotConfigured")}</p>`}
            <ul class="space-y-1.5 text-[11px] text-slate-300">
              <li class="flex items-start gap-2"><i data-lucide="shield-check" class="w-3.5 h-3.5 mt-0.5 text-sky-300 flex-shrink-0"></i>${t("app.services.dsTransfer")}</li>
              <li class="flex items-start gap-2"><i data-lucide="file-text" class="w-3.5 h-3.5 mt-0.5 text-sky-300 flex-shrink-0"></i>${t("app.services.dsContent")}</li>
              <li class="flex items-start gap-2"><i data-lucide="user-check" class="w-3.5 h-3.5 mt-0.5 text-sky-300 flex-shrink-0"></i>${t("app.services.dsAuth")}</li>
            </ul>
          </div>
          ${scalerExchange(t("app.services.flowDigitalServices"), "arrow-down-up")}
        </div>
      </div>
    </div>
  ` : "";

  // ── MIDDLE: BACK-END — Scaler hub + ICM + Postgres ──
  const renderIcmGroup = () => `
    <div data-node="icm" class="group-box rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl">
      <div class="bg-[#8b929d] text-slate-950 font-black tracking-widest text-center py-2 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm flex items-center justify-center gap-2">
        ${productIcon("content-manager", "black", "w-5 h-5")}
        <span>ICM</span>
        ${productHint("icm")}
      </div>
      <div class="p-4 sm:p-5 bg-slate-900/60">
        ${renderNodeBox({
          title: "ICM (Inspire Configuration Manager)",
          container: icm,
          defaultPort: env.ports?.icm || 30353,
          internalPort: 30353,
          type: "icm",
          env: env
        })}
      </div>
    </div>
  `;

  const renderPostgresGroup = () => `
    <div data-node="postgres" class="group-box rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl">
      <div class="bg-[#8b929d] text-slate-950 font-black tracking-widest text-center py-2 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm flex items-center justify-center gap-2">
        ${productIcon("postgres", "black", "w-5 h-5")}
        <span>POSTGRES DATABASE</span>
      </div>
      <div class="p-4 sm:p-5 bg-slate-900/60">
        ${renderNodeBox({
          title: "POSTGRES DATABASE",
          container: postgres,
          defaultPort: env.ports?.postgres || 5432,
          internalPort: 5432,
          type: "postgres",
          env: env
        })}
      </div>
    </div>
  `;

  const platformStack = `
    <div class="space-y-2">
      ${renderIcmGroup()}
      <div class="flex flex-col items-center justify-center py-1">
        <div class="flex items-center gap-2 text-[11px] font-mono text-slate-400 bg-slate-950/80 px-3 py-1 rounded-full border border-slate-800">
          <i data-lucide="arrow-up-down" class="w-3.5 h-3.5 text-cyan-400"></i>
          <span>${t("app.services.icmPostgresLink")}</span>
        </div>
      </div>
      ${renderPostgresGroup()}
    </div>
  `;

  const backendSection = tierFrame({
    zone: "backend",
    title: "Back-end",
    icon: "server",
    subtitle: hasScaler ? t("app.services.backendSubtitleScaler") : t("app.services.backendSubtitle"),
    body: hasScaler ? `
      <div class="grid grid-cols-1 lg:grid-cols-[1.35fr,72px,1fr] gap-4 lg:gap-0 items-start">
        ${renderScalerGroup()}
        <div class="hidden lg:flex flex-col items-center justify-start pt-40">
          <svg class="w-16 h-5 text-slate-400" viewBox="0 0 64 20" fill="none">
            <line x1="6" y1="10" x2="58" y2="10" stroke="currentColor" stroke-width="2" />
            <polygon points="6,10 13,6 13,14" fill="currentColor" />
            <polygon points="58,10 51,6 51,14" fill="currentColor" />
          </svg>
          <span class="text-[9px] font-mono text-slate-400 uppercase tracking-tighter text-center mt-1">${t("app.services.icmResources")}</span>
        </div>
        ${platformStack}
      </div>
    ` : `<div class="max-w-2xl mx-auto">${platformStack}</div>`
  });

  // ── BOTTOM: FRONT-END (Interactive) + customer systems (FTP, Kafka) ──
  const frontendSection = hasInteractive ? tierFrame({
    zone: "frontend",
    title: "Front-end",
    icon: "monitor",
    subtitle: t("app.services.frontendSubtitle"),
    body: `<div data-flow-source="interactive" data-flow-bidir data-flow-style="platform" data-flow-protocol="HTTP REST" class="h-full">${renderInteractiveGroup()}</div>`
  }) : "";

  const integrationGroups = [];
  if (hasFtp) {
    integrationGroups.push(serviceGroup({
      key: "ftp",
      color: "#3F7F76",
      icon: "ftp",
      title: "FTP SERVER (vsftpd)",
      bidir: true,
      arrow: "arrow-up-down",
      protocol: "FTP · TCP 21",
      flow: t("app.services.flowFtp"),
      body: `
        ${renderNodeBox({
          title: "FTP SERVER (vsftpd)",
          container: ftp,
          defaultPort: env.ports?.ftp || 2121,
          internalPort: 21,
          type: "ftp",
          env: env,
          compact: true
        })}

        <div class="bg-slate-950/80 p-3.5 rounded-xl border border-teal-500/30 flex flex-col gap-2 text-xs">
          <div class="flex items-center justify-between">
            <span class="text-teal-300 font-semibold flex items-center gap-1.5">
              <i data-lucide="key-round" class="w-3.5 h-3.5"></i> ${t("app.services.ftpAuth")}
            </span>
            <span class="text-[10px] font-mono text-slate-400">PASV: ${env.ports?.ftp_pasv_min || 21100}-${env.ports?.ftp_pasv_max || 21105}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2 font-mono text-[11px] bg-slate-900 p-2 rounded-lg border border-slate-800">
            <span class="text-slate-400">${t("app.services.user")}</span>
            <span class="text-white font-bold">system</span>
            <span class="text-slate-600">|</span>
            <span class="text-slate-400">${t("app.services.password")}</span>
            <span class="text-teal-400 font-bold">Password12345*</span>
          </div>
        </div>
      `
    }));
  }
  if (hasKafka) {
    integrationGroups.push(serviceGroup({
      key: "kafka",
      color: "#6E6CA3",
      icon: "kafka",
      title: "KAFKA STREAMING",
      bidir: false,
      arrow: "arrow-up",
      protocol: "Kafka · TCP 9092",
      flow: t("app.services.flowKafka"),
      body: `
        ${renderNodeBox({
          title: "KAFKA BROKER (KRaft)",
          container: kafka,
          defaultPort: env.ports?.kafka || 9092,
          internalPort: 9092,
          type: "kafka",
          env: env,
          compact: true
        })}

        <div class="bg-slate-950/80 p-3.5 rounded-xl border border-indigo-500/30 flex flex-col gap-2 text-xs">
          <span class="text-indigo-300 font-semibold flex items-center gap-1.5">
            <i data-lucide="plug" class="w-3.5 h-3.5"></i> Bootstrap servers
          </span>
          <div class="font-mono text-[11px] bg-slate-900 p-2 rounded-lg border border-slate-800 text-slate-300 break-all">
            kafka:9092 <span class="text-slate-500">${t("app.services.containers")}</span> · localhost:${escapeHtml(String(env.ports?.kafka || 9092))} <span class="text-slate-500">(host)</span>
          </div>
        </div>
      `
    }));
  }

  const integrationsSection = integrationGroups.length ? tierFrame({
    zone: "integrations",
    title: t("app.services.integrations"),
    icon: "network",
    subtitle: hasScaler ? "" : `<span class="text-amber-300">${t("app.services.enableScalerHint")}</span>`,
    body: `<div class="grid grid-cols-1 ${integrationGroups.length > 1 ? "md:grid-cols-2" : ""} gap-4 h-full">${integrationGroups.join("")}</div>`
  }) : "";

  // HUB FLOW: use cases (above) and front-end/integrations (below) all connect to Scaler; drawHubFlow() draws it
  html += `
      <div id="hub-flow" class="relative" data-running="${isRunning}">
        <svg id="hub-flow-svg" class="hidden lg:block absolute inset-0 w-full h-full pointer-events-none overflow-visible" aria-hidden="true"></svg>

        ${useCasesSection}
        ${digitalServicesSection}
        ${useCasesSection ? `
          <div class="h-10 lg:h-20 flex items-center justify-center">
            <i data-lucide="arrow-down-up" class="lg:hidden w-5 h-5 text-amber-300"></i>
          </div>
        ` : ""}

        ${backendSection}

        ${frontendSection || integrationsSection ? `
          <div class="h-10 lg:h-20 flex items-center justify-center">
            <i data-lucide="arrow-up-down" class="lg:hidden w-5 h-5 text-amber-300"></i>
          </div>
          <div class="grid grid-cols-1 ${frontendSection && integrationsSection ? "lg:grid-cols-[1fr,1.6fr]" : ""} gap-6 items-stretch">
            ${frontendSection}
            ${integrationsSection}
          </div>
        ` : ""}
      </div>
    </div>
  `;

  // If there are extra containers not part of the standard architecture
  if (extraContainers.length > 0) {
    html += `
      <div data-node="extra" class="pt-6 border-t border-slate-800 space-y-3">
        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
          <i data-lucide="layers" class="w-4 h-4 text-slate-500"></i>
          ${t("app.services.extra")}
        </h4>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          ${extraContainers.map(c => {
            const isUp = c.state === "running";
            const portInfo = getServicePortInfo(c, env);
            return `
              <div class="bg-slate-900/70 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:border-slate-700 transition">
                <div class="space-y-2">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-mono font-bold text-white truncate">${escapeHtml(c.service || c.name)}</span>
                    <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full ${isUp ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'}">
                      ${escapeHtml(c.state)}
                    </span>
                  </div>
                  <div class="text-[11px] text-slate-400 font-mono">${escapeHtml(portInfo.portText)}</div>
                </div>
                <div class="flex items-center justify-between pt-2 border-t border-slate-800">
                  <button onclick="openLogs('${escapeHtml(c.name)}')" class="text-xs text-slate-400 hover:text-white flex items-center gap-1">
                    <i data-lucide="terminal" class="w-3.5 h-3.5"></i> Logs
                  </button>
                  <button onclick="containerAction('${escapeHtml(c.name)}', 'restart')" class="p-1 hover:text-white text-slate-400 rounded">
                    <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
  lucide.createIcons();
  requestAnimationFrame(() => {
    // A saved design (or one being edited) turns the tiers into a free canvas; otherwise the automatic layout
    if (!applyArchitectureCanvas(env)) drawHubFlow();
  });
}

// Connectors from every source (use cases above, front-end and integrations below) into the Scaler hub
function drawHubFlow() {
  if (document.getElementById("arch-stage")) return drawCanvasEdges();
  const wrap = document.getElementById("hub-flow");
  const svg = document.getElementById("hub-flow-svg");
  if (!wrap || !svg) return;
  const target = wrap.querySelector("[data-flow-target]");
  const sources = Array.from(wrap.querySelectorAll("[data-flow-source]"));
  const box = wrap.getBoundingClientRect();
  // Hidden tab or stacked (mobile) layout: the arrows between tiers are enough
  if (!target || !sources.length || box.width === 0 || window.innerWidth < 1024) {
    svg.innerHTML = "";
    return;
  }
  const t = target.getBoundingClientRect();
  const tCenter = t.left + t.width / 2 - box.left;
  const running = wrap.dataset.running === "true";

  // Leave from the edge of the tier frame, not the card, so lines never cross the tier titles
  const measured = sources.map(el => {
    const r = el.getBoundingClientRect();
    const frame = el.closest(".tier-frame");
    const f = frame ? frame.getBoundingClientRect() : r;
    return { el, r: { left: r.left, width: r.width, top: f.top, bottom: f.bottom } };
  });
  const above = measured.filter(m => m.r.bottom <= t.top);
  const below = measured.filter(m => m.r.top >= t.bottom);

  // Spread arrivals along the hub edge so the lines don't merge into one
  const spread = (list, i) => tCenter + (i - (list.length - 1) / 2) * 40;
  // animate: only the use cases above pulse; front-end and integrations below are fixed links
  const line = (m, sx, sy, ax, ay, animate) => {
    const my = (sy + ay) / 2;
    const bidir = m.el.hasAttribute("data-flow-bidir");
    const style = m.el.dataset.flowStyle === "platform" ? " is-platform" : "";
    const marker = style ? "hub-arrow-platform" : "hub-arrow";
    const path = `<path d="M ${sx} ${sy} C ${sx} ${my}, ${ax} ${my}, ${ax} ${ay}" class="hub-flow-line${style}${animate && running ? " is-running" : ""}" marker-end="url(#${marker})"${bidir ? ` marker-start="url(#${marker})"` : ""} />`;
    const protocol = m.el.dataset.flowProtocol;
    if (!protocol) return path;
    // A cubic with these control points passes through ((sx+ax)/2, my) at t = 0.5
    const lx = (sx + ax) / 2;
    const w = protocol.length * 6.6 + 18;
    return `${path}
      <g class="hub-flow-label${style}">
        <rect x="${lx - w / 2}" y="${my - 10}" width="${w}" height="20" rx="10" />
        <text x="${lx}" y="${my + 3.5}" text-anchor="middle">${escapeHtml(protocol)}</text>
      </g>`;
  };

  const paths = [
    ...above.sort((a, b) => a.r.left - b.r.left).map((m, i, list) =>
      line(m, m.r.left + m.r.width * (parseFloat(m.el.dataset.flowX) || 0.5) - box.left, m.r.bottom - box.top + 2, spread(list, i), t.top - box.top - 3, true)),
    ...below.sort((a, b) => a.r.left - b.r.left).map((m, i, list) =>
      line(m, m.r.left + m.r.width / 2 - box.left, m.r.top - box.top - 2, spread(list, i), t.bottom - box.top + 3, false))
  ].join("");

  svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  svg.innerHTML = `
    <defs>
      <marker id="hub-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#C99A62" />
      </marker>
      <marker id="hub-arrow-platform" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#8FB8A0" />
      </marker>
    </defs>
    ${paths}`;
}

let hubFlowResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(hubFlowResizeTimer);
  hubFlowResizeTimer = setTimeout(() => {
    // Crossing the canvas width limit switches between the free design and the automatic layout
    const env = selectedServicesEnv();
    const wantsCanvas = Boolean(env && window.innerWidth >= CANVAS_MIN_VIEWPORT && (layoutEditing || savedLayout(env)));
    if (wantsCanvas !== Boolean(document.getElementById("arch-stage"))) return renderServicesView();
    fitCanvasStage();
    drawHubFlow();
  }, 120);
});

// ------------------------------------------------------------------------------
// Architecture canvas: the services view as a free layout, designed per environment and locked when done.
// The automatic layout is rendered first; applyArchitectureCanvas() measures it (the defaults for anything the
// design doesn't have yet) and moves the groups ([data-node]) and the layers ([data-zone]) onto a stage. The use
// case tiles stay inside their group: they are only reordered there, and arrows can start or end on them.
// A design is { nodes: {key: {x,y,w,h}}, zones: {key: {x,y,w,h}}, tiles: [tile key, ...], edges: [{from, to, label,
// bidir, style, animate}], custom: {key: {title, subtitle, icon, color}} }; the arrows start as the automatic ones
// and then belong to the design, and custom groups stand for systems around Inspire (AWS, SAP, a CRM...).
// ------------------------------------------------------------------------------
const CANVAS_GRID = 10;
const CANVAS_MIN_VIEWPORT = 1024;   // narrower screens keep the automatic, stacked layout
const ZONE_META = {
  backend: { icon: "server", title: () => "Back-end" },
  frontend: { icon: "monitor", title: () => "Front-end" },
  integrations: { icon: "network", title: () => t("app.services.integrations") }
};
const CUSTOM_GROUP_PRESETS = [
  { id: "aws", title: "AWS Cloud Services", icon: "cloud", color: "#B45309" },
  { id: "azure", title: "Microsoft Azure", icon: "cloud", color: "#1D6FB8" },
  { id: "gcp", title: "Google Cloud", icon: "cloud", color: "#2F7D4F" },
  { id: "sap", title: "SAP", icon: "building-2", color: "#1F5FA6" },
  { id: "crm", title: "CRM", icon: "users", color: "#7C3AED" },
  { id: "database", titleKey: "app.layout.preset.database", icon: "database", color: "#475569" },
  { id: "messaging", titleKey: "app.layout.preset.messaging", icon: "mail", color: "#BE185D" },
  { id: "customer", titleKey: "app.layout.preset.customer", icon: "building", color: "#0F766E" },
  { id: "other", titleKey: "app.layout.preset.other", icon: "box", color: "#57534E" }
];
const CUSTOM_GROUP_COLORS = ["#B45309", "#1D6FB8", "#2F7D4F", "#7C3AED", "#BE185D", "#0F766E", "#475569", "#A35F78", "#C99A62", "#57534E"];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const ICON_NAME = /^[a-z0-9-]{1,40}$/;

let layoutEditing = null;           // { envId, draft } while a design is being edited
let canvasLayout = null;            // design shown on the stage (the draft while editing)
let canvasConnect = null;           // arrow being drawn: { from, x, y }
let canvasEdgesFrame = 0;

const snapToGrid = v => Math.round(v / CANVAS_GRID) * CANVAS_GRID;
const presetTitle = p => (p.titleKey ? t(p.titleKey) : p.title);
const cloneLayout = value => JSON.parse(JSON.stringify(value));

function savedLayout(env) {
  const layout = env && env.layout;
  return layout && typeof layout === "object" && layout.nodes ? layout : null;
}

function layoutToolbarHtml(env) {
  const editing = Boolean(layoutEditing && layoutEditing.envId === env.id);
  const locked = Boolean(savedLayout(env));
  const button = (icon, label, onclick, style) => `
    <button type="button" onclick="${onclick}" class="whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${style}">
      <i data-lucide="${icon}" class="w-3.5 h-3.5"></i>${label}
    </button>`;
  const neutral = "bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700";
  const hint = editing ? t("app.layout.editingHint") : locked ? t("app.layout.lockedHint") : t("app.layout.autoHint");
  return `
    <div class="hidden lg:flex flex-wrap items-center justify-between gap-2 ${editing ? "bg-sky-500/10 border border-sky-500/30 rounded-xl px-3 py-2" : ""}">
      <p class="text-[11px] ${editing ? "text-sky-200" : "text-slate-500"} flex items-center gap-1.5 max-w-3xl">
        <i data-lucide="${editing ? "move" : locked ? "lock" : "layout-grid"}" class="w-3.5 h-3.5 flex-shrink-0"></i>${hint}
      </p>
      <div class="flex flex-wrap items-center gap-2">
        ${editing ? `
          <span id="arch-group-selection" class="hidden">${button("group", t("app.layout.groupSelection", { count: 0 }), "groupSelectedElements()", "bg-emerald-600/20 text-emerald-200 border border-emerald-500/50 hover:bg-emerald-600/30")}</span>
          ${button("plus", t("app.layout.addGroup"), "openCustomGroupDialog()", "bg-slate-800 text-sky-200 border border-sky-500/40 hover:bg-slate-700")}
          ${locked ? button("rotate-ccw", t("app.layout.reset"), "resetArchitectureLayout()", neutral) : ""}
          ${button("x", t("app.layout.cancel"), "cancelArchitectureLayout()", neutral)}
          ${button("lock", t("app.layout.lock"), "lockArchitectureLayout()", "bg-sky-600 hover:bg-sky-500 text-white border border-sky-500")}
        ` : button("pencil-ruler", t(locked ? "app.layout.editAgain" : "app.layout.edit"), "editArchitectureLayout()", neutral)}
      </div>
    </div>`;
}

function customGroupElement(key, group, editing) {
  const color = HEX_COLOR.test(group.color || "") ? group.color : "#57534E";
  const icon = ICON_NAME.test(group.icon || "") ? group.icon : "box";
  const links = elementLinks(group);
  const el = document.createElement("div");
  el.dataset.node = key;
  el.dataset.custom = "";
  el.className = "group-box flex flex-col rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl";
  el.innerHTML = `
    <div class="relative text-white font-black tracking-widest text-center py-2.5 ${editing ? "px-10" : "px-4"} uppercase text-sm sm:text-base leading-tight border-b-2 border-slate-700 select-none flex items-center justify-center gap-2" style="background:${color}">
      <i data-lucide="${icon}" class="w-5 h-5 flex-shrink-0"></i><span class="min-w-0 break-words">${escapeHtml(group.title)}</span>
      ${editing ? `<button type="button" data-custom-edit class="arch-custom-edit" title="${t("app.layout.groupEditTitle")}" aria-label="${t("app.layout.groupEditTitle")}"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>` : ""}
    </div>
    ${group.subtitle || links.length ? `
      <div class="p-4 sm:p-5 bg-slate-900/60 space-y-3">
        ${group.subtitle ? `<p class="text-xs text-slate-300 leading-relaxed whitespace-pre-line">${escapeHtml(group.subtitle)}</p>` : ""}
        ${links.map(link => `
          <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(link.url)}"
             class="flex items-center justify-between gap-2 w-full px-3 py-2 rounded-lg text-xs font-semibold bg-[#C2410C]/20 text-[#E07A50] hover:bg-[#C2410C]/30 hover:text-white border border-[#D9541F]/40 shadow-sm transition group">
            <span class="flex items-center gap-2 min-w-0">
              <i data-lucide="external-link" class="w-3.5 h-3.5 text-brand-400 flex-shrink-0"></i>
              <span class="min-w-0">
                <span class="block text-[11px] text-slate-100 truncate">${escapeHtml(link.label)}</span>
                <span class="block font-mono text-[10px] font-normal text-slate-400 truncate">${escapeHtml(link.url)}</span>
              </span>
            </span>
            <span class="text-[10px] uppercase font-bold text-white bg-[#C2410C] px-2 py-0.5 rounded shadow-sm flex-shrink-0">${t("app.common.open")}</span>
          </a>`).join("")}
      </div>` : ""}`;
  return el;
}

// Only web addresses: anything else (javascript:, data:...) is dropped
const SAFE_URL = /^https?:\/\/[^\s"'<>]{1,500}$/i;
function elementLinks(group) {
  return (Array.isArray(group.links) ? group.links : [])
    .filter(link => link && SAFE_URL.test(String(link.url || "")))
    .slice(0, 6)
    .map(link => ({ url: String(link.url), label: String(link.label || "").trim() || new URL(link.url).host }));
}

// The arrows the automatic layout draws; a new design starts with them
function defaultCanvasEdges(stage) {
  const has = key => Boolean(stage.querySelector(`[data-node="${key}"]`));
  const edges = [];
  if (has("scaler")) {
    stage.querySelectorAll("[data-node][data-flow-source]").forEach(el => {
      const key = el.dataset.node;
      if (key === "scaler") return;
      edges.push({ from: key, to: "scaler", label: el.dataset.flowProtocol || "", bidir: el.hasAttribute("data-flow-bidir"),
        style: el.dataset.flowStyle === "platform" ? "platform" : "hub", animate: key === "use-cases" || key === "digital-services" });
    });
  }
  const link = (from, to, label) => {
    if (has(from) && has(to)) edges.push({ from, to, label, bidir: true, style: "hub", animate: false });
  };
  link("scaler", "icm", t("app.services.icmResources").replace(/<br\s*\/?>/gi, " "));
  link("icm", "postgres", t("app.services.icmPostgresLink"));
  const dasTiles = ["uc-das-inbox", "uc-das-banking"].filter(has);
  (dasTiles.length ? dasTiles : ["use-cases"]).forEach(key => link(key, "digital-services", "HTTPS · SDK"));
  return edges;
}

function applyArchitectureCanvas(env) {
  if (layoutEditing && layoutEditing.envId !== env.id) layoutEditing = null;
  const editing = Boolean(layoutEditing);
  const source = editing ? layoutEditing.draft : savedLayout(env);
  const wrap = document.getElementById("hub-flow");
  // Two renders in the same frame: the first callback already built the stage for the latest markup
  if (!wrap) return Boolean(document.getElementById("arch-stage"));
  canvasLayout = null;
  if (!source || window.innerWidth < CANVAS_MIN_VIEWPORT) return false;
  const origin = wrap.getBoundingClientRect();
  if (origin.width === 0) return false;   // hidden tab: it is rendered again when shown
  const card = wrap.closest(".architecture-canvas");
  // The extra containers block sits after the architecture card, so look in the whole services view
  const view = document.getElementById("services-grid");

  // The interactive group carries its flow attributes on a wrapper; the stage only keeps the group itself
  card.querySelectorAll("[data-flow-source]").forEach(el => {
    const node = el.matches("[data-node]") ? null : el.querySelector("[data-node]");
    if (!node) return;
    ["data-flow-source", "data-flow-bidir", "data-flow-protocol", "data-flow-style"].forEach(attr => {
      if (el.hasAttribute(attr)) node.setAttribute(attr, el.getAttribute(attr));
    });
  });

  // Measured before anything moves (taking the tiles out shrinks the use cases group), rounded down to the
  // grid so the automatic layout never ends up wider than the view
  const down = v => Math.floor(v / CANVAS_GRID) * CANVAS_GRID;
  const nodes = Array.from(view.querySelectorAll("[data-node]:not(.use-case-tile)"));
  const tiles = Array.from(view.querySelectorAll(".use-case-tile[data-node]"));
  const zones = Array.from(wrap.querySelectorAll("[data-zone]"));
  const auto = new Map([...nodes, ...zones].map(el => {
    const r = el.getBoundingClientRect();
    return [el, { x: down(r.left - origin.left), y: down(r.top - origin.top), w: down(r.width), h: down(r.height) }];
  }));

  // Saved positions win; anything that appeared after the design was made starts below it
  const layout = {
    nodes: {}, zones: {},
    custom: cloneLayout(source.custom || {}),
    // Groups (boxes): the automatic ones can be renamed or hidden, custom ones are added; {key: {title, hidden, custom}}
    zoneMeta: cloneLayout(source.zoneMeta || {}),
    tiles: Array.isArray(source.tiles) ? [...source.tiles] : [],
    edges: Array.isArray(source.edges) ? cloneLayout(source.edges) : null
  };
  const known = [...Object.values(source.nodes || {}), ...Object.values(source.zones || {})];
  let freeY = known.length ? Math.max(...known.map(r => r.y + (r.h || 200))) + 40 : 0;
  const fresh = new Set();
  const place = (saved, rect, key) => {
    if (saved) return { ...saved };
    if (key) fresh.add(key);
    if (!known.length) return rect;
    const placed = { ...rect, y: freeY };
    freeY += rect.h + 20;
    return placed;
  };

  const stage = document.createElement("div");
  stage.id = "arch-stage";
  stage.className = `arch-stage${editing ? " is-editing" : ""}`;
  stage.dataset.running = wrap.dataset.running;
  stage.innerHTML = `<svg id="arch-edges" class="arch-edges" aria-hidden="true"></svg>`;
  const handles = `<span class="arch-resize" data-resize title="${t("app.layout.resize")}"></span>`;

  const addZone = (key, icon, title, rect) => {
    const zone = document.createElement("section");
    zone.className = "arch-item arch-zone tier-frame rounded-2xl border-2 border-slate-500/70 bg-slate-950/40";
    zone.dataset.kind = "zone";
    zone.dataset.key = key;
    zone.innerHTML = `
      <header class="arch-zone-header flex items-center gap-2 px-4 pt-3 pb-2 text-xs font-black uppercase tracking-[0.2em] text-slate-300">
        <i data-lucide="${icon}" class="w-4 h-4 text-slate-400"></i><span class="truncate">${escapeHtml(title)}</span>
        ${editing ? `
          <span class="ml-auto flex items-center gap-1.5">
            <button type="button" data-zone-ungroup class="arch-zone-edit" title="${t("app.layout.zoneRemove")}" aria-label="${t("app.layout.zoneRemove")}"><i data-lucide="ungroup" class="w-3.5 h-3.5"></i></button>
            <button type="button" data-zone-edit class="arch-zone-edit" title="${t("app.layout.zoneEdit")}" aria-label="${t("app.layout.zoneEdit")}"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
          </span>` : ""}
      </header>
      ${editing ? handles : ""}`;
    layout.zones[key] = rect;
    stage.appendChild(zone);
    placeCanvasItem(zone, rect);
  };
  zones.forEach(el => {
    const key = el.dataset.zone;
    const custom = layout.zoneMeta[key] || {};
    if (custom.hidden) return;
    const meta = ZONE_META[key] || { icon: "square", title: () => key };
    addZone(key, meta.icon, custom.title || meta.title(), place(source.zones && source.zones[key], auto.get(el)));
  });
  Object.entries(layout.zoneMeta).forEach(([key, meta]) => {
    if (meta.custom && source.zones && source.zones[key]) addZone(key, "group", meta.title || t("app.layout.newGroup"), { ...source.zones[key] });
  });

  const addNode = (el, rect) => {
    el.classList.remove("h-full");
    el.classList.add("arch-item", "arch-node");
    el.dataset.kind = "node";
    el.dataset.key = el.dataset.node;
    if (editing) {
      // Stopped environments dim their tiles and make them unclickable; while designing they must be grabbable
      el.classList.remove("pointer-events-none");
      el.setAttribute("draggable", "false");
      el.insertAdjacentHTML("beforeend", `${handles}<span class="arch-connect" data-connect title="${t("app.layout.connect")}"></span>`);
    }
    layout.nodes[el.dataset.node] = rect;
    stage.appendChild(el);
    placeCanvasItem(el, rect);
  };
  nodes.forEach(el => addNode(el, place(source.nodes && source.nodes[el.dataset.node], auto.get(el), el.dataset.node)));

  // Tiles keep the saved order inside their group (new use cases go last) and can be arrow ends
  // (the use cases group is already on the detached stage, so the grid is reached through its tiles)
  const tileGrid = tiles.length ? tiles[0].parentElement : null;
  if (tileGrid) {
    const rank = key => { const i = layout.tiles.indexOf(key); return i < 0 ? Infinity : i; };
    tiles.sort((a, b) => rank(a.dataset.node) - rank(b.dataset.node)).forEach(tile => tileGrid.appendChild(tile));
  }
  tiles.forEach(tile => {
    tile.dataset.key = tile.dataset.node;
    if (!editing) return;
    tile.classList.remove("pointer-events-none");
    tile.classList.add("relative", "arch-tile");
    tile.setAttribute("draggable", "false");
    tile.insertAdjacentHTML("beforeend", `<span class="arch-connect" data-connect title="${t("app.layout.connect")}"></span>`);
  });
  layout.tiles = tiles.map(tile => tile.dataset.node);
  Object.entries(layout.custom).forEach(([key, group]) => {
    addNode(customGroupElement(key, group, editing), place(source.nodes && source.nodes[key], { x: 20, y: 0, w: 300, h: 120 }, key));
  });

  // New designs start with the automatic arrows; groups added to the environment later bring theirs along
  const defaults = defaultCanvasEdges(stage);
  if (!layout.edges) layout.edges = defaults;
  else layout.edges.push(...defaults.filter(e => (fresh.has(e.from) || fresh.has(e.to))
    && !layout.edges.some(x => x.from === e.from && x.to === e.to)));

  const scroller = document.createElement("div");
  scroller.className = "arch-scroller";
  scroller.appendChild(stage);
  wrap.replaceWith(scroller);

  canvasLayout = layout;
  if (editing) {
    layoutEditing.draft = layout;
    stage.addEventListener("pointerdown", onCanvasPointerDown);
    // Designing, not operating: links and buttons inside the groups stay quiet
    stage.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); }, true);
  }
  fitCanvasStage();
  drawCanvasEdges();
  lucide.createIcons();
  if (editing) {
    // Elements that are no longer on the stage leave the selection
    [...canvasSelection].forEach(k => { if (!layout.nodes[k]) canvasSelection.delete(k); });
    updateCanvasSelection();
  }
  return true;
}

function placeCanvasItem(el, rect) {
  el.style.left = `${rect.x}px`;
  el.style.top = `${rect.y}px`;
  el.style.width = `${rect.w}px`;
  if (el.dataset.kind === "zone") el.style.height = `${rect.h}px`;
}

// Grows the stage to its content; while editing it keeps room below to drag groups into
function fitCanvasStage() {
  const stage = document.getElementById("arch-stage");
  if (!stage) return;
  let right = 0;
  let bottom = 0;
  stage.querySelectorAll(".arch-item").forEach(el => {
    right = Math.max(right, el.offsetLeft + el.offsetWidth);
    bottom = Math.max(bottom, el.offsetTop + el.offsetHeight);
  });
  // Wider than the view only when a group was dragged past its right edge
  const width = stage.parentElement.clientWidth;
  stage.style.width = `${right > width ? right + 20 : width}px`;
  stage.style.height = `${bottom + (layoutEditing ? 240 : 20)}px`;
}

// Elements selected in the design (Shift / Ctrl + click adds); they move together and can be grouped
const canvasSelection = new Set();

function updateCanvasSelection() {
  document.querySelectorAll("#arch-stage .arch-node").forEach(el => el.classList.toggle("is-selected", canvasSelection.has(el.dataset.key)));
  const wrap = document.getElementById("arch-group-selection");
  if (!wrap) return;
  wrap.classList.toggle("hidden", canvasSelection.size < 2);
  const label = wrap.querySelector("button");
  if (label) label.lastChild.textContent = t("app.layout.groupSelection", { count: canvasSelection.size });
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && canvasSelection.size && document.getElementById("arch-stage")?.classList.contains("is-editing") && !document.querySelector("dialog[open]")) {
    canvasSelection.clear();
    updateCanvasSelection();
  }
});

// Elements whose center lies inside a group belong to it (and nested groups fully inside it)
function zoneMembers(zoneKey) {
  const draft = layoutEditing.draft;
  const zone = draft.zones[zoneKey];
  const inside = (x, y) => x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h;
  const nodes = Object.entries(draft.nodes).filter(([key, r]) => {
    const el = document.querySelector(`#arch-stage .arch-node[data-key="${CSS.escape(key)}"]`);
    return el && inside(r.x + r.w / 2, r.y + (el.offsetHeight || r.h || 0) / 2);
  }).map(([key]) => key);
  const zones = Object.entries(draft.zones).filter(([key, r]) => key !== zoneKey
    && r.x >= zone.x && r.y >= zone.y && r.x + r.w <= zone.x + zone.w && r.y + r.h <= zone.y + zone.h).map(([key]) => key);
  return { nodes, zones };
}

function onCanvasPointerDown(e) {
  if (!layoutEditing || e.button !== 0) return;
  // A click on the empty stage clears the selection
  if (!e.target.closest(".arch-item, [data-edge]") && canvasSelection.size) {
    canvasSelection.clear();
    updateCanvasSelection();
  }
  if (e.target.closest("[data-zone-ungroup]")) {
    e.preventDefault();
    ungroupZone(e.target.closest(".arch-zone").dataset.key);
    return;
  }
  if (e.target.closest("[data-zone-edit]")) {
    e.preventDefault();
    openZoneDialog(e.target.closest(".arch-zone").dataset.key);
    return;
  }
  const edge = e.target.closest("[data-edge]");
  if (edge) {
    e.preventDefault();
    openEdgeDialog(Number(edge.dataset.edge));
    return;
  }
  const tile = e.target.closest(".arch-tile");
  if (tile) return e.target.closest("[data-connect]") ? startCanvasConnect(e, tile) : startTileReorder(e, tile);
  const item = e.target.closest(".arch-item");
  if (!item) return;
  if (e.target.closest("[data-custom-edit]")) {
    e.preventDefault();
    openCustomGroupDialog(item.dataset.key);
    return;
  }
  if (e.target.closest("[data-connect]")) return startCanvasConnect(e, item);

  const resizing = Boolean(e.target.closest("[data-resize]"));
  const isZone = item.dataset.kind === "zone";
  // Layers move by their title so the groups on top of them stay easy to grab
  if (isZone && !resizing && !e.target.closest(".arch-zone-header")) return;
  e.preventDefault();

  const draft = layoutEditing.draft;
  const key = item.dataset.key;
  const rect = draft[isZone ? "zones" : "nodes"][key];
  const start = { px: e.clientX, py: e.clientY, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  // What moves along: a group carries its elements; a selected element carries the rest of the selection
  const followers = [];
  if (!resizing) {
    const add = (kind, k) => {
      const el = document.querySelector(`#arch-stage .arch-item[data-kind="${kind}"][data-key="${CSS.escape(k)}"]`);
      if (el && draft[kind === "zone" ? "zones" : "nodes"][k]) followers.push({ el, r: draft[kind === "zone" ? "zones" : "nodes"][k], x: 0, y: 0 });
    };
    if (isZone) {
      const members = zoneMembers(key);
      members.nodes.forEach(k => add("node", k));
      members.zones.forEach(k => add("zone", k));
    } else if (canvasSelection.has(key) && canvasSelection.size > 1) {
      canvasSelection.forEach(k => { if (k !== key) add("node", k); });
    }
    followers.forEach(f => { f.x = f.r.x; f.y = f.r.y; });
  }
  let moved = false;
  item.setPointerCapture(e.pointerId);
  item.classList.add("is-dragging");

  const move = ev => {
    const dx = ev.clientX - start.px;
    const dy = ev.clientY - start.py;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    moved = true;
    if (resizing) {
      rect.w = Math.max(isZone ? 200 : 160, snapToGrid(start.w + dx));
      if (isZone) rect.h = Math.max(80, snapToGrid(start.h + dy));
    } else {
      // Every follower shifts by the same snapped amount as the item, so their relative layout is kept
      rect.x = Math.max(0, snapToGrid(start.x + dx));
      rect.y = Math.max(0, snapToGrid(start.y + dy));
      const sx = rect.x - start.x;
      const sy = rect.y - start.y;
      followers.forEach(f => {
        f.r.x = Math.max(0, f.x + sx);
        f.r.y = Math.max(0, f.y + sy);
        placeCanvasItem(f.el, f.r);
      });
    }
    placeCanvasItem(item, rect);
    scheduleCanvasEdges();
  };
  const end = ev => {
    item.removeEventListener("pointermove", move);
    item.removeEventListener("pointerup", end);
    item.removeEventListener("pointercancel", end);
    item.classList.remove("is-dragging");
    if (!isZone) rect.h = snapToGrid(item.offsetHeight);
    // A click (no movement) on an element selects it; Shift / Ctrl / Cmd adds it to the selection or takes it out
    if (!moved && !isZone && !resizing && ev.type === "pointerup") {
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
        if (canvasSelection.has(key)) canvasSelection.delete(key); else canvasSelection.add(key);
      } else {
        canvasSelection.clear();
        canvasSelection.add(key);
      }
      updateCanvasSelection();
    }
    fitCanvasStage();
    drawCanvasEdges();
  };
  item.addEventListener("pointermove", move);
  item.addEventListener("pointerup", end);
  item.addEventListener("pointercancel", end);
}

// Use case tiles are reordered inside their group: dragging one over another puts it in that place
function startTileReorder(e, tile) {
  e.preventDefault();
  const grid = tile.parentElement;
  tile.classList.add("is-reordering");

  // Moving the tile in the DOM drops pointer capture, so the pointer is followed on the window
  const move = ev => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const over = el && el.closest(".use-case-tile");
    if (!over || over === tile || over.parentElement !== grid) return;
    const tiles = Array.from(grid.children);
    // Moving forward lands after the tile below the pointer, moving back lands before it
    grid.insertBefore(tile, tiles.indexOf(over) > tiles.indexOf(tile) ? over.nextSibling : over);
    scheduleCanvasEdges();
  };
  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    tile.classList.remove("is-reordering");
    if (layoutEditing) layoutEditing.draft.tiles = Array.from(grid.querySelectorAll(".use-case-tile")).map(t => t.dataset.node);
    fitCanvasStage();
    drawCanvasEdges();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

// Drag from a group's blue dot to another group to draw an arrow between them
function startCanvasConnect(e, item) {
  e.preventDefault();
  const stage = document.getElementById("arch-stage");
  const handle = e.target.closest("[data-connect]");
  const at = ev => {
    const box = stage.getBoundingClientRect();
    return { x: ev.clientX - box.left, y: ev.clientY - box.top };
  };
  const targetAt = ev => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const node = el && el.closest("#arch-stage .use-case-tile, #arch-stage .arch-node");
    return node && node !== item ? node : null;
  };
  canvasConnect = { from: item.dataset.key, ...at(e) };
  handle.setPointerCapture(e.pointerId);
  stage.classList.add("is-connecting");
  let hovered = null;

  const move = ev => {
    Object.assign(canvasConnect, at(ev));
    const target = targetAt(ev);
    if (target !== hovered) {
      if (hovered) hovered.classList.remove("is-connect-target");
      hovered = target;
      if (hovered) hovered.classList.add("is-connect-target");
    }
    scheduleCanvasEdges();
  };
  const end = ev => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    stage.classList.remove("is-connecting");
    if (hovered) hovered.classList.remove("is-connect-target");
    const target = ev.type === "pointerup" ? targetAt(ev) : null;
    const from = canvasConnect.from;
    canvasConnect = null;
    if (!target) return drawCanvasEdges();
    const edges = layoutEditing.draft.edges;
    edges.push({ from, to: target.dataset.key, label: "", bidir: false, style: "hub", animate: false });
    drawCanvasEdges();
    openEdgeDialog(edges.length - 1, true);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

function scheduleCanvasEdges() {
  if (canvasEdgesFrame) return;
  canvasEdgesFrame = requestAnimationFrame(() => {
    canvasEdgesFrame = 0;
    drawCanvasEdges();
  });
}

// Each arrow leaves from the side of a group that faces the other one; arrivals sharing a side are spread out
function drawCanvasEdges() {
  const stage = document.getElementById("arch-stage");
  const svg = document.getElementById("arch-edges");
  if (!stage || !svg || !canvasLayout) return;
  const box = stage.getBoundingClientRect();
  const rectOf = el => {
    const r = el.getBoundingClientRect();
    const left = r.left - box.left;
    const top = r.top - box.top;
    return { left, top, right: left + r.width, bottom: top + r.height, cx: left + r.width / 2, cy: top + r.height / 2 };
  };
  const node = key => stage.querySelector(`.arch-node[data-key="${CSS.escape(key)}"], .use-case-tile[data-key="${CSS.escape(key)}"]`);
  const running = stage.dataset.running === "true";
  const editing = stage.classList.contains("is-editing");

  const sides = (a, b) => {
    if (b.top >= a.bottom) return ["bottom", "top"];
    if (b.bottom <= a.top) return ["top", "bottom"];
    return b.cx >= a.cx ? ["right", "left"] : ["left", "right"];
  };
  const point = (r, side) => ({
    top: { x: r.cx, y: r.top - 3 }, bottom: { x: r.cx, y: r.bottom + 3 },
    left: { x: r.left - 3, y: r.cy }, right: { x: r.right + 3, y: r.cy }
  })[side];

  const lines = [];
  canvasLayout.edges.forEach((edge, index) => {
    const from = node(edge.from);
    const to = node(edge.to);
    if (!from || !to || from === to) return;
    const a = rectOf(from);
    const b = rectOf(to);
    const [sa, sb] = sides(a, b);
    lines.push({ edge, index, a, sa, sb, toKey: edge.to, start: point(a, sa), end: point(b, sb) });
  });
  const bySide = new Map();
  lines.forEach(l => {
    const k = `${l.toKey}:${l.sb}`;
    if (!bySide.has(k)) bySide.set(k, []);
    bySide.get(k).push(l);
  });
  bySide.forEach(list => {
    const vertical = list[0].sb === "top" || list[0].sb === "bottom";
    list.sort((p, q) => (vertical ? p.a.cx - q.a.cx : p.a.cy - q.a.cy));
    list.forEach((l, i) => {
      const offset = (i - (list.length - 1) / 2) * 40;
      if (vertical) l.end.x += offset; else l.end.y += offset;
    });
  });

  const curve = (sx, sy, ax, ay, verticalStart) => {
    const mx = (sx + ax) / 2;
    const my = (sy + ay) / 2;
    return verticalStart ? `M ${sx} ${sy} C ${sx} ${my}, ${ax} ${my}, ${ax} ${ay}` : `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ay}, ${ax} ${ay}`;
  };
  let paths = lines.map(l => {
    const { edge, index } = l;
    const { x: sx, y: sy } = l.start;
    const { x: ax, y: ay } = l.end;
    const d = curve(sx, sy, ax, ay, l.sa === "top" || l.sa === "bottom");
    const style = edge.style === "platform" ? " is-platform" : "";
    const marker = style ? "hub-arrow-platform" : "hub-arrow";
    const hit = editing ? `<path d="${d}" class="arch-edge-hit" data-edge="${index}"><title>${escapeHtml(t("app.layout.edgeHint"))}</title></path>` : "";
    const path = `${hit}<path d="${d}" class="hub-flow-line${style}${edge.animate && running ? " is-running" : ""}" marker-end="url(#${marker})"${edge.bidir ? ` marker-start="url(#${marker})"` : ""} />`;
    if (!edge.label) return path;
    // Both curves are symmetric, so t = 0.5 is the midpoint of the two ends
    const mx = (sx + ax) / 2;
    const my = (sy + ay) / 2;
    const w = edge.label.length * 6.6 + 18;
    return `${path}
      <g class="hub-flow-label${style}"${editing ? ` data-edge="${index}"` : ""}>
        <rect x="${mx - w / 2}" y="${my - 10}" width="${w}" height="20" rx="10" />
        <text x="${mx}" y="${my + 3.5}" text-anchor="middle">${escapeHtml(edge.label)}</text>
      </g>`;
  }).join("");

  // Arrow being drawn: from the source group to the pointer
  if (canvasConnect) {
    const from = node(canvasConnect.from);
    if (from) {
      const r = rectOf(from);
      paths += `<path d="M ${r.cx} ${r.cy} L ${canvasConnect.x} ${canvasConnect.y}" class="arch-edge-draft" marker-end="url(#hub-arrow-draft)" />`;
    }
  }

  svg.setAttribute("width", stage.offsetWidth);
  svg.setAttribute("height", stage.offsetHeight);
  svg.setAttribute("viewBox", `0 0 ${stage.offsetWidth} ${stage.offsetHeight}`);
  svg.innerHTML = `
    <defs>
      <marker id="hub-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#C99A62" />
      </marker>
      <marker id="hub-arrow-platform" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#8FB8A0" />
      </marker>
      <marker id="hub-arrow-draft" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#38BDF8" />
      </marker>
    </defs>
    ${paths}`;
}

// Name of a group or tile for the arrow dialog
function canvasNodeName(key) {
  const names = {
    "use-cases": t("app.services.useCasesBanner"), "digital-services": "Digital Services", scaler: "Scaler", icm: "ICM",
    postgres: "PostgreSQL", interactive: "Interactive", ftp: "FTP", kafka: "Kafka", extra: t("app.services.extra")
  };
  if (names[key]) return names[key];
  if (canvasLayout && canvasLayout.custom[key]) return canvasLayout.custom[key].title;
  if (key.startsWith("uc-")) {
    const useCase = useCaseCatalog.find(c => c.id === key.slice(3));
    return useCase ? useCaseText(useCase, "name") : key.slice(3);
  }
  return key;
}

async function openEdgeDialog(index, isNew = false) {
  if (!layoutEditing) return;
  const edges = layoutEditing.draft.edges;
  const edge = edges[index];
  if (!edge) return;
  const { action, value } = await openActionDialog({
    title: t(isNew ? "app.layout.edgeNewTitle" : "app.layout.edgeTitle"),
    message: `<p class="font-mono text-xs text-slate-400">${escapeHtml(canvasNodeName(edge.from))} → ${escapeHtml(canvasNodeName(edge.to))}</p>`,
    input: { label: t("app.layout.edgeLabel"), value: edge.label },
    actions: [
      { id: "delete", label: t("app.layout.edgeDelete"), style: "dangerOutline" },
      { id: "both", label: t("app.layout.edgeTwoWay"), style: edge.bidir ? "primary" : "secondary", default: edge.bidir },
      { id: "one", label: t("app.layout.edgeOneWay"), style: edge.bidir ? "secondary" : "primary", default: !edge.bidir }
    ]
  });
  if (!layoutEditing || layoutEditing.draft.edges !== edges) return;
  if (action === "delete" || (!action && isNew)) {
    edges.splice(index, 1);
  } else if (action) {
    edge.label = value.slice(0, 60);
    edge.bidir = action === "both";
  }
  drawCanvasEdges();
}

// Add or edit a custom group: a preset (AWS, SAP, a CRM...) or a free name, a description and a color
function openCustomGroupDialog(key) {
  if (!layoutEditing) return;
  const existing = key ? layoutEditing.draft.custom[key] : null;
  const first = CUSTOM_GROUP_PRESETS[0];
  const state = existing ? { ...existing } : { title: presetTitle(first), subtitle: "", icon: first.icon, color: first.color };
  const envId = layoutEditing.envId;

  let dlg = document.getElementById("group-dialog");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "group-dialog";
    dlg.className = "bg-slate-900 border border-slate-700 text-slate-100 rounded-xl shadow-2xl p-0 w-[calc(100%-2rem)] max-w-lg";
    document.body.appendChild(dlg);
  }
  const field = "w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500";
  dlg.innerHTML = `
    <form method="dialog" class="p-6 space-y-4">
      <h2 class="text-base font-semibold text-white">${t(existing ? "app.layout.groupEditTitle" : "app.layout.groupNewTitle")}</h2>
      ${existing ? "" : `
        <div>
          <span class="block text-xs text-slate-400 mb-1.5">${t("app.layout.groupPreset")}</span>
          <div class="flex flex-wrap gap-1.5">
            ${CUSTOM_GROUP_PRESETS.map(p => `
              <button type="button" data-preset="${p.id}" class="group-preset flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-700 text-xs text-slate-200 hover:border-slate-500">
                <span class="w-2.5 h-2.5 rounded-full" style="background:${p.color}"></span>
                <i data-lucide="${p.icon}" class="w-3.5 h-3.5"></i>${escapeHtml(presetTitle(p))}
              </button>`).join("")}
          </div>
        </div>`}
      <div>
        <label for="group-dialog-title" class="block text-xs text-slate-400 mb-1.5">${t("app.layout.groupName")}</label>
        <input id="group-dialog-title" type="text" maxlength="60" autocomplete="off" value="${escapeHtml(state.title)}" class="${field}">
      </div>
      <div>
        <label for="group-dialog-subtitle" class="block text-xs text-slate-400 mb-1.5">${t("app.layout.groupDescription")}</label>
        <textarea id="group-dialog-subtitle" rows="3" maxlength="500" class="${field}">${escapeHtml(state.subtitle || "")}</textarea>
      </div>
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-xs text-slate-400">${t("app.layout.elementLinks")}</span>
          <button type="button" data-add-link class="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md border border-slate-700 text-slate-200 hover:border-brand-500 hover:text-white">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i>${t("app.layout.addLink")}
          </button>
        </div>
        <div data-links class="space-y-2"></div>
        <p data-links-empty class="text-[11px] text-slate-500">${t("app.layout.noLinks")}</p>
      </div>
      <div>
        <span class="block text-xs text-slate-400 mb-1.5">${t("app.layout.groupColor")}</span>
        <div class="flex flex-wrap gap-2">
          ${CUSTOM_GROUP_COLORS.map(c => `<button type="button" data-color="${c}" class="group-color w-7 h-7 rounded-full border-2 border-transparent" style="background:${c}" aria-label="${c}"></button>`).join("")}
        </div>
      </div>
      <div class="flex flex-col-reverse sm:flex-row sm:items-center gap-2 pt-2">
        ${existing ? `<button value="delete" class="sm:mr-auto whitespace-nowrap px-3.5 py-2 rounded-md text-sm font-medium ${DIALOG_BUTTON_STYLES.dangerOutline}">${t("app.layout.groupDelete")}</button>` : `<span class="sm:mr-auto"></span>`}
        <button value="" class="whitespace-nowrap px-3.5 py-2 rounded-md text-sm font-medium text-slate-300 border border-slate-700 hover:bg-slate-800">${t("app.common.cancel")}</button>
        <button value="save" class="whitespace-nowrap px-3.5 py-2 rounded-md text-sm font-medium ${DIALOG_BUTTON_STYLES.primary}">${t(existing ? "app.layout.groupSave" : "app.layout.groupAdd")}</button>
      </div>
    </form>`;

  const titleInput = dlg.querySelector("#group-dialog-title");
  // Links: a name and a web address per row (up to 6)
  const linksBox = dlg.querySelector("[data-links]");
  const syncLinks = () => {
    const rows = linksBox.querySelectorAll("[data-link-row]").length;
    dlg.querySelector("[data-links-empty]").classList.toggle("hidden", rows > 0);
    dlg.querySelector("[data-add-link]").disabled = rows >= 6;
  };
  const addLinkRow = (link = {}) => {
    linksBox.insertAdjacentHTML("beforeend", `
      <div data-link-row class="grid grid-cols-[1fr_1.6fr_auto] gap-2 items-center">
        <input type="text" data-link-label maxlength="60" placeholder="${escapeHtml(t("app.layout.linkLabel"))}" value="${escapeHtml(link.label || "")}" class="${field} py-1.5 text-xs">
        <input type="url" data-link-url maxlength="500" placeholder="https://" value="${escapeHtml(link.url || "")}" class="${field} py-1.5 text-xs font-mono">
        <button type="button" data-remove-link title="${escapeHtml(t("app.layout.removeLink"))}" aria-label="${escapeHtml(t("app.layout.removeLink"))}" class="w-8 h-8 flex items-center justify-center rounded-md text-slate-500 hover:text-rose-400 hover:bg-slate-800">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>`);
    lucide.createIcons();
    syncLinks();
  };
  (Array.isArray(state.links) ? state.links : []).forEach(addLinkRow);
  syncLinks();
  dlg.querySelector("[data-add-link]").addEventListener("click", () => {
    addLinkRow();
    linksBox.lastElementChild.querySelector("input").focus();
  });
  linksBox.addEventListener("click", ev => {
    const remove = ev.target.closest("[data-remove-link]");
    if (!remove) return;
    remove.closest("[data-link-row]").remove();
    syncLinks();
  });
  const readLinks = () => Array.from(linksBox.querySelectorAll("[data-link-row]")).map(row => ({
    label: row.querySelector("[data-link-label]").value.trim().slice(0, 60),
    url: row.querySelector("[data-link-url]").value.trim()
  })).filter(link => link.url);
  const markSelected = () => {
    dlg.querySelectorAll(".group-color").forEach(b => b.classList.toggle("is-selected", b.dataset.color.toLowerCase() === state.color.toLowerCase()));
    dlg.querySelectorAll(".group-preset").forEach(b => {
      const p = CUSTOM_GROUP_PRESETS.find(x => x.id === b.dataset.preset);
      b.classList.toggle("is-selected", p.icon === state.icon && presetTitle(p) === titleInput.value.trim());
    });
  };
  dlg.querySelectorAll(".group-preset").forEach(b => b.addEventListener("click", () => {
    const p = CUSTOM_GROUP_PRESETS.find(x => x.id === b.dataset.preset);
    Object.assign(state, { title: presetTitle(p), icon: p.icon, color: p.color });
    titleInput.value = state.title;
    markSelected();
  }));
  dlg.querySelectorAll(".group-color").forEach(b => b.addEventListener("click", () => {
    state.color = b.dataset.color;
    markSelected();
  }));
  titleInput.addEventListener("input", markSelected);
  markSelected();
  lucide.createIcons();

  dlg.onclick = ev => { if (ev.target === dlg) dlg.close(""); };
  // Addresses that aren't web links keep the dialog open with the field marked
  dlg.querySelector("form").addEventListener("submit", ev => {
    if (ev.submitter && ev.submitter.value !== "save") return;
    const bad = Array.from(linksBox.querySelectorAll("[data-link-url]")).find(input => input.value.trim() && !SAFE_URL.test(input.value.trim()));
    if (!bad) return;
    ev.preventDefault();
    bad.setCustomValidity(t("app.layout.badLink"));
    bad.reportValidity();
    bad.addEventListener("input", () => bad.setCustomValidity(""), { once: true });
  });
  dlg.addEventListener("close", () => {
    // The stage may have been redrawn while the dialog was open: work on the current draft
    if (!layoutEditing || layoutEditing.envId !== envId) return;
    const draft = layoutEditing.draft;
    const action = dlg.returnValue;
    if (action === "delete" && key) {
      delete draft.custom[key];
      delete draft.nodes[key];
      draft.edges = draft.edges.filter(e => e.from !== key && e.to !== key);
    } else if (action === "save") {
      const group = {
        title: titleInput.value.trim().slice(0, 60) || state.title,
        subtitle: dlg.querySelector("#group-dialog-subtitle").value.trim().slice(0, 500),
        icon: state.icon,
        color: state.color,
        links: readLinks().filter(link => SAFE_URL.test(link.url))
      };
      if (key) {
        draft.custom[key] = group;
      } else {
        // New groups appear near the top of what is on screen
        const newKey = `custom-${Date.now().toString(36)}`;
        const stageTop = document.getElementById("arch-stage")?.getBoundingClientRect().top || 0;
        draft.custom[newKey] = group;
        draft.nodes[newKey] = { x: 20, y: Math.max(0, snapToGrid(160 - stageTop)), w: 300, h: 120 };
      }
    } else {
      return;
    }
    renderServicesView();
  }, { once: true });
  dlg.returnValue = "";
  dlg.showModal();
  titleInput.focus();
}

// A new group (box) around the selected elements, with room for its title
function groupSelectedElements() {
  if (!layoutEditing || canvasSelection.size < 2) return;
  const draft = layoutEditing.draft;
  const rects = [...canvasSelection].map(k => {
    const r = draft.nodes[k];
    const el = document.querySelector(`#arch-stage .arch-node[data-key="${CSS.escape(k)}"]`);
    return r && { x: r.x, y: r.y, w: r.w, h: el ? el.offsetHeight : (r.h || 0) };
  }).filter(Boolean);
  if (rects.length < 2) return;
  const left = Math.min(...rects.map(r => r.x));
  const top = Math.min(...rects.map(r => r.y));
  const right = Math.max(...rects.map(r => r.x + r.w));
  const bottom = Math.max(...rects.map(r => r.y + r.h));
  const x = Math.max(0, snapToGrid(left - 20));
  const y = Math.max(0, snapToGrid(top - 50));
  createZone({ x, y, w: snapToGrid(right + 20 - x), h: snapToGrid(bottom + 20 - y) });
}

function createZone(rect) {
  const key = `zone-${Date.now().toString(36)}`;
  layoutEditing.draft.zoneMeta[key] = { custom: true, title: t("app.layout.newGroup") };
  layoutEditing.draft.zones[key] = rect;
  canvasSelection.clear();
  renderServicesView();
  openZoneDialog(key, true);
}

// Rename a group or take it away (its elements stay where they are); the automatic ones are hidden
async function openZoneDialog(key, isNew = false) {
  if (!layoutEditing) return;
  const envId = layoutEditing.envId;
  const meta = layoutEditing.draft.zoneMeta[key] || {};
  const current = meta.title || (ZONE_META[key] ? ZONE_META[key].title() : t("app.layout.newGroup"));
  const { action, value } = await openActionDialog({
    title: t(isNew ? "app.layout.zoneNewTitle" : "app.layout.zoneEdit"),
    message: `<p class="text-xs text-slate-400">${t("app.layout.zoneHint")}</p>`,
    input: { label: t("app.layout.zoneName"), value: current },
    actions: [
      { id: "remove", label: t("app.layout.zoneRemove"), style: "dangerOutline" },
      { id: "save", label: t("app.layout.zoneSave"), style: "primary", gate: "value", default: true }
    ]
  });
  // The stage may have been redrawn while the dialog was open (a new group is): use the current draft
  if (!layoutEditing || layoutEditing.envId !== envId) return;
  if (action === "remove") {
    ungroupZone(key);
  } else if (action === "save") {
    layoutEditing.draft.zoneMeta[key] = { ...meta, title: value.slice(0, 60) };
    renderServicesView();
  }
}

// Ungroup: the box goes away and its elements stay where they are (the automatic groups are only hidden)
function ungroupZone(key) {
  if (!layoutEditing) return;
  const draft = layoutEditing.draft;
  const meta = draft.zoneMeta[key] || {};
  delete draft.zones[key];
  if (meta.custom) delete draft.zoneMeta[key];
  else draft.zoneMeta[key] = { hidden: true };
  canvasSelection.clear();
  renderServicesView();
}

function selectedServicesEnv() {
  const envId = document.getElementById("service-env-select")?.value;
  return allEnvironments.find(e => e.id === envId) || null;
}

function editArchitectureLayout() {
  const env = selectedServicesEnv();
  if (!env) return;
  const saved = savedLayout(env);
  layoutEditing = { envId: env.id, draft: saved ? cloneLayout(saved) : { nodes: {}, zones: {} } };
  canvasSelection.clear();
  renderServicesView();
}

function cancelArchitectureLayout() {
  layoutEditing = null;
  canvasSelection.clear();
  renderServicesView();
}

async function saveArchitectureLayout(env, layout) {
  try {
    const res = await fetch(`/api/environments/${encodeURIComponent(env.id)}/layout`, {
      method: layout ? "PUT" : "DELETE",
      headers: { "Content-Type": "application/json" },
      body: layout ? JSON.stringify({ layout }) : undefined
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
    if (!data.success) return false;
    env.layout = layout;
    return true;
  } catch (err) {
    showAlert("error", t("app.common.networkError", { error: err.message }));
    return false;
  }
}

async function lockArchitectureLayout() {
  const env = selectedServicesEnv();
  if (!env || !layoutEditing) return;
  if (await saveArchitectureLayout(env, layoutEditing.draft)) {
    layoutEditing = null;
    renderServicesView();
  }
}

async function resetArchitectureLayout() {
  const env = selectedServicesEnv();
  if (!env) return;
  const { action } = await openActionDialog({
    title: t("app.layout.resetTitle"),
    message: `<p>${t("app.layout.resetBody", { name: escapeHtml(env.name) })}</p>`,
    actions: [{ id: "reset", label: t("app.layout.reset"), style: "danger" }]
  });
  if (action !== "reset") return;
  if (await saveArchitectureLayout(env, null)) {
    layoutEditing = null;
    renderServicesView();
  }
}

async function containerAction(containerName, action) {
  showAlert("info", t("app.services.runningAction", { action, name: containerName }));
  try {
    const res = await fetch(`/api/containers/${containerName}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
    await loadEnvironments();
    renderServicesView();
  } catch (err) {
    showAlert("error", t("app.common.error", { error: err.message }));
  }
}

async function startSelectedEnvironment() {
  const select = document.getElementById("service-env-select");
  if (select && select.value) {
    activateDemo(select.value, true);
  }
}

async function stopSelectedEnvironment() {
  const select = document.getElementById("service-env-select");
  if (select && select.value) {
    stopDemo(select.value);
  }
}

// ------------------------------------------------------------------------------
// Logs Viewer
// ------------------------------------------------------------------------------
function openLogs(containerName) {
  activeContainerForLogs = containerName;
  document.getElementById("logs-container-name").innerText = containerName;

  renderLogsSubtitle(containerName);

  const modal = document.getElementById("logs-modal");
  modal.showModal();
  lucide.createIcons();
  refreshCurrentLogs();

  if (logPollInterval) clearInterval(logPollInterval);
  logPollInterval = setInterval(refreshCurrentLogs, 4000);
}

// Subtitle with Port and Access URL if available
function renderLogsSubtitle(containerName) {
  const subtitleEl = document.getElementById("logs-container-subtitle");
  if (!subtitleEl) return;
  const select = document.getElementById("service-env-select");
  const envId = select ? select.value : (allEnvironments[0] ? allEnvironments[0].id : null);
  const env = allEnvironments.find(e => e.id === envId);
  const c = env && env.containers ? env.containers.find(x => x.name === containerName) : null;
  if (c) {
    const portInfo = getServicePortInfo(c, env);
    if (portInfo.accessUrl) {
      subtitleEl.innerHTML = `${t("app.services.port")} <span class="font-mono text-brand-300 font-semibold">${escapeHtml(portInfo.portText)}</span> • URL: <a href="${portInfo.accessUrl}" target="_blank" rel="noopener noreferrer" class="font-mono text-brand-400 underline hover:text-brand-300 inline-flex items-center gap-1">${escapeHtml(portInfo.accessUrl)} <i data-lucide="external-link" class="w-3 h-3"></i></a>`;
    } else {
      subtitleEl.innerHTML = `${t("app.services.port")} <span class="font-mono text-slate-300 font-semibold">${escapeHtml(portInfo.portText)}</span> • ${t("app.logs.live")}`;
    }
  } else {
    subtitleEl.innerText = t("app.logs.latest");
  }
}

async function refreshCurrentLogs() {
  if (!activeContainerForLogs) return;
  const viewer = document.getElementById("logs-viewer-content");
  try {
    const res = await fetch(`/api/containers/${activeContainerForLogs}/logs?tail=200`);
    const data = await res.json();
    viewer.innerText = data.logs || t("app.logs.none");
    viewer.scrollTop = viewer.scrollHeight;
  } catch (err) {
    viewer.innerText = t("app.logs.error", { error: err.message });
  }
}

// Stop polling when dialog is closed
document.getElementById("logs-modal")?.addEventListener("close", () => {
  if (logPollInterval) {
    clearInterval(logPollInterval);
    logPollInterval = null;
  }
});

// ------------------------------------------------------------------------------
// Azure Container Registry (ACR) Explorer
// ------------------------------------------------------------------------------
async function loadAcrVersions() {
  const loading = document.getElementById("acr-loading");
  const content = document.getElementById("acr-content");
  loading.classList.remove("hidden");
  content.classList.add("hidden");

  try {
    const res = await fetch("/api/acr/versions");
    const data = await res.json();
    loading.classList.add("hidden");
    content.classList.remove("hidden");

    if (!data.success) {
      showAlert("error", data.message);
      return;
    }

    const latestContainer = document.getElementById("acr-latest-tags");
    latestContainer.innerHTML = "";
    (data.data.all_latest || []).forEach(tag => {
      const card = document.createElement("div");
      card.className = "bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between";
      card.innerHTML = `
        <span class="font-mono text-xs text-cyan-300 font-bold">${escapeHtml(tag)}</span>
        <button onclick="applyVersionToActiveEnv('${tag}')" class="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded" title="${t("app.acr.useInEnv")}">
          ${t("app.acr.assign")}
        </button>
      `;
      latestContainer.appendChild(card);
    });

    const hfContainer = document.getElementById("acr-hf-tags");
    hfContainer.innerHTML = "";
    (data.data.hotfixes || []).forEach(tag => {
      const pill = document.createElement("span");
      pill.className = "text-[11px] font-mono bg-slate-950 text-slate-400 px-2 py-1 rounded border border-slate-800";
      pill.innerText = tag;
      hfContainer.appendChild(pill);
    });
  } catch (err) {
    loading.classList.add("hidden");
    showAlert("error", t("app.acr.error", { error: err.message }));
  }
}

async function applyVersionToActiveEnv(tag) {
  const select = document.getElementById("service-env-select");
  const envId = select ? select.value : "default";
  const { action } = await openActionDialog({
    title: t("app.acr.changeVersion"),
    message: `<p>${t("app.acr.confirm", { version: `<span class="font-mono text-white">${escapeHtml(tag)}</span>`, name: `<strong class="text-white">${escapeHtml(envName(envId))}</strong>` })}</p>`,
    actions: [{ id: "ok", label: t("app.acr.assignVersion"), style: "primary" }]
  });
  if (!action) return;

  try {
    const res = await fetch(`/api/environments/${envId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: tag })
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
    await loadEnvironments();
  } catch (err) {
    showAlert("error", t("app.common.error", { error: err.message }));
  }
}

// ------------------------------------------------------------------------------
// Volumes
// ------------------------------------------------------------------------------
let currentModalCliCmd = "";

async function loadVolumes() {
  const container = document.getElementById("volumes-list");
  if (!container) return;
  try {
    const res = await fetch("/api/volumes");
    const data = await res.json();
    container.innerHTML = "";
    const vols = data.volumes || [];
    if (vols.length === 0) {
      container.innerHTML = `<span class="text-slate-500">${t("app.volumes.none")}</span>`;
      return;
    }
    vols.forEach(v => {
      const item = document.createElement("div");
      item.className = "p-2.5 bg-slate-950 rounded-lg border border-slate-800 flex flex-col gap-1.5 hover:border-slate-700 transition";
      const displayPath = v.host_path || v.mountpoint || "";
      item.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <span class="font-mono text-slate-200 font-semibold truncate text-xs" title="${escapeHtml(v.name)}">${escapeHtml(v.name)}</span>
          <div class="flex items-center gap-1.5 flex-shrink-0">
            <span class="text-[10px] ${v.is_custom ? 'bg-[#668fb3]/15 text-[#668fb3] border border-[#668fb3]/30 font-semibold' : 'bg-slate-900 text-slate-400'} px-2 py-0.5 rounded">
              ${v.is_custom ? 'Host Bind' : escapeHtml(v.driver)}
            </span>
            <button onclick="deleteVolume('${escapeHtml(v.name)}')" class="p-1 text-slate-500 hover:text-rose-400 rounded transition" title="${t("app.volumes.deleteTitle")}">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>
        ${displayPath ? `
          <div class="flex items-center justify-between gap-1 text-[11px] font-mono bg-black/50 px-2 py-1 rounded border border-slate-800/80">
            <span class="truncate ${v.is_custom ? 'text-[#668fb3]' : 'text-slate-400'}" title="${escapeHtml(displayPath)}">
              ${escapeHtml(displayPath)}
            </span>
            <button onclick="copyVolPath('${escapeHtml(displayPath)}')" class="text-slate-400 hover:text-white flex-shrink-0 ml-1.5" title="${t("app.volumes.copyPath")}">
              <i data-lucide="copy" class="w-3 h-3"></i>
            </button>
          </div>
        ` : ''}
      `;
      container.appendChild(item);
    });
    lucide.createIcons();
  } catch (err) {
    console.error("Error al cargar volúmenes:", err);
  }
}

async function deleteVolume(volumeName) {
  const { action } = await openActionDialog({
    title: t("app.volumes.delete"),
    message: `<p>${t("app.volumes.deleteIntro", { name: `<span class="font-mono text-white break-all">${escapeHtml(volumeName)}</span>` })}</p>
      <p class="text-slate-400">${t("app.volumes.deleteWarning")}</p>`,
    actions: [{ id: "ok", label: t("app.volumes.delete"), style: "danger" }]
  });
  if (!action) return;
  showAlert("info", t("app.volumes.deleting", { name: volumeName }));
  try {
    const res = await fetch(`/api/volumes/${encodeURIComponent(volumeName)}`, { method: "DELETE" });
    let data;
    try {
      data = await res.json();
    } catch (_) {
      const text = await res.text();
      showAlert("error", t("app.common.serverError", { status: res.status, text: text.substring(0, 120) }));
      return;
    }
    showAlert(data.success ? "success" : "error", data.message || t("app.common.processed"));
    loadVolumes();
  } catch (err) {
    showAlert("error", t("app.volumes.deleteError", { error: err.message }));
  }
}

let volumeModalEnvId = null;

async function openVolumeLocationModal(envId) {
  volumeModalEnvId = envId;
  const env = allEnvironments.find(e => e.id === envId);
  const modal = document.getElementById("volume-locations-modal");
  if (!modal) return;

  document.getElementById("vol-modal-env-name").innerText = env ? env.name : envId;
  document.getElementById("vol-modal-env-subtitle").innerText = t("app.volumes.modalSubtitle", { id: envId, project: env?.project_name || 'flex-' + envId });

  const bannerEl = document.getElementById("vol-modal-type-banner");
  const listEl = document.getElementById("vol-modal-list");
  const cmdEl = document.getElementById("vol-modal-cli-cmd");

  listEl.innerHTML = `<div class="py-4 text-center text-slate-400"><i data-lucide="loader-2" class="w-5 h-5 animate-spin mx-auto mb-1"></i> ${t("app.volumes.loading")}</div>`;
  lucide.createIcons();
  if (!modal.open) modal.showModal();

  try {
    const res = await fetch(`/api/environments/${envId}/volumes`);
    const data = await res.json();
    const vols = data.volumes || [];

    const isCustom = env && env.storage_path && env.storage_path !== "docker_default";
    if (isCustom) {
      bannerEl.className = "p-3.5 rounded-xl border bg-[#668fb3]/10 border-[#668fb3]/30 text-[#668fb3] flex items-center justify-between text-xs";
      bannerEl.innerHTML = `
        <div class="flex items-center gap-2">
          <i data-lucide="folder-check" class="w-4 h-4 flex-shrink-0"></i>
          <div>
            <span class="font-bold">${t("app.volumes.customFolder")}</span>
            <span class="font-mono ml-1 text-white">${escapeHtml(env.storage_path)}</span>
          </div>
        </div>
        <button onclick="copyVolPath('${escapeHtml(env.storage_path)}')" class="px-2.5 py-1 bg-[#668fb3]/20 hover:bg-[#668fb3]/30 text-white rounded text-[11px] font-semibold flex items-center gap-1 transition">
          <i data-lucide="copy" class="w-3 h-3"></i> ${t("app.volumes.copyBase")}
        </button>
      `;
      const isWindows = /^[a-zA-Z]:[/\\]/.test(env.storage_path) || env.storage_path.startsWith("\\\\");
      if (isWindows) {
        const winPath = env.storage_path.replace(/\//g, "\\");
        currentModalCliCmd = `dir "${winPath}"`;
      } else {
        currentModalCliCmd = `ls -la "${env.storage_path}"`;
      }
    } else {
      bannerEl.className = "p-3.5 rounded-xl border bg-slate-950 border-slate-800 text-slate-300 flex items-center justify-between text-xs";
      bannerEl.innerHTML = `
        <div class="flex items-center gap-2">
          <i data-lucide="hard-drive" class="w-4 h-4 flex-shrink-0 text-slate-400"></i>
          <div>
            <span class="font-bold text-white">${t("app.volumes.dockerStorage")}</span>
            <span class="text-slate-400 ml-1">${t("app.volumes.dockerStorageText")}</span>
          </div>
        </div>
        <span class="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">Docker Managed</span>
      `;
      currentModalCliCmd = `docker volume inspect flex-${envId}_pgdata`;
    }

    cmdEl.innerText = currentModalCliCmd;

    listEl.innerHTML = "";
    if (vols.length === 0) {
      listEl.innerHTML = `<p class="text-slate-500 py-2">${t("app.volumes.noneForEnv")}</p>`;
    } else {
      vols.forEach(v => {
        const row = document.createElement("div");
        row.className = "p-3 bg-slate-950/80 rounded-xl border border-slate-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:border-slate-700 transition";
        row.innerHTML = `
          <div class="space-y-0.5 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-semibold text-white">${escapeHtml(v.component)}</span>
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded ${v.is_custom ? 'bg-[#668fb3]/15 text-[#668fb3] border border-[#668fb3]/30' : 'bg-slate-800 text-slate-400'}">
                ${escapeHtml(v.volume_name)}
              </span>
            </div>
            <div class="flex items-center gap-1.5 text-slate-400 font-mono text-[11px] truncate">
              <i data-lucide="corner-down-right" class="w-3 h-3 flex-shrink-0 text-slate-500"></i>
              <span class="truncate ${v.is_custom ? 'text-[#668fb3] font-medium' : 'text-slate-400'}" title="${escapeHtml(v.host_path || t("app.common.notAvailable"))}">
                ${escapeHtml(v.host_path || t("app.volumes.internalPath"))}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-1.5 flex-shrink-0">
            ${v.host_path ? `
              <button onclick="copyVolPath('${escapeHtml(v.host_path)}')" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium rounded-lg flex items-center gap-1 transition" title="${t("app.volumes.copyPath")}">
                <i data-lucide="copy" class="w-3 h-3"></i> ${t("app.common.copy")}
              </button>
            ` : ''}
          </div>
        `;
        listEl.appendChild(row);
      });
    }

    lucide.createIcons();
  } catch (err) {
    listEl.innerHTML = `<p class="text-rose-400 py-2">${escapeHtml(t("app.volumes.loadError", { error: err.message }))}</p>`;
  }
}

function copyVolPath(path) {
  if (!path) return;
  navigator.clipboard.writeText(path).then(() => {
    showAlert("success", t("app.volumes.pathCopied", { path }));
  }).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = path;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showAlert("success", t("app.volumes.pathCopied", { path }));
  });
}

function copyVolCliCmd() {
  if (!currentModalCliCmd) return;
  navigator.clipboard.writeText(currentModalCliCmd).then(() => {
    showAlert("success", t("app.volumes.cmdCopied"));
  }).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = currentModalCliCmd;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showAlert("success", t("app.volumes.cmdCopied"));
  });
}

// ------------------------------------------------------------------------------
// Helpers & Utilities
// ------------------------------------------------------------------------------
const DIALOG_BUTTON_STYLES = {
  primary: "bg-[#C2410C] hover:bg-[#9A3412] text-white",
  danger: "bg-rose-600 hover:bg-rose-500 text-white",
  dangerOutline: "border border-rose-500/40 text-rose-300 hover:bg-rose-500/10",
  secondary: "border border-slate-600 text-slate-200 hover:bg-slate-800"
};

/**
 * In-app replacement for confirm()/prompt().
 * `message` and `input.label` are HTML: callers must escape user data.
 * Actions may be gated on the input: gate "match" (equals input.match) or "value" (non-empty).
 * Resolves to {action, value}; action is null when cancelled (button, Esc or backdrop).
 */
function openActionDialog({ title, message, actions, input }) {
  return new Promise(resolve => {
    let dlg = document.getElementById("action-dialog");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "action-dialog";
      dlg.className = "bg-slate-900 border border-slate-700 text-slate-100 rounded-xl shadow-2xl p-0 w-[calc(100%-2rem)] max-w-lg";
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = `
      <form method="dialog" class="p-6 space-y-4">
        <h2 class="text-base font-semibold text-white">${escapeHtml(title)}</h2>
        <div class="text-sm text-slate-300 space-y-2">${message}</div>
        ${input ? `
          <div>
            <label for="action-dialog-input" class="block text-xs text-slate-400 mb-1.5">${input.label}</label>
            <input id="action-dialog-input" type="text" autocomplete="off" spellcheck="false" value="${escapeHtml(input.value || "")}"
              class="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500">
          </div>` : ""}
        <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <button value="" class="whitespace-nowrap px-3.5 py-2 rounded-md text-sm font-medium text-slate-300 border border-slate-700 hover:bg-slate-800">${t("app.common.cancel")}</button>
          ${actions.map(a => `
            <button value="${a.id}" data-gate="${a.gate || ""}"
              class="whitespace-nowrap px-3.5 py-2 rounded-md text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${DIALOG_BUTTON_STYLES[a.style] || DIALOG_BUTTON_STYLES.primary}">${escapeHtml(a.label)}</button>`).join("")}
        </div>
      </form>`;

    const field = dlg.querySelector("#action-dialog-input");
    const syncGates = () => {
      const val = field ? field.value.trim() : "";
      dlg.querySelectorAll("[data-gate]").forEach(btn => {
        if (btn.dataset.gate === "match") btn.disabled = val !== (input.match || "").trim();
        else if (btn.dataset.gate === "value") btn.disabled = !val;
      });
    };
    if (field) {
      field.addEventListener("input", syncGates);
      // Enter would submit the first button (Cancelar); route it to the default action instead
      field.addEventListener("keydown", ev => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        const def = actions.find(a => a.default);
        const btn = def && dlg.querySelector(`button[value="${def.id}"]`);
        if (btn && !btn.disabled) btn.click();
      });
    }
    syncGates();

    // Backdrop click cancels
    dlg.onclick = ev => { if (ev.target === dlg) dlg.close(""); };
    dlg.addEventListener("close", () => {
      resolve({ action: dlg.returnValue || null, value: field ? field.value.trim() : "" });
    }, { once: true });

    dlg.returnValue = "";
    dlg.showModal();
    if (field) { field.focus(); field.select(); }
    else dlg.querySelector('button[value=""]').focus();  // safe default for destructive prompts
  });
}

function closeModal(dialogId) {
  const modal = document.getElementById(dialogId);
  if (modal) modal.close();
}

function showAlert(type, message) {
  const banner = document.getElementById("alert-banner");
  const text = document.getElementById("alert-text");
  const icon = document.getElementById("alert-icon");
  if (!banner || !text) return;

  text.innerText = message;
  banner.className = "p-4 rounded-xl border flex items-center justify-between text-sm transition-all duration-300 ";

  if (type === "success") {
    banner.classList.add("bg-emerald-500/10", "border-emerald-500/20", "text-emerald-300");
  } else if (type === "error") {
    banner.classList.add("bg-rose-500/10", "border-rose-500/20", "text-rose-300");
  } else {
    banner.classList.add("bg-sky-500/10", "border-sky-500/20", "text-sky-300");
  }

  banner.classList.remove("hidden");
  lucide.createIcons();

  if (type !== "error") {
    setTimeout(dismissAlert, 6000);
  }
}

function dismissAlert() {
  const banner = document.getElementById("alert-banner");
  if (banner) banner.classList.add("hidden");
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}
