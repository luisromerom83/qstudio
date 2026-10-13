// ==========================================================================
// FORMULARIOS A KAFKA - CLIENTE
// Formularios de negocio (factura digital y solicitud de contacto),
// notificación push, user_id por integración y publicación en Kafka.
// ==========================================================================

let currentScreen = 'data';
let currentUseCase = 1;
let statsTotalSent = 0;
let statsTotalErrors = 0;
let statsTotalTime = 0;
let defaultUserIds = {
  '3rd Party': 'quadientlatam@gmail.com',
  'Quadient Inspire DAS': 'xbaGznvBRTbXKT0YOVEH30959486'
};

// ==========================================
// Navegación entre pantallas (sección 1 y 2)
// ==========================================
function switchMainScreen(screenId) {
  currentScreen = screenId;
  
  const tabBtnData = document.getElementById('tab-btn-data');
  const tabBtnKafka = document.getElementById('tab-btn-kafka');
  const screenDataView = document.getElementById('screen-data-view');
  const screenKafkaView = document.getElementById('screen-kafka-view');

  if (screenId === 'data') {
    tabBtnData.classList.add('active');
    tabBtnKafka.classList.remove('active');
    screenDataView.style.display = 'block';
    screenKafkaView.style.display = 'none';
  } else {
    tabBtnData.classList.remove('active');
    tabBtnKafka.classList.add('active');
    screenDataView.style.display = 'none';
    screenKafkaView.style.display = 'block';
  }

  logToConsole(`Navegación: ${screenId === 'data' ? 'Sección 1 (formulario)' : 'Sección 2 (servidor Kafka, JSON y logs)'}`);
  updateLivePreview();
}

// ==========================================
// Selector de formulario (1 y 2)
// ==========================================
const USE_CASE_PRESETS = {
  1: {
    title: 'Factura / Recibo digital',
    useCase: 'Factura / Recibo Digital',
    pushTitle: 'Tu factura de septiembre está disponible',
    pushContent: 'Estimado cliente, tu factura digital de septiembre por $ 1,450.00 fue generada correctamente.'
  },
  2: {
    title: 'Solicitud de contacto comercial',
    useCase: 'Solicitud de Contacto Comercial',
    pushTitle: 'Confirmación de solicitud comercial',
    pushContent: 'Recibimos tu solicitud de contacto. Un asesor se comunicará contigo en breve.'
  }
};

function switchUseCase(caseNum) {
  currentUseCase = caseNum;

  const btn1 = document.getElementById('btn-usecase-1');
  const btn2 = document.getElementById('btn-usecase-2');
  const panel1 = document.getElementById('panel-usecase-1');
  const panel2 = document.getElementById('panel-usecase-2');
  const heading = document.getElementById('usecase-form-heading');

  const pushTitleInput = document.getElementById('push_title');
  const pushContentInput = document.getElementById('push_content');
  const useCaseInput = document.getElementById('use_case');

  const preset = USE_CASE_PRESETS[caseNum];
  const other = USE_CASE_PRESETS[caseNum === 1 ? 2 : 1];

  btn1.classList.toggle('active', caseNum === 1);
  btn2.classList.toggle('active', caseNum === 2);
  panel1.style.display = caseNum === 1 ? 'block' : 'none';
  panel2.style.display = caseNum === 2 ? 'block' : 'none';
  heading.textContent = `Formulario: ${preset.title}`;
  if (useCaseInput) useCaseInput.value = preset.useCase;

  // Sugerir el push del formulario salvo que el usuario lo haya editado
  if (!pushTitleInput.value.trim() || pushTitleInput.value === other.pushTitle) {
    pushTitleInput.value = preset.pushTitle;
  }
  if (!pushContentInput.value.trim() || pushContentInput.value === other.pushContent) {
    pushContentInput.value = preset.pushContent;
  }

  logToConsole(`Formulario seleccionado: [${caseNum}] ${preset.title}`);

  updateLivePreview();
}

