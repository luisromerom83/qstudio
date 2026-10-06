// ==========================================================================
// VIVO KAFKA DATA PRODUCER STUDIO - JAVASCRIPT CLIENT (pt-BR)
// Gerenciamento de casos de uso estruturados (Fatura Digital e Telefonia),
// notificação push, atribuição de user_id por integração e publicação no Kafka.
// ==========================================================================

let currentScreen = 'data';
let currentUseCase = 1;
let statsTotalSent = 0;
let statsTotalErrors = 0;
let statsTotalTime = 0;

// ==========================================
// Navegação entre Telas (Seção 1 vs 2)
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

  logToConsole(`Navegação: ${screenId === 'data' ? 'Seção 1 (Casos de Uso)' : 'Seção 2 (Servidor Kafka, JSON & Logs)'}`);
  updateLivePreview();
}

// ==========================================
// Seletor de Casos de Uso (1 vs 2)
// ==========================================
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

  if (caseNum === 1) {
    btn1.classList.add('active');
    btn2.classList.remove('active');
    panel1.style.display = 'block';
    panel2.style.display = 'none';
    heading.textContent = 'Formulário do Caso de Uso: Fatura / Recibo Digital';
    if (useCaseInput) useCaseInput.value = 'Fatura / Recibo Digital';

    // Sugestão contextual do push se não foi editada manualmente ou se coincide com a do outro caso
    if (pushTitleInput.value === 'Confirmação de Solicitação Comercial' || !pushTitleInput.value.trim()) {
      pushTitleInput.value = 'Sua Fatura de Setembro está disponível';
    }
    if (pushContentInput.value.includes('solicitação de contato') || pushContentInput.value.includes('solicitud de contacto') || !pushContentInput.value.trim()) {
      pushContentInput.value = 'Prezado cliente, sua fatura digital de Setembro no valor de R$ 1.450,00 foi gerada com sucesso.';
    }

    logToConsole('Caso de uso selecionado: [Caso 1] Fatura / Recibo Digital Corporativo');
  } else {
    btn1.classList.remove('active');
    btn2.classList.add('active');
    panel1.style.display = 'none';
    panel2.style.display = 'block';
    heading.textContent = 'Formulário do Caso de Uso: Solicitação de Contato Telefonia Vivo';
    if (useCaseInput) useCaseInput.value = 'Solicitação de Contato Telefonia';

    if (pushTitleInput.value === 'Sua Fatura de Setembro está disponível' || !pushTitleInput.value.trim()) {
      pushTitleInput.value = 'Confirmação de Solicitação Comercial';
    }
    if (pushContentInput.value.includes('fatura digital') || pushContentInput.value.includes('factura digital') || !pushContentInput.value.trim()) {
      pushContentInput.value = 'Recebemos sua solicitação de contato para telefonia Vivo. Um consultor entrará em contato em breve.';
    }

    logToConsole('Caso de uso selecionado: [Caso 2] Solicitação de Contato Comercial Telefonia Vivo');
  }

  updateLivePreview();
}

// ==========================================
// Seletor de Integração & Atribuição de user_id
// ==========================================
function selectIntegration(integrationValue) {
  const intInput = document.getElementById('integration');
  const userIdInput = document.getElementById('user_id');
  const card3rd = document.getElementById('card-int-3rd');
  const cardDas = document.getElementById('card-int-das');

  intInput.value = integrationValue;

  if (integrationValue === '3rd Party') {
    userIdInput.value = 'quadientlatam@gmail.com';
    card3rd.classList.add('active');
    cardDas.classList.remove('active');
    logToConsole('Destino de integração: "3rd Party" &bull; ID de usuário atribuído: quadientlatam@gmail.com');
  } else {
    userIdInput.value = 'xbaGznvBRTbXKT0YOVEH30959486';
    card3rd.classList.remove('active');
    cardDas.classList.add('active');
    logToConsole('Destino de integração: "Quadient Inspire DAS" &bull; ID de usuário atribuído: xbaGznvBRTbXKT0YOVEH30959486');
  }

  updateLivePreview();
}

// ==========================================
// Extração de Dados do Caso de Uso Ativo
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
// Geração do Objeto Final para o Kafka
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
// Atualização Reativa da Visualização
// ==========================================
function handleFieldChange() {
  updateLivePreview();
}

function updateLivePreview() {
  const payload = buildFullPayloadObject();
  const jsonStr = JSON.stringify(payload, null, 2);

  // Sincronizar campo oculto content com o JSON do formulário
  const hiddenContent = document.getElementById('content');
  if (hiddenContent) {
    hiddenContent.value = JSON.stringify(payload.content);
  }

  // Visualização de código
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
    alertText.textContent = `Visualização atualizada para [Caso ${currentUseCase}]. Pronto para envio.`;
    alertBox.style.display = 'flex';
  }
  logToConsole(`Visualização gerada para o Caso de Uso ${currentUseCase}.`);
}

// ==========================================
// Envio do Formulário para o Kafka
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // Inicializar estado padrão
  selectIntegration('3rd Party');
  switchUseCase(1);

  const form = document.getElementById('kafka-form');
  if (form) {
    form.addEventListener('submit', handleFormSubmit);
  }

  logToConsole('Sistema Vivo Kafka Data Producer Studio inicializado.');
  logToConsole('Servidor web pronto para transmitir mensagens estruturadas.');
});

