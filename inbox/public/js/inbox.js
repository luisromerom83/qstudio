/**
 * Módulo de Bandeja de Entrada (Inbox) y Visor de HTML
 * Maneja la sincronización en tiempo real con Firestore, el filtrado y el renderizado seguro en iframe.
 */

let inboxUnsubscribe = null;
let currentItems = [];
let selectedItemId = null;
let currentFilter = 'all'; // 'all' | 'unread'

// Elementos del DOM
const inboxListContainer = document.getElementById('inbox-list');
const inboxCountBadge = document.getElementById('inbox-count-badge');
const inboxSearchInput = document.getElementById('inbox-search');
const filterAllBtn = document.getElementById('filter-all-btn');
const filterUnreadBtn = document.getElementById('filter-unread-btn');

// Elementos del Visor
const viewerEmptyState = document.getElementById('viewer-empty-state');
const viewerContent = document.getElementById('viewer-content');
const viewerTitle = document.getElementById('viewer-title');
const viewerDate = document.getElementById('viewer-date');
const viewerFrame = document.getElementById('html-preview-frame');
const btnMarkUnread = document.getElementById('btn-mark-unread');
const btnDeleteMessage = document.getElementById('btn-delete-message');
const btnOpenNewTab = document.getElementById('btn-open-new-tab');
const btnPrintHtml = document.getElementById('btn-print-html');
const btnBackToInbox = document.getElementById('btn-back-to-inbox');

/**
 * Inicia la escucha en tiempo real de los mensajes del usuario en Firestore
 */
function initInboxListener(userId) {
  if (inboxUnsubscribe) {
    inboxUnsubscribe();
  }

  if (!window.db) {
    console.warn('Firestore no está disponible');
    return;
  }

  try {
    const inboxRef = window.db
      .collection('users')
      .doc(userId)
      .collection('inbox')
      .orderBy('createdAt', 'desc');

    inboxUnsubscribe = inboxRef.onSnapshot((snapshot) => {
      currentItems = [];
      snapshot.forEach(doc => {
        currentItems.push({ id: doc.id, ...doc.data() });
      });

      renderInboxList();

      // Si había un elemento seleccionado, actualizar su contenido si cambió
      if (selectedItemId) {
        const item = currentItems.find(i => i.id === selectedItemId);
        if (item) {
          displayHtmlContent(item);
        } else {
          resetViewer();
        }
      }

      // Comprobar si hay un inboxId en los parámetros de la URL (ej. clic en notificación push)
      checkUrlParams();

    }, (error) => {
      console.error('Error escuchando Firestore Inbox:', error);
      if (inboxListContainer) {
        inboxListContainer.innerHTML = `
          <div class="p-3 text-danger text-center">
            <i class="bi bi-exclamation-triangle-fill fs-4 d-block mb-2"></i>
            Error al sincronizar con Firestore.<br><small>${error.message}</small>
          </div>
        `;
      }
    });

    console.log(`📡 Escucha de Inbox iniciada para ${userId}`);
  } catch (err) {
    console.error('Error inicializando Inbox listener:', err);
  }
}

/**
 * Detiene la escucha de Firestore
 */
function detachInboxListener() {
  if (inboxUnsubscribe) {
    inboxUnsubscribe();
    inboxUnsubscribe = null;
  }
  currentItems = [];
  selectedItemId = null;
  renderInboxList();
  resetViewer();
}

/**
 * Limpia el estado de la bandeja al cerrar sesión
 */
function clearInboxState() {
  detachInboxListener();
}

/**
 * Renderiza la lista de elementos en la barra lateral
 */