// ==========================================
// Selector de integración y user_id por defecto
// ==========================================
function selectIntegration(integrationValue) {
  const intInput = document.getElementById('integration');
  const userIdInput = document.getElementById('user_id');
  const previousDefault = defaultUserIds[intInput.value];

  intInput.value = integrationValue;
  document.getElementById('card-int-3rd').classList.toggle('active', integrationValue === '3rd Party');
  document.getElementById('card-int-das').classList.toggle('active', integrationValue !== '3rd Party');

  // Solo se reemplaza el user_id si no fue editado a mano
  if (!userIdInput.value.trim() || userIdInput.value === previousDefault) {
    userIdInput.value = defaultUserIds[integrationValue] || '';
  }
  logToConsole(`Destino de integración: "${integrationValue}" • user_id: ${userIdInput.value}`);

  updateLivePreview();
}

// ==========================================
// Datos del formulario activo
// ==========================================
function collectUseCaseContent() {
  if (currentUseCase === 1) {
    return {
      "BILLING_PERIOD": (document.getElementById('f_billing_period').value || "").trim(),
      "COMPANY_NAME": (document.getElementById('f_company_name').value || "").trim(),
      "CURRENCY": (document.getElementById('f_currency').value || "").trim(),
      "FOLIO_FISCAL": (document.getElementById('f_folio').value || "").trim(),
      "ITEM_1_NAME": (document.getElementById('f_item1_name').value || "").trim(),
      "ITEM_1_PRICE": (document.getElementById('f_item1_price').value || "").trim(),
      "ITEM_1_QTY": (document.getElementById('f_item1_qty').value || "").trim(),
      "ITEM_2_NAME": (document.getElementById('f_item2_name').value || "").trim(),
      "ITEM_2_PRICE": (document.getElementById('f_item2_price').value || "").trim(),
      "ITEM_2_QTY": (document.getElementById('f_item2_qty').value || "").trim(),
      "RFC": (document.getElementById('f_rfc').value || "").trim(),
      "STATUS_BADGE": (document.getElementById('f_status').value || "").trim(),
      "SUPPORT_EMAIL": (document.getElementById('f_support_email').value || "").trim(),
      "TAX_DISCLAIMER": (document.getElementById('f_tax').value || "").trim(),
      "TOTAL_AMOUNT": (document.getElementById('f_total').value || "").trim()
    };
  } else {
    return {
      "CUSTOMER_NAME": (document.getElementById('c_customer_name').value || "").trim(),
      "CUSTOMER_PHONE": (document.getElementById('c_customer_phone').value || "").trim(),
      "CUSTOMER_EMAIL": (document.getElementById('c_customer_email').value || "").trim(),
      "SERVICE_TYPE": document.getElementById('c_service_type').value,
      "REQUEST_TYPE": document.getElementById('c_request_type').value,
      "PREFERRED_CONTACT_TIME": document.getElementById('c_contact_time').value,
      "LOCATION_CITY": (document.getElementById('c_location_city').value || "").trim(),
      "NOTES": (document.getElementById('c_notes').value || "").trim()
    };
  }
}

// ==========================================
// Mensaje final para Kafka
// ==========================================
function buildFullPayloadObject() {
  const contentObj = collectUseCaseContent();
  const integrationVal = document.getElementById('integration').value;
  const pushTitleVal = (document.getElementById('push_title').value || "").trim();
  const pushContentVal = (document.getElementById('push_content').value || "").trim();
  const userIdVal = (document.getElementById('user_id').value || "").trim();
  const useCaseVal = (document.getElementById('use_case') ? document.getElementById('use_case').value : "").trim();

  return {
    "content": contentObj,
    "integration": integrationVal,
    "push_content": pushContentVal,
    "push_title": pushTitleVal,
    "type": "JSON",
    "use_case": useCaseVal,
    "user_id": userIdVal
  };
}

// ==========================================
// Vista previa reactiva
// ==========================================
function handleFieldChange() {
  updateLivePreview();
}

