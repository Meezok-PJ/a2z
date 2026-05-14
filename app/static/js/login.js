(function () {
  "use strict";

  const AUTH_SALT_PREFIX = "a2z-ftl:";
  const state = {
    username: "",
    authHash: "",
    pendingToken: "",
    pendingUser: null,
    totpMode: "login",
    masterEncryptionKey: null,
    lastProbe: null
  };

  const els = {
    message: document.getElementById("auth-message"),
    username: document.getElementById("username"),
    usernameNext: document.getElementById("username-next"),
    authInline: document.getElementById("auth-inline"),
    inlineSetup: document.getElementById("inline-setup"),
    inlinePassword: document.getElementById("inline-password"),
    setupPassword: document.getElementById("setup-password"),
    setupConfirm: document.getElementById("setup-confirm"),
    setupSubmit: document.getElementById("setup-submit"),
    loginPassword: document.getElementById("login-password"),
    passwordNext: document.getElementById("password-next"),
    totpCode: document.getElementById("totp-code"),
    totpTitle: document.getElementById("totp-title"),
    totpSubtext: document.getElementById("totp-subtext"),
    totpChoice: document.getElementById("totp-choice"),
    totpEnableNow: document.getElementById("totp-enable-now"),
    totpSkipNow: document.getElementById("totp-skip-now"),
    totpCodeLabel: document.getElementById("totp-code-label"),
    totpCodeWrap: document.getElementById("totp-code-wrap"),
    totpSubmit: document.getElementById("totp-submit"),
    totpBack: document.getElementById("totp-back"),
    lostAuthenticator: document.getElementById("lost-authenticator"),
    qrWrap: document.getElementById("qr-wrap"),
    qr: document.getElementById("totp-qr"),
    recoveryPanel: document.getElementById("recovery-panel"),
    recoveryClose: document.getElementById("recovery-close"),
    recoveryPathToken: document.getElementById("recovery-path-token"),
    recoveryPathAdmin: document.getElementById("recovery-path-admin"),
    recoveryToken: document.getElementById("recovery-token"),
    recoveryAdmin: document.getElementById("recovery-admin"),
    recoveryTotp: document.getElementById("recovery-totp"),
    recoveryPassword: document.getElementById("recovery-password"),
    recoveryConfirm: document.getElementById("recovery-confirm"),
    recoveryTokenSubmit: document.getElementById("recovery-token-submit"),
    recoveryReason: document.getElementById("recovery-reason"),
    recoveryAdminSubmit: document.getElementById("recovery-admin-submit")
  };

  const steps = {
    auth: document.getElementById("step-auth"),
    totp: document.getElementById("step-totp")
  };

  function setPasswordToggleIcon(btn, isVisible) {
    if (!btn || !window.feather || !window.feather.icons) return;
    const iconName = isVisible ? "eye-off" : "eye";
    const icon = window.feather.icons[iconName];
    if (!icon) return;
    btn.innerHTML = icon.toSvg({ "aria-hidden": "true" });
    btn.setAttribute("aria-label", isVisible ? "Hide password" : "Show password");
  }

  function wirePasswordVisibilityToggles() {
    const toggles = Array.prototype.slice.call(document.querySelectorAll("[data-password-toggle]"));
    toggles.forEach(function (btn) {
      const targetId = btn.getAttribute("data-password-target");
      const input = targetId ? document.getElementById(targetId) : null;
      if (!input) return;

      setPasswordToggleIcon(btn, input.type === "text");
      btn.addEventListener("click", function () {
        const nextVisible = input.type !== "text";
        input.type = nextVisible ? "text" : "password";
        setPasswordToggleIcon(btn, nextVisible);
        try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
      });
    });
  }

  function setMessage(text, isError) {
    els.message.textContent = text || "";
    els.message.classList.toggle("is-error", Boolean(isError));
  }

  function stashDevCryptoContext(masterPassword, authHash) {
    if (!state.username || !masterPassword || !authHash) return;
    sessionStorage.setItem("a2z_dev_master_password", masterPassword);
    sessionStorage.setItem("a2z_dev_auth_hash", authHash);
    sessionStorage.setItem("a2z_dev_crypto_username", state.username);
  }

  function showStep(stepName) {
    Object.keys(steps).forEach(function (key) {
      steps[key].classList.toggle("hidden", key !== stepName);
    });
    if (stepName !== "totp") {
      els.qrWrap.classList.add("hidden");
      els.qr.src = "";
    }
    setMessage("");
  }

  function redirectForUser(user) {
    window.location.href = user && user.role === "Admin" ? "/admin" : "/vault";
  }

  function renderTotpMode(mode) {
    state.totpMode = mode;
    const isLoginMode = mode === "login";
    const isOnboardingChoice = mode === "onboarding-choice";
    const isOnboardingProvision = mode === "onboarding-provision";
    if (els.totpChoice) els.totpChoice.classList.toggle("hidden", !isOnboardingChoice);
    if (els.qrWrap) els.qrWrap.classList.toggle("hidden", !isOnboardingProvision);
    if (els.totpCodeLabel) els.totpCodeLabel.classList.toggle("hidden", !(isLoginMode || isOnboardingProvision));
    if (els.totpCodeWrap) els.totpCodeWrap.classList.toggle("hidden", !(isLoginMode || isOnboardingProvision));
    if (els.totpSubmit) els.totpSubmit.classList.toggle("hidden", !(isLoginMode || isOnboardingProvision));
    if (els.lostAuthenticator) els.lostAuthenticator.classList.toggle("hidden", !isLoginMode);
    if (els.totpBack) els.totpBack.classList.toggle("hidden", isOnboardingChoice);

    if (isLoginMode) {
      els.totpTitle.textContent = "2FA";
      els.totpSubtext.textContent = "Enter your authenticator code to continue.";
      els.totpSubmit.querySelector("span").textContent = "Verify";
    } else if (isOnboardingChoice) {
      els.totpTitle.textContent = "Protect your account";
      els.totpSubtext.textContent = "2FA is recommended. Enable now or skip for now and set it up later in Security settings.";
    } else {
      els.totpTitle.textContent = "Enable 2FA";
      els.totpSubtext.textContent = "Scan this QR code with your authenticator app and enter the code to finish setup.";
      els.totpSubmit.querySelector("span").textContent = "Enable 2FA";
    }
  }

  function showInline(mode) {
    const next = mode === "setup" ? "setup" : mode === "password" ? "password" : "";
    const show = Boolean(next);
    if (els.authInline) els.authInline.classList.toggle("hidden", !show);
    if (els.inlineSetup) els.inlineSetup.classList.toggle("hidden", next !== "setup");
    if (els.inlinePassword) els.inlinePassword.classList.toggle("hidden", next !== "password");
  }

  function showRecoveryPanel(open) {
    if (!els.recoveryPanel) return;
    els.recoveryPanel.classList.toggle("hidden", !open);
    if (!open) {
      els.recoveryToken.classList.add("hidden");
      els.recoveryAdmin.classList.add("hidden");
    }
  }

  function showRecoveryPath(path) {
    if (!els.recoveryPanel) return;
    els.recoveryToken.classList.toggle("hidden", path !== "token");
    els.recoveryAdmin.classList.toggle("hidden", path !== "admin");
  }

  async function postJson(url, body, token) {
    const csrfToken = readCookie("a2z_csrf");
    const res = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: Object.assign(
        {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken || ""
        },
        token ? { Authorization: "Bearer " + token } : {}
      ),
      body: JSON.stringify(body || {})
    });
    const payload = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      throw new Error(payload.error || "request_failed");
    }
    return payload;
  }

  function readCookie(name) {
    const key = String(name || "") + "=";
    const chunks = String(document.cookie || "").split(";");
    for (let i = 0; i < chunks.length; i += 1) {
      const part = chunks[i].trim();
      if (part.indexOf(key) === 0) {
        return decodeURIComponent(part.substring(key.length));
      }
    }
    return "";
  }

  async function deriveAuthHash(masterPassword, username) {
    const derived = await window.A2ZCrypto.deriveKeys(masterPassword, AUTH_SALT_PREFIX + username, {
      argon2: window.argon2
    });
    return derived.authKey;
  }

  async function setupUser() {
    const password = els.setupPassword.value;
    const confirm = els.setupConfirm.value;
    if (!password || password !== confirm) {
      setMessage("Passwords do not match.", true);
      return;
    }

    const derived = await window.A2ZCrypto.deriveKeys(password, AUTH_SALT_PREFIX + state.username, {
      argon2: window.argon2
    });
    state.authHash = derived.authKey;
    state.masterEncryptionKey = derived.masterEncryptionKey;

    const pair = await window.A2ZCrypto.generateRsaOaepKeyPair({ modulusLength: 2048, extractable: false });
    const exported = await window.crypto.subtle.exportKey("spki", pair.publicKey);
    const publicKey = window.A2ZCrypto.toBase64(new Uint8Array(exported));
    const publicKeyBytes = new Uint8Array(exported);

    await postJson("/api/auth/ftl", {
      username: state.username,
      auth_hash: state.authHash,
      public_key: publicKey
    });
    stashDevCryptoContext(password, state.authHash);
    await runPasswordLogin(state.authHash, true);

    // Overwrite short-lived plaintext immediately after derivation and upload.
    if (window.A2ZSecurity) {
      window.A2ZSecurity.wipeInputValue(els.setupPassword);
      window.A2ZSecurity.wipeInputValue(els.setupConfirm);
      window.A2ZSecurity.wipeStateObject({ password: password, confirm: confirm, publicKeyBytes: publicKeyBytes });
    }
  }

  async function runPasswordLogin(existingAuthHash, fromSetup) {
    const loginPassword = els.loginPassword.value;
    const authHash = existingAuthHash || (await deriveAuthHash(loginPassword, state.username));
    state.authHash = authHash;
    if (!existingAuthHash) {
      stashDevCryptoContext(loginPassword, authHash);
    }
    const login = await postJson("/api/auth/login", {
      username: state.username,
      auth_hash: authHash
    });
    if (login.user && login.user.id) {
      if (fromSetup) {
        state.pendingUser = login.user;
        showStep("totp");
        renderTotpMode("onboarding-choice");
        return;
      }
      redirectForUser(login.user);
      return;
    }
    state.pendingToken = login.pending_token;
    state.pendingUser = null;
    showStep("totp");
    renderTotpMode("login");
    if (!existingAuthHash && window.A2ZSecurity) {
      window.A2ZSecurity.wipeInputValue(els.loginPassword);
    }
  }

  async function submitTotp() {
    const code = els.totpCode.value.trim();
    if (!code) {
      setMessage("Enter a TOTP code.", true);
      return;
    }
    if (state.totpMode === "onboarding-provision") {
      await postJson("/api/auth/totp/provision/confirm", { code: code });
      redirectForUser(state.pendingUser);
      return;
    }
    const data = await postJson("/api/auth/totp", { code: code }, state.pendingToken);
    if (window.A2ZSecurity) {
      window.A2ZSecurity.wipeVolatileState({
        stateObjects: [state],
        inputElements: [els.username, els.setupPassword, els.setupConfirm, els.loginPassword, els.totpCode],
        textNodes: [els.message]
      });
    }
    redirectForUser(data.user);
  }

  async function startTotpProvision() {
    const data = await postJson("/api/auth/totp/provision/start", {});
    if (data && data.qr_png_base64 && els.qr && els.qrWrap) {
      els.qr.src = "data:image/png;base64," + data.qr_png_base64;
    }
    renderTotpMode("onboarding-provision");
  }

  function skipTotpProvision() {
    if (!state.pendingUser) {
      setMessage("Sign in first.", true);
      return;
    }
    redirectForUser(state.pendingUser);
  }

  els.usernameNext.addEventListener("click", async function () {
    try {
      state.username = els.username.value.trim();
      if (!state.username) {
        setMessage("Enter username.", true);
        return;
      }
      const probe = await postJson("/api/auth/probe", { username: state.username });
      if (!probe.exists) {
        setMessage("Invalid credentials.", true);
        return;
      }
      state.lastProbe = probe;
      showInline(probe.is_setup ? "password" : "setup");
      showRecoveryPanel(false);
      showStep("auth");
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  els.setupSubmit.addEventListener("click", async function () {
    try {
      await setupUser();
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  els.passwordNext.addEventListener("click", async function () {
    try {
      await runPasswordLogin("");
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  els.totpSubmit.addEventListener("click", async function () {
    try {
      await submitTotp();
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  els.lostAuthenticator.addEventListener("click", async function () {
    try {
      showRecoveryPanel(true);
      setMessage("");
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  els.totpEnableNow.addEventListener("click", async function () {
    try {
      await startTotpProvision();
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  els.totpSkipNow.addEventListener("click", function () {
    skipTotpProvision();
  });

  els.totpBack.addEventListener("click", function () {
    if (state.totpMode === "onboarding-provision") {
      renderTotpMode("onboarding-choice");
      els.totpCode.value = "";
      for (var d = 0; d < 6; d++) {
        var box = document.getElementById("totp-digit-" + d);
        if (box) { box.value = ""; box.classList.remove("filled"); }
      }
      if (els.qr) {
        els.qr.src = "";
      }
      return;
    }
    showStep("auth");
  });

  const needHelp = document.getElementById("need-help");
  if (needHelp) {
    needHelp.addEventListener("click", function () {
      showRecoveryPanel(true);
      setMessage("");
    });
  }

  if (els.recoveryClose) {
    els.recoveryClose.addEventListener("click", function () {
      showRecoveryPanel(false);
      setMessage("");
    });
  }
  if (els.recoveryPathToken) {
    els.recoveryPathToken.addEventListener("click", function () {
      showRecoveryPath("token");
      setMessage("");
    });
  }
  if (els.recoveryPathAdmin) {
    els.recoveryPathAdmin.addEventListener("click", function () {
      showRecoveryPath("admin");
      setMessage("");
    });
  }

  async function tokenBasedRecovery() {
    state.username = els.username.value.trim();
    if (!state.username) {
      setMessage("Enter username first.", true);
      return;
    }
    const code = (els.recoveryTotp.value || "").trim();
    const password = els.recoveryPassword.value;
    const confirm = els.recoveryConfirm.value;
    if (!code) {
      setMessage("Enter a TOTP code.", true);
      return;
    }
    if (!password || password !== confirm) {
      setMessage("Passwords do not match.", true);
      return;
    }
    const derived = await window.A2ZCrypto.deriveKeys(password, AUTH_SALT_PREFIX + state.username, {
      argon2: window.argon2
    });
    const authHash = derived.authKey;
    const pair = await window.A2ZCrypto.generateRsaOaepKeyPair({ modulusLength: 2048, extractable: false });
    const exported = await window.crypto.subtle.exportKey("spki", pair.publicKey);
    const publicKey = window.A2ZCrypto.toBase64(new Uint8Array(exported));
    const data = await postJson("/api/auth/recovery/token-reset", {
      username: state.username,
      totp_code: code,
      auth_hash: authHash,
      public_key: publicKey
    });
    if (data.user && data.user.id) {
      stashDevCryptoContext(password, authHash);
      window.location.href = data.user && data.user.role === "Admin" ? "/admin" : "/vault";
      return;
    }
    setMessage("Recovery completed. Please sign in.", false);
    showRecoveryPanel(false);
    showInline("password");
  }

  async function requestAdminReset() {
    state.username = els.username.value.trim();
    if (!state.username) {
      setMessage("Enter username first.", true);
      return;
    }
    await postJson("/api/recovery/admin-reset-request", {
      username: state.username,
      reason: String(els.recoveryReason.value || "").trim()
    });
    setMessage("Request submitted for admin review.");
  }

  if (els.recoveryTokenSubmit) {
    els.recoveryTokenSubmit.addEventListener("click", function () {
      tokenBasedRecovery().catch(function (error) {
        setMessage(error.message, true);
      });
    });
  }
  if (els.recoveryAdminSubmit) {
    els.recoveryAdminSubmit.addEventListener("click", function () {
      requestAdminReset().catch(function (error) {
        setMessage(error.message, true);
      });
    });
  }

  wirePasswordVisibilityToggles();
  showStep("auth");

  // ── Segmented TOTP digit box wiring ───────────────────────────────
  (function wireDigitBoxes() {
    var digits = [];
    for (var i = 0; i < 6; i++) {
      var el = document.getElementById("totp-digit-" + i);
      if (el) digits.push(el);
    }
    var hidden = document.getElementById("totp-code");
    if (!digits.length || !hidden) return;

    function syncHidden() {
      var code = "";
      for (var j = 0; j < digits.length; j++) {
        code += (digits[j].value || "");
      }
      hidden.value = code;
    }

    function focusDigit(index) {
      if (index >= 0 && index < digits.length) {
        digits[index].focus();
        digits[index].select();
      }
    }

    digits.forEach(function (box, idx) {
      box.addEventListener("input", function () {
        var val = box.value.replace(/\D/g, "");
        box.value = val.slice(0, 1);
        box.classList.toggle("filled", box.value.length > 0);
        syncHidden();
        if (box.value.length === 1 && idx < digits.length - 1) {
          focusDigit(idx + 1);
        }
      });

      box.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !box.value && idx > 0) {
          e.preventDefault();
          focusDigit(idx - 1);
        }
        if (e.key === "ArrowLeft" && idx > 0) {
          e.preventDefault();
          focusDigit(idx - 1);
        }
        if (e.key === "ArrowRight" && idx < digits.length - 1) {
          e.preventDefault();
          focusDigit(idx + 1);
        }
      });

      box.addEventListener("focus", function () {
        box.select();
      });

      box.addEventListener("paste", function (e) {
        e.preventDefault();
        var pasted = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "").slice(0, 6);
        for (var k = 0; k < digits.length; k++) {
          digits[k].value = pasted[k] || "";
          digits[k].classList.toggle("filled", digits[k].value.length > 0);
        }
        syncHidden();
        var nextEmpty = pasted.length < digits.length ? pasted.length : digits.length - 1;
        focusDigit(nextEmpty);
      });
    });
  })();
})();