function renderInboxList() {
  if (!inboxListContainer) return;

  const searchTerm = inboxSearchInput ? inboxSearchInput.value.toLowerCase().trim() : '';

  // Filtrado
  const filtered = currentItems.filter(item => {
    const matchesFilter = currentFilter === 'all' || (currentFilter === 'unread' && !item.read);
    const matchesSearch = !searchTerm ||
      (item.title && item.title.toLowerCase().includes(searchTerm)) ||
      (item.pushBody && item.pushBody.toLowerCase().includes(searchTerm));
    return matchesFilter && matchesSearch;
  });

  // Contador de no leídos
  const unreadCount = currentItems.filter(i => !i.read).length;
  if (inboxCountBadge) {
    inboxCountBadge.textContent = unreadCount;
    inboxCountBadge.className = unreadCount > 0 ? 'badge bg-primary rounded-pill' : 'badge bg-secondary rounded-pill';
  }

  if (filtered.length === 0) {
    inboxListContainer.innerHTML = `
      <div class="text-center p-4 text-muted">
        <i class="bi bi-inbox fs-1 d-block mb-2 text-secondary opacity-50"></i>
        <h6>No hay mensajes ${currentFilter === 'unread' ? 'sin leer' : 'aquí'}</h6>
        <p class="small text-secondary mb-3">Los elementos enviados desde la API externa aparecerán aquí en tiempo real.</p>
        <button class="btn btn-sm btn-outline-primary" onclick="document.getElementById('nav-tester-tab').click()">
          <i class="bi bi-send-plus me-1"></i> Probar envío vía API
        </button>
      </div>
    `;
    return;
  }

  let html = '';
  filtered.forEach(item => {
    const isSelected = item.id === selectedItemId;
    const isUnread = !item.read;
    const dateFormatted = formatDate(item.createdAt);

    html += `
      <div class="inbox-item ${isUnread ? 'unread' : ''} ${isSelected ? 'active' : ''}" 
           onclick="window.selectInboxItem('${item.id}')">
        <div class="d-flex justify-content-between align-items-start mb-1">
          <div class="d-flex align-items-center gap-2 text-truncate pe-2">
            ${isUnread ? '<span class="unread-dot"></span>' : ''}
            <span class="fw-semibold inbox-item-title text-truncate">${escapeHtml(item.title || 'Sin Título')}</span>
          </div>
          <small class="text-muted flex-shrink-0" style="font-size: 0.75rem;">${dateFormatted}</small>
        </div>
        <div class="small text-muted text-truncate mb-1">
          ${item.pushBody ? escapeHtml(item.pushBody) : 'Contenido HTML disponible'}
        </div>
        <div class="d-flex align-items-center gap-1">
          <span class="badge bg-light text-secondary border" style="font-size: 0.65rem;">
            <i class="bi bi-code-slash me-1"></i>HTML
          </span>
          ${isUnread ? '<span class="badge bg-primary-subtle text-primary border border-primary-subtle" style="font-size: 0.65rem;">Nuevo</span>' : ''}
        </div>
      </div>
    `;
  });

  inboxListContainer.innerHTML = html;
}

/**
 * Selecciona un elemento y lo renderiza en el visor HTML
 */
async function selectInboxItem(itemId) {
  if (!itemId) return;
  selectedItemId = itemId;

  // 1. Asegurar que la pestaña de Inbox esté activa
  const inboxTabBtn = document.getElementById('nav-inbox-tab');
  if (inboxTabBtn && !inboxTabBtn.classList.contains('active')) {
    if (typeof bootstrap !== 'undefined' && bootstrap.Tab) {
      const tabInstance = bootstrap.Tab.getOrCreateInstance(inboxTabBtn);
      tabInstance.show();
    } else {
      inboxTabBtn.click();
    }
  }

  // 2. Activar vista en móvil (oculta la lista de mensajes y muestra el visor)
  const inboxContainer = document.querySelector('.inbox-container');
  if (inboxContainer) {
    inboxContainer.classList.add('mobile-show-viewer');
  }

  renderInboxList();

  let item = currentItems.find(i => i.id === itemId);

  // Si no está en memoria aún (por ejemplo si la notificación llegó antes de que Firestore sincronice el snapshot)
  if (!item && window.db && window.currentUser) {
    try {
      const docSnap = await window.db
        .collection('users')
        .doc(window.currentUser.uid)
        .collection('inbox')
        .doc(itemId)
        .get();

      if (docSnap.exists) {
        item = { id: docSnap.id, ...docSnap.data() };
        currentItems.unshift(item);
        renderInboxList();
      }
    } catch (err) {
      console.warn('No se pudo obtener el mensaje directamente de Firestore:', err);
    }
  }

  if (!item) return;

  displayHtmlContent(item);

  // Actualizar URL con inboxId sin recargar la página
  try {
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('inboxId', itemId);
    window.history.replaceState(null, '', newUrl.toString());
  } catch (e) {
    // Ignorar si el contexto no permite history.replaceState
  }

  // Marcar como leído en Firestore
  if (!item.read && window.db && window.currentUser) {
    try {
      await window.db
        .collection('users')
        .doc(window.currentUser.uid)
        .collection('inbox')
        .doc(itemId)
        .update({ read: true });
      item.read = true;
      renderInboxList();
    } catch (err) {
      console.warn('No se pudo marcar como leído:', err);
    }
  }
}

/**
 * Cierra la vista del visor en móvil y regresa a la lista
 */
function closeMobileViewer() {
  const inboxContainer = document.querySelector('.inbox-container');
  if (inboxContainer) {
    inboxContainer.classList.remove('mobile-show-viewer');
  }
  selectedItemId = null;
  resetViewer();
  renderInboxList();

  try {
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.delete('inboxId');
    window.history.replaceState(null, '', newUrl.toString());
  } catch (e) {}
}

/**
 * Renderiza el contenido del HTML en el iframe de previsualización
 */
function displayHtmlContent(item) {
  if (!viewerEmptyState || !viewerContent || !viewerFrame) return;

  viewerEmptyState.classList.add('d-none');
  viewerContent.classList.remove('d-none');

  if (viewerTitle) viewerTitle.textContent = item.title || 'Sin Título';
  if (viewerDate) viewerDate.textContent = `Recibido: ${formatFullDate(item.createdAt)}`;

  // Inyectar HTML en el iframe de forma aislada
  const doc = viewerFrame.contentWindow.document;
  doc.open();
  doc.write(item.html || '<p class="text-muted p-3">No hay contenido HTML para mostrar.</p>');
  doc.close();
}