function updateLivePreview() {
  const payload = buildFullPayloadObject();
  const jsonStr = JSON.stringify(payload, null, 2);

  const codeElem = document.getElementById('preview-envelope-code');
  if (codeElem) {
    codeElem.textContent = jsonStr;
  }
}

function handleGeneratePreview() {
  updateLivePreview();
  const alertBox = document.getElementById('quick-preview-alert');
  const alertText = document.getElementById('quick-preview-text');
  if (alertBox) {
    alertText.textContent = `Vista previa actualizada para el formulario ${currentUseCase}. Lista para enviar.`;
    alertBox.style.display = 'flex';
  }
  logToConsole(`Vista previa generada para el formulario ${currentUseCase}.`);
}

// ==========================================
// Envío del formulario a Kafka
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('kafka-form');
  if (form) {
    form.addEventListener('submit', handleFormSubmit);
  }

  await loadServerConfig();
  selectIntegration('3rd Party');
  switchUseCase(1);

  logToConsole('Formularios a Kafka inicializado.');
});

async function loadServerConfig() {
  try {
    const res = await fetch('api/config');
    const cfg = await res.json();
    if (cfg.default_user_ids) defaultUserIds = cfg.default_user_ids;
    document.getElementById('topic').value = cfg.kafka_topic || '';
    const broker = cfg.kafka_bootstrap_servers || (cfg.kafka_host ? `${cfg.kafka_host}:${cfg.kafka_port}` : '');
    document.getElementById('host-hint').textContent = broker
      ? `Vacío: usa el broker del ambiente (${broker})`
      : 'Este ambiente no tiene broker de Kafka: indica host y puerto';
    if (!broker) setStatus(false, 'Sin broker configurado');
  } catch (err) {
    setStatus(false, 'Servidor no disponible');
    logToConsole(`[ERROR] No se pudo leer la configuración: ${err.message}`);
  }
  document.getElementById('default-user-3rd').textContent = defaultUserIds['3rd Party'] || '';
  document.getElementById('default-user-das').textContent = defaultUserIds['Quadient Inspire DAS'] || '';
}

