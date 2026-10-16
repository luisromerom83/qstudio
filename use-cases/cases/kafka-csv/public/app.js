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

// UI state that is redrawn when the language changes (texts come from the i18n dictionaries)
let kafkaBroker = null;          // null = config not loaded yet, '' = environment without broker
let statusState = { ok: true, key: 'kafka.status.ready' };
let lastBanner = null;           // () => [type, title, text]
let quickPreviewVisible = false;
let isSendingNow = false;
let consoleIsEmpty = true;
let sampleLang = 'es-MX';        // language of the sample values currently in the form

// Dictionary lookup in a specific language (to recognise untouched sample values)
function tIn(lang, key) {
  const dict = window.I18N_MESSAGES[lang] || {};
  return dict[key] ?? (window.I18N_MESSAGES['es-MX'] || {})[key];
}

// ==========================================
// Sample data prefilled in the forms
// Only human-readable values switch with the language; JSON keys, ids, emails and amounts never change.
// ==========================================
const SAMPLE_INPUTS = {
  f_billing_period: 'kafka.sample.billingPeriod',
  f_company_name: 'kafka.sample.companyName',
  f_status: 'kafka.sample.status',
  f_item1_name: 'kafka.sample.item1Name',
  f_item2_name: 'kafka.sample.item2Name',
  f_tax: 'kafka.sample.tax',
  c_location_city: 'kafka.sample.city',
  c_notes: 'kafka.sample.notes'
};

const SAMPLE_SELECTS = {
  c_service_type: ['kafka.sample.service.1', 'kafka.sample.service.2', 'kafka.sample.service.3', 'kafka.sample.service.4'],
  c_request_type: ['kafka.sample.request.1', 'kafka.sample.request.2', 'kafka.sample.request.3'],
  c_contact_time: ['kafka.sample.time.1', 'kafka.sample.time.2', 'kafka.sample.time.3']
};

// Replace sample values written in fromLang, keeping anything the user typed
function applySampleData(fromLang) {
  const swap = (el, key) => {
    if (el && (!el.value.trim() || el.value === tIn(fromLang, key))) el.value = t(key);
  };
  Object.entries(SAMPLE_INPUTS).forEach(([id, key]) => swap(document.getElementById(id), key));

  Object.entries(SAMPLE_SELECTS).forEach(([id, keys]) => {
    const select = document.getElementById(id);
    if (!select) return;
    const index = Math.max(0, select.selectedIndex);
    select.innerHTML = '<option></option>'.repeat(keys.length);
    keys.forEach((key, i) => {
      select.options[i].value = t(key);
      select.options[i].textContent = t(key);
    });
    select.selectedIndex = index;
  });

  Object.values(USE_CASE_PRESETS).forEach(preset => {
    swap(document.getElementById('push_title'), preset.pushTitleKey);
    swap(document.getElementById('push_content'), preset.pushContentKey);
  });
  sampleLang = currentLang;
}

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

  logToConsole(t('kafka.log.navigation', { section: t(screenId === 'data' ? 'kafka.log.section1' : 'kafka.log.section2') }));
  updateLivePreview();
}

