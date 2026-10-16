/**
 * Custom demo — front end
 * Opens one document of a Quadient Cloud application with the Anonymous Access provider, without credentials:
 * this app's server gets the anonymous token (api/token), the SDK receives it through signIn's refreshToken and
 * embeds the document with _runtime_getDocumentUrl. Whatever the document sends goes straight to Quadient Cloud.
 */
(function () {
  const $ = id => document.getElementById(id);
  const VIEWS = ["loading", "error", "document"];
  const demo = window.__DAS_DEMO__ || {};
  let lastError = null;

  function show(view) {
    VIEWS.forEach(v => $(`view-${v}`).classList.toggle("d-none", v !== view));
  }

  function renderError() {
    if (!lastError) return;
    $("error-title").textContent = t(lastError.title);
    $("error-body").textContent = lastError.detail ? `${t(lastError.body)} (${lastError.detail})` : t(lastError.body);
    $("btn-retry").classList.toggle("d-none", !lastError.retry);
  }

  function fail(title, body, detail, retry = true) {
    lastError = { title, body, detail, retry };
    renderError();
    show("error");
  }

  function send(messageId, data, timeout) {
    return new Promise((resolve, reject) => {
      gmcMobileRuntime.sendAppMessage(messageId, data, (error, result) => (error == null ? resolve(result) : reject(error)), timeout);
    });
  }

  // Anonymous access is the application's "Public" provider
  async function hasAnonymousAccess() {
    const res = await fetch(`${CLOUD_URL}/api/query/MobileBackend/IdentityProviderSignInData`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ ApplicationId: CLOUD_APP_ID, AuthenticationClientId: CLOUD_CLIENT_ID })
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.error || JSON.stringify(json.error));
    return (json.identityProviderSignInData || []).some(p => p.identityProviderType === "Public");
  }

  function signIn() {
    return send("signIn", {
      refreshToken: callback => {
        fetch("api/token", { method: "POST" })
          .then(res => res.json().then(json => (res.ok ? callback(undefined, json.token) : callback(json.error || `HTTP ${res.status}`))))
          .catch(err => callback(err.message));
      }
    }, 30000);
  }

  function listenResize() {
    const frame = $("doc-frame");
    if (!frame.contentWindow) return;
    gmcMobileRuntime.sendAppMessage("listen_contentDcResize", {
      targetWindow: frame.contentWindow,
      currentSize: { height: frame.offsetHeight }
    }, (error, data) => {
      if (error != null || !data || data.height == null) return;
      frame.style.height = `${data.height}px`;
      listenResize();
    });
  }

  async function openDocument() {
    lastError = null;
    show("loading");
    let anonymous;
    try {
      anonymous = await hasAnonymousAccess();
    } catch (err) {
      return fail("demo.error.appTitle", "demo.error.appBody", err.message || String(err));
    }
    if (!anonymous) return fail("demo.error.anonymousTitle", "demo.error.anonymousBody", "", false);
    try {
      await signIn();
      const data = await send("_runtime_getDocumentUrl", { documentId: demo.documentId }, 30000);
      const frame = $("doc-frame");
      frame.style.height = "";
      frame.onload = () => {
        gmcMobileRuntime.sendAppMessage("_runtime_increaseDocumentStatOpen", { documentId: demo.documentId }, () => {});
        listenResize();
      };
      frame.src = data.documentUrl;
      show("document");
    } catch (err) {
      fail("demo.error.docTitle", "demo.error.docBody", typeof err === "string" ? err : (err.message || JSON.stringify(err)));
    }
  }

  function start() {
    $("demo-name").textContent = demo.name || "";
    document.title = demo.name || document.title;
    const slot = $("lang-select-slot");
    slot.innerHTML = langSelectHtml("form-select form-select-sm w-auto");
    slot.querySelector("select").value = currentLang;
    $("btn-retry").addEventListener("click", openDocument);
    window.addEventListener("studio:languagechange", renderError);

    // web-runtime.js is not in the repository; without it there is no SDK to open the document with
    if (typeof gmcMobileRuntime === "undefined") return fail("demo.sdk.title", "demo.sdk.body", "", false);
    if (!demo.ready) return fail("demo.config.title", "demo.config.body", "", false);
    gmcMobileRuntime.init(() => ({}), () => {});
    openDocument();
  }

  start();
})();
