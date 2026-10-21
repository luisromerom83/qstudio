/**
 * Online banking — front end
 * Sign-in is the Digital Advantage Inbox's: this app's server checks the user (api/login) and mints Quadient Cloud
 * tokens (api/token) that the SDK receives through signIn's refreshToken. The "Statements" section is the DAS
 * inbox (_runtime_fetchDCs / _runtime_getDocumentUrl), limited to the documents whose metadata matches Studio
 * Manager › Settings › Quadient Cloud (DocType = accstt by default). Balances, accounts, cards, movements and contacts are sample
 * data generated from the username, so each demo user always sees the same bank.
 */
(function () {
  const $ = id => document.getElementById(id);
  const VIEWS = ["loading", "config", "login", "app"];
  const SECTIONS = ["home", "accounts", "cards", "transfers", "statements", "document"];
  const SESSION_CREATED = 0;
  const CURRENCY = { "es-MX": ["MXN", 1], "en-US": ["USD", 0.06], "pt-BR": ["BRL", 0.3] };

  let user = null;
  let cloudSignedIn = false;
  let bank = null;              // sample data of the signed-in user
  let selectedAccount = "checking";
  let statements = null;        // DAS documents, loaded right after sign-in
  let statementsLoading = null; // the request in flight, so the menu badge and the section share it
  let openDocumentId = null;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function show(view) {
    VIEWS.forEach(v => $(`view-${v}`).classList.toggle("d-none", v !== view));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function money(amount) {
    const [code, rate] = CURRENCY[currentLang] || CURRENCY["es-MX"];
    return new Intl.NumberFormat(currentLang, { style: "currency", currency: code }).format(amount * rate);
  }

  function shortDate(date) {
    return date.toLocaleDateString(currentLang, { day: "numeric", month: "short" });
  }

  // The SDK reports dates as "/Date(1700000000000)/"
  function sdkDate(value) {
    const ms = Number((/\d+/.exec(value || "") || [])[0]);
    return ms ? new Date(ms).toLocaleDateString(currentLang, { year: "numeric", month: "long", day: "numeric" }) : "";
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

  function toast(message) {
    $("toast-body").textContent = message;
    bootstrap.Toast.getOrCreateInstance($("toast")).show();
  }

  function langSelect(slotId) {
    const slot = $(slotId);
    slot.innerHTML = langSelectHtml("form-select form-select-sm w-auto");
    slot.querySelector("select").value = currentLang;
  }

  // ── Sample bank data, the same every time for a given user ─────────────────
  function seededRandom(text) {
    let seed = 0;
    for (const ch of text) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) | 0;
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const MERCHANTS = [
    { key: "bank.mv.payroll", icon: "briefcase", credit: true, min: 18000, max: 32000, weight: 1 },
    { key: "bank.mv.transferIn", icon: "arrow-down-left", credit: true, min: 500, max: 4000, weight: 2 },
    { text: "Supermercado La Esquina", icon: "cart3", min: 350, max: 2400, weight: 4 },
    { text: "Netflix", icon: "play-btn", min: 199, max: 299, weight: 1 },
    { text: "Amazon", icon: "bag", min: 250, max: 3200, weight: 2 },
    { text: "Uber", icon: "car-front", min: 80, max: 420, weight: 3 },
    { key: "bank.mv.gas", icon: "fuel-pump", min: 600, max: 1200, weight: 2 },
    { key: "bank.mv.electricity", icon: "lightning-charge", min: 450, max: 1300, weight: 1 },
    { key: "bank.mv.pharmacy", icon: "capsule", min: 120, max: 900, weight: 2 },
    { key: "bank.mv.restaurant", icon: "cup-hot", min: 280, max: 1600, weight: 3 },
    { key: "bank.mv.atm", icon: "cash-stack", min: 500, max: 3000, weight: 1 },
    { key: "bank.mv.transferOut", icon: "arrow-up-right", min: 300, max: 5000, weight: 2 }
  ];

  function buildBank(username) {
    const rnd = seededRandom(username);
    const between = (min, max) => Math.round((min + rnd() * (max - min)) * 100) / 100;
    const digits = n => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join("");
    const pick = list => {
      const total = list.reduce((s, m) => s + (m.weight || 1), 0);
      let r = rnd() * total;
      return list.find(m => (r -= m.weight || 1) < 0) || list[0];
    };
    const movements = (count, days, pool) => {
      const today = new Date();
      return Array.from({ length: count }, () => {
        const m = pick(pool);
        const date = new Date(today);
        date.setDate(today.getDate() - Math.floor(rnd() * days));
        return { ...m, date, amount: (m.credit ? 1 : -1) * between(m.min, m.max) };
      }).sort((a, b) => b.date - a.date);
    };

    const checkingNumber = digits(4);
    const accounts = [
      { id: "checking", nameKey: "bank.acct.checking", icon: "wallet2", number: checkingNumber, balance: between(28000, 95000),
        movements: movements(14, 30, MERCHANTS) },
      { id: "savings", nameKey: "bank.acct.savings", icon: "piggy-bank", number: digits(4), balance: between(60000, 250000), rate: "6.5%",
        movements: movements(5, 90, MERCHANTS.filter(m => m.key === "bank.mv.transferIn" || m.key === "bank.mv.transferOut")) },
      { id: "investment", nameKey: "bank.acct.investment", icon: "graph-up-arrow", number: digits(4), balance: between(120000, 480000), rate: "10.2%",
        movements: movements(3, 120, [{ key: "bank.mv.yield", icon: "graph-up", credit: true, min: 600, max: 3500 }]) }
    ];
    const cardLimit = Math.round(between(60000, 180000) / 1000) * 1000;
    const cards = [
      { id: "credit", nameKey: "bank.card.credit", kind: "credit", number: digits(4), limit: cardLimit, used: between(4000, cardLimit * 0.45),
        cutDay: 5 + Math.floor(rnd() * 20), movements: movements(8, 30, MERCHANTS.filter(m => !m.credit && m.key !== "bank.mv.atm")) },
      { id: "debit", nameKey: "bank.card.debit", kind: "debit", number: checkingNumber, account: "checking" }
    ];
    const contacts = ["María González", "Carlos Ramírez", "Ana Torres", "Jorge Méndez", "Lucía Fernández"].map(name => ({
      name, bank: ["Banco del Norte", "Banco Azul", "Finanzas Unidas"][Math.floor(rnd() * 3)], number: digits(4)
    }));
    return { accounts, cards, contacts };
  }

  function account(id) {
    return bank.accounts.find(a => a.id === id);
  }

  function movementHtml(m) {
    return `
      <div class="movement">
        <span class="movement-icon"><i class="bi bi-${m.icon}"></i></span>
        <div class="flex-grow-1 min-w-0">
          <div class="fw-semibold text-truncate">${escapeHtml(m.text || t(m.key))}</div>
          <div class="small text-secondary">${escapeHtml(shortDate(m.date))}</div>
        </div>
        <span class="movement-amount ${m.amount > 0 ? "is-credit" : ""}">${m.amount > 0 ? "+" : "−"}${escapeHtml(money(Math.abs(m.amount)))}</span>
      </div>`;
  }

  // ── Sections ───────────────────────────────────────────────────────────────
  function renderHome() {
    const credit = bank.cards.find(c => c.kind === "credit");
    const hour = new Date().getHours();
    const greetingKey = hour < 12 ? "bank.home.morning" : hour < 19 ? "bank.home.afternoon" : "bank.home.evening";
    $("greeting").textContent = t(greetingKey, { name: user.displayName });
    $("today-label").textContent = new Date().toLocaleDateString(currentLang, { weekday: "long", day: "numeric", month: "long" });

    const total = bank.accounts.reduce((s, a) => s + a.balance, 0);
    const tile = (cls, icon, label, amount, meta, href) => `
      <div class="col-sm-6 col-xl-3">
        <a href="${href}" class="summary-card ${cls}">
          <div class="d-flex align-items-center justify-content-between">
            <span class="label">${escapeHtml(label)}</span>
            <span class="summary-icon"><i class="bi bi-${icon}"></i></span>
          </div>
          <div class="amount">${escapeHtml(amount)}</div>
          <div class="meta">${escapeHtml(meta)}</div>
        </a>
      </div>`;
    $("summary-cards").innerHTML = [
      tile("is-featured", "bank", t("bank.home.total"), money(total), t("bank.home.totalMeta", { count: bank.accounts.length }), "#/accounts"),
      tile("", "wallet2", t("bank.acct.checking"), money(account("checking").balance), `•••• ${account("checking").number}`, "#/accounts"),
      tile("", "piggy-bank", t("bank.acct.savings"), money(account("savings").balance), t("bank.acct.rate", { rate: account("savings").rate }), "#/accounts"),
      tile("", "credit-card", t("bank.card.credit"), money(credit.limit - credit.used), t("bank.card.available"), "#/cards")
    ].join("");

    const recent = [...account("checking").movements, ...credit.movements].sort((a, b) => b.date - a.date).slice(0, 6);
    $("recent-movements").innerHTML = recent.map(movementHtml).join("");
  }

  function renderAccounts() {
    $("account-list").innerHTML = bank.accounts.map(a => `
      <div class="col-md-4">
        <button type="button" class="summary-card account-tile ${a.id === selectedAccount ? "active" : ""}" data-account="${a.id}">
          <div class="d-flex align-items-center justify-content-between">
            <span class="label">${escapeHtml(t(a.nameKey))}</span>
            <span class="summary-icon"><i class="bi bi-${a.icon}"></i></span>
          </div>
          <div class="amount">${escapeHtml(money(a.balance))}</div>
          <div class="meta">•••• ${a.number}${a.rate ? ` · ${escapeHtml(t("bank.acct.rate", { rate: a.rate }))}` : ""}</div>
        </button>
      </div>`).join("");
    const selected = account(selectedAccount);
    $("account-movements-title").textContent = t("bank.accounts.movements", { account: t(selected.nameKey) });
    $("account-movements").innerHTML = selected.movements.map(movementHtml).join("");
  }

  function renderCards() {
    $("card-list").innerHTML = bank.cards.map(c => {
      const linked = c.account ? account(c.account) : null;
      const details = c.kind === "credit"
        ? [
            [t("bank.card.limit"), money(c.limit)],
            [t("bank.card.balance"), money(c.used)],
            [t("bank.card.available"), money(c.limit - c.used)],
            [t("bank.card.cutDay"), t("bank.card.dayOfMonth", { day: c.cutDay })],
            [t("bank.card.minPayment"), money(Math.round(c.used * 0.08))]
          ]
        : [[t("bank.card.linkedTo"), `${t(linked.nameKey)} •••• ${linked.number}`], [t("bank.card.available"), money(linked.balance)]];
      return `
        <div class="col-lg-6">
          <div class="panel p-4 h-100">
            <div class="bank-card ${c.kind === "debit" ? "is-debit" : ""} mb-4">
              <div class="d-flex justify-content-between align-items-start position-relative">
                <span class="fw-bold">${escapeHtml(t(c.nameKey))}</span>
                <span data-brand-logo class="small fw-bold opacity-75"><i class="bi bi-bank2"></i></span>
              </div>
              <div class="chip position-relative"></div>
              <div class="position-relative">
                <div class="number">•••• •••• •••• ${c.number}</div>
                <div class="small opacity-75 mt-1 text-uppercase">${escapeHtml(user.displayName)}</div>
              </div>
            </div>
            <dl class="row small mb-0">
              ${details.map(([k, v]) => `<dt class="col-6 text-secondary fw-normal">${escapeHtml(k)}</dt><dd class="col-6 text-end fw-semibold">${escapeHtml(v)}</dd>`).join("")}
            </dl>
          </div>
        </div>`;
    }).join("");
  }

  function renderTransfers() {
    $("transfer-from").innerHTML = bank.accounts.map(a =>
      `<option value="${a.id}">${escapeHtml(t(a.nameKey))} •••• ${a.number} — ${escapeHtml(money(a.balance))}</option>`).join("");
    const own = bank.accounts.map(a => `<option value="own:${a.id}">${escapeHtml(t("bank.transfers.own", { account: t(a.nameKey) }))} •••• ${a.number}</option>`);
    const others = bank.contacts.map((c, i) => `<option value="contact:${i}">${escapeHtml(c.name)} · ${escapeHtml(c.bank)} •••• ${c.number}</option>`);
    $("transfer-to").innerHTML = `<optgroup label="${escapeHtml(t("bank.transfers.contacts"))}">${others.join("")}</optgroup>
      <optgroup label="${escapeHtml(t("bank.transfers.ownAccounts"))}">${own.join("")}</optgroup>`;
    $("contact-list").innerHTML = bank.contacts.map((c, i) => `
      <button type="button" class="contact" data-contact="${i}">
        <span class="avatar">${escapeHtml(c.name.split(" ").map(w => w[0]).join(""))}</span>
        <span class="flex-grow-1 min-w-0">
          <span class="d-block fw-semibold">${escapeHtml(c.name)}</span>
          <span class="d-block small text-secondary">${escapeHtml(c.bank)} •••• ${c.number}</span>
        </span>
        <i class="bi bi-chevron-right text-secondary"></i>
      </button>`).join("");
  }

  // Sample transfer: moves the money between the in-memory accounts and shows a confirmation
  function handleTransfer(event) {
    event.preventDefault();
    const result = $("transfer-result");
    const from = account($("transfer-from").value);
    const to = $("transfer-to").value;
    const amount = Number($("transfer-amount").value);
    const fail = key => {
      result.className = "alert alert-danger small";
      result.textContent = t(key);
    };
    if (!(amount > 0)) return fail("bank.transfers.errorAmount");
    if (to === `own:${from.id}`) return fail("bank.transfers.errorSame");
    // Entered in the display currency; the sample data is kept in the base one
    const base = Math.round((amount / (CURRENCY[currentLang] || CURRENCY["es-MX"])[1]) * 100) / 100;
    if (base > from.balance) return fail("bank.transfers.errorFunds");

    const concept = $("transfer-concept").value.trim();
    const [kind, ref] = to.split(":");
    const target = kind === "own" ? account(ref) : bank.contacts[Number(ref)];
    from.balance -= base;
    from.movements.unshift({ text: concept || t("bank.transfers.movementTo", { name: kind === "own" ? t(target.nameKey) : target.name }), icon: "arrow-up-right", date: new Date(), amount: -base });
    if (kind === "own") {
      target.balance += base;
      target.movements.unshift({ text: concept || t("bank.mv.transferIn"), icon: "arrow-down-left", date: new Date(), amount: base });
    }
    const folio = String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
    result.className = "alert alert-success small";
    result.textContent = t("bank.transfers.done", { amount: money(base), folio });
    $("transfer-form").reset();
    renderTransfers();
    toast(t("bank.transfers.toast"));
  }

  // ── Statements: the Digital Advantage Inbox ────────────────────────────────
  function renderStatements() {
    const list = statements || [];
    $("statements-empty").classList.toggle("d-none", !statements || list.length > 0);
    $("statements-list").innerHTML = list.map(doc => `
      <a href="#/statements/${encodeURIComponent(doc.documentId)}" class="statement">
        <span class="statement-icon"><i class="bi bi-file-earmark-richtext"></i></span>
        <span class="name">${escapeHtml(doc.name)}</span>
        ${doc.contentDescription ? `<span class="desc">${escapeHtml(doc.contentDescription)}</span>` : ""}
        <span class="foot">
          <span>${escapeHtml(sdkDate(doc.created))}</span>
          <span class="open">${escapeHtml(t("bank.statements.open"))} <i class="bi bi-arrow-right"></i></span>
        </span>
      </a>`).join("");
    const badge = $("statements-badge");
    badge.textContent = list.length;
    badge.classList.toggle("d-none", !list.length);
  }

  function loadStatements() {
    if (!statementsLoading) statementsLoading = fetchStatements().finally(() => { statementsLoading = null; });
    return statementsLoading;
  }

  async function fetchStatements() {
    $("statements-error").classList.add("d-none");
    $("statements-loading").classList.remove("d-none");
    $("statements-empty").classList.add("d-none");
    $("statements-list").innerHTML = "";
    try {
      // Only the monthly statements: documents carrying the configured metadata (exact, case-sensitive match)
      const meta = window.__DAS_STATEMENTS_META__;
      const filter = meta && meta.name
        ? { propertyConditions: [], metadataConditions: [{ not: false, operation: "equals", name: meta.name, value: meta.value }] }
        : undefined;
      const data = await send("_runtime_fetchDCs", { sortBy: "Created", orderDescending: true, count: 100, filter }, 20000);
      statements = (data && data.documents) || [];
    } catch (err) {
      statements = null;
      $("statements-error").textContent = `${t("bank.statements.error")} (${err})`;
      $("statements-error").classList.remove("d-none");
    } finally {
      $("statements-loading").classList.add("d-none");
    }
    renderStatements();
  }

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

  // ── Routing: #/home, #/accounts, #/cards, #/transfers, #/statements, #/statements/<id> ──
  function route() {
    if (!user) return;
    const match = /^#\/([a-z]+)(?:\/(.+))?$/.exec(location.hash) || [];
    let section = SECTIONS.includes(match[1]) ? match[1] : "home";
    if (section === "statements" && match[2]) section = "document";
    if (section !== "document") closeDocument();

    SECTIONS.forEach(s => $(`section-${s}`).classList.toggle("d-none", s !== section));
    document.querySelectorAll(".side-nav a").forEach(a => {
      a.classList.toggle("active", a.dataset.section === (section === "document" ? "statements" : section));
    });

    if (section === "home") renderHome();
    else if (section === "accounts") renderAccounts();
    else if (section === "cards") renderCards();
    else if (section === "transfers") renderTransfers();
    else if (section === "statements") (statements ? renderStatements() : loadStatements());
    else openDocument(decodeURIComponent(match[2]));
    window.scrollTo(0, 0);
  }

  // ── Session ────────────────────────────────────────────────────────────────
  function watchSession() {
    gmcMobileRuntime.sendAppMessage("listen_sessionChange", undefined, (error, data) => {
      const wasSignedIn = cloudSignedIn;
      cloudSignedIn = error == null && data && data.status === SESSION_CREATED;
      // Expired or terminated in Quadient Cloud: back to the sign-in page
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
    langSelect("login-lang-slot");
    show("login");
  }

  function displayName(username) {
    return username.replace(/[._-]+/g, " ").replace(/\b\p{L}/gu, c => c.toUpperCase());
  }

  function enterApp(sessionUser) {
    user = { ...sessionUser, displayName: displayName(sessionUser.username) };
    bank = buildBank(sessionUser.subject || sessionUser.username);
    statements = null;
    selectedAccount = "checking";
    $("user-name").textContent = user.displayName;
    langSelect("app-lang-slot");
    show("app");
    // Load the statements right away so the menu shows how many there are
    loadStatements();
    if (!/^#\/[a-z]/.test(location.hash)) location.hash = "#/home";
    route();
  }

  async function handleLogin(event) {
    event.preventDefault();
    $("login-submit").disabled = true;
    $("login-spinner").classList.remove("d-none");
    $("login-error").classList.add("d-none");
    let signedIn = null;
    try {
      signedIn = (await api("api/login", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: $("login-username").value.trim(), password: $("login-password").value })
      })).user;
      await signInToCloud();
      $("login-password").value = "";
      enterApp(signedIn);
    } catch (err) {
      // A failed cloud sign-in leaves no usable app session either
      if (signedIn) await api("api/logout").catch(() => {});
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
    bank = null;
    statements = null;
    cloudSignedIn = false;
    closeDocument();
    location.hash = "";
    showLogin();
  }

  // ── Start ──────────────────────────────────────────────────────────────────
  async function start() {
    $("login-form").addEventListener("submit", handleLogin);
    // Quadient Cloud user store: accounts can be created here and are signed in like a normal login
    DasSignup.init({
      loginForm: $("login-form"),
      onSignedIn: async signedIn => {
        try {
          await signInToCloud();
          enterApp(signedIn);
        } catch (err) {
          await api("api/logout").catch(() => {});
          user = null;
          showLogin(err.message || String(err));
        }
      }
    });
    $("btn-logout").addEventListener("click", handleLogout);
    $("btn-reload").addEventListener("click", loadStatements);
    $("btn-doc-retry").addEventListener("click", () => openDocumentId && openDocument(openDocumentId));
    $("transfer-form").addEventListener("submit", handleTransfer);
    $("account-list").addEventListener("click", e => {
      const tile = e.target.closest("[data-account]");
      if (!tile) return;
      selectedAccount = tile.dataset.account;
      renderAccounts();
    });
    $("contact-list").addEventListener("click", e => {
      const contact = e.target.closest("[data-contact]");
      if (!contact) return;
      $("transfer-to").value = `contact:${contact.dataset.contact}`;
      $("transfer-amount").focus();
    });
    window.addEventListener("hashchange", route);
    // Dates, amounts and the generated texts follow the language
    window.addEventListener("studio:languagechange", () => {
      if (!user) return langSelect("login-lang-slot");
      langSelect("app-lang-slot");
      if (!location.hash.startsWith("#/statements/")) route();
      if (statements) renderStatements();
    });

    // web-runtime.js is not in the repository; without it there is no SDK to sign in with
    const sdkMissing = typeof gmcMobileRuntime === "undefined";
    if (sdkMissing || !window.__DAS_READY__) {
      $("sdk-missing").classList.toggle("d-none", !sdkMissing);
      $("config-missing").classList.toggle("d-none", !!window.__DAS_READY__);
      show("config");
      return;
    }
    gmcMobileRuntime.init(() => ({}), () => {});
    watchSession();

    // Still signed in to this app (cookie): renew the Quadient Cloud session silently
    try {
      const me = (await api("api/me", { method: "GET" })).user;
      await signInToCloud();
      enterApp(me);
    } catch (err) {
      user = null;
      showLogin();
    }
  }

  start();
})();