// ==========================================
// Selector de formulario (1 y 2)
// ==========================================
// useCase is the identifier sent in the root "use_case" field; Scaler may route on it, so it is not translated
const USE_CASE_PRESETS = {
  1: {
    titleKey: 'kafka.form1.title',
    useCase: 'Factura / Recibo Digital',
    pushTitleKey: 'kafka.sample.form1.pushTitle',
    pushContentKey: 'kafka.sample.form1.pushContent'
  },
  2: {
    titleKey: 'kafka.form2.title',
    useCase: 'Solicitud de Contacto Comercial',
    pushTitleKey: 'kafka.sample.form2.pushTitle',
    pushContentKey: 'kafka.sample.form2.pushContent'
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
  heading.textContent = t('kafka.formB.heading', { title: t(preset.titleKey) });
  if (useCaseInput) useCaseInput.value = preset.useCase;

  // Sugerir el push del formulario salvo que el usuario lo haya editado
  if (!pushTitleInput.value.trim() || pushTitleInput.value === t(other.pushTitleKey)) {
    pushTitleInput.value = t(preset.pushTitleKey);
  }
  if (!pushContentInput.value.trim() || pushContentInput.value === t(other.pushContentKey)) {
    pushContentInput.value = t(preset.pushContentKey);
  }

  logToConsole(t('kafka.log.formSelected', { num: caseNum, title: t(preset.titleKey) }));

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
  logToConsole(t('kafka.log.integration', { integration: integrationValue, userId: userIdInput.value }));

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
    quickPreviewVisible = true;
    alertText.textContent = t('kafka.preview.updated', { num: currentUseCase });
    alertBox.style.display = 'flex';
  }
  logToConsole(t('kafka.log.previewGenerated', { num: currentUseCase }));
}

// ==========================================
// Envío del formulario a Kafka
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('kafka-form');
  if (form) {
    form.addEventListener('submit', handleFormSubmit);
  }

  renderLangSelect();
  clearConsole();
  applySampleData('es-MX');
  await loadServerConfig();
  selectIntegration('Quadient Inspire DAS');
  switchUseCase(1);

  logToConsole(t('kafka.log.initialized'));
});

// ==========================================
// Idioma de la interfaz
// ==========================================
function renderLangSelect() {
  const slot = document.getElementById('lang-slot');
  if (slot) slot.innerHTML = langSelectHtml('lang-select');
  applyI18n(slot || document);
  // Back to the portal in the same language
  const back = document.getElementById('back-to-portal');
  if (back) back.href = `../?lang=${encodeURIComponent(currentLang)}`;
}

// applyI18n already reset the static texts; redraw what JS writes
window.addEventListener('studio:languagechange', () => {
  renderLangSelect();
  applySampleData(sampleLang);
  // Only the heading: switchUseCase would also reset the use_case identifier the user may have edited
  document.getElementById('usecase-form-heading').textContent =
    t('kafka.formB.heading', { title: t(USE_CASE_PRESETS[currentUseCase].titleKey) });
  renderHostHint();
  setStatus(statusState.ok, statusState.key);
  setSendingState(isSendingNow);
  if (lastBanner) showBanner(...lastBanner());
  if (quickPreviewVisible) document.getElementById('quick-preview-text').textContent = t('kafka.preview.updated', { num: currentUseCase });
  if (consoleIsEmpty) clearConsole();
  logToConsole(t('kafka.log.language', { lang: currentLang }));
  updateLivePreview();
});

async function loadServerConfig() {
  try {
    const res = await fetch('api/config');
    const cfg = await res.json();
    if (cfg.default_user_ids) defaultUserIds = cfg.default_user_ids;
    document.getElementById('topic').value = cfg.kafka_topic || '';
    kafkaBroker = cfg.kafka_bootstrap_servers || (cfg.kafka_host ? `${cfg.kafka_host}:${cfg.kafka_port}` : '');
    // Prefill host and port with the environment's broker (the first one when there are several)
    const [brokerHost, brokerPort] = kafkaBroker.split(',')[0].trim().split(':');
    document.getElementById('host').value = brokerHost || '';
    document.getElementById('port').value = brokerPort || cfg.kafka_port || '';
    renderHostHint();
    if (!kafkaBroker) setStatus(false, 'kafka.status.noBroker');
  } catch (err) {
    setStatus(false, 'kafka.status.unavailable');
    logToConsole(t('kafka.log.configError', { error: err.message }));
  }
  document.getElementById('default-user-3rd').textContent = defaultUserIds['3rd Party'] || '';
  document.getElementById('default-user-das').textContent = defaultUserIds['Quadient Inspire DAS'] || '';
}

