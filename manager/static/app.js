/**
 * Quadient Inspire Flex - Demo & PoC Studio Frontend Logic
 */

let allEnvironments = [];
let currentFilter = "all";
let activeContainerForLogs = null;
let logPollInterval = null;

// Initialization
document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

async function initApp() {
  lucide.createIcons();
  await checkConfigAndOnboarding();
  await loadEnvironments();
  loadVolumes();
}

// ------------------------------------------------------------------------------
// Navigation & Tabs
// ------------------------------------------------------------------------------
function switchTab(tabId) {
  const tabs = ["catalog", "services", "acr", "storage", "settings"];
  tabs.forEach(t => {
    const viewEl = document.getElementById(`view-${t}`);
    const btnEl = document.getElementById(`tab-${t}`);
    if (t === tabId) {
      viewEl.classList.remove("hidden");
      btnEl.classList.add("text-slate-200", "bg-slate-800", "shadow-sm");
      btnEl.classList.remove("text-slate-400");
    } else {
      viewEl.classList.add("hidden");
      btnEl.classList.remove("text-slate-200", "bg-slate-800", "shadow-sm");
      btnEl.classList.add("text-slate-400");
    }
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
    document.getElementById("setting-registry").value = creds.registry || "quadientdistribution.azurecr.io";
    document.getElementById("setting-username").value = creds.username || "";
    document.getElementById("setting-lic-server").value = creds.license_server || "";

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
    allEnvironments = data.environments || [];
    document.getElementById("env-count").innerText = allEnvironments.length;
    renderEnvironments();
    populateServicesSelect();
  } catch (err) {
    console.error("Error al cargar ambientes:", err);
  }
}

function filterVertical(catId) {
  currentFilter = catId;
  const pills = document.querySelectorAll(".vertical-pill");
  pills.forEach(p => {
    if (p.getAttribute("onclick").includes(`'${catId}'`)) {
      p.classList.add("active", "bg-brand-600", "text-white", "border-brand-500");
      p.classList.remove("text-slate-400", "border-slate-800");
    } else {
      p.classList.remove("active", "bg-brand-600", "text-white", "border-brand-500");
      p.classList.add("text-slate-400", "border-slate-800");
    }
  });
  renderEnvironments();
}

function renderEnvironments() {
  const container = document.getElementById("environments-grid");
  container.innerHTML = "";

  const filtered = allEnvironments.filter(e => {
    if (currentFilter === "all") return true;
    return (e.vertical_id || "").toLowerCase() === currentFilter.toLowerCase();
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-16 text-center text-slate-500 bg-slate-900/30 rounded-2xl border border-dashed border-slate-800">
        <i data-lucide="folder-search" class="w-10 h-10 mx-auto mb-2 text-slate-600"></i>
        <p class="text-sm">No hay demostraciones registradas en esta categoría.</p>
        <button onclick="openNewEnvModal()" class="mt-3 text-xs text-brand-400 hover:underline">+ Crear nueva demostración</button>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  filtered.forEach(env => {
    const isRunning = env.status === "running" || env.status === "partial";
    const portInter = env.ports ? env.ports.interactive : 30701;
    const portScaler = env.ports ? env.ports.scaler : 30600;

    const card = document.createElement("div");
    card.className = `bg-slate-900/70 border rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 hover:border-slate-700 ${isRunning ? "card-active border-brand-500/50" : "border-slate-800"}`;

    card.innerHTML = `
      <div class="space-y-3">
        <!-- Header: Badge & Status -->
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-800 text-slate-200 border border-slate-700 flex items-center gap-1.5">
              ${getVerticalIcon(env.vertical_id)} ${env.vertical || 'General'}
            </span>
            <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
              v${env.version || '17.5'}
            </span>
            ${env.demo_mode ? `
              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 flex items-center gap-1" title="Demo Mode activo con avatares y usuarios">
                🎭 Demo Mode
              </span>
            ` : ''}
          </div>
          <div>
            ${isRunning ? `
              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span> Activa
              </span>
            ` : `
              <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-400">
                ○ En Pausa
              </span>
            `}
          </div>
        </div>

        <!-- Title & Description -->
        <div>
          <h3 class="text-base font-bold text-white tracking-tight">${escapeHtml(env.name)}</h3>
          <p class="text-xs text-slate-400 line-clamp-2 mt-1">${escapeHtml(env.description || 'Sin notas de presentación.')}</p>
        </div>

        <!-- Quick Access Launch Buttons -->
        <div class="pt-2 border-t border-slate-800/80 flex items-center gap-2">
          <a href="http://${window.location.hostname || 'localhost'}:${portInter}/interactive" target="_blank" class="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold ${isRunning ? 'bg-brand-600/20 text-brand-300 hover:bg-brand-600/30 border border-brand-500/30' : 'bg-slate-800/50 text-slate-500 pointer-events-none'}" title="Abrir Inspire Interactive">
            <i data-lucide="external-link" class="w-3.5 h-3.5"></i> Interactive (:${portInter})
          </a>
          <a href="http://${window.location.hostname || 'localhost'}:${portScaler}/scaler" target="_blank" class="inline-flex items-center justify-center p-1.5 rounded-lg text-xs font-semibold ${isRunning ? 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700' : 'bg-slate-800/50 text-slate-600 pointer-events-none'}" title="Consola Scaler">
            <i data-lucide="activity" class="w-3.5 h-3.5"></i>
          </a>
        </div>
      </div>

      <!-- Footer Actions -->
      <div class="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
        <div>
          ${isRunning ? `
            <button onclick="stopDemo('${env.id}')" class="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition">
              <i data-lucide="square" class="w-3.5 h-3.5"></i> Pausar
            </button>
          ` : `
            <button onclick="activateDemo('${env.id}', true)" class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow transition">
              <i data-lucide="play" class="w-3.5 h-3.5"></i> Activar Demo
            </button>
          `}
        </div>

        <div class="flex items-center gap-1">
          <button onclick="viewEnvServices('${env.id}')" class="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800" title="Ver Servicios">
            <i data-lucide="server" class="w-4 h-4"></i>
          </button>
          <button onclick="createSnapshotForEnv('${env.id}')" class="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800" title="Crear Snapshot de Demo">
            <i data-lucide="camera" class="w-4 h-4"></i>
          </button>
          ${!env.is_default ? `
            <button onclick="deleteEnvironment('${env.id}')" class="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800" title="Eliminar Ambiente">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          ` : ''}
        </div>
      </div>
    `;

    container.appendChild(card);
  });

  lucide.createIcons();
}

function getVerticalIcon(verticalId) {
  switch (verticalId) {
    case 'insurance': return '🛡️';
    case 'financials': return '🏦';
    case 'telco': return '📡';
    case 'healthcare': return '🏥';
    case 'retail': return '🛍️';
    case 'poc': return '💼';
    default: return '📦';
  }
}

// ------------------------------------------------------------------------------
// Demo Activation & Lifecycle
// ------------------------------------------------------------------------------
async function activateDemo(envId, exclusive = true) {
  showAlert("info", `Activando ambiente '${envId}' en modo On-Demand...`);
  try {
    const res = await fetch(`/api/environments/${envId}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exclusive: exclusive })
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
    await loadEnvironments();
  } catch (err) {
    showAlert("error", "Error al activar: " + err.message);
  }
}

async function stopDemo(envId) {
  showAlert("info", `Deteniendo ambiente '${envId}'...`);
  try {
    const res = await fetch(`/api/environments/${envId}/stop`, {
      method: "POST"
    });
    const data = await res.json();
    showAlert(data.success ? "success" : "error", data.message);
    await loadEnvironments();
  } catch (err) {
    showAlert("error", "Error: " + err.message);
  }
}

async function deleteEnvironment(envId) {
  if (envId === "default") {
    showAlert("error", "No se puede eliminar el ambiente base predeterminado.");
    return;
  }
  const env = allEnvironments.find(e => e.id === envId);
  const envName = env ? env.name : envId;

  if (!confirm(`¿Estás seguro de que deseas eliminar por completo el ambiente '${envName}'? Se detendrán y removerán todos sus contenedores.`)) return;
  const removeVols = confirm("¿Deseas también eliminar definitivamente los volúmenes de datos asociados (PostgreSQL e ICM)?\n\nPresiona Aceptar para borrarlos o Cancelar para conservarlos.");
  
  showAlert("info", `Eliminando ambiente '${envName}'...`);
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
function openNewEnvModal() {
  const modal = document.getElementById("new-env-modal");
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

  const demoModeEl = document.getElementById("new-env-demo-mode");
  const demoMode = demoModeEl ? demoModeEl.checked : false;

  const payload = {
    name: name,
    vertical: vertName,
    vertical_id: vertId,
    description: desc,
    version: ver,
    demo_mode: demoMode
  };
  if (port) {
    payload.interactive_port = parseInt(port);
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
  } else if (s.includes("studio")) {
    const port = extractHostPort(c.ports, 8080) || ports.csv_studio || 8080;
    portText = `${port}`;
    accessUrl = `http://${host}:${port}/`;
    urlLabel = "Abrir CSV Studio";
  } else if (s.includes("kafka")) {
    portText = `9092 (KRaft)`;
  } else {
    const genericMatch = c.ports ? c.ports.match(/:(\d+)->/) : null;
    portText = genericMatch ? genericMatch[1] : (c.ports || "N/A");
  }

  return { portText, accessUrl, urlLabel };
}

function renderServicesView() {
  const select = document.getElementById("service-env-select");
  const envId = select ? select.value : (allEnvironments[0] ? allEnvironments[0].id : null);
  const container = document.getElementById("services-grid");
  container.innerHTML = "";

  const env = allEnvironments.find(e => e.id === envId);
  if (!env || !env.containers || env.containers.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-12 text-center text-slate-500 bg-slate-900/30 rounded-2xl border border-dashed border-slate-800">
        <p class="text-sm">No hay contenedores creados o iniciados para este ambiente.</p>
        <button onclick="startSelectedEnvironment()" class="mt-2 text-xs text-brand-400 hover:underline">▶ Iniciar ambiente ahora</button>
      </div>
    `;
    return;
  }

  env.containers.forEach(c => {
    const isUp = c.state === "running";
    const portInfo = getServicePortInfo(c, env);
    const card = document.createElement("div");
    card.className = "bg-slate-900/70 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3 hover:border-slate-700 transition";
    card.innerHTML = `
      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-mono font-bold text-white truncate" title="${escapeHtml(c.service || c.name)}">
            ${escapeHtml(c.service || c.name)}
          </span>
          <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full ${isUp ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'}">
            ${escapeHtml(c.state)}
          </span>
        </div>
        <p class="text-[11px] text-slate-400 truncate" title="${escapeHtml(c.image)}">${escapeHtml(c.image)}</p>
        <p class="text-[10px] text-slate-500">${escapeHtml(c.status || '')}</p>

        <!-- Port Info Badge -->
        <div class="flex items-center justify-between text-xs bg-slate-950/80 px-2.5 py-1.5 rounded-lg border border-slate-800/80">
          <span class="text-slate-400 text-[11px] font-medium flex items-center gap-1.5">
            <i data-lucide="network" class="w-3.5 h-3.5 text-slate-500"></i> Puerto:
          </span>
          <span class="font-mono text-[11px] font-semibold ${isUp ? 'text-brand-300' : 'text-slate-400'}">
            ${escapeHtml(portInfo.portText)}
          </span>
        </div>

        <!-- URL Access for Interactive, Scaler and Web Services -->
        ${portInfo.accessUrl ? `
          <div class="pt-1">
            <a href="${portInfo.accessUrl}" target="_blank" rel="noopener noreferrer" 
               class="inline-flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-xs font-semibold ${isUp ? 'bg-brand-600/20 text-brand-300 hover:bg-brand-600/30 border border-brand-500/30 shadow-sm' : 'bg-slate-800/40 text-slate-500 border border-slate-800 pointer-events-none'} transition group"
               title="${escapeHtml(portInfo.urlLabel)}">
              <span class="flex items-center gap-1.5 truncate">
                <i data-lucide="external-link" class="w-3.5 h-3.5 text-brand-400 group-hover:scale-110 transition-transform flex-shrink-0"></i>
                <span class="font-mono text-[11px] truncate text-slate-200 group-hover:text-white">${escapeHtml(portInfo.accessUrl)}</span>
              </span>
              <span class="text-[10px] uppercase font-bold text-brand-400 bg-brand-500/10 px-1.5 py-0.5 rounded border border-brand-500/20 flex-shrink-0 ml-1.5">Abrir</span>
            </a>
          </div>
        ` : ''}
      </div>

      <div class="flex items-center justify-between pt-2 border-t border-slate-800/80 mt-1">
        <button onclick="openLogs('${escapeHtml(c.name)}')" class="text-xs text-slate-400 hover:text-brand-400 flex items-center gap-1 transition">
          <i data-lucide="terminal" class="w-3.5 h-3.5"></i> Logs
        </button>
        <div class="flex items-center gap-1">
          <button onclick="containerAction('${escapeHtml(c.name)}', 'restart')" class="p-1 hover:text-white text-slate-400 rounded transition" title="Reiniciar">
            <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
          </button>
          ${isUp ? `
            <button onclick="containerAction('${escapeHtml(c.name)}', 'stop')" class="p-1 hover:text-rose-400 text-slate-400 rounded transition" title="Detener">
              <i data-lucide="square" class="w-3.5 h-3.5"></i>
            </button>
          ` : `
            <button onclick="containerAction('${escapeHtml(c.name)}', 'start')" class="p-1 hover:text-emerald-400 text-slate-400 rounded transition" title="Iniciar">
              <i data-lucide="play" class="w-3.5 h-3.5"></i>
            </button>
          `}
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  lucide.createIcons();
}

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
  if (!confirm(`¿Deseas asignar la versión '${tag}' al ambiente '${envId}'?`)) return;

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
      item.className = "p-2.5 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between";
      item.innerHTML = `
        <span class="font-mono text-slate-300 font-semibold truncate">${escapeHtml(v.name)}</span>
        <span class="text-[10px] text-slate-500 bg-slate-900 px-2 py-0.5 rounded">${escapeHtml(v.driver)}</span>
      `;
      container.appendChild(item);
    });
  } catch (err) {
    console.error("Error al cargar volúmenes:", err);
  }
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
  const name = prompt(`Ingresa un nombre descriptivo para el Snapshot de '${envId}':`, `Demo ${envId} - Estado Listo`);
  if (!name) return;
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
  if (!confirm(`¿Eliminar el snapshot '${filename}'?`)) return;
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