async function handleFormSubmit(e) {
  e.preventDefault();

  const topicInput = document.getElementById('topic');
  const topic = (topicInput.value || "").trim();
  if (!topic) {
    showBanner('error', 'Informação obrigatória ausente', 'Por favor, informe o nome do Tópico do Kafka na Seção 2.');
    switchMainScreen('kafka');
    topicInput.focus();
    return;
  }

  // Garantir payload sincronizado
  updateLivePreview();

  const payload = buildFullPayloadObject();
  const formData = new FormData();
  formData.append('topic', topic);
  formData.append('host', (document.getElementById('host').value || "").trim());
  formData.append('port', (document.getElementById('port').value || "").trim());
  formData.append('data_type', 'json');
  formData.append('type_field', 'type');
  formData.append('content_field', 'content');
  formData.append('integration_field', 'integration');
  formData.append('integration', payload.integration);
  formData.append('user_id', payload.user_id);
  formData.append('push_title', payload.push_title);
  formData.append('push_content', payload.push_content);
  formData.append('use_case', payload.use_case);
  formData.append('content', JSON.stringify(payload.content));

  setSendingState(true);
  logToConsole(`Iniciando envio para o Kafka no tópico '${topic}'...`);
  logToConsole(`Caso de uso: "${payload.use_case}" | Destino: "${payload.integration}" | user_id: "${payload.user_id}"`);

  const startTime = performance.now();

  try {
    const response = await fetch('/api/send', {
      method: 'POST',
      body: formData
    });

    const elapsedSeconds = ((performance.now() - startTime) / 1000).toFixed(2);
    const data = await response.json();

    if (response.ok && data.success) {
      const stats = data.stats || {};
      const sentCount = stats.total_sent || 1;
      statsTotalSent += sentCount;
      statsTotalTime += parseFloat(elapsedSeconds);

      updateMetrics(statsTotalSent, statsTotalTime, sentCount > 0 ? (sentCount / Math.max(elapsedSeconds, 0.01)).toFixed(1) : '0', statsTotalErrors);

      const successTitle = 'Publicação com Sucesso no Apache Kafka';
      const successMsg = `1 mensagem com estrutura JSON (Caso ${currentUseCase}) foi publicada no tópico '${topic}' em '${data.bootstrap_servers}'.`;
      showBanner('success', successTitle, successMsg);
      logToConsole(`[SUCESSO] ${successMsg} Tempo: ${elapsedSeconds}s`);

      // Abrir tela de visualização se não estava ativa
      switchMainScreen('kafka');
    } else {
      statsTotalErrors++;
      updateMetrics(statsTotalSent, statsTotalTime, '0', statsTotalErrors);
      const errMsg = data.error || 'Erro desconhecido ao processar a solicitação.';
      showBanner('error', 'Erro ao enviar para o Kafka', errMsg);
      logToConsole(`[ERRO] Falha no envio para o Kafka: ${errMsg}`);
      switchMainScreen('kafka');
    }
  } catch (err) {
    statsTotalErrors++;
    updateMetrics(statsTotalSent, statsTotalTime, '0', statsTotalErrors);
    const errMsg = err.message || 'Erro de comunicação de rede com o servidor.';
    showBanner('error', 'Erro de Rede / Conexão', errMsg);
    logToConsole(`[ERRO] Exceção de rede: ${errMsg}`);
    switchMainScreen('kafka');
  } finally {
    setSendingState(false);
  }
}

// ==========================================
// Estado de Envio e Indicadores de Carregamento
// ==========================================
function setSendingState(isSending) {
  const btnSend = document.getElementById('btn-send');
  const btnSend2 = document.getElementById('btn-send-screen2');
  const spinner = document.getElementById('btn-send-spinner');
  const btnText = document.getElementById('btn-send-text');

  if (btnSend) btnSend.disabled = isSending;
  if (btnSend2) btnSend2.disabled = isSending;

  if (spinner) spinner.style.display = isSending ? 'inline-block' : 'none';
  if (btnText) btnText.textContent = isSending ? 'Enviando para o Kafka...' : '🚀 Enviar para o Kafka';
}

// ==========================================
// Banner de Resultados
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
// Console de Logs
// ==========================================
function logToConsole(message) {
  const consoleOutput = document.getElementById('console-output');
  if (!consoleOutput) return;

  const now = new Date();
  const timeStr = now.toLocaleTimeString('pt-BR', { hour12: false });
  const logLine = `[${timeStr}] ${message}\n`;

  if (consoleOutput.textContent === 'Aguardando ações do usuário...') {
    consoleOutput.textContent = logLine;
  } else {
    consoleOutput.textContent += logLine;
  }
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function clearConsole() {
  const consoleOutput = document.getElementById('console-output');
  if (consoleOutput) {
    consoleOutput.textContent = 'Aguardando ações do usuário...';
  }
}

function copyConsoleLogs() {
  const consoleOutput = document.getElementById('console-output');
  if (!consoleOutput) return;

  navigator.clipboard.writeText(consoleOutput.textContent).then(() => {
    alert('Logs copiados para a área de transferência.');
  }).catch(err => {
    console.error('Erro ao copiar logs:', err);
  });
}