function setStatus(ok, text) {
  const pill = document.getElementById('status-indicator');
  pill.classList.toggle('status-online', ok);
  pill.classList.toggle('status-offline', !ok);
  document.getElementById('status-text').textContent = text;
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const topicInput = document.getElementById('topic');
  const topic = (topicInput.value || "").trim();
  if (!topic) {
    showBanner('error', 'Falta un dato obligatorio', 'Indica el nombre del tópico de Kafka en la sección 2.');
    switchMainScreen('kafka');
    topicInput.focus();
    return;
  }

  updateLivePreview();

  const payload = buildFullPayloadObject();
  const body = {
    topic,
    host: (document.getElementById('host').value || "").trim(),
    port: (document.getElementById('port').value || "").trim(),
    data_type: 'json',
    integration: payload.integration,
    user_id: payload.user_id,
    push_title: payload.push_title,
    push_content: payload.push_content,
    use_case: payload.use_case,
    content: payload.content
  };

  setSendingState(true);
  logToConsole(`Enviando a Kafka en el tópico '${topic}'...`);
  logToConsole(`Caso de uso: "${payload.use_case}" | Destino: "${payload.integration}" | user_id: "${payload.user_id}"`);

  const startTime = performance.now();

  try {
    const response = await fetch('api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const elapsedSeconds = ((performance.now() - startTime) / 1000).toFixed(2);
    const data = await response.json();

    if (response.ok && data.success) {
      const stats = data.stats || {};
      const sentCount = stats.total_sent || 1;
      statsTotalSent += sentCount;
      statsTotalTime += parseFloat(elapsedSeconds);

      updateMetrics(statsTotalSent, statsTotalTime, sentCount > 0 ? (sentCount / Math.max(elapsedSeconds, 0.01)).toFixed(1) : '0', statsTotalErrors);

      const successTitle = 'Publicado en Apache Kafka';
      const successMsg = `Se publicó 1 mensaje JSON (formulario ${currentUseCase}) en el tópico '${topic}' de '${data.bootstrap_servers}'.`;
      showBanner('success', successTitle, successMsg);
      logToConsole(`[OK] ${successMsg} Tiempo: ${elapsedSeconds}s`);

      switchMainScreen('kafka');
    } else {
      statsTotalErrors++;
      updateMetrics(statsTotalSent, statsTotalTime, '0', statsTotalErrors);
      const errMsg = data.error || 'Error desconocido al procesar la solicitud.';
      showBanner('error', 'Error al enviar a Kafka', errMsg);
      logToConsole(`[ERROR] Falló el envío a Kafka: ${errMsg}`);
      switchMainScreen('kafka');
    }
  } catch (err) {
    statsTotalErrors++;
    updateMetrics(statsTotalSent, statsTotalTime, '0', statsTotalErrors);
    const errMsg = err.message || 'Error de comunicación con el servidor.';
    showBanner('error', 'Error de red / conexión', errMsg);
    logToConsole(`[ERROR] Excepción de red: ${errMsg}`);
    switchMainScreen('kafka');
  } finally {
    setSendingState(false);
  }
}

// ==========================================
// Estado de envío
// ==========================================
function setSendingState(isSending) {
  const btnSend = document.getElementById('btn-send');
  const btnSend2 = document.getElementById('btn-send-screen2');
  const spinner = document.getElementById('btn-send-spinner');
  const btnText = document.getElementById('btn-send-text');

  if (btnSend) btnSend.disabled = isSending;
  if (btnSend2) btnSend2.disabled = isSending;

  if (spinner) spinner.style.display = isSending ? 'inline-block' : 'none';
  if (btnText) btnText.textContent = isSending ? 'Enviando a Kafka...' : '🚀 Enviar a Kafka';
}

// ==========================================
// Banner de resultado
// ==========================================
function showBanner(type, title, text) {
  const banner = document.getElementById('result-banner');
  const bannerIcon = document.getElementById('banner-icon');
  const bannerTitle = document.getElementById('banner-title');
  const bannerText = document.getElementById('banner-text');

  if (!banner) return;

  banner.className = `banner banner-${type}`;
  if (type === 'success') {
    bannerIcon.textContent = '✅';
  } else if (type === 'error') {
    bannerIcon.textContent = '❌';
  } else {
    bannerIcon.textContent = 'ℹ️';
  }

  bannerTitle.textContent = title;
  bannerText.textContent = text;
}

// ==========================================
// Métricas
// ==========================================
function updateMetrics(sent, time, rate, errors) {
  const mSent = document.getElementById('metric-sent');
  const mTime = document.getElementById('metric-time');
  const mRate = document.getElementById('metric-rate');
  const mErrors = document.getElementById('metric-errors');

  if (mSent) mSent.textContent = sent;
  if (mTime) mTime.textContent = `${parseFloat(time).toFixed(2)}s`;
  if (mRate) mRate.textContent = `${rate} /s`;
  if (mErrors) mErrors.textContent = errors;
}

// ==========================================
// Consola de logs
// ==========================================
function logToConsole(message) {
  const consoleOutput = document.getElementById('console-output');
  if (!consoleOutput) return;

  const now = new Date();
  const timeStr = now.toLocaleTimeString('es', { hour12: false });
  const logLine = `[${timeStr}] ${message}\n`;

  if (consoleOutput.textContent === 'Esperando acciones del usuario...') {
    consoleOutput.textContent = logLine;
  } else {
    consoleOutput.textContent += logLine;
  }
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function clearConsole() {
  const consoleOutput = document.getElementById('console-output');
  if (consoleOutput) {
    consoleOutput.textContent = 'Esperando acciones del usuario...';
  }
}

function copyConsoleLogs() {
  const consoleOutput = document.getElementById('console-output');
  if (!consoleOutput) return;

  navigator.clipboard.writeText(consoleOutput.textContent).then(() => {
    alert('Logs copiados al portapapeles.');
  }).catch(err => {
    console.error('Error al copiar logs:', err);
  });
}
