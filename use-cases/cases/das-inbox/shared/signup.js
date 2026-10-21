/**
 * "Create account" on the sign-in page of the Quadient Cloud cases (Digital Advantage Inbox, online banking).
 * It only shows up when the application has a Quadient Cloud user store (api/auth-options): the account is created
 * with self-registration (api/register) and, when it can be used right away, the user is signed in.
 *
 * DasSignup.init({ loginForm, onSignedIn }) adds a "Create account" link under the sign-in form and the
 * registration form next to it; onSignedIn(user) receives the session user, like a successful api/login.
 */
(function () {
  const field = (id, key, type = "text", autocomplete = "off", required = true) => `
    <div class="mb-3">
      <label for="${id}" class="form-label small fw-semibold" data-i18n="${key}"></label>
      <input id="${id}" type="${type}" class="form-control" autocomplete="${autocomplete}" ${required ? "required" : ""}>
    </div>`;

  async function init({ loginForm, onSignedIn }) {
    let options;
    try {
      const res = await fetch("api/auth-options", { credentials: "same-origin" });
      options = await res.json();
    } catch (err) {
      return;
    }
    if (!options || !options.signUp || document.getElementById("signup-form")) return;

    loginForm.insertAdjacentHTML("afterend", `
      <p id="signup-prompt" class="small text-center text-secondary mt-3 mb-0">
        <span data-i18n="dasSignup.prompt"></span>
        <a href="#" id="signup-open" class="fw-semibold" data-i18n="dasSignup.open"></a>
      </p>
      <div id="signup-notice" class="alert alert-success small mt-3 mb-0 d-none"></div>
      <form id="signup-form" class="d-none" novalidate>
        <h2 class="h6 fw-bold mb-1" data-i18n="dasSignup.title"></h2>
        <p class="small text-secondary mb-3" data-i18n="dasSignup.subtitle"></p>
        <div id="signup-error" class="alert alert-danger small d-none"></div>
        ${field("signup-username", "dasSignup.username", "text", "username")}
        ${field("signup-email", "dasSignup.email", "email", "email")}
        <div class="row g-2">
          <div class="col-sm-6">${field("signup-first", "dasSignup.firstName", "text", "given-name", false)}</div>
          <div class="col-sm-6">${field("signup-last", "dasSignup.lastName", "text", "family-name", false)}</div>
        </div>
        ${field("signup-password", "dasSignup.password", "password", "new-password")}
        ${field("signup-confirm", "dasSignup.confirm", "password", "new-password")}
        <button id="signup-submit" type="submit" class="btn btn-primary w-100">
          <span id="signup-spinner" class="spinner-border spinner-border-sm me-1 d-none"></span>
          <span data-i18n="dasSignup.submit"></span>
        </button>
        <p class="small text-center mt-3 mb-0">
          <a href="#" id="signup-close" data-i18n="dasSignup.back"></a>
        </p>
      </form>`);
    if (typeof applyI18n === "function") applyI18n(loginForm.parentElement);

    const $ = id => document.getElementById(id);
    const toggle = registering => {
      loginForm.classList.toggle("d-none", registering);
      $("signup-prompt").classList.toggle("d-none", registering);
      $("signup-form").classList.toggle("d-none", !registering);
      $("signup-error").classList.add("d-none");
      if (registering) $("signup-notice").classList.add("d-none");
      (registering ? $("signup-username") : loginForm.querySelector("input")).focus();
    };
    const fail = message => {
      $("signup-error").textContent = message;
      $("signup-error").classList.remove("d-none");
    };
    $("signup-open").addEventListener("click", e => { e.preventDefault(); toggle(true); });
    $("signup-close").addEventListener("click", e => { e.preventDefault(); toggle(false); });

    $("signup-form").addEventListener("submit", async e => {
      e.preventDefault();
      const value = id => $(id).value.trim();
      if (!value("signup-username") || !value("signup-email") || !$("signup-password").value) return fail(t("dasSignup.required"));
      if ($("signup-password").value !== $("signup-confirm").value) return fail(t("dasSignup.mismatch"));
      $("signup-submit").disabled = true;
      $("signup-spinner").classList.remove("d-none");
      $("signup-error").classList.add("d-none");
      try {
        const res = await fetch("api/register", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: value("signup-username"), email: value("signup-email"), password: $("signup-password").value,
            firstName: value("signup-first"), lastName: value("signup-last"), language: (window.currentLang || "es-MX").slice(0, 2)
          })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        const username = value("signup-username");
        $("signup-form").reset();
        if (json.user) {
          await onSignedIn(json.user);
        } else {
          // The application asks to verify the email first: back to sign-in with the username filled in
          toggle(false);
          loginForm.querySelector("input").value = username;
          $("signup-notice").textContent = json.message || t("dasSignup.pending");
          $("signup-notice").classList.remove("d-none");
        }
      } catch (err) {
        fail(err.message || String(err));
      } finally {
        $("signup-submit").disabled = false;
        $("signup-spinner").classList.add("d-none");
      }
    });
  }

  window.DasSignup = { init };
})();
