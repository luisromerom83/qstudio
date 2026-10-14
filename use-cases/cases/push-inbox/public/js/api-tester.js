/**
 * Simulador y Probador Interactivo de la API Externa
 * Permite probar el endpoint POST /api/inbox/send y genera snippets de código listos para usar.
 */

const formApiTester = document.getElementById('form-api-tester');
const testerResultAlert = document.getElementById('tester-result-alert');
const testerTemplateSelect = document.getElementById('tester-template-select');
const testerSnippetCurl = document.getElementById('snippet-curl');
const testerSnippetJs = document.getElementById('snippet-js');
const testerSnippetPython = document.getElementById('snippet-python');

// Plantillas de ejemplo de HTML (los textos salen del diccionario del idioma activo)
const SAMPLE_TEMPLATE_BUILDERS = {
  factura: () => ({
    title: t('inbox.sample.invoice.title'),
    pushTitle: t('inbox.sample.invoice.pushTitle'),
    pushBody: t('inbox.sample.invoice.pushBody'),
    html: `<!DOCTYPE html>
<html lang="${currentLang}">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 24px; color: #1e293b; background: #ffffff; }
    .invoice-card { max-width: 650px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #3b82f6; padding-bottom: 16px; margin-bottom: 20px; }
    .company { font-size: 20px; font-weight: 700; color: #1e3a8a; }
    .invoice-title { font-size: 14px; color: #64748b; }
    .amount-box { background: #eff6ff; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center; }
    .amount-value { font-size: 28px; font-weight: 800; color: #1d4ed8; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th { text-align: left; padding: 8px; border-bottom: 1px solid #cbd5e1; font-size: 13px; color: #64748b; }
    td { padding: 10px 8px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    .footer { text-align: center; margin-top: 24px; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="invoice-card">
    <div class="header">
      <div>
        <div class="company">${t('inbox.sample.invoice.company')}</div>
        <div class="invoice-title">${t('inbox.sample.invoice.taxLine')}</div>
      </div>
      <div style="text-align: right;">
        <span style="background: #dcfce7; color: #15803d; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600;">${t('inbox.sample.invoice.paid')}</span>
      </div>
    </div>
    
    <p>${t('inbox.sample.invoice.greeting')}</p>
    
    <table>
      <thead>
        <tr>
          <th>${t('inbox.sample.invoice.colConcept')}</th>
          <th style="text-align: center;">${t('inbox.sample.invoice.colQty')}</th>
          <th style="text-align: right;">${t('inbox.sample.invoice.colTotal')}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${t('inbox.sample.invoice.line1')}</td>
          <td style="text-align: center;">1</td>
          <td style="text-align: right;">${t('inbox.sample.invoice.line1Amount')}</td>
        </tr>
        <tr>
          <td>${t('inbox.sample.invoice.line2')}</td>
          <td style="text-align: center;">1</td>
          <td style="text-align: right;">${t('inbox.sample.invoice.line2Amount')}</td>
        </tr>
      </tbody>
    </table>

    <div class="amount-box">
      <div style="font-size: 13px; color: #475569;">${t('inbox.sample.invoice.totalLabel')}</div>
      <div class="amount-value">${t('inbox.sample.invoice.totalAmount')}</div>
    </div>

    <div class="footer">
      ${t('inbox.sample.invoice.footer')}
    </div>
  </div>
</body>
</html>`
  }),
  alerta: () => ({
    title: t('inbox.sample.alert.title'),
    pushTitle: t('inbox.sample.alert.pushTitle'),
    pushBody: t('inbox.sample.alert.pushBody'),
    html: `<!DOCTYPE html>
<html lang="${currentLang}">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui, sans-serif; padding: 20px; color: #334155; }
    .box { border: 1px solid #fecaca; background: #fff5f5; border-radius: 8px; padding: 20px; max-width: 550px; margin: 0 auto; }
    .title { color: #dc2626; font-size: 18px; font-weight: bold; margin-bottom: 10px; }
    .btn { display: inline-block; background: #dc2626; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="box">
    <div class="title">${t('inbox.sample.alert.heading')}</div>
    <p>${t('inbox.sample.alert.intro')}</p>
    <ul>
      <li><strong>${t('inbox.sample.alert.date')}</strong> ${new Date().toLocaleString(currentLang)}</li>
      <li><strong>IP:</strong> 187.190.45.12</li>
      <li><strong>${t('inbox.sample.alert.browser')}</strong> Google Chrome / Linux</li>
    </ul>
    <p>${t('inbox.sample.alert.ignore')}</p>
    <a href="#" class="btn">${t('inbox.sample.alert.button')}</a>
  </div>
</body>
</html>`
  }),
  boletin: () => ({
    title: t('inbox.sample.news.title'),
    pushTitle: t('inbox.sample.news.pushTitle'),
    pushBody: t('inbox.sample.news.pushBody'),
    html: `<!DOCTYPE html>
<html lang="${currentLang}">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; color: #1e293b; }
    .card { max-width: 600px; margin: 0 auto; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; }
    .banner { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: white; padding: 30px 20px; text-align: center; }
    .content { padding: 24px; }
    .feature { margin-bottom: 16px; }
    .feature h4 { margin: 0 0 4px 0; color: #4338ca; }
  </style>
</head>
<body>
  <div class="card">
    <div class="banner">
      <h2 style="margin: 0;">${t('inbox.sample.news.heading')}</h2>
      <p style="margin: 8px 0 0 0; opacity: 0.9;">${t('inbox.sample.news.edition')}</p>
    </div>
    <div class="content">
      <p>${t('inbox.sample.news.intro')}</p>
      <div class="feature">
        <h4>${t('inbox.sample.news.f1Title')}</h4>
        <p>${t('inbox.sample.news.f1Text')}</p>
      </div>
      <div class="feature">
        <h4>${t('inbox.sample.news.f2Title')}</h4>
        <p>${t('inbox.sample.news.f2Text')}</p>
      </div>
    </div>
  </div>
</body>
</html>`
  })
};