/**
 * Resetea el visor a su estado vacío
 */
function resetViewer() {
  selectedItemId = null;
  if (viewerEmptyState && viewerContent) {
    viewerEmptyState.classList.remove('d-none');
    viewerContent.classList.add('d-none');
  }
  if (viewerFrame) {
    const doc = viewerFrame.contentWindow.document;
    doc.open();
    doc.write('');
    doc.close();
  }
}

/**
 * Botón: Marcar como no leído
 */
if (btnMarkUnread) {
  btnMarkUnread.addEventListener('click', async () => {
    if (!selectedItemId || !window.currentUser || !window.db) return;
    try {
      await window.db
        .collection('users')
        .doc(window.currentUser.uid)
        .collection('inbox')
        .doc(selectedItemId)
        .update({ read: false });

      const item = currentItems.find(i => i.id === selectedItemId);
      if (item) item.read = false;
      renderInboxList();
    } catch (err) {
      console.error('Error al marcar como no leído:', err);
    }
  });
}

/**
 * Botón: Eliminar mensaje
 */
if (btnDeleteMessage) {
  btnDeleteMessage.addEventListener('click', async () => {
    if (!selectedItemId || !window.currentUser || !window.db) return;
    if (!confirm('¿Estás seguro de que deseas eliminar este mensaje de tu Inbox?')) return;

    try {
      await window.db
        .collection('users')
        .doc(window.currentUser.uid)
        .collection('inbox')
        .doc(selectedItemId)
        .delete();

      resetViewer();
      renderInboxList();
    } catch (err) {
      console.error('Error al eliminar mensaje:', err);
      alert('Error al eliminar: ' + err.message);
    }
  });
}

/**
 * Botón: Abrir HTML en nueva pestaña
 */
if (btnOpenNewTab) {
  btnOpenNewTab.addEventListener('click', () => {
    if (!selectedItemId) return;
    const item = currentItems.find(i => i.id === selectedItemId);
    if (!item || !item.html) return;

    const newWindow = window.open();
    if (newWindow) {
      newWindow.document.open();
      newWindow.document.write(item.html);
      newWindow.document.close();
    }
  });
}

/**
 * Botón: Imprimir HTML
 */
if (btnPrintHtml) {
  btnPrintHtml.addEventListener('click', () => {
    if (!viewerFrame || !viewerFrame.contentWindow) return;
    viewerFrame.contentWindow.focus();
    viewerFrame.contentWindow.print();
  });
}

/**
 * Filtros de Inbox (Todos / No leídos)
 */
if (filterAllBtn && filterUnreadBtn) {
  filterAllBtn.addEventListener('click', () => {
    currentFilter = 'all';
    filterAllBtn.classList.add('active', 'btn-primary');
    filterAllBtn.classList.remove('btn-outline-secondary');
    filterUnreadBtn.classList.remove('active', 'btn-primary');
    filterUnreadBtn.classList.add('btn-outline-secondary');
    renderInboxList();
  });

  filterUnreadBtn.addEventListener('click', () => {
    currentFilter = 'unread';
    filterUnreadBtn.classList.add('active', 'btn-primary');
    filterUnreadBtn.classList.remove('btn-outline-secondary');
    filterAllBtn.classList.remove('active', 'btn-primary');
    filterAllBtn.classList.add('btn-outline-secondary');
    renderInboxList();
  });
}

/**
 * Buscador en tiempo real
 */
if (inboxSearchInput) {
  inboxSearchInput.addEventListener('input', () => {
    renderInboxList();
  });
}

/**
 * Comprobar parámetros de URL al cargar
 */
function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const inboxId = urlParams.get('inboxId');
  if (inboxId) {
    selectInboxItem(inboxId);
  }
}

// Botón de regreso al listado en pantallas móviles
if (btnBackToInbox) {
  btnBackToInbox.addEventListener('click', closeMobileViewer);
}

// Escuchar mensajes desde el Service Worker cuando se hace clic en una notificación
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'OPEN_INBOX_ITEM' && event.data.inboxId) {
      console.log('📬 [inbox.js] Evento OPEN_INBOX_ITEM recibido vía Service Worker:', event.data.inboxId);
      selectInboxItem(event.data.inboxId);
    }
  });
}

window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'OPEN_INBOX_ITEM' && event.data.inboxId) {
    console.log('📬 [inbox.js] Evento OPEN_INBOX_ITEM recibido vía window:', event.data.inboxId);
    selectInboxItem(event.data.inboxId);
  }
});

// Utilidades de formato
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch (e) {
    return dateStr;
  }
}

function formatFullDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleString();
  } catch (e) {
    return dateStr;
  }
}

function escapeHtml(string) {
  if (!string) return '';
  return String(string)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Exportar globalmente
window.initInboxListener = initInboxListener;
window.detachInboxListener = detachInboxListener;
window.clearInboxState = clearInboxState;
window.selectInboxItem = selectInboxItem;
window.renderInboxList = renderInboxList;
