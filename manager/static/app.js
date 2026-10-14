/**
 * Quadient Inspire Flex - Demo & PoC Studio Frontend Logic
 */

let allEnvironments = [];
let currentFilter = "all";
let activeContainerForLogs = null;
let logPollInterval = null;
let verticals = [];             // from /api/config
let useCaseCatalog = [];        // from /api/config: bundled use cases (use-cases/cases/*/case.json)
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

async function initApp() {
  lucide.createIcons();
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
  ["catalog", "services", "acr", "storage", "settings"].forEach(t => {
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
    loadSnapshots();
  } else if (tabId === "services") {
    populateServicesSelect();
    renderServicesView();
  }

  lucide.createIcons();
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
      showAlert("success", "Credenciales configuradas exitosamente.");
      await checkConfigAndOnboarding();
      loadEnvironments();
    } else {
      showAlert("error", result.message || "Error al guardar");
    }
  } catch (err) {
    showAlert("error", "Error de red: " + err.message);
  }
}

async function testOnboardingConnection() {
  const reg = document.getElementById("ob-registry").value.trim();
  const user = document.getElementById("ob-username").value.trim();
  const pwd = document.getElementById("ob-password").value.trim();
  if (!user || !pwd) {
    showAlert("error", "Ingresa usuario y contraseña para probar.");
    return;
  }
  showAlert("info", "Validando credenciales con Azure Container Registry...");
  try {
    const res = await fetch("/api/config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registry: reg, username: user, password: pwd })
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
  } catch (err) {
    showAlert("error", "Fallo al conectar: " + err.message);
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
    showAlert("error", "Error de red: " + err.message);
  }
}

function renderFirebaseStatus(fb) {
  const el = document.getElementById("firebase-status");
  if (!el) return;
  if (fb && fb.configured) {
    el.textContent = `Configurado: proyecto ${fb.project_id} (${fb.client_email}).`;
  } else {
    const missing = [
      !(fb && fb.service_account) && "cuenta de servicio",
      !(fb && fb.web_config) && "configuración web",
      !(fb && fb.vapid_key) && "VAPID key"
    ].filter(Boolean);
    el.textContent = `Sin configurar (falta: ${missing.join(", ")}). El caso de uso Push Notifications Inbox arrancará, pero no podrá iniciar sesión, guardar mensajes ni enviar notificaciones.`;
  }
}

// ------------------------------------------------------------------------------
// Use cases (one checkbox per bundled case)
// ------------------------------------------------------------------------------
const USE_CASE_REQUIREMENTS = {
  kafka: "Publica en Kafka: activa también Apache Kafka.",
  firebase: "Requiere tu proyecto de Firebase en Configuración."
};

function renderUseCaseCheckboxes(prefix, selected) {
  const container = document.getElementById(`${prefix}-env-use-cases`);
  if (!container) return;
  if (!useCaseCatalog.length) {
    container.innerHTML = `<p class="text-[11px] text-slate-500">No hay casos de uso disponibles en esta versión del Studio.</p>`;
    return;
  }
  container.innerHTML = useCaseCatalog.map(c => {
    const id = `${prefix}-env-uc-${c.id}`;
    const reqs = (c.requires || []).map(r => USE_CASE_REQUIREMENTS[r]).filter(Boolean).join(" ");
    return `
      <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-3 flex items-start gap-3 hover:border-slate-700 transition">
        <input type="checkbox" id="${id}" data-use-case="${escapeHtml(c.id)}" data-requires="${escapeHtml((c.requires || []).join(","))}"
          ${selected.includes(c.id) ? "checked" : ""} onchange="handleUseCaseToggle('${prefix}', this)"
          class="mt-1 w-4 h-4 rounded border-slate-700 text-brand-600 bg-slate-950 focus:ring-brand-500 cursor-pointer">
        <label for="${id}" class="cursor-pointer">
          <span class="block text-xs font-semibold text-white">${escapeHtml(c.name)} <code class="text-[10px] text-slate-500 font-normal">/${escapeHtml(c.id)}/</code></span>
          <span class="block text-[11px] text-slate-400 mt-0.5 leading-snug">${escapeHtml(c.description)}${reqs ? ` <span class="text-slate-500">${escapeHtml(reqs)}</span>` : ""}</span>
        </label>
      </div>`;
  }).join("");
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
    showAlert("error", "Error de red: " + err.message);
  }
}

