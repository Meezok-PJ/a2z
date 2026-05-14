(function () {
  "use strict";

  const els = {
    status: document.getElementById("security-2fa-status"),
    message: document.getElementById("security-message"),
    enableBtn: document.getElementById("security-enable-2fa"),
    disableBtn: document.getElementById("security-disable-2fa"),
    setupPanel: document.getElementById("security-2fa-setup"),
    disablePanel: document.getElementById("security-2fa-disable"),
    qr: document.getElementById("security-totp-qr"),
    code: document.getElementById("security-totp-code"),
    disableCode: document.getElementById("security-disable-code"),
    confirmEnable: document.getElementById("security-confirm-2fa"),
    cancelSetup: document.getElementById("security-cancel-setup"),
    confirmDisable: document.getElementById("security-confirm-disable"),
    cancelDisable: document.getElementById("security-cancel-disable")
  };

  const state = {
    totpEnabled: false
  };

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

  function setMessage(text, isError) {
    if (!els.message) return;
    if (!text) {
      els.message.innerHTML = "";
      els.message.classList.remove("is-error");
      return;
    }
    var iconName = isError ? "alert-circle" : "info";
    var iconHtml = '<i data-feather="' + iconName + '" aria-hidden="true"></i>';
    els.message.innerHTML = iconHtml + '<span>' + escapeHtml(text) + '</span>';
    els.message.classList.toggle("is-error", Boolean(isError));
    refreshIcons();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function refreshIcons() {
    if (window.feather && typeof window.feather.replace === "function") {
      window.feather.replace({ width: 18, height: 18, strokeWidth: 2 });
    }
  }

  async function api(url, options) {
    const method = String((options && options.method) || "GET").toUpperCase();
    const headers = { "Content-Type": "application/json" };
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      headers["X-CSRF-Token"] = readCookie("a2z_csrf") || "";
    }
    const res = await fetch(url, Object.assign({
      credentials: "same-origin",
      headers: headers
    }, options || {}));
    const payload = await res.json().catch(function () { return {}; });
    if (res.status === 401) {
      window.location.href = "/login";
      throw new Error("unauthorized");
    }
    if (!res.ok) throw new Error(payload.error || "request_failed");
    return payload;
  }

  function togglePanels(panelName) {
    const setupOpen = panelName === "setup";
    const disableOpen = panelName === "disable";
    els.setupPanel.classList.toggle("hidden", !setupOpen);
    els.disablePanel.classList.toggle("hidden", !disableOpen);
  }

  function renderStatus() {
    els.status.classList.remove("admin-pill-alert");
    if (state.totpEnabled) {
      els.status.textContent = "2FA enabled";
      els.enableBtn.classList.add("hidden");
      els.disableBtn.classList.remove("hidden");
      togglePanels("");
      refreshIcons();
      return;
    }
    els.status.textContent = "2FA optional (not enabled)";
    els.status.classList.add("admin-pill-alert");
    els.enableBtn.classList.remove("hidden");
    els.disableBtn.classList.add("hidden");
    togglePanels("");
    refreshIcons();
  }

  async function loadMe() {
    const me = await api("/api/auth/me");
    state.totpEnabled = Boolean(me.totp_enabled);
    renderStatus();
  }

  async function startSetup() {
    const data = await api("/api/auth/totp/provision/start", { method: "POST", body: "{}" });
    if (data.qr_png_base64) {
      els.qr.src = "data:image/png;base64," + data.qr_png_base64;
    }
    clearDigitBoxes("sec-totp-digit");
    els.code.value = "";
    togglePanels("setup");
    refreshIcons();
  }

  async function confirmSetup() {
    const code = String(els.code.value || "").trim();
    if (!code || code.length < 6) {
      setMessage("Enter a 6-digit TOTP code.", true);
      return;
    }
    await api("/api/auth/totp/provision/confirm", {
      method: "POST",
      body: JSON.stringify({ code: code })
    });
    state.totpEnabled = true;
    setMessage("2FA enabled successfully.");
    renderStatus();
  }

  async function confirmDisable() {
    const code = String(els.disableCode.value || "").trim();
    if (!code || code.length < 6) {
      setMessage("Enter a 6-digit TOTP code.", true);
      return;
    }
    await api("/api/auth/totp/disable", {
      method: "POST",
      body: JSON.stringify({ code: code })
    });
    state.totpEnabled = false;
    setMessage("2FA disabled.");
    renderStatus();
  }

  // ── Segmented digit box wiring ────────────────────────────────────
  function wireDigitGroup(prefix, hiddenInput) {
    var digits = [];
    for (var i = 0; i < 6; i++) {
      var el = document.getElementById(prefix + "-" + i);
      if (el) digits.push(el);
    }
    if (!digits.length || !hiddenInput) return;

    function syncHidden() {
      var code = "";
      for (var j = 0; j < digits.length; j++) {
        code += (digits[j].value || "");
      }
      hiddenInput.value = code;
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
        if (e.key === "ArrowLeft" && idx > 0) { e.preventDefault(); focusDigit(idx - 1); }
        if (e.key === "ArrowRight" && idx < digits.length - 1) { e.preventDefault(); focusDigit(idx + 1); }
      });
      box.addEventListener("focus", function () { box.select(); });
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
  }

  function clearDigitBoxes(prefix) {
    for (var i = 0; i < 6; i++) {
      var box = document.getElementById(prefix + "-" + i);
      if (box) { box.value = ""; box.classList.remove("filled"); }
    }
  }

  wireDigitGroup("sec-totp-digit", els.code);
  wireDigitGroup("sec-dis-digit", els.disableCode);

  els.enableBtn.addEventListener("click", function () {
    startSetup().catch(function (error) {
      setMessage(error.message, true);
    });
  });
  els.confirmEnable.addEventListener("click", function () {
    confirmSetup().catch(function (error) {
      setMessage(error.message, true);
    });
  });
  els.cancelSetup.addEventListener("click", function () {
    togglePanels("");
    setMessage("");
    clearDigitBoxes("sec-totp-digit");
    els.code.value = "";
  });
  els.disableBtn.addEventListener("click", function () {
    clearDigitBoxes("sec-dis-digit");
    els.disableCode.value = "";
    togglePanels("disable");
    refreshIcons();
  });
  els.confirmDisable.addEventListener("click", function () {
    confirmDisable().catch(function (error) {
      setMessage(error.message, true);
    });
  });
  els.cancelDisable.addEventListener("click", function () {
    togglePanels("");
    setMessage("");
    clearDigitBoxes("sec-dis-digit");
    els.disableCode.value = "";
  });

  refreshIcons();
  loadMe().catch(function (error) {
    setMessage(error.message, true);
  });
})();