// Valores de la última plantilla cargada: si el usuario no los editó, se recargan al cambiar de idioma
let loadedTemplate = null;

/**
 * Cargar plantilla seleccionada en el formulario
 */
function loadTemplate(templateKey) {
  const build = SAMPLE_TEMPLATE_BUILDERS[templateKey];
  if (!build) return;
  const tpl = build();
  loadedTemplate = { key: templateKey, values: tpl };

  const inputTitle = document.getElementById('tester-title');
  const inputPushTitle = document.getElementById('tester-push-title');
  const inputPushBody = document.getElementById('tester-push-body');
  const inputHtml = document.getElementById('tester-html');

  if (inputTitle) inputTitle.value = tpl.title;
  if (inputPushTitle) inputPushTitle.value = tpl.pushTitle;
  if (inputPushBody) inputPushBody.value = tpl.pushBody;
  if (inputHtml) inputHtml.value = tpl.html;

  updateApiExamples();
}

if (testerTemplateSelect) {
  testerTemplateSelect.addEventListener('change', (e) => {
    loadTemplate(e.target.value);
  });
}

/**
 * Actualizar snippets de código dinámicamente con los valores actuales del formulario
 */
function updateApiExamples() {
  const userEmail = document.getElementById('tester-user-email')?.value || t('inbox.tester.defaultEmail');
  const title = document.getElementById('tester-title')?.value || t('inbox.tester.defaultTitle');
  const pushTitle = document.getElementById('tester-push-title')?.value || t('inbox.tester.defaultPushTitle');
  const pushBody = document.getElementById('tester-push-body')?.value || t('inbox.tester.defaultPushBody');
  const html = document.getElementById('tester-html')?.value || `<h1>${t('inbox.tester.defaultHtmlHeading')}</h1>`;

  const endpoint = new URL('api/inbox/send', window.location.href).href;

  const payload = {
    userEmail: userEmail,
    title: title,
    pushTitle: pushTitle,
    pushBody: pushBody,
    html: html
  };

  // 1. Snippet cURL
  if (testerSnippetCurl) {
    const escapedJson = JSON.stringify(payload, null, 2);
    testerSnippetCurl.textContent = `curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -d '${escapedJson.replace(/'/g, "'\\''")}'`;
  }

  // 2. Snippet JavaScript
  if (testerSnippetJs) {
    testerSnippetJs.textContent = `// ${t('inbox.tester.snippetJsComment')}
await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${JSON.stringify(payload, null, 2)})
});`;
  }

  // 3. Snippet Python
  if (testerSnippetPython) {
    testerSnippetPython.textContent = `# ${t('inbox.tester.snippetPyComment')}
import requests

payload = ${JSON.stringify(payload, null, 4)}

response = requests.post(
    "${endpoint}",
    json=payload
)
print(response.json())`;
  }
}

