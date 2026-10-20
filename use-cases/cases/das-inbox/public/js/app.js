/**
 * Digital Advantage Inbox — front end
 * Sign-in: this app's server checks the user (api/login) and mints Quadient Cloud tokens (api/token);
 * the SDK receives them through signIn's refreshToken and asks again before the session expires.
 * Documents are listed with _runtime_fetchDCs and embedded with _runtime_getDocumentUrl. Whatever a document
 * sends (storeIncomingData / storeAndRetrieveReplyData) goes straight to Quadient Cloud, where Scaler's
 * Digital Services Input picks it up.
 */
(function () {
  const $ = id => document.getElementById(id);
  const VIEWS = ["loading", "config", "login", "inbox", "document"];
  const SESSION_CREATED = 0;
  let user = null;
  let cloudSignedIn = false;
  let documents = [];

  function show(view) {
    VIEWS.forEach(v => $(`view-${v}`).classList.toggle("d-none", v !== view));
    $("btn-back").classList.toggle("d-none", view !== "document");
    $("user-box").classList.toggle("d-none", !user || view === "login");
    $("user-box").classList.toggle("d-flex", !!user && view !== "login");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // The SDK reports dates as "/Date(1700000000000)/"
  function formatDate(value) {
    const ms = Number((/\d+/.exec(value || "") || [])[0]);
    if (!ms) return "";
    return new Date(ms).toLocaleString(currentLang, { dateStyle: "medium", timeStyle: "short" });
  }

  function send(messageId, data, timeout) {
    return new Promise((resolve, reject) => {
      gmcMobileRuntime.sendAppMessage(messageId, data, (error, result) => (error == null ? resolve(result) : reject(error)), timeout);
    });
  }

  async function api(path, options = {}) {
    const res = await fetch(path, { method: "POST", credentials: "same-origin", ...options });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  // ── Session ────────────────────────────────────────────────────────────────
  function watchSession() {
    gmcMobileRuntime.sendAppMessage("listen_sessionChange", undefined, (error, data) => {
      const wasSignedIn = cloudSignedIn;
      cloudSignedIn = error == null && data && data.status === SESSION_CREATED;
      // Expired or terminated in Quadient Cloud: back to the login screen
      if (wasSignedIn && !cloudSignedIn) {
        user = null;
        showLogin();
      }
      watchSession();
    });
  }

  function signInToCloud() {
    return send("signIn", {
      refreshToken: callback => {
        api("api/token")
          .then(json => callback(undefined, json.token))
          .catch(err => callback(err.message));
      }
    }, 30000).then(() => { cloudSignedIn = true; });
  }

  function showLogin(message) {
    $("login-error").textContent = message || "";
    $("login-error").classList.toggle("d-none", !message);
    $("login-spinner").classList.add("d-none");
    $("login-submit").disabled = false;
    show("login");
  }

  async function handleLogin(event) {
    event.preventDefault();
    $("login-submit").disabled = true;
    $("login-spinner").classList.remove("d-none");
    $("login-error").classList.add("d-none");
    try {
      const json = await api("api/login", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: $("login-username").value.trim(), password: $("login-password").value })
      });
      user = json.user;
      await signInToCloud();
      $("login-password").value = "";
      enterApp();
    } catch (err) {
      // A failed cloud sign-in leaves no usable app session either
      if (user) await api("api/logout").catch(() => {});
      user = null;
      showLogin(err.message || String(err));
    }
  }

  async function handleLogout() {
    try {
      await send("signOut", undefined, 15000);
    } catch (err) {
      console.warn("signOut:", err);
    }
    await api("api/logout").catch(() => {});
    user = null;
    cloudSignedIn = false;
    documents = [];
    location.hash = "";
    showLogin();
  }

  function enterApp() {
    $("user-name").textContent = user.subject && user.subject !== user.username ? `${user.username} (${user.subject})` : user.username;
    if (!location.hash.startsWith("#/doc/")) location.hash = "#/inbox";
    route();
  }

  // ── Inbox ──────────────────────────────────────────────────────────────────
  function renderInbox() {
    $("inbox-empty").classList.toggle("d-none", documents.length > 0);
    $("inbox-list").innerHTML = documents.map(doc => `
      <a href="#/doc/${encodeURIComponent(doc.documentId)}" class="list-group-item list-group-item-action doc-item">
        <span class="doc-icon"><i class="bi bi-file-earmark-richtext"></i></span>
        <span class="flex-grow-1 min-w-0">
          <span class="d-block doc-name">${escapeHtml(doc.name)}</span>
          ${doc.contentDescription ? `<span class="d-block doc-desc">${escapeHtml(doc.contentDescription)}</span>` : ""}
        </span>
        <span class="doc-date">${escapeHtml(formatDate(doc.created))}</span>
      </a>`).join("");
  }

  async function loadInbox() {
    $("inbox-error").classList.add("d-none");
    $("inbox-loading").classList.remove("d-none");
    $("inbox-empty").classList.add("d-none");
    $("inbox-list").innerHTML = "";
    try {
      const data = await send("_runtime_fetchDCs", { sortBy: "Created", orderDescending: true, count: 100 }, 20000);
      documents = (data && data.documents) || [];
      renderInbox();
    } catch (err) {
      $("inbox-error").textContent = `${t("das.inbox.error")} (${err})`;
      $("inbox-error").classList.remove("d-none");
    } finally {
      $("inbox-loading").classList.add("d-none");
    }
  }

  // ── Document ───────────────────────────────────────────────────────────────
  let openDocumentId = null;

  function listenResize() {
    const frame = $("doc-frame");
    if (!frame.contentWindow) return;
    gmcMobileRuntime.sendAppMessage("listen_contentDcResize", {
      targetWindow: frame.contentWindow,
      currentSize: { height: frame.offsetHeight }
    }, (error, data) => {
      if (error != null || !data || data.height == null || openDocumentId == null) return;
      frame.style.height = `${data.height}px`;
      listenResize();
    });
  }

  async function openDocument(documentId) {
    openDocumentId = documentId;
    const frame = $("doc-frame");
    frame.classList.add("d-none");
    frame.style.height = "";
    $("doc-error").classList.add("d-none");
    $("doc-loading").classList.remove("d-none");
    try {
      const data = await send("_runtime_getDocumentUrl", { documentId }, 30000);
      if (openDocumentId !== documentId) return;
      frame.onload = () => {
        $("doc-loading").classList.add("d-none");
        gmcMobileRuntime.sendAppMessage("_runtime_increaseDocumentStatOpen", { documentId }, () => {});
        listenResize();
      };
      frame.src = data.documentUrl;
      frame.classList.remove("d-none");
    } catch (err) {
      console.error("_runtime_getDocumentUrl:", err);
      $("doc-loading").classList.add("d-none");
      $("doc-error").classList.remove("d-none");
    }
  }

  function closeDocument() {
    openDocumentId = null;
    $("doc-frame").onload = null;
    $("doc-frame").src = "about:blank";
  }

  // ── Routing: #/inbox, #/doc/<id> ───────────────────────────────────────────
  function route() {
    if (!user) return;
    const match = /^#\/doc\/(.+)$/.exec(location.hash);
    if (match) {
      show("document");
      openDocument(decodeURIComponent(match[1]));
    } else {
      closeDocument();
      show("inbox");
      loadInbox();
    }
  }

  // ── Start ──────────────────────────────────────────────────────────────────
  async function start() {
    const slot = $("lang-select-slot");
    slot.innerHTML = langSelectHtml("form-select form-select-sm w-auto");
    slot.querySelector("select").value = currentLang;

    $("login-form").addEventListener("submit", handleLogin);
    // Quadient Cloud user store: accounts can be created here and are signed in like a normal login
    DasSignup.init({
      loginForm: $("login-form"),
      onSignedIn: async signedIn => {
        user = signedIn;
        try {
          await signInToCloud();
          enterApp();
        } catch (err) {
          await api("api/logout").catch(() => {});
          user = null;
          showLogin(err.message || String(err));
        }
      }
    });
    $("btn-logout").addEventListener("click", handleLogout);
    $("btn-reload").addEventListener("click", loadInbox);
    $("btn-back").addEventListener("click", event => { event.preventDefault(); location.hash = "#/inbox"; });
    $("btn-doc-retry").addEventListener("click", () => openDocumentId && openDocument(openDocumentId));
    window.addEventListener("hashchange", route);
    window.addEventListener("studio:languagechange", () => { if (documents.length) renderInbox(); });

    // web-runtime.js is not in the repository; without it there is no SDK to sign in with
    const sdkMissing = typeof gmcMobileRuntime === "undefined";
    if (sdkMissing || !window.__DAS_READY__) {
      $("sdk-missing").classList.toggle("d-none", !sdkMissing);
      $("view-config").querySelector(".alert-warning").classList.toggle("d-none", !!window.__DAS_READY__);
      show("config");
      return;
    }
    gmcMobileRuntime.init(() => ({}), () => {});
    watchSession();

    // Still signed in to this app (cookie): renew the Quadient Cloud session silently
    try {
      user = (await api("api/me", { method: "GET" })).user;
      await signInToCloud();
      enterApp();
    } catch (err) {
      user = null;
      showLogin();
    }
  }

  start();
})();
