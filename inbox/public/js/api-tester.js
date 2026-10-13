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

// Plantillas de ejemplo de HTML
const HTML_TEMPLATES = {
  factura: {
    title: "Factura Electrónica #FAC-2026-9810",
    pushTitle: "📄 Nueva Factura Disponible",
    pushBody: "Tu factura de septiembre por $1,450.00 MXN ya está disponible en tu Inbox.",
    html: `<!DOCTYPE html>
<html>
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
        <div class="company">Empresa Servicios Digitales S.A.</div>
        <div class="invoice-title">RFC: ESD120304XYZ · Folio Fiscal: 9A8B7C-6543</div>
      </div>
      <div style="text-align: right;">
        <span style="background: #dcfce7; color: #15803d; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600;">PAGADA</span>
      </div>
    </div>
    
    <p>Estimado/a cliente, confirmamos el pago de su suscripción mensual correspondiente a Septiembre 2026.</p>
    
    <table>
      <thead>
        <tr>
          <th>Concepto</th>
          <th style="text-align: center;">Cantidad</th>
          <th style="text-align: right;">Total</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Suscripción Plan Corporativo Cloud</td>
          <td style="text-align: center;">1</td>
          <td style="text-align: right;">$1,250.00</td>
        </tr>
        <tr>
          <td>Servicio de Notificaciones Push Adicionales</td>
          <td style="text-align: center;">1</td>
          <td style="text-align: right;">$200.00</td>
        </tr>
      </tbody>
    </table>

    <div class="amount-box">
      <div style="font-size: 13px; color: #475569;">Total Facturado (IVA incluido)</div>
      <div class="amount-value">$1,450.00 MXN</div>
    </div>

    <div class="footer">
      Gracias por su preferencia · Si tiene dudas, contáctenos en soporte@empresa.com
    </div>
  </div>
</body>
</html>`
  },
  alerta: {
    title: "Alerta de Seguridad: Nuevo inicio de sesión detectado",
    pushTitle: "⚠️ Alerta de Seguridad",
    pushBody: "Se detectó un nuevo inicio de sesión en tu cuenta desde un dispositivo nuevo.",
    html: `<!DOCTYPE html>
<html>
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
    <div class="title">🛡️ Aviso de Seguridad en tu Cuenta</div>
    <p>Hemos detectado un inicio de sesión reciente en tu cuenta desde una nueva ubicación o dispositivo:</p>
    <ul>
      <li><strong>Fecha:</strong> ${new Date().toLocaleString()}</li>
      <li><strong>IP:</strong> 187.190.45.12</li>
      <li><strong>Navegador:</strong> Google Chrome / Linux</li>
    </ul>
    <p>Si fuiste tú, puedes ignorar este mensaje con tranquilidad. Si no reconoces esta actividad, por favor asegura tu cuenta inmediatamente.</p>
    <a href="#" class="btn">Proteger mi cuenta</a>
  </div>
</body>
</html>`
  },
  boletin: {
    title: "Novedades del Mes: Lanzamiento de Nuevas Funcionalidades",
    pushTitle: "🚀 Nuevas funcionalidades en la plataforma",
    pushBody: "Descubre las últimas mejoras que preparamos para ti este mes.",
    html: `<!DOCTYPE html>
<html>
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
      <h2 style="margin: 0;">¡Novedades de la Plataforma!</h2>
      <p style="margin: 8px 0 0 0; opacity: 0.9;">Edición Septiembre 2026</p>
    </div>
    <div class="content">
      <p>Nos emociona compartirte las actualizaciones más recientes que optimizarán tu flujo de trabajo:</p>
      <div class="feature">
        <h4>✨ 1. Notificaciones Push Web Instantáneas</h4>
        <p>Ahora recibes actualizaciones al segundo directamente en tu navegador, sin necesidad de recargar.</p>
      </div>
      <div class="feature">
        <h4>📬 2. Bandeja de Entrada HTML Rica</h4>
        <p>Visualiza facturas, estados de cuenta y comunicaciones formateadas con soporte completo de estilos.</p>
      </div>
    </div>
  </div>
</body>
</html>`
  }
};

/**
 * Cargar plantilla seleccionada en el formulario
 */
function loadTemplate(templateKey) {
  const tpl = HTML_TEMPLATES[templateKey];
  if (!tpl) return;

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
  const userEmail = document.getElementById('tester-user-email')?.value || 'usuario@ejemplo.com';
  const title = document.getElementById('tester-title')?.value || 'Factura Septiembre';
  const pushTitle = document.getElementById('tester-push-title')?.value || 'Nueva Factura';
  const pushBody = document.getElementById('tester-push-body')?.value || 'Tu factura está lista.';
  const html = document.getElementById('tester-html')?.value || '<h1>Factura</h1>';

  const host = window.location.origin;

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
    testerSnippetCurl.textContent = `curl -X POST "${host}/api/inbox/send" \\
  -H "Content-Type: application/json" \\
  -d '${escapedJson.replace(/'/g, "'\\''")}'`;
  }

  // 2. Snippet JavaScript
  if (testerSnippetJs) {
    testerSnippetJs.textContent = `// Enviar HTML y Push desde cualquier app JS / Node
await fetch("${host}/api/inbox/send", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${JSON.stringify(payload, null, 2)})
});`;
  }

  // 3. Snippet Python
  if (testerSnippetPython) {
    testerSnippetPython.textContent = `# Enviar HTML y Push desde Python
import requests

payload = ${JSON.stringify(payload, null, 4)}

response = requests.post(
    "${host}/api/inbox/send",
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
      alert('Por favor especifica el correo del destinatario.');
      return;
    }

    try {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Enviando a la API...';

      const response = await fetch('/api/inbox/send', {
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
          `✅ <strong>¡Mensaje HTML y Push enviados con éxito!</strong><br>` +
          `• ID en Inbox: <code>${data.inboxId}</code><br>` +
          `• Notificaciones Push enviadas: <strong>${data.pushResult?.successCount || 0}</strong> dispositivo(s).<br>` +
          `• Revisa tu pestaña <strong>Bandeja de Entrada</strong> para ver el nuevo elemento recibido.`
        );
      } else {
        showTesterResult(
          'danger',
          `❌ <strong>Error de la API (${response.status}):</strong> ${data.error || 'Ocurrió un error.'}<br>` +
          (data.details ? `<small class="text-muted">${data.details}</small>` : '') +
          (data.help ? `<br><small class="text-primary">${data.help}</small>` : '')
        );
      }
    } catch (err) {
      console.error('Error enviando a la API:', err);
      showTesterResult('danger', `❌ Error de conexión con la API: ${err.message}`);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i class="bi bi-send-fill me-2"></i>Enviar vía API ahora';
    }
  });
}

function showTesterResult(type, html) {
  if (!testerResultAlert) return;
  testerResultAlert.className = `alert alert-${type} alert-dismissible fade show mt-3`;
  testerResultAlert.innerHTML = `
    ${html}
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
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
    btnElement.innerHTML = '<i class="bi bi-check2 me-1"></i>¡Copiado!';
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

// Exportar globalmente
window.updateApiExamples = updateApiExamples;
window.copyToClipboard = copyToClipboard;