// Escuchar cambios en los inputs para actualizar los ejemplos en vivo
['tester-user-email', 'tester-title', 'tester-push-title', 'tester-push-body', 'tester-html'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', updateApiExamples);
  }
});

/**
 * Envío del formulario de prueba
 */
if (formApiTester) {
  formApiTester.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btnSubmit = formApiTester.querySelector('button[type="submit"]');
    const userEmail = document.getElementById('tester-user-email').value.trim();
    const title = document.getElementById('tester-title').value.trim();
    const pushTitle = document.getElementById('tester-push-title').value.trim();
    const pushBody = document.getElementById('tester-push-body').value.trim();
    const html = document.getElementById('tester-html').value;

    if (!userEmail) {
      alert(t('inbox.tester.recipientRequired'));
      return;
    }

    try {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${t('inbox.tester.sending')}`;

      const response = await fetch('api/inbox/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userEmail,
          title,
          pushTitle,
          pushBody,
          html
        })
      });

      const data = await response.json();

      if (response.ok) {
        showTesterResult(
          'success',
          `✅ <strong>${t('inbox.tester.successTitle')}</strong><br>` +
          `• ${t('inbox.tester.successInboxId', { id: escapeHtml(data.inboxId) })}<br>` +
          `• ${t('inbox.tester.successPushCount', { count: data.pushResult?.successCount || 0 })}<br>` +
          `• ${t('inbox.tester.successCheckInbox')}`
        );
      } else {
        showTesterResult(
          'danger',
          `❌ <strong>${t('inbox.tester.apiError', { status: response.status })}</strong> ${escapeHtml(data.error || t('inbox.tester.genericError'))}<br>` +
          (data.details ? `<small class="text-muted">${escapeHtml(data.details)}</small>` : '') +
          (data.help ? `<br><small class="text-primary">${escapeHtml(data.help)}</small>` : '')
        );
      }
    } catch (err) {
      console.error('Error enviando a la API:', err);
      showTesterResult('danger', `❌ ${t('inbox.tester.connectionError', { error: escapeHtml(err.message) })}`);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `<i class="bi bi-send-fill me-2"></i><span data-i18n="inbox.tester.send">${t('inbox.tester.send')}</span>`;
    }
  });
}

function showTesterResult(type, html) {
  if (!testerResultAlert) return;
  testerResultAlert.className = `alert alert-${type} alert-dismissible fade show mt-3`;
  testerResultAlert.innerHTML = `
    ${html}
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="${t('inbox.common.close')}"></button>
  `;
  testerResultAlert.classList.remove('d-none');
}

/**
 * Función para copiar texto al portapapeles
 */
function copyToClipboard(elementId, btnElement) {
  const el = document.getElementById(elementId);
  if (!el) return;

  navigator.clipboard.writeText(el.textContent).then(() => {
    const originalHtml = btnElement.innerHTML;
    btnElement.innerHTML = `<i class="bi bi-check2 me-1"></i>${t('inbox.tester.copied')}`;
    btnElement.classList.replace('btn-outline-light', 'btn-success');
    setTimeout(() => {
      btnElement.innerHTML = originalHtml;
      btnElement.classList.replace('btn-success', 'btn-outline-light');
    }, 2000);
  }).catch(err => {
    console.error('Error al copiar:', err);
  });
}

// Inicializar plantilla por defecto al cargar
window.addEventListener('DOMContentLoaded', () => {
  loadTemplate('factura');
});

// Al cambiar de idioma: la plantilla se recarga si el usuario no la editó; los snippets siempre se regeneran
function testerFormMatchesTemplate() {
  if (!loadedTemplate) return false;
  const v = loadedTemplate.values;
  return document.getElementById('tester-title')?.value === v.title
    && document.getElementById('tester-push-title')?.value === v.pushTitle
    && document.getElementById('tester-push-body')?.value === v.pushBody
    && document.getElementById('tester-html')?.value === v.html;
}

window.addEventListener('studio:languagechange', () => {
  if (testerFormMatchesTemplate()) {
    loadTemplate(loadedTemplate.key);
  } else {
    updateApiExamples();
  }
  if (testerResultAlert) testerResultAlert.classList.add('d-none');
});

// Exportar globalmente
window.updateApiExamples = updateApiExamples;
window.copyToClipboard = copyToClipboard;
