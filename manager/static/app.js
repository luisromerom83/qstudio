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
      btnEl.classList.add("text-white", "bg-slate-800", "shadow-sm", "border-slate-700");
      btnEl.classList.remove("text-slate-400", "border-transparent");
    } else {
      viewEl.classList.add("hidden");
      btnEl.classList.remove("text-white", "bg-slate-800", "shadow-sm", "border-slate-700");
      btnEl.classList.add("text-slate-400", "border-transparent");
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
    allEnvironments = (data.environments || []).filter(e => e.id !== "default");
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
      p.classList.add("active", "bg-[#CC3400]", "text-white", "border-[#FF4200]", "shadow-sm", "shadow-[#CC3400]/20");
      p.classList.remove("text-slate-400", "border-slate-800");
    } else {
      p.classList.remove("active", "bg-[#CC3400]", "text-white", "border-[#FF4200]", "shadow-sm", "shadow-[#CC3400]/20");
      p.classList.add("text-slate-400", "border-slate-800");
    }
  });
  renderEnvironments();
}

function renderEnvironments() {
  const container = document.getElementById("environments-grid");
  container.innerHTML = "";

  if (allEnvironments.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-16 text-center bg-slate-900/40 rounded-2xl border border-dashed border-slate-800">
        <div class="w-14 h-14 mx-auto mb-3 rounded-2xl bg-[#FF4200]/10 border border-[#FF4200]/20 flex items-center justify-center text-[#FF4200]">
          <i data-lucide="plus-circle" class="w-7 h-7"></i>
        </div>
        <h3 class="text-base font-bold text-white mb-1">Aún no hay ambientes creados</h3>
        <p class="text-xs text-slate-400 max-w-sm mx-auto mb-4">Configura tus credenciales y crea tu primer sandbox personalizado para comenzar.</p>
        <button onclick="openNewEnvModal()" class="px-4 py-2 bg-[#CC3400] hover:bg-[#FF4200] text-white rounded-xl text-xs font-semibold shadow-lg shadow-[#CC3400]/25 inline-flex items-center gap-2 transition active:scale-95">
          <i data-lucide="plus" class="w-4 h-4"></i> Crear Primer Ambiente
        </button>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  const filtered = allEnvironments.filter(e => {
    if (e.id === "default") return false;
    if (currentFilter === "all") return true;
    return (e.vertical_id || "").toLowerCase() === currentFilter.toLowerCase();
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-16 text-center text-slate-500 bg-slate-900/30 rounded-2xl border border-dashed border-slate-800">
        <i data-lucide="folder-search" class="w-10 h-10 mx-auto mb-2 text-slate-600"></i>
        <p class="text-sm">No hay demostraciones registradas en esta categoría.</p>
        <button onclick="openNewEnvModal()" class="mt-3 text-xs text-[#FF6833] hover:underline">+ Crear nueva demostración</button>
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
    card.className = `bg-slate-900/70 border rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 hover:border-slate-700 ${isRunning ? "card-active border-[#FF4200]/50" : "border-slate-800"}`;

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
              <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#7536F0]/15 text-[#915DF3] border border-[#7536F0]/30 flex items-center gap-1" title="Demo Mode activo con avatares y usuarios">
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
          <div class="mt-2.5 flex items-center justify-between">
            <button onclick="openVolumeLocationModal('${env.id}')" class="group/storage inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md border transition ${env.storage_path && env.storage_path !== 'docker_default' ? 'bg-[#05B9F0]/10 border-[#05B9F0]/30 text-[#05B9F0] hover:bg-[#05B9F0]/20' : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:border-slate-700'}" title="Ver ubicación física en disco host">
              <i data-lucide="${env.storage_path && env.storage_path !== 'docker_default' ? 'folder-check' : 'hard-drive'}" class="w-3 h-3 flex-shrink-0"></i>
              <span class="truncate max-w-[170px] font-mono">${env.storage_path && env.storage_path !== 'docker_default' ? escapeHtml(env.storage_path) : 'Docker Managed'}</span>
              <i data-lucide="chevron-right" class="w-2.5 h-2.5 opacity-60 group-hover/storage:translate-x-0.5 transition-transform"></i>
            </button>
          </div>
        </div>

        <!-- Quick Access Launch Buttons: Interactive & Scaler -->
        <div class="pt-2.5 border-t border-slate-800/80 grid grid-cols-2 gap-2">
          <a href="http://${window.location.hostname || 'localhost'}:${portInter}/interactive" target="_blank" class="inline-flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-semibold transition ${isRunning ? 'bg-[#FF4200]/15 text-[#FF6833] hover:bg-[#FF4200]/25 hover:text-white border border-[#FF4200]/30 shadow-sm' : 'bg-slate-800/40 text-slate-500 border border-slate-800/60 pointer-events-none'}" title="Abrir Inspire Interactive">
            <i data-lucide="external-link" class="w-3.5 h-3.5 flex-shrink-0"></i>
            <span class="truncate">Interactive (:${portInter})</span>
          </a>
          <a href="http://${window.location.hostname || 'localhost'}:${portScaler}/" target="_blank" class="inline-flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-semibold transition ${isRunning ? 'bg-[#05B9F0]/15 text-[#38BDF8] hover:bg-[#05B9F0]/25 hover:text-white border border-[#05B9F0]/30 shadow-sm' : 'bg-slate-800/40 text-slate-500 border border-slate-800/60 pointer-events-none'}" title="Abrir Inspire Scaler">
            <i data-lucide="external-link" class="w-3.5 h-3.5 flex-shrink-0"></i>
            <span class="truncate">Scaler (:${portScaler})</span>
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
            <button onclick="activateDemo('${env.id}', true)" class="px-3.5 py-1.5 bg-[#CC3400] hover:bg-[#FF4200] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-[#CC3400]/25 transition active:scale-95">
              <i data-lucide="play" class="w-3.5 h-3.5"></i> Activar Demo
            </button>
          `}
        </div>

        <div class="flex items-center gap-1">
          <button onclick="openEditEnvModal('${env.id}')" class="p-1.5 text-slate-400 hover:text-amber-400 rounded-lg hover:bg-slate-800 transition" title="Configurar Stacks y Servicios">
            <i data-lucide="settings-2" class="w-4 h-4"></i>
          </button>
          <button onclick="openVolumeLocationModal('${env.id}')" class="p-1.5 text-slate-400 hover:text-[#05B9F0] rounded-lg hover:bg-slate-800 transition" title="Ubicación Física de Volúmenes en el Host">
            <i data-lucide="hard-drive" class="w-4 h-4"></i>
          </button>
          <button onclick="viewEnvServices('${env.id}')" class="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition" title="Ver Servicios">
            <i data-lucide="server" class="w-4 h-4"></i>
          </button>
          <button onclick="createSnapshotForEnv('${env.id}')" class="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition" title="Crear Snapshot de Demo">
            <i data-lucide="camera" class="w-4 h-4"></i>
          </button>
          <button onclick="deleteEnvironment('${env.id}')" class="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition" title="Eliminar Ambiente">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
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
  const removeVols = confirm(
    `¿Deseas ELIMINAR también definitivamente todos los volúmenes de datos asociados (PostgreSQL, ICM, archivos)?\n\n` +
    `• Presiona [Aceptar] = BORRAR definitivamente todos los datos del ambiente.\n` +
    `• Presiona [Cancelar] = CONSERVAR los volúmenes de datos en disco.`
  );
  
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
  } else if (s.includes("studio") || s.includes("producer")) {
    const port = extractHostPort(c.ports, 8080) || ports.csv_studio || 8081;
    portText = `${port}`;
    accessUrl = `http://${host}:${port}/`;
    urlLabel = "Abrir Kafka CSV Studio";
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

function renderNodeBox({ title, container, defaultPort, internalPort, type, env }) {
  const isUp = container && container.state === "running";
  const isHealthy = container && container.status && container.status.includes("healthy");
  const host = window.location.hostname || "localhost";
  const portInfo = container ? getServicePortInfo(container, env) : {
    portText: `${defaultPort}${internalPort ? ` -> ${internalPort}` : ''}`,
    accessUrl: type === "interactive" ? `http://${host}:${defaultPort}/interactive` : ((type === "scaler" || type === "studio") ? `http://${host}:${defaultPort}/` : null),
    urlLabel: type === "interactive" ? "Abrir Inspire Interactive" : (type === "scaler" ? "Abrir Inspire Scaler" : (type === "studio" ? "Abrir Kafka CSV Studio" : ""))
  };

  return `
    <div class="node-box rounded-xl p-4 flex flex-col justify-between space-y-3 shadow-md">
      <div class="space-y-2">
        <!-- Node Title & State -->
        <div class="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full ${isUp ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}"></span>
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
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] pt-1">
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
               class="inline-flex items-center justify-between w-full px-3 py-2 rounded-lg text-xs font-semibold ${isUp ? (type === 'studio' ? 'bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 hover:text-white border border-indigo-500/40 shadow-sm' : 'bg-[#CC3400]/20 text-[#FF6833] hover:bg-[#CC3400]/30 hover:text-white border border-[#FF4200]/40 shadow-sm') : 'bg-slate-800/40 text-slate-500 border border-slate-800 pointer-events-none'} transition group"
               title="${escapeHtml(portInfo.urlLabel)}">
              <span class="flex items-center gap-2 truncate">
                <i data-lucide="external-link" class="w-3.5 h-3.5 ${type === 'studio' ? 'text-indigo-400' : 'text-brand-400'} group-hover:scale-110 transition-transform flex-shrink-0"></i>
                <span class="font-mono text-[11px] truncate text-slate-200 group-hover:text-white">${escapeHtml(portInfo.accessUrl)}</span>
              </span>
              <span class="text-[10px] uppercase font-bold text-white ${type === 'studio' ? 'bg-indigo-600' : 'bg-[#CC3400]'} px-2 py-0.5 rounded shadow-sm flex-shrink-0 ml-1.5">Abrir</span>
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
    return s.includes("kafka") && !s.includes("studio") && !s.includes("producer");
  });

  const kafkaProducer = rawContainers.find(c => {
    const s = (c.service || c.name || "").toLowerCase();
    return s.includes("kafka-csv-studio") || s.includes("producer") || (s.includes("studio") && !s.includes("inspire"));
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
  const coreIds = [interactive, interactiveIps, scaler, scalerIps, icm, postgres, scalerPrep, interPrep, kafka, kafkaProducer, ftp]
    .filter(Boolean)
    .map(c => c.name);
  const extraContainers = rawContainers.filter(c => !coreIds.includes(c.name));

  const isRunning = env.status === "running" || env.status === "partial";

  const hasInteractive = env.enable_interactive !== false;
  const hasScaler = env.enable_scaler !== false;
  const hasKafka = Boolean(env.enable_kafka || kafka || kafkaProducer);
  const hasFtp = Boolean(env.enable_ftp || ftp);

  // Helper to render Interactive Group
  const renderInteractiveGroup = () => `
    <div class="group-box flex flex-col rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl">
      <!-- Header Banner (Mint Green as in groups.png) -->
      <div class="bg-[#99E2B4] text-slate-950 font-black tracking-widest text-center py-2.5 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm flex items-center justify-center gap-2">
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
    <div class="group-box flex flex-col rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl">
      <!-- Header Banner (Orange as in groups.png) -->
      <div class="bg-[#FFA64D] text-slate-950 font-black tracking-widest text-center py-2.5 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm flex items-center justify-center gap-2 flex-wrap">
        <span>SCALER NODE</span>
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
          <div class="w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}"></div>
          <div>
            <h3 class="text-sm font-bold text-white tracking-wide uppercase">Topología del Ambiente: <span class="text-brand-400 font-mono">${escapeHtml(env.name)}</span></h3>
            <p class="text-[11px] text-slate-400">Estructura modular Quadient Inspire Flex</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-3 text-xs">
          ${hasInteractive ? `
            <span class="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
              <span class="w-3 h-3 rounded-sm bg-[#99E2B4] inline-block border border-slate-700"></span>
              <span class="font-bold text-slate-200">INTERACTIVE</span>
            </span>
          ` : ''}
          ${hasScaler ? `
            <span class="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
              <span class="w-3 h-3 rounded-sm bg-[#FFA64D] inline-block border border-slate-700"></span>
              <span class="font-bold text-slate-200">SCALER NODE</span>
            </span>
          ` : ''}
          <span class="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
            <span class="w-3 h-3 rounded-sm bg-[#9CA3AF] inline-block border border-slate-700"></span>
            <span class="font-bold text-slate-200">ICM / POSTGRES</span>
          </span>
          ${hasKafka ? `
            <span class="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
              <span class="w-3 h-3 rounded-sm bg-[#6366F1] inline-block border border-slate-700"></span>
              <span class="font-bold text-slate-200">KAFKA</span>
            </span>
          ` : ''}
          ${hasFtp ? `
            <span class="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
              <span class="w-3 h-3 rounded-sm bg-[#0D9488] inline-block border border-slate-700"></span>
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

  // TOP SECTION: QUADIENT INTERACTIVE & SCALER
  if (hasInteractive && hasScaler) {
    html += `
      <div>
        <div class="grid grid-cols-1 lg:grid-cols-[1fr,68px,1fr] gap-4 lg:gap-0 items-start">
          ${renderInteractiveGroup()}

          <!-- CONNECTOR BETWEEN INTERACTIVE & SCALER NODE -->
          <div class="hidden lg:flex flex-col items-center justify-start h-full px-1">
            <div class="h-11"></div>
            <div class="h-44 flex flex-col items-center justify-center">
              <svg class="w-16 h-5 text-slate-400" viewBox="0 0 64 20" fill="none">
                <line x1="6" y1="10" x2="58" y2="10" stroke="currentColor" stroke-width="2" />
                <polygon points="6,10 13,6 13,14" fill="currentColor" />
                <polygon points="58,10 51,6 51,14" fill="currentColor" />
              </svg>
              <span class="text-[9px] font-mono text-slate-400 uppercase tracking-tighter text-center mt-1">HTTP / RPC</span>
            </div>
          </div>

          ${renderScalerGroup()}
        </div>
      </div>

      <!-- CONNECTOR DOWN TO ICM (Fork) -->
      <div class="flex flex-col items-center justify-center pt-2 pb-1 text-slate-500">
        <svg class="w-full max-w-xl h-10 text-slate-600 hidden sm:block" viewBox="0 0 500 40" fill="none">
          <path d="M 125 0 C 125 22, 250 12, 250 32" stroke="currentColor" stroke-width="2.5" stroke-dasharray="4 3" />
          <path d="M 375 0 C 375 22, 250 12, 250 32" stroke="currentColor" stroke-width="2.5" stroke-dasharray="4 3" />
          <polygon points="245,32 255,32 250,40" fill="currentColor" />
        </svg>
        <div class="sm:hidden flex items-center justify-center py-1">
          <i data-lucide="arrow-down" class="w-5 h-5 text-slate-500"></i>
        </div>
      </div>
    `;
  } else if (hasInteractive) {
    html += `
      <div class="w-full max-w-2xl mx-auto">
        ${renderInteractiveGroup()}
      </div>

      <!-- Single vertical connector down to ICM -->
      <div class="flex flex-col items-center justify-center pt-2 pb-1 text-slate-500">
        <div class="w-0.5 h-6 bg-slate-700"></div>
        <i data-lucide="arrow-down" class="w-4 h-4 text-slate-500 -mt-1"></i>
      </div>
    `;
  } else if (hasScaler) {
    html += `
      <div class="w-full max-w-2xl mx-auto">
        ${renderScalerGroup()}
      </div>

      <!-- Single vertical connector down to ICM -->
      <div class="flex flex-col items-center justify-center pt-2 pb-1 text-slate-500">
        <div class="w-0.5 h-6 bg-slate-700"></div>
        <i data-lucide="arrow-down" class="w-4 h-4 text-slate-500 -mt-1"></i>
      </div>
    `;
  }

  // ICM BOX (Mandatory)
  html += `
      <!-- ICM BOX (Inspire Configuration Manager) -->
      <div class="w-full max-w-2xl mx-auto group-box rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl">
        <div class="bg-[#9CA3AF] text-slate-950 font-black tracking-widest text-center py-2 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm">
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

      <!-- CONNECTOR BETWEEN ICM AND POSTGRES -->
      <div class="flex flex-col items-center justify-center py-1 text-slate-500">
        <div class="flex items-center gap-2 text-xs font-mono text-slate-400 bg-slate-950/80 px-3.5 py-1 rounded-full border border-slate-800 shadow-sm">
          <i data-lucide="arrow-up-down" class="w-3.5 h-3.5 text-cyan-400"></i>
          <span>Tablas del Repositorio & Metadatos de Licencias</span>
        </div>
        <div class="w-0.5 h-6 bg-slate-700 mt-1"></div>
        <i data-lucide="arrow-down" class="w-4 h-4 text-slate-500 -mt-1"></i>
      </div>

      <!-- POSTGRES DATABASE BOX (Mandatory) -->
      <div class="w-full max-w-2xl mx-auto group-box rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl">
        <div class="bg-[#9CA3AF] text-slate-950 font-black tracking-widest text-center py-2 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm">
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

    </div>
  `;

  // OPTIONAL THIRD-PARTY SERVICES: KAFKA & FTP
  if (hasKafka || hasFtp) {
    html += `
      <div class="pt-6 border-t border-slate-800 space-y-6">
        <div class="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          <i data-lucide="cpu" class="w-4 h-4 text-cyan-400"></i>
          Servicios de Integración y Terceros Opcionales
        </div>

        <div class="grid grid-cols-1 ${hasKafka && hasFtp ? 'lg:grid-cols-2' : ''} gap-6">
          ${hasKafka ? `
            <!-- KAFKA STREAMING & CSV STUDIO GROUP -->
            <div class="group-box flex flex-col rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl">
              <!-- Header Banner (Indigo/Purple) -->
              <div class="bg-[#6366F1] text-white font-black tracking-widest text-center py-2.5 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm flex items-center justify-center gap-2">
                <i data-lucide="radio" class="w-4 h-4 text-white"></i>
                <span>KAFKA STREAMING & CSV STUDIO</span>
              </div>

              <!-- Group Body: Broker and CSV Producer -->
              <div class="p-4 sm:p-5 space-y-4 flex-1 flex flex-col justify-between bg-slate-900/60">
                ${renderNodeBox({
                  title: "KAFKA BROKER (KRaft)",
                  container: kafka,
                  defaultPort: env.ports?.kafka || 9092,
                  internalPort: 9092,
                  type: "kafka",
                  env: env
                })}

                <!-- Connector indicator -->
                <div class="flex items-center justify-center text-slate-500 py-0.5 gap-2 text-[11px] font-mono">
                  <i data-lucide="chevrons-down" class="w-4 h-4 text-indigo-400 opacity-70"></i>
                  <span class="text-indigo-300">Flujo CSV / Ingesta de Mensajes</span>
                  <i data-lucide="chevrons-down" class="w-4 h-4 text-indigo-400 opacity-70"></i>
                </div>

                ${renderNodeBox({
                  title: "KAFKA CSV PRODUCER (WEB GUI)",
                  container: kafkaProducer,
                  defaultPort: env.ports?.csv_studio || 8081,
                  internalPort: 8080,
                  type: "studio",
                  env: env
                })}
              </div>
            </div>
          ` : ''}

          ${hasFtp ? `
            <!-- FTP SERVER GROUP -->
            <div class="group-box flex flex-col rounded-2xl border-2 border-slate-700 overflow-hidden bg-slate-900/90 shadow-xl">
              <!-- Header Banner (Teal) -->
              <div class="bg-[#0D9488] text-white font-black tracking-widest text-center py-2.5 px-4 uppercase text-sm sm:text-base border-b-2 border-slate-700 select-none shadow-sm flex items-center justify-center gap-2">
                <i data-lucide="folder-sync" class="w-4 h-4 text-white"></i>
                <span>FTP SERVER (vsftpd)</span>
              </div>

              <div class="p-4 sm:p-5 flex-1 flex flex-col justify-between bg-slate-900/60 space-y-4">
                ${renderNodeBox({
                  title: "FTP SERVER (vsftpd)",
                  container: ftp,
                  defaultPort: env.ports?.ftp || 2121,
                  internalPort: 21,
                  type: "ftp",
                  env: env
                })}

                <!-- FTP Credentials and PASV Range Banner -->
                <div class="bg-slate-950/80 p-3.5 rounded-xl border border-teal-500/30 flex flex-col gap-2 text-xs">
                  <div class="flex items-center justify-between">
                    <span class="text-teal-300 font-semibold flex items-center gap-1.5">
                      <i data-lucide="key-round" class="w-3.5 h-3.5"></i> Autenticación FTP
                    </span>
                    <span class="text-[10px] font-mono text-slate-400">PASV: ${env.ports?.ftp_pasv_min || 21100}-${env.ports?.ftp_pasv_max || 21105}</span>
                  </div>
                  <div class="flex items-center gap-2 font-mono text-[11px] bg-slate-900 p-2 rounded-lg border border-slate-800">
                    <span class="text-slate-400">Usuario:</span>
                    <span class="text-white font-bold">system</span>
                    <span class="text-slate-600">|</span>
                    <span class="text-slate-400">Password:</span>
                    <span class="text-teal-400 font-bold">Password12345*</span>
                  </div>
                </div>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

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
            <span class="text-[10px] ${v.is_custom ? 'bg-[#05B9F0]/15 text-[#05B9F0] border border-[#05B9F0]/30 font-semibold' : 'bg-slate-900 text-slate-400'} px-2 py-0.5 rounded">
              ${v.is_custom ? 'Host Bind' : escapeHtml(v.driver)}
            </span>
            <button onclick="deleteVolume('${escapeHtml(v.name)}')" class="p-1 text-slate-500 hover:text-rose-400 rounded transition" title="Eliminar volumen de Docker">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>
        ${displayPath ? `
          <div class="flex items-center justify-between gap-1 text-[11px] font-mono bg-black/50 px-2 py-1 rounded border border-slate-800/80">
            <span class="truncate ${v.is_custom ? 'text-[#05B9F0]' : 'text-slate-400'}" title="${escapeHtml(displayPath)}">
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
  if (!confirm(`¿Deseas eliminar definitivamente el volumen '${volumeName}' de Docker?\n\nSi pertenece a un ambiente activo, esto borrará sus datos.`)) return;
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
      bannerEl.className = "p-3.5 rounded-xl border bg-[#05B9F0]/10 border-[#05B9F0]/30 text-[#05B9F0] flex items-center justify-between text-xs";
      bannerEl.innerHTML = `
        <div class="flex items-center gap-2">
          <i data-lucide="folder-check" class="w-4 h-4 flex-shrink-0"></i>
          <div>
            <span class="font-bold">Carpeta Personalizada en tu Host:</span>
            <span class="font-mono ml-1 text-white">${escapeHtml(env.storage_path)}</span>
          </div>
        </div>
        <button onclick="copyVolPath('${escapeHtml(env.storage_path)}')" class="px-2.5 py-1 bg-[#05B9F0]/20 hover:bg-[#05B9F0]/30 text-white rounded text-[11px] font-semibold flex items-center gap-1 transition">
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
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded ${v.is_custom ? 'bg-[#05B9F0]/15 text-[#05B9F0] border border-[#05B9F0]/30' : 'bg-slate-800 text-slate-400'}">
                ${escapeHtml(v.volume_name)}
              </span>
            </div>
            <div class="flex items-center gap-1.5 text-slate-400 font-mono text-[11px] truncate">
              <i data-lucide="corner-down-right" class="w-3 h-3 flex-shrink-0 text-slate-500"></i>
              <span class="truncate ${v.is_custom ? 'text-[#05B9F0] font-medium' : 'text-slate-400'}" title="${escapeHtml(v.host_path || 'No disponible')}">
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