async function testAcrConnection() {
  const reg = document.getElementById("setting-registry").value.trim();
  const user = document.getElementById("setting-username").value.trim();
  const pwd = document.getElementById("setting-password").value.trim();
  showAlert("info", "Probando autenticación con Azure Container Registry...");
  try {
    const res = await fetch("/api/config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registry: reg, username: user, password: pwd })
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
  } catch (err) {
    showAlert("error", "Error: " + err.message);
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
    const snapshot = JSON.stringify(allEnvironments.map(e => [e.id, e.name, e.status, e.version, e.description, e.vertical_id, e.demo_mode, e.storage_path, e.ports, e.enable_interactive, e.enable_scaler]));
    if (snapshot !== lastEnvSnapshot) {
      lastEnvSnapshot = snapshot;
      renderFilterPills();
      renderEnvironments();
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
  const items = [{ id: "all", name: "Todos" }, ...verticals.filter(v => counts[v.id] || v.id === currentFilter)];
  box.innerHTML = items.map(v => {
    const active = v.id === currentFilter;
    const count = v.id === "all" ? allEnvironments.length : (counts[v.id] || 0);
    return `
      <button type="button" onclick="filterVertical('${v.id}')" aria-pressed="${active}"
        class="vertical-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition whitespace-nowrap ${active ? "bg-slate-700 text-white border-slate-600" : "text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800"}">
        ${v.id !== "all" ? `<i data-lucide="${verticalIcon(v.id)}" class="w-3.5 h-3.5 opacity-80"></i>` : ""}
        ${escapeHtml(v.name)}
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

function statusBadge(env, busy) {
  if (busy) {
    return `<span class="inline-flex items-center gap-1.5 text-xs font-medium text-amber-300 whitespace-nowrap">
      <i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i>${busy.kind === "stop" ? "Deteniendo" : "Activando"}</span>`;
  }
  if (env.status === "running") {
    return `<span class="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300 whitespace-nowrap">
      <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Activa</span>`;
  }
  if (env.status === "partial") {
    return `<span class="inline-flex items-center gap-1.5 text-xs font-medium text-amber-300 whitespace-nowrap" title="Algunos servicios no están en ejecución. Revisa la pestaña Servicios y logs.">
      <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>Parcial</span>`;
  }
  return `<span class="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 whitespace-nowrap">
    <span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span>Detenida</span>`;
}

function progressBlock(envId, busy) {
  if (busy.kind === "stop") {
    return `<div id="progress-${envId}" class="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">Deteniendo contenedores…</div>`;
  }
  const total = busy.total || 1;
  const pct = Math.round(((busy.step || 0) / total) * 100);
  return `
    <div id="progress-${envId}" class="rounded-md border border-slate-800 bg-slate-950/60 p-3" role="status" aria-live="polite">
      <div class="flex items-center justify-between gap-2 text-xs text-slate-300">
        <span data-role="label">${escapeHtml(busy.label || "Preparando activación")}</span>
        <span data-role="step" class="font-mono text-slate-500 whitespace-nowrap">${busy.step || 0}/${total}</span>
      </div>
      <div class="mt-2 h-1 rounded-full bg-slate-800 overflow-hidden">
        <div data-role="bar" class="h-full bg-brand-600 transition-all duration-500" style="width:${pct}%"></div>
      </div>
      <p class="mt-2 text-[11px] text-slate-500">La primera activación puede tardar varios minutos.</p>
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

// Quadient product pictograms (manager/static/img/products), black for light banners, white for dark surfaces
function productIcon(product, color, sizeClass = "w-4 h-4") {
  return `<img src="/static/img/products/${product}-${color}.png" alt="" aria-hidden="true" class="${sizeClass} flex-shrink-0 object-contain">`;
}

function serviceLink(label, url, port, enabled, product) {
  const base = "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition";
  const icon = product ? productIcon(product, "white", `w-4 h-4${enabled ? "" : " opacity-40"}`) : `<i data-lucide="external-link" class="w-3.5 h-3.5"></i>`;
  if (!enabled) {
    return `<span class="${base} border-slate-800 text-slate-500" aria-disabled="true" title="Disponible cuando la demo esté activa">
      <span class="inline-flex items-center gap-2 font-medium">${icon}${label}</span>
      <span class="font-mono text-xs">:${port}</span></span>`;
  }
  return `<a href="${url}" target="_blank" rel="noopener" class="${base} border-slate-700 text-slate-100 hover:bg-slate-800 hover:border-slate-600" title="Abrir ${label} en una pestaña nueva">
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
        <h3 class="text-base font-semibold text-white mb-1">Aún no hay ambientes creados</h3>
        <p class="text-sm text-slate-400 max-w-sm mx-auto mb-4">Configura tus credenciales y crea tu primer sandbox para comenzar.</p>
        <button type="button" onclick="openNewEnvModal()" class="px-4 py-2 bg-[#C2410C] hover:bg-[#9A3412] text-white rounded-md text-sm font-medium inline-flex items-center gap-2 transition">
          <i data-lucide="plus" class="w-4 h-4"></i> Crear primer ambiente
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
        <p class="text-sm">No hay demostraciones en esta categoría.</p>
        <button type="button" onclick="openNewEnvModal()" class="mt-3 text-sm text-brand-400 hover:underline">Crear nueva demostración</button>
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
    const storageLabel = customStorage ? env.storage_path : "Volúmenes gestionados por Docker";

    let primaryAction;
    if (busy) {
      primaryAction = `<button type="button" disabled class="px-3 py-1.5 rounded-md text-sm font-medium inline-flex items-center gap-1.5 bg-slate-800 text-slate-400 cursor-wait">
        <i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i>${busy.kind === "stop" ? "Deteniendo…" : "Activando…"}</button>`;
    } else if (isRunning) {
      primaryAction = `<button type="button" onclick="stopDemo('${env.id}')" class="px-3 py-1.5 rounded-md text-sm font-medium inline-flex items-center gap-1.5 border border-slate-700 text-slate-200 hover:bg-slate-800 transition">
        <i data-lucide="square" class="w-3.5 h-3.5"></i>Detener</button>`;
    } else {
      primaryAction = `<button type="button" onclick="activateDemo('${env.id}', true)" class="px-3.5 py-1.5 rounded-md text-sm font-medium inline-flex items-center gap-1.5 bg-[#C2410C] hover:bg-[#9A3412] text-white transition">
        <i data-lucide="play" class="w-3.5 h-3.5"></i>Activar</button>`;
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
                <i data-lucide="${verticalIcon(env.vertical_id)}" class="w-3.5 h-3.5"></i>${escapeHtml(env.vertical || "General")}
              </span>
              <span class="text-slate-600" aria-hidden="true">·</span>
              <span class="font-mono whitespace-nowrap">v${escapeHtml(env.version || "17.5")}</span>
              ${env.demo_mode ? `<span class="text-slate-600" aria-hidden="true">·</span><span class="whitespace-nowrap" title="Demo Mode activo con usuarios y avatares de ejemplo">Demo Mode</span>` : ""}
            </div>
            <h3 class="mt-1.5 text-base font-semibold text-white line-clamp-2 break-words" title="${escapeHtml(env.name)}">${escapeHtml(env.name)}</h3>
          </div>
          ${statusBadge(env, busy)}
        </div>

        <p class="text-sm text-slate-400 line-clamp-2">${escapeHtml(env.description || "Sin notas de presentación.")}</p>

        ${busy ? progressBlock(env.id, busy) : ""}

        ${links.length ? `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${links.join("")}</div>` : ""}

        <button type="button" onclick="openVolumeLocationModal('${env.id}')" title="${escapeHtml(storageLabel)}" aria-label="Ver ubicación de los volúmenes: ${escapeHtml(storageLabel)}"
          class="w-full inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition min-w-0">
          <i data-lucide="${customStorage ? "folder" : "database"}" class="w-3.5 h-3.5 shrink-0"></i>
          <span class="truncate ${customStorage ? "font-mono" : ""}">${escapeHtml(storageLabel)}</span>
          <i data-lucide="chevron-right" class="w-3 h-3 shrink-0 opacity-60"></i>
        </button>
      </div>

      <div class="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
        ${primaryAction}
        <div class="flex items-center gap-0.5">
          ${iconButton("settings-2", "Configurar servicios", `openEditEnvModal('${env.id}')`, { disabled: !!busy })}
          ${iconButton("server", "Ver servicios y logs", `viewEnvServices('${env.id}')`)}
          ${iconButton("camera", "Crear snapshot", `createSnapshotForEnv('${env.id}')`, { disabled: !!busy })}
          <span class="w-px h-4 bg-slate-800 mx-1" aria-hidden="true"></span>
          ${iconButton("trash-2", "Eliminar ambiente", `deleteEnvironment('${env.id}')`, { danger: true, disabled: !!busy })}
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
  busyEnvs.set(envId, { kind: "activate", label: "Preparando activación", step: 0, total: 1 });
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
    showAlert("error", "Error al activar: " + err.message);
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
    showAlert(data.success ? "success" : "error", data.success ? `Ambiente '${envName(envId)}' detenido.` : data.message);
  } catch (err) {
    showAlert("error", "Error: " + err.message);
  } finally {
    busyEnvs.delete(envId);
    lastEnvSnapshot = "";
    await loadEnvironments();
  }
}

async function deleteEnvironment(envId) {
  const name = envName(envId);
  const { action } = await openActionDialog({
    title: "Eliminar ambiente",
    message: `
      <p>Se detendrán y eliminarán los contenedores de <strong class="text-white">${escapeHtml(name)}</strong>.</p>
      <p class="text-slate-400">Puedes conservar los datos (bases de datos, paquetes ICM y archivos) para recrearlo después, o borrarlos definitivamente.</p>`,
    input: {
      label: `Para borrar también los datos, escribe <strong class="text-slate-200">${escapeHtml(name)}</strong>`,
      match: name
    },
    actions: [
      { id: "keep", label: "Eliminar y conservar datos", style: "dangerOutline" },
      { id: "all", label: "Eliminar todo", style: "danger", gate: "match" }
    ]
  });
  if (!action) return;
  const removeVols = action === "all";

  showAlert("info", `Eliminando ambiente '${name}'...`);
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
    showAlert("error", "Error al eliminar: " + err.message);
  }
}

async function deleteSelectedEnvironment() {
  const select = document.getElementById("service-env-select");
  if (!select || !select.value) {
    showAlert("error", "No hay ningún ambiente seleccionado.");
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
  const chkFtp = document.getElementById("new-env-enable-ftp");
  if (chkFtp) chkFtp.checked = false;
  toggleScalerSharedFolder();
  toggleNewEnvInteractiveGroup();
  modal.showModal();
  lucide.createIcons();
}

function handleVerticalChange() {
  const select = document.getElementById("new-env-vertical");
  const opt = select.options[select.selectedIndex];
  const nameInput = document.getElementById("new-env-name");
  if (!nameInput.value || nameInput.value.startsWith("Demo ")) {
    nameInput.value = `Demo ${opt.getAttribute("data-name")} - `;
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
    enable_ftp: enableFtp
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
      showAlert("success", "Ambiente creado exitosamente");
      await loadEnvironments();
    } else {
      showAlert("error", data.message);
    }
  } catch (err) {
    showAlert("error", "Error: " + err.message);
  }
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
    showAlert("error", "Ambiente no encontrado.");
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

  renderUseCaseCheckboxes("edit", env.use_cases || []);

  const chkFtp = document.getElementById("edit-env-enable-ftp");
  if (chkFtp) chkFtp.checked = Boolean(env.enable_ftp);

  const chkDemo = document.getElementById("edit-env-demo-mode");
  if (chkDemo) chkDemo.checked = Boolean(env.demo_mode);

  toggleEditScalerGroup();
  toggleEditInteractiveGroup();
  document.getElementById("edit-env-modal").showModal();
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
    demo_mode: demoMode
  };

  // Close the modal window immediately upon clicking save
  closeModal("edit-env-modal");

  showAlert("info", `Actualizando stacks y servicios en '${name}'...`);
  try {
    const res = await fetch(`/api/environments/${envId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showAlert("success", data.message || "Ambiente actualizado correctamente");
      await loadEnvironments();
      renderServicesView();
    } else {
      showAlert("error", data.message);
    }
  } catch (err) {
    showAlert("error", "Error: " + err.message);
  }
}

function editSelectedEnvironment() {
  const select = document.getElementById("service-env-select");
  if (!select || !select.value) {
    showAlert("error", "No hay ningún ambiente seleccionado.");
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
    opt.innerText = `${e.name} (${e.status.toUpperCase()})`;
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

  if (s.includes("interactive") && !s.includes("ips") && !s.includes("prepare")) {
    const port = extractHostPort(c.ports, 30701) || ports.interactive || 30701;
    portText = `${port}`;
    accessUrl = `http://${host}:${port}/interactive`;
    urlLabel = "Abrir Inspire Interactive";
  } else if (s.includes("scaler") && !s.includes("ips") && !s.includes("prepare")) {
    const port = extractHostPort(c.ports, 30600) || ports.scaler || 30600;
    portText = `${port}`;
    accessUrl = `http://${host}:${port}/`;
    urlLabel = "Abrir Inspire Scaler";
  } else if (s.includes("icm")) {
    const port = extractHostPort(c.ports, 30353) || ports.icm || 30353;
    portText = `${port} (Inspire ICM)`;
  } else if (s.includes("postgres")) {
    const port = extractHostPort(c.ports, 5432) || ports.postgres || 5432;
    portText = `${port} (PostgreSQL)`;
  } else if (s === "ips" || (s.endsWith("-ips") && !s.includes("interactive"))) {
    const port = extractHostPort(c.ports, 30354) || ports.scaler_ips || 30354;
    portText = `${port} (IPS Scaler)`;
  } else if (s.includes("interactive-ips")) {
    portText = `30354 (IPS Interactive)`;
  } else if (s.includes("prepare")) {
    portText = `One-Shot (Prep BD)`;
  } else if (s.includes("use-cases")) {
    const port = extractHostPort(c.ports, 3000) || ports.use_cases || 3000;
    portText = `${port}`;
    accessUrl = `http://${host}:${port}/`;
    urlLabel = "Abrir portal de casos de uso";
  } else if (s.includes("kafka")) {
    const port = extractHostPort(c.ports, 29092) || extractHostPort(c.ports, 9092) || ports.kafka || 9092;
    portText = `${port} (KRaft Broker)`;
  } else if (s.includes("ftp")) {
    const port = extractHostPort(c.ports, 21) || ports.ftp || 2121;
    portText = `${port} (system:Password12345*)`;
  } else {
    const genericMatch = c.ports ? c.ports.match(/:(\d+)->/) : null;
    portText = genericMatch ? genericMatch[1] : (c.ports || "N/A");
  }

  return { portText, accessUrl, urlLabel };
}

function renderNodeBox({ title, container, defaultPort, internalPort, type, env, compact = false }) {
  const isUp = container && container.state === "running";
  const isHealthy = container && container.status && container.status.includes("healthy");
  const host = window.location.hostname || "localhost";
  const portInfo = container ? getServicePortInfo(container, env) : {
    portText: `${defaultPort}${internalPort ? ` -> ${internalPort}` : ''}`,
    accessUrl: type === "interactive" ? `http://${host}:${defaultPort}/interactive` : ((type === "scaler" || type === "use-cases") ? `http://${host}:${defaultPort}/` : null),
    urlLabel: type === "interactive" ? "Abrir Inspire Interactive" : (type === "scaler" ? "Abrir Inspire Scaler" : (type === "use-cases" ? "Abrir portal de casos de uso" : ""))
  };

  return `
    <div class="node-box rounded-xl p-4 flex flex-col justify-between space-y-3 shadow-md">
      <div class="space-y-2">
        <!-- Node Title & State -->
        <div class="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full ${isUp ? 'bg-emerald-400' : 'bg-slate-500'}"></span>
            <h4 class="text-xs font-mono font-bold text-white tracking-wide truncate" title="${escapeHtml(title)}">
              ${escapeHtml(title)}
            </h4>
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
                detenido
              </span>
            `}
          </div>
        </div>

        <!-- Container name & Port Info -->
        <div class="grid grid-cols-1 ${compact ? "" : "sm:grid-cols-2"} gap-2 text-[11px] pt-1">
          <div class="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 flex items-center justify-between">
            <span class="text-slate-400 font-medium">Puerto:</span>
            <span class="font-mono font-semibold ${isUp ? 'text-brand-300' : 'text-slate-400'}">
              ${escapeHtml(portInfo.portText)}
            </span>
          </div>
          <div class="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 flex items-center justify-between truncate" title="${escapeHtml(container ? container.name : 'No iniciado')}">
            <span class="text-slate-400 font-medium mr-1 flex-shrink-0">ID:</span>
            <span class="font-mono text-[10px] text-slate-300 truncate">
              ${escapeHtml(container ? container.name : '--')}
            </span>
          </div>
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
              <span class="text-[10px] uppercase font-bold text-white ${type === 'studio' ? 'bg-indigo-600' : 'bg-[#C2410C]'} px-2 py-0.5 rounded shadow-sm flex-shrink-0 ml-1.5">Abrir</span>
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
            <button onclick="containerAction('${escapeHtml(container.name)}', 'restart')" class="p-1.5 hover:text-white text-slate-400 rounded-md hover:bg-slate-800 transition" title="Reiniciar Servicio">
              <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
            </button>
            ${isUp ? `
              <button onclick="containerAction('${escapeHtml(container.name)}', 'stop')" class="p-1.5 hover:text-rose-400 text-slate-400 rounded-md hover:bg-slate-800 transition" title="Detener Servicio">
                <i data-lucide="square" class="w-3.5 h-3.5"></i>
              </button>
            ` : `
              <button onclick="containerAction('${escapeHtml(container.name)}', 'start')" class="p-1.5 hover:text-emerald-400 text-slate-400 rounded-md hover:bg-slate-800 transition" title="Iniciar Servicio">
                <i data-lucide="play" class="w-3.5 h-3.5"></i>
              </button>
            `}
          </div>
        ` : `
          <span class="text-[11px] text-slate-500 italic">Contenedor no iniciado</span>
          <button onclick="startSelectedEnvironment()" class="text-xs text-emerald-400 hover:underline flex items-center gap-1">
            <i data-lucide="play" class="w-3 h-3"></i> Iniciar
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
        <p class="text-sm">Aún no hay ambientes creados.</p>
        <button onclick="switchTab('catalog'); openNewEnvModal();" class="mt-2 text-xs text-brand-400 hover:underline">+ Crear primer ambiente</button>
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
        <p class="text-sm">Ambiente no seleccionado.</p>
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
    <div class="group-box flex flex-col rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl">
      <!-- Header Banner (Mint Green as in groups.png) -->
      <div class="bg-[#8FB8A0] text-slate-950 font-black tracking-widest text-center py-2.5 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm flex items-center justify-center gap-2">
        ${productIcon("interactive", "black", "w-5 h-5")}
        <span>INTERACTIVE</span>
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
          env: env
        })}
      </div>
    </div>
  `;

  // Helper to render Scaler Group
  const renderScalerGroup = () => `
    <div class="group-box hub-box flex flex-col rounded-2xl border-2 border-[#C99A62] overflow-hidden bg-slate-900/90" data-flow-target>
      <!-- Header Banner: Scaler is the communications hub every integration feeds -->
      <div class="bg-[#C99A62] text-slate-950 font-black tracking-widest text-center py-2.5 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm flex items-center justify-center gap-2 flex-wrap">
        ${productIcon("scaler", "black", "w-5 h-5")}
        <span>SCALER · HUB DE COMUNICACIONES</span>
        ${(env.scaler_sharedfolder || env.volume_locations?.sharedfolder) ? `
          <span class="text-[10px] font-mono font-bold bg-slate-950 text-amber-300 px-2 py-0.5 rounded-full border border-slate-800 lowercase tracking-normal flex items-center gap-1 shadow-inner" title="Volumen: ${escapeHtml(env.volume_locations?.sharedfolder || env.scaler_sharedfolder)}">
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
        <span><span class="font-bold text-amber-200 uppercase tracking-wider">Torre de control.</span> Recibe eventos, archivos y solicitudes de los sistemas del cliente, orquesta la generación con Inspire y entrega cada comunicación por su canal.</span>
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
          env: env
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
            <h3 class="text-sm font-bold text-white tracking-wide uppercase">Topología del Ambiente: <span class="text-brand-400 font-mono">${escapeHtml(env.name)}</span></h3>
            <p class="text-[11px] text-slate-400">Estructura modular Quadient Inspire Flex</p>
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
              <span class="font-bold text-slate-200">CASOS DE USO</span>
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
            <span class="font-bold text-white block">Inicializando Esquemas de Base de Datos (Prepare)</span>
            <span class="text-slate-400">scaler-prepare y/o interactive-prepare están ejecutando configuraciones one-shot iniciales.</span>
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
            <span class="font-bold text-white block">Fallo en la Preparación de Base de Datos (Prepare)</span>
            <span class="text-slate-400">Uno de los contenedores one-shot finalizó con error. Revisa los logs para diagnosticar.</span>
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
  const tierFrame = ({ title, icon, subtitle, body, extraAttrs = "" }) => `
    <section class="tier-frame rounded-2xl border border-slate-700/80 bg-slate-950/40 p-4 sm:p-5 space-y-4 h-full flex flex-col" ${extraAttrs}>
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

  const serviceGroup = ({ key, color, icon, title, body, flow, arrow, bidir }) => `
    <div class="group-box flex flex-col h-full rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl" data-flow-source="${key}" ${bidir ? "data-flow-bidir" : ""}>
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

  // ── TOP: USE CASES — the case names are the protagonists ──
  const useCasesUp = useCasesContainer && useCasesContainer.state === "running";
  const useCasesBaseUrl = `http://${window.location.hostname || "localhost"}:${env.ports?.use_cases || 3000}`;
  const useCasesSection = hasUseCases ? `
    <div class="group-box flex flex-col rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl" data-flow-source="use-cases" data-flow-bidir>
      <div class="bg-[#A35F78] text-white font-black tracking-widest text-center py-2.5 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm flex items-center justify-center gap-2">
        ${productIcon("use-cases", "white", "w-5 h-5")}
        <span>CASOS DE USO</span>
      </div>

      <div class="p-4 sm:p-5 bg-slate-900/60 space-y-4">
        <div class="grid grid-cols-1 ${envUseCases.length >= 3 ? "md:grid-cols-3" : envUseCases.length === 2 ? "md:grid-cols-2" : ""} gap-4">
          ${envUseCases.length ? envUseCases.map(c => `
            <a href="${escapeHtml(`${useCasesBaseUrl}/${c.id}/`)}" target="_blank" rel="noopener noreferrer"
               class="use-case-tile group rounded-xl border-2 p-4 sm:p-5 flex items-start gap-4 transition ${useCasesUp ? "border-[#A35F78]/60 bg-slate-950/80 hover:border-[#A35F78] hover:bg-slate-950" : "border-slate-800 bg-slate-900/40 pointer-events-none opacity-60"}">
              <span class="text-3xl sm:text-4xl leading-none" aria-hidden="true">${escapeHtml(c.icon || "📄")}</span>
              <span class="min-w-0 flex-1 space-y-1.5">
                <span class="block text-lg sm:text-xl font-black text-white leading-tight">${escapeHtml(c.name)}</span>
                ${c.description ? `<span class="block text-xs text-slate-400 leading-relaxed">${escapeHtml(c.description)}</span>` : ""}
                <span class="flex items-center gap-2 pt-1 text-[11px] font-mono text-rose-300">
                  /${escapeHtml(c.id)}/
                  <i data-lucide="arrow-up-right" class="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"></i>
                </span>
              </span>
            </a>`).join("") : `
            <p class="text-xs text-slate-500">No hay casos de uso seleccionados. Actívalos en <em>Configurar servicios</em>.</p>`}
        </div>

        <div class="grid grid-cols-1 ${(env.use_cases || []).includes("push-inbox") ? "lg:grid-cols-2" : ""} gap-4 items-start">
          ${renderNodeBox({
            title: "PORTAL DE CASOS DE USO",
            container: useCasesContainer,
            defaultPort: env.ports?.use_cases || 3000,
            internalPort: 3000,
            type: "use-cases",
            env: env
          })}
          ${(env.use_cases || []).includes("push-inbox") ? `
            <div class="bg-slate-950/80 p-3.5 rounded-xl border border-rose-500/30 flex flex-col gap-2 text-xs">
              <span class="text-rose-300 font-semibold flex items-center gap-1.5">
                <i data-lucide="send" class="w-3.5 h-3.5"></i> Endpoint del inbox para Scaler
              </span>
              <div class="font-mono text-[11px] bg-slate-900 p-2 rounded-lg border border-slate-800 text-slate-300 break-all">
                POST http://use-cases:3000/push-inbox/api/inbox/send
              </div>
              <span class="text-[10px] text-slate-500">También responde en <code>http://push-inbox:3000/api/inbox/send</code> para no romper conectores previos. Desde el navegador usa <code>localhost</code>: las notificaciones push solo funcionan en localhost o HTTPS.</span>
            </div>
          ` : ""}
        </div>
      </div>

      ${scalerExchange("Envían solicitudes y eventos a Scaler y reciben los documentos y notificaciones", "arrow-down-up")}
    </div>
  ` : "";

  // ── MIDDLE: BACK-END — Scaler hub + ICM + Postgres ──
  const renderIcmGroup = () => `
    <div class="group-box rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl">
      <div class="bg-[#8b929d] text-slate-950 font-black tracking-widest text-center py-2 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm flex items-center justify-center gap-2">
        ${productIcon("content-manager", "black", "w-5 h-5")}
        <span>ICM</span>
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
    <div class="group-box rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl">
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
          <span>Repositorio y metadatos de licencias</span>
        </div>
      </div>
      ${renderPostgresGroup()}
    </div>
  `;

  const backendSection = tierFrame({
    title: "Back-end",
    icon: "server",
    subtitle: hasScaler ? "Scaler orquesta todas las comunicaciones; ICM y Postgres guardan recursos y configuración" : "Repositorio y base de datos de la plataforma",
    body: hasScaler ? `
      <div class="grid grid-cols-1 lg:grid-cols-[1.35fr,72px,1fr] gap-4 lg:gap-0 items-start">
        ${renderScalerGroup()}
        <div class="hidden lg:flex flex-col items-center justify-start pt-40">
          <svg class="w-16 h-5 text-slate-400" viewBox="0 0 64 20" fill="none">
            <line x1="6" y1="10" x2="58" y2="10" stroke="currentColor" stroke-width="2" />
            <polygon points="6,10 13,6 13,14" fill="currentColor" />
            <polygon points="58,10 51,6 51,14" fill="currentColor" />
          </svg>
          <span class="text-[9px] font-mono text-slate-400 uppercase tracking-tighter text-center mt-1">Recursos<br>ICM</span>
        </div>
        ${platformStack}
      </div>
    ` : `<div class="max-w-2xl mx-auto">${platformStack}</div>`
  });

  // ── BOTTOM: FRONT-END (Interactive) + customer systems (FTP, Kafka) ──
  const frontendSection = hasInteractive ? tierFrame({
    title: "Front-end",
    icon: "monitor",
    subtitle: "Edición de comunicaciones por los usuarios",
    body: `<div data-flow-source="interactive" data-flow-bidir data-flow-style="platform" class="h-full">${renderInteractiveGroup()}</div>`
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
      flow: "Scaler recoge los archivos de entrada y deposita los de salida",
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
              <i data-lucide="key-round" class="w-3.5 h-3.5"></i> Autenticación FTP
            </span>
            <span class="text-[10px] font-mono text-slate-400">PASV: ${env.ports?.ftp_pasv_min || 21100}-${env.ports?.ftp_pasv_max || 21105}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2 font-mono text-[11px] bg-slate-900 p-2 rounded-lg border border-slate-800">
            <span class="text-slate-400">Usuario:</span>
            <span class="text-white font-bold">system</span>
            <span class="text-slate-600">|</span>
            <span class="text-slate-400">Password:</span>
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
      flow: "Scaler consume los tópicos como entrada de eventos en tiempo real",
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
            kafka:9092 <span class="text-slate-500">(contenedores)</span> · localhost:${escapeHtml(String(env.ports?.kafka || 9092))} <span class="text-slate-500">(host)</span>
          </div>
        </div>
      `
    }));
  }

  const integrationsSection = integrationGroups.length ? tierFrame({
    title: "Sistemas del cliente e integraciones",
    icon: "network",
    subtitle: hasScaler ? "" : `<span class="text-amber-300">Activa Scaler para orquestar estas integraciones</span>`,
    body: `<div class="grid grid-cols-1 ${integrationGroups.length > 1 ? "md:grid-cols-2" : ""} gap-4 h-full">${integrationGroups.join("")}</div>`
  }) : "";

  // HUB FLOW: use cases (above) and front-end/integrations (below) all connect to Scaler; drawHubFlow() draws it
  html += `
      <div id="hub-flow" class="relative" data-running="${isRunning}">
        <svg id="hub-flow-svg" class="hidden lg:block absolute inset-0 w-full h-full pointer-events-none overflow-visible" aria-hidden="true"></svg>

        ${useCasesSection}
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
      <div class="pt-6 border-t border-slate-800 space-y-3">
        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
          <i data-lucide="layers" class="w-4 h-4 text-slate-500"></i>
          Otros Servicios Adicionales del Sandbox
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
  requestAnimationFrame(drawHubFlow);
}

// Connectors from every source (use cases above, front-end and integrations below) into the Scaler hub
function drawHubFlow() {
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
  const line = (m, sx, sy, ax, ay) => {
    const my = (sy + ay) / 2;
    const bidir = m.el.hasAttribute("data-flow-bidir");
    const style = m.el.dataset.flowStyle === "platform" ? " is-platform" : "";
    const marker = style ? "hub-arrow-platform" : "hub-arrow";
    return `<path d="M ${sx} ${sy} C ${sx} ${my}, ${ax} ${my}, ${ax} ${ay}" class="hub-flow-line${style}${running ? " is-running" : ""}" marker-end="url(#${marker})"${bidir ? ` marker-start="url(#${marker})"` : ""} />`;
  };

  const paths = [
    ...above.sort((a, b) => a.r.left - b.r.left).map((m, i, list) =>
      line(m, m.r.left + m.r.width / 2 - box.left, m.r.bottom - box.top + 2, spread(list, i), t.top - box.top - 3)),
    ...below.sort((a, b) => a.r.left - b.r.left).map((m, i, list) =>
      line(m, m.r.left + m.r.width / 2 - box.left, m.r.top - box.top - 2, spread(list, i), t.bottom - box.top + 3))
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
  hubFlowResizeTimer = setTimeout(drawHubFlow, 120);
});

async function containerAction(containerName, action) {
  showAlert("info", `Ejecutando ${action} en ${containerName}...`);
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
    showAlert("error", "Error: " + err.message);
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

  // Enhance subtitle with Port and Access URL if available
  const subtitleEl = document.getElementById("logs-container-subtitle");
  if (subtitleEl) {
    const select = document.getElementById("service-env-select");
    const envId = select ? select.value : (allEnvironments[0] ? allEnvironments[0].id : null);
    const env = allEnvironments.find(e => e.id === envId);
    const c = env && env.containers ? env.containers.find(x => x.name === containerName) : null;
    if (c) {
      const portInfo = getServicePortInfo(c, env);
      if (portInfo.accessUrl) {
        subtitleEl.innerHTML = `Puerto: <span class="font-mono text-brand-300 font-semibold">${escapeHtml(portInfo.portText)}</span> • URL: <a href="${portInfo.accessUrl}" target="_blank" rel="noopener noreferrer" class="font-mono text-brand-400 underline hover:text-brand-300 inline-flex items-center gap-1">${escapeHtml(portInfo.accessUrl)} <i data-lucide="external-link" class="w-3 h-3"></i></a>`;
      } else {
        subtitleEl.innerHTML = `Puerto: <span class="font-mono text-slate-300 font-semibold">${escapeHtml(portInfo.portText)}</span> • Registros en tiempo real`;
      }
    } else {
      subtitleEl.innerText = "Últimos registros de ejecución";
    }
  }

  const modal = document.getElementById("logs-modal");
  modal.showModal();
  lucide.createIcons();
  refreshCurrentLogs();

  if (logPollInterval) clearInterval(logPollInterval);
  logPollInterval = setInterval(refreshCurrentLogs, 4000);
}

async function refreshCurrentLogs() {
  if (!activeContainerForLogs) return;
  const viewer = document.getElementById("logs-viewer-content");
  try {
    const res = await fetch(`/api/containers/${activeContainerForLogs}/logs?tail=200`);
    const data = await res.json();
    viewer.innerText = data.logs || "No hay registros disponibles.";
    viewer.scrollTop = viewer.scrollHeight;
  } catch (err) {
    viewer.innerText = "Error al obtener logs: " + err.message;
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
        <button onclick="applyVersionToActiveEnv('${tag}')" class="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded" title="Usar en ambiente activo">
          Asignar
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
    showAlert("error", "Error al consultar Azure: " + err.message);
  }
}

async function applyVersionToActiveEnv(tag) {
  const select = document.getElementById("service-env-select");
  const envId = select ? select.value : "default";
  const { action } = await openActionDialog({
    title: "Cambiar versión",
    message: `<p>¿Asignar la versión <span class="font-mono text-white">${escapeHtml(tag)}</span> al ambiente <strong class="text-white">${escapeHtml(envName(envId))}</strong>?</p>`,
    actions: [{ id: "ok", label: "Asignar versión", style: "primary" }]
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
    showAlert("error", "Error: " + err.message);
  }
}

// ------------------------------------------------------------------------------
// Volumes & Snapshots
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
      container.innerHTML = `<span class="text-slate-500">No se detectaron volúmenes específicos.</span>`;
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
            <button onclick="deleteVolume('${escapeHtml(v.name)}')" class="p-1 text-slate-500 hover:text-rose-400 rounded transition" title="Eliminar volumen de Docker">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>
        ${displayPath ? `
          <div class="flex items-center justify-between gap-1 text-[11px] font-mono bg-black/50 px-2 py-1 rounded border border-slate-800/80">
            <span class="truncate ${v.is_custom ? 'text-[#668fb3]' : 'text-slate-400'}" title="${escapeHtml(displayPath)}">
              ${escapeHtml(displayPath)}
            </span>
            <button onclick="copyVolPath('${escapeHtml(displayPath)}')" class="text-slate-400 hover:text-white flex-shrink-0 ml-1.5" title="Copiar ruta">
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
    title: "Eliminar volumen",
    message: `<p>Se eliminará definitivamente el volumen <span class="font-mono text-white break-all">${escapeHtml(volumeName)}</span>.</p>
      <p class="text-slate-400">Si pertenece a un ambiente, sus datos se perderán.</p>`,
    actions: [{ id: "ok", label: "Eliminar volumen", style: "danger" }]
  });
  if (!action) return;
  showAlert("info", `Eliminando volumen '${volumeName}'...`);
  try {
    const res = await fetch(`/api/volumes/${encodeURIComponent(volumeName)}`, { method: "DELETE" });
    let data;
    try {
      data = await res.json();
    } catch (_) {
      const text = await res.text();
      showAlert("error", `Error del servidor (${res.status}): ${text.substring(0, 120)}`);
      return;
    }
    showAlert(data.success ? "success" : "error", data.message || "Operación procesada");
    loadVolumes();
  } catch (err) {
    showAlert("error", "Error al eliminar volumen: " + err.message);
  }
}

async function openVolumeLocationModal(envId) {
  const env = allEnvironments.find(e => e.id === envId);
  const modal = document.getElementById("volume-locations-modal");
  if (!modal) return;

  document.getElementById("vol-modal-env-name").innerText = env ? env.name : envId;
  document.getElementById("vol-modal-env-subtitle").innerText = `Ambiente ID: ${envId} • Proyecto: ${env?.project_name || 'flex-' + envId}`;

  const bannerEl = document.getElementById("vol-modal-type-banner");
  const listEl = document.getElementById("vol-modal-list");
  const cmdEl = document.getElementById("vol-modal-cli-cmd");

  listEl.innerHTML = `<div class="py-4 text-center text-slate-400"><i data-lucide="loader-2" class="w-5 h-5 animate-spin mx-auto mb-1"></i> Consultando rutas físicas del host...</div>`;
  lucide.createIcons();
  modal.showModal();

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
            <span class="font-bold">Carpeta Personalizada en tu Host:</span>
            <span class="font-mono ml-1 text-white">${escapeHtml(env.storage_path)}</span>
          </div>
        </div>
        <button onclick="copyVolPath('${escapeHtml(env.storage_path)}')" class="px-2.5 py-1 bg-[#668fb3]/20 hover:bg-[#668fb3]/30 text-white rounded text-[11px] font-semibold flex items-center gap-1 transition">
          <i data-lucide="copy" class="w-3 h-3"></i> Copiar Ruta Base
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
            <span class="font-bold text-white">Almacenamiento Estándar de Docker:</span>
            <span class="text-slate-400 ml-1">Los volúmenes están aislados en el directorio raíz de Docker (/var/lib/docker/volumes/)</span>
          </div>
        </div>
        <span class="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">Docker Managed</span>
      `;
      currentModalCliCmd = `docker volume inspect flex-${envId}_pgdata`;
    }

    cmdEl.innerText = currentModalCliCmd;

    listEl.innerHTML = "";
    if (vols.length === 0) {
      listEl.innerHTML = `<p class="text-slate-500 py-2">No se encontraron volúmenes asociados a este ambiente.</p>`;
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
              <span class="truncate ${v.is_custom ? 'text-[#668fb3] font-medium' : 'text-slate-400'}" title="${escapeHtml(v.host_path || 'No disponible')}">
                ${escapeHtml(v.host_path || 'Ruta interna de Docker')}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-1.5 flex-shrink-0">
            ${v.host_path ? `
              <button onclick="copyVolPath('${escapeHtml(v.host_path)}')" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium rounded-lg flex items-center gap-1 transition" title="Copiar ruta">
                <i data-lucide="copy" class="w-3 h-3"></i> Copiar
              </button>
            ` : ''}
          </div>
        `;
        listEl.appendChild(row);
      });
    }

    lucide.createIcons();
  } catch (err) {
    listEl.innerHTML = `<p class="text-rose-400 py-2">Error al consultar volúmenes: ${escapeHtml(err.message)}</p>`;
  }
}

function copyVolPath(path) {
  if (!path) return;
  navigator.clipboard.writeText(path).then(() => {
    showAlert("success", `Ruta copiada al portapapeles: ${path}`);
  }).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = path;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showAlert("success", `Ruta copiada al portapapeles: ${path}`);
  });
}

function copyVolCliCmd() {
  if (!currentModalCliCmd) return;
  navigator.clipboard.writeText(currentModalCliCmd).then(() => {
    showAlert("success", "Comando de terminal copiado.");
  }).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = currentModalCliCmd;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showAlert("success", "Comando de terminal copiado.");
  });
}

async function loadSnapshots() {
  const tbody = document.getElementById("snapshots-tbody");
  if (!tbody) return;
  try {
    const res = await fetch("/api/environments/default/snapshots");
    const data = await res.json();
    tbody.innerHTML = "";
    const snaps = data.snapshots || [];
    if (snaps.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="py-6 text-center text-slate-500">No hay snapshots generados todavía.</td>
        </tr>
      `;
      return;
    }
    snaps.forEach(s => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="py-2.5 px-3 font-semibold text-white">${escapeHtml(s.name)}</td>
        <td class="py-2.5 px-3 text-slate-400 font-mono">${escapeHtml(s.env_id)}</td>
        <td class="py-2.5 px-3 text-slate-400">${new Date(s.created_at).toLocaleString()}</td>
        <td class="py-2.5 px-3 font-mono text-slate-300">${escapeHtml(s.size_human)}</td>
        <td class="py-2.5 px-3 text-right">
          <button onclick="deleteSnapshot('${s.filename}')" class="p-1 hover:text-rose-400 text-slate-500 rounded" title="Eliminar">
            <i data-lucide="trash" class="w-3.5 h-3.5"></i>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
    lucide.createIcons();
  } catch (err) {
    console.error("Error al cargar snapshots:", err);
  }
}

function promptCreateSnapshot() {
  const select = document.getElementById("service-env-select");
  const envId = select ? select.value : "default";
  createSnapshotForEnv(envId);
}

async function createSnapshotForEnv(envId) {
  const { action, value: name } = await openActionDialog({
    title: "Crear snapshot",
    message: `<p>Se guardará una copia de las bases de datos de <strong class="text-white">${escapeHtml(envName(envId))}</strong>.</p>`,
    input: { label: "Nombre del snapshot", value: `${envId}-listo` },
    actions: [{ id: "ok", label: "Crear snapshot", style: "primary", gate: "value", default: true }]
  });
  if (!action || !name) return;
  showAlert("info", `Generando Snapshot para '${envId}' (dump de bases de datos)...`);
  try {
    const res = await fetch(`/api/environments/${envId}/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name })
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
    loadSnapshots();
  } catch (err) {
    showAlert("error", "Error: " + err.message);
  }
}

async function deleteSnapshot(filename) {
  const { action } = await openActionDialog({
    title: "Eliminar snapshot",
    message: `<p>¿Eliminar el snapshot <span class="font-mono text-white break-all">${escapeHtml(filename)}</span>?</p>`,
    actions: [{ id: "ok", label: "Eliminar snapshot", style: "danger" }]
  });
  if (!action) return;
  try {
    const res = await fetch(`/api/snapshots/${filename}`, { method: "DELETE" });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
    loadSnapshots();
  } catch (err) {
    showAlert("error", "Error: " + err.message);
  }
}

// ------------------------------------------------------------------------------
// Helpers & Utilities
// ------------------------------------------------------------------------------
const DIALOG_BUTTON_STYLES = {
  primary: "bg-[#C2410C] hover:bg-[#9A3412] text-white",
  danger: "bg-rose-600 hover:bg-rose-500 text-white",
  dangerOutline: "border border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
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
          <button value="" class="whitespace-nowrap px-3.5 py-2 rounded-md text-sm font-medium text-slate-300 border border-slate-700 hover:bg-slate-800">Cancelar</button>
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