function renderHostHint() {
  if (kafkaBroker === null) return;
  document.getElementById('host-hint').textContent = kafkaBroker
    ? t('kafka.config.hostHintBroker', { broker: kafkaBroker })
    : t('kafka.config.hostHintNoBroker');
}

function setStatus(ok, key) {
  statusState = { ok, key };
  const pill = document.getElementById('status-indicator');
  pill.classList.toggle('status-online', ok);
  pill.classList.toggle('status-offline', !ok);
  document.getElementById('status-text').textContent = t(key);
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const topicInput = document.getElementById('topic');
  const topic = (topicInput.value || "").trim();
  if (!topic) {
    setBanner(() => ['error', t('kafka.banner.missingTitle'), t('kafka.banner.missingText')]);
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
  logToConsole(t('kafka.log.sending', { topic }));
  logToConsole(t('kafka.log.sendDetails', { useCase: payload.use_case, integration: payload.integration, userId: payload.user_id }));

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

      const sentForm = currentUseCase;
      const successText = () => t('kafka.banner.successText', { num: sentForm, topic, servers: data.bootstrap_servers });
      setBanner(() => ['success', t('kafka.banner.successTitle'), successText()]);
      logToConsole(t('kafka.log.ok', { message: successText(), seconds: elapsedSeconds }));

      switchMainScreen('kafka');
    } else {
      statsTotalErrors++;
      updateMetrics(statsTotalSent, statsTotalTime, '0', statsTotalErrors);
      // data.error already comes in the interface language (server-side catalog)
      const errMsg = data.error || t('kafka.error.unknown');
      setBanner(() => ['error', t('kafka.banner.sendErrorTitle'), data.error || t('kafka.error.unknown')]);
      logToConsole(t('kafka.log.sendFailed', { error: errMsg }));
      switchMainScreen('kafka');
    }
  } catch (err) {
    statsTotalErrors++;
    updateMetrics(statsTotalSent, statsTotalTime, '0', statsTotalErrors);
    const errMsg = err.message || t('kafka.error.network');
    setBanner(() => ['error', t('kafka.banner.networkTitle'), err.message || t('kafka.error.network')]);
    logToConsole(t('kafka.log.networkError', { error: errMsg }));
    switchMainScreen('kafka');
  } finally {
    setSendingState(false);
  }
}

// ==========================================
// Estado de envío
// ==========================================
function setSendingState(isSending) {
  isSendingNow = isSending;
  const btnSend = document.getElementById('btn-send');
  const btnSend2 = document.getElementById('btn-send-screen2');
  const spinner = document.getElementById('btn-send-spinner');
  const btnText = document.getElementById('btn-send-text');

  if (btnSend) btnSend.disabled = isSending;
  if (btnSend2) btnSend2.disabled = isSending;

  if (spinner) spinner.style.display = isSending ? 'inline-block' : 'none';
  if (btnText) btnText.textContent = t(isSending ? 'kafka.actions.sending' : 'kafka.actions.send');
}

// ==========================================
// Banner de resultado
// ==========================================
// Remember how to rebuild the banner so it follows language changes
function setBanner(build) {
  lastBanner = build;
  showBanner(...build());
}

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
  const timeStr = now.toLocaleTimeString(currentLang, { hour12: false });
  const logLine = `[${timeStr}] ${message}\n`;

  if (consoleIsEmpty) {
    consoleOutput.textContent = logLine;
    consoleIsEmpty = false;
  } else {
    consoleOutput.textContent += logLine;
  }
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function clearConsole() {
  const consoleOutput = document.getElementById('console-output');
  if (consoleOutput) {
    consoleOutput.textContent = t('kafka.console.waiting');
    consoleIsEmpty = true;
  }
}

function copyConsoleLogs() {
  const consoleOutput = document.getElementById('console-output');
  if (!consoleOutput) return;

  navigator.clipboard.writeText(consoleOutput.textContent).then(() => {
    alert(t('kafka.console.copied'));
  }).catch(err => {
    console.error('Error al copiar logs:', err);
  });
}
