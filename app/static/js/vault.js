(function () {
  "use strict";

  const AUTH_SALT_PREFIX = "a2z-ftl:";
  const ORG_SHARED_SALT_PREFIX = "a2z-org-shared-v1:";
  const DECRYPT_MIN_VISIBLE_MS = 850;
  const DECRYPT_PROGRESS_BASE = 0.06;
  const DECRYPT_PROGRESS_MAX_PENDING = 0.9;
  const SIDEBAR_COLLAPSE_KEY = "a2z_sidebar_collapsed";
  const SIDEBAR_MOBILE_MEDIA = "(max-width: 840px)";

  const state = {
    username: "",
    sharedRecords: [],
    privateRecords: [],
    department: "",
    decryptedRecords: [],
    activeFilter: "all",
    searchQuery: "",
    isUnlocked: false,
    editingRecordId: null,
    masterKey: null,
    departmentSharedKey: null,
    serviceScope: "private"
  };

  const els = {
    userName: document.getElementById("vault-user-name"),
    userBadge: document.getElementById("vault-user-badge"),
    department: document.getElementById("vault-department"),
    grid: document.getElementById("vault-grid"),
    message: document.getElementById("vault-message"),
    search: document.getElementById("vault-search"),
    logout: document.getElementById("vault-logout"),
    lockToggle: document.getElementById("vault-lock-toggle"),
    decryptProgress: document.getElementById("vault-decrypt-progress"),
    decryptProgressFill: document.getElementById("vault-decrypt-progress-fill"),
    sideItems: Array.prototype.slice.call(document.querySelectorAll("[data-filter]")),
    addService: document.getElementById("vault-add-service"),
    unlockModal: document.getElementById("unlock-modal"),
    unlockForm: document.getElementById("unlock-form"),
    unlockPassword: document.getElementById("unlock-password"),
    unlockCancel: document.getElementById("unlock-cancel"),
    serviceModal: document.getElementById("service-modal"),
    serviceForm: document.getElementById("service-form"),
    serviceName: document.getElementById("service-name"),
    serviceUsername: document.getElementById("service-username"),
    serviceUrl: document.getElementById("service-url"),
    servicePassword: document.getElementById("service-password"),
    serviceSubmit: document.getElementById("service-submit"),
    serviceCancel: document.getElementById("service-cancel"),
    serviceTitle: document.getElementById("service-modal-title"),
    sidebarBody: document.querySelector(".vault-body"),
    sidebarToggles: Array.prototype.slice.call(document.querySelectorAll("[data-sidebar-toggle]"))
  };

  const EYE_SVG = '<i data-feather="eye" aria-hidden="true"></i>';
  const EYE_OFF_SVG = '<i data-feather="eye-off" aria-hidden="true"></i>';
  const STAR_SVG = '<i data-feather="star" aria-hidden="true"></i>';
  const STAR_FILLED_SVG = '<i data-feather="star" fill="currentColor" aria-hidden="true"></i>';
  const COPY_SVG = '<i data-feather="copy" aria-hidden="true"></i>';
  const CHECK_SVG = '<i data-feather="check" aria-hidden="true"></i>';
  const EDIT_SVG = '<i data-feather="edit-2" aria-hidden="true"></i>';
  const TRASH_SVG = '<i data-feather="trash-2" aria-hidden="true"></i>';

  function setMessage(text, isError) {
    if (!text) {
      els.message.innerHTML = "";
      els.message.classList.remove("is-error");
      return;
    }
    const icon = isError ? '<i data-feather="alert-circle" aria-hidden="true"></i>' : '<i data-feather="info" aria-hidden="true"></i>';
    els.message.innerHTML = icon + '<span>' + escapeHtml(text) + '</span>';
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

  function sidebarCollapsedFromStorage() {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
    } catch (error) {
      return false;
    }
  }

  function updateSidebarToggleUi(collapsed) {
    const action = collapsed ? "Show sidebar" : "Hide sidebar";
    if (!els.sidebarToggles.length) return;
    els.sidebarToggles.forEach(function (toggle) {
      toggle.setAttribute("aria-label", action);
      toggle.setAttribute("title", action);
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.classList.toggle("is-collapsed", collapsed);
    });
  }

  function applySidebarState(collapsed, persist) {
    if (!els.sidebarBody || !els.sidebarToggles.length) return;
    const isMobileLayout = window.matchMedia && window.matchMedia(SIDEBAR_MOBILE_MEDIA).matches;
    const nextState = isMobileLayout ? false : Boolean(collapsed);
    els.sidebarBody.classList.toggle("is-sidebar-collapsed", nextState);
    updateSidebarToggleUi(nextState);
    refreshIcons();
    if (!persist || isMobileLayout) return;
    try {
      localStorage.setItem(SIDEBAR_COLLAPSE_KEY, nextState ? "1" : "0");
    } catch (error) {}
  }

  function initSidebarToggle() {
    if (!els.sidebarBody || !els.sidebarToggles.length) return;
    applySidebarState(sidebarCollapsedFromStorage(), false);
    els.sidebarToggles.forEach(function (toggle) {
      toggle.addEventListener("click", function () {
        const next = !els.sidebarBody.classList.contains("is-sidebar-collapsed");
        applySidebarState(next, true);
      });
    });
    if (window.matchMedia) {
      const media = window.matchMedia(SIDEBAR_MOBILE_MEDIA);
      media.addEventListener("change", function () {
        applySidebarState(sidebarCollapsedFromStorage(), false);
      });
    }
  }

  function waitFor(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, Math.max(0, ms));
    });
  }

  function setDecryptProgress(value) {
    if (!els.decryptProgressFill) return;
    const clamped = Math.max(0, Math.min(1, Number(value) || 0));
    els.decryptProgressFill.style.transform = "scaleX(" + clamped + ")";
  }

  function beginDecryptProgress() {
    if (!els.decryptProgress) return null;
    const startedAt = Date.now();
    setDecryptProgress(DECRYPT_PROGRESS_BASE);
    els.decryptProgress.classList.remove("hidden");
    const timerId = window.setInterval(function () {
      if (!els.decryptProgressFill) return;
      const current = Number(
        String(els.decryptProgressFill.style.transform || "")
          .replace("scaleX(", "")
          .replace(")", "")
      ) || DECRYPT_PROGRESS_BASE;
      const next = Math.min(DECRYPT_PROGRESS_MAX_PENDING, current + 0.07);
      setDecryptProgress(next);
    }, 130);
    return {
      startedAt: startedAt,
      timerId: timerId
    };
  }

  async function finishDecryptProgress(loader) {
    if (!loader) return;
    window.clearInterval(loader.timerId);
    setDecryptProgress(1);
    const elapsed = Date.now() - loader.startedAt;
    const remaining = Math.max(220, DECRYPT_MIN_VISIBLE_MS - elapsed);
    await waitFor(remaining);
    els.decryptProgress.classList.add("hidden");
    setDecryptProgress(DECRYPT_PROGRESS_BASE);
  }

  function abortDecryptProgress(loader) {
    if (!loader) return;
    window.clearInterval(loader.timerId);
    els.decryptProgress.classList.add("hidden");
    setDecryptProgress(DECRYPT_PROGRESS_BASE);
  }

  async function api(url, options) {
    const method = String((options && options.method) || "GET").toUpperCase();
    const headers = { "Content-Type": "application/json" };
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      headers["X-CSRF-Token"] = readCookie("a2z_csrf") || "";
    }
    const merged = Object.assign({
      credentials: "same-origin",
      headers: headers
    }, options || {});
    const res = await fetch(url, merged);
    const payload = await res.json().catch(function () { return {}; });
    if (res.status === 401) {
      window.location.href = "/login";
      throw new Error("unauthorized");
    }
    if (!res.ok) throw new Error(payload.error || "request_failed");
    return payload;
  }

  async function getJson(url) {
    const res = await fetch(url, { credentials: "same-origin" });
    const payload = await res.json().catch(function () { return {}; });
    if (res.status === 401) {
      window.location.href = "/login";
      throw new Error("unauthorized");
    }
    if (!res.ok) throw new Error(payload.error || "request_failed");
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

  function setLockedState(isLocked) {
    const icon = isLocked ? "lock" : "unlock";
    els.lockToggle.innerHTML = '<i data-feather="' + icon + '" aria-hidden="true"></i>';
    els.lockToggle.setAttribute("aria-label", isLocked ? "Unlock vault" : "Lock vault");
    els.lockToggle.setAttribute("title", isLocked ? "Unlock vault" : "Lock vault");
    refreshIcons();
  }

  function normalizeDecryptedRecord(raw, fallbackName) {
    const item = raw && typeof raw === "object" ? raw : {};
    return {
      service: item.service || item.name || fallbackName || "Credential",
      username: item.username || item.login || item.email || "-",
      password: item.password || item.secret || "",
      url: item.url || ""
    };
  }

  function filteredItems() {
    const byScope = state.decryptedRecords.filter(function (item) {
      if (state.activeFilter === "shared") return item.scope === "shared";
      if (state.activeFilter === "favorites") return item.is_favorite;
      return true;
    });
    const query = state.searchQuery.trim().toLowerCase();
    if (!query) return byScope;
    return byScope.filter(function (item) {
      return String(item.service || "").toLowerCase().indexOf(query) !== -1 ||
        String(item.username || "").toLowerCase().indexOf(query) !== -1 ||
        String(item.url || "").toLowerCase().indexOf(query) !== -1 ||
        String(item.owner || "").toLowerCase().indexOf(query) !== -1;
    });
  }

  function renderItems() {
    const items = filteredItems();
    if (!items.length) {
      els.grid.innerHTML =
        '<article class="credential-card empty-state-card"><div class="empty-state-title">No matching credentials found.</div></article>';
      refreshIcons();
      return;
    }

    els.grid.innerHTML = items.map(function (item) {
      const cardId = "credential-password-" + item.id;
      var categoryLabel;
      if (item.scope === "private") {
        categoryLabel = "Private";
      } else {
        categoryLabel = "Shared • " + escapeHtml(item.sharedLabel || item.owner || state.department || "-");
      }
      const favoriteClass = item.is_favorite ? "on" : "";
      const favoriteIcon = item.is_favorite ? STAR_FILLED_SVG : STAR_SVG;
      const privateActions = item.scope === "private"
        ? '<button type="button" class="credential-eye" data-edit-record="' + item.id + '" title="Edit service" aria-label="Edit service">' + EDIT_SVG + "</button>" +
          '<button type="button" class="credential-eye" data-delete-record="' + item.id + '" title="Delete service" aria-label="Delete service">' + TRASH_SVG + "</button>"
        : "";
      return '<article class="credential-card">' +
        '<button type="button" class="credential-star ' + favoriteClass + '" data-favorite-record="' + item.id + '" title="Toggle favorite" aria-label="Toggle favorite">' + favoriteIcon + "</button>" +
        '<div class="credential-top">' +
          '<div class="credential-icon" aria-hidden="true">' + escapeHtml(String(item.service || "S").slice(0, 1).toUpperCase()) + "</div>" +
          "<div>" +
            '<div class="credential-name">' + escapeHtml(item.service) + "</div>" +
            '<div class="credential-category">' + categoryLabel + "</div>" +
          "</div>" +
        "</div>" +
        '<div class="credential-fields">' +
          "<div>" +
            '<div class="credential-label">Username</div>' +
            '<div class="credential-value">' + escapeHtml(item.username) + "</div>" +
          "</div>" +
          "<div>" +
            '<div class="credential-label">URL</div>' +
            '<div class="credential-value">' + escapeHtml(item.url || "-") + "</div>" +
          "</div>" +
          "<div>" +
            '<div class="credential-label">Password</div>' +
            '<div class="credential-password">' +
              '<input id="' + cardId + '" type="password" value="' + escapeHtml(item.password) + '" readonly>' +
              '<button type="button" class="credential-eye" data-target="' + cardId + '" title="Reveal password" aria-label="Reveal password">' + EYE_SVG + "</button>" +
              '<button type="button" class="credential-eye credential-copy" data-copy-target="' + cardId + '" title="Copy password" aria-label="Copy password">' + COPY_SVG + "</button>" +
              privateActions +
            "</div>" +
          "</div>" +
        "</div>" +
      "</article>";
    }).join("");
    refreshIcons();
  }

  function parseCiphertextBlob(record) {
    const blob = record.ciphertext_blob;
    if (blob && typeof blob === "string") {
      try {
        const parsed = JSON.parse(blob);
        if (parsed && typeof parsed === "object" && parsed.iv && parsed.ciphertext) {
          return {
            iv: String(parsed.iv),
            ciphertext: String(parsed.ciphertext)
          };
        }
      } catch (error) {}
    }
    return {
      iv: String(record.iv_blob || ""),
      ciphertext: String(record.ciphertext_blob || "")
    };
  }

  async function decryptRecord(record, fallbackKey, departmentSharedKey) {
    const payload = parseCiphertextBlob(record);
    if (!payload.iv || !payload.ciphertext) {
      throw new Error("missing_ciphertext_blob");
    }

    let keyToUse = fallbackKey;
    const wrappedKeyCandidate = record.wrapped_key;
    if (wrappedKeyCandidate && window.A2ZSessionPrivateKey) {
      keyToUse = await window.A2ZCrypto.unwrapVaultKey(wrappedKeyCandidate, window.A2ZSessionPrivateKey, {
        extractable: false
      });
    }

    let plaintext;
    try {
      plaintext = await window.A2ZCrypto.decryptAesGcm(payload, keyToUse, { parseJson: true });
    } catch (error) {
      if (record.record_scope === "private" || !departmentSharedKey) throw error;
      plaintext = await window.A2ZCrypto.decryptAesGcm(payload, departmentSharedKey, { parseJson: true });
    }
    return normalizeDecryptedRecord(
      plaintext,
      record.service_name || ("Record #" + String(record.id))
    );
  }

  function mapUnlockedItem(record, decrypted, fallbackName) {
    var scope = record.record_scope || "shared";
    var owner = record.owner_username || (scope === "private" ? state.username : "Organizational");
    var sharedLabel;
    if (scope === "shared") {
      // If the owner is a regular user (not the admin who created shared dept records),
      // show their username. Otherwise show the department name.
      if (record.owner_username && record.owner_username !== "admin") {
        sharedLabel = record.owner_username;
      } else {
        sharedLabel = state.department || "Department";
      }
    } else {
      sharedLabel = "";
    }
    return {
      id: record.id,
      service: decrypted.service || record.service_name || fallbackName,
      username: decrypted.username || record.service_username || "-",
      password: decrypted.password || "",
      url: decrypted.url || record.service_url || "",
      owner: owner,
      scope: scope,
      sharedLabel: sharedLabel,
      is_favorite: Boolean(record.is_favorite)
    };
  }

  function openUnlockModal() {
    els.unlockModal.classList.remove("hidden");
    setTimeout(function () {
      els.unlockPassword.focus();
    }, 20);
  }

  function closeUnlockModal(clearInput) {
    els.unlockModal.classList.add("hidden");
    if (clearInput) {
      els.unlockPassword.value = "";
    }
  }

  function setScopeToggle(scope) {
    state.serviceScope = scope;
    var scopeToggle = document.getElementById("service-scope-toggle");
    if (!scopeToggle) return;
    var buttons = scopeToggle.querySelectorAll(".scope-option");
    buttons.forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-scope") === scope);
    });
    // Update modal title accordingly
    if (!state.editingRecordId) {
      els.serviceTitle.textContent = scope === "shared" ? "Share Service with Department" : "Add Private Service";
    }
  }

  function openServiceModal(record) {
    state.editingRecordId = record ? record.id : null;
    els.serviceName.value = record ? record.service : "";
    els.serviceUsername.value = record ? record.username : "";
    els.serviceUrl.value = record ? (record.url || "") : "";
    els.servicePassword.value = record ? record.password : "";
    els.serviceSubmit.textContent = record ? "Update" : "Save";
    els.serviceTitle.textContent = record ? "Edit Private Service" : "Add Private Service";
    setScopeToggle(record ? "private" : "private");
    // Hide scope toggle when editing (scope can't be changed after creation)
    var scopeToggle = document.getElementById("service-scope-toggle");
    if (scopeToggle) scopeToggle.classList.toggle("hidden", Boolean(record));
    els.serviceModal.classList.remove("hidden");
    refreshIcons();
  }

  function closeServiceModal(clearInput) {
    els.serviceModal.classList.add("hidden");
    if (clearInput) {
      state.editingRecordId = null;
      state.serviceScope = "private";
      els.serviceForm.reset();
      els.serviceSubmit.textContent = "Save";
      els.serviceTitle.textContent = "Add Private Service";
    }
  }

  function lockVault() {
    state.masterKey = null;
    state.departmentSharedKey = null;
    state.decryptedRecords = [];
    state.isUnlocked = false;
    els.grid.innerHTML =
      '<article class="credential-card empty-state-card"><div class="empty-state-title">Vault locked.</div></article>';
    setLockedState(true);
    setMessage("Vault locked.");
  }

  async function decryptLoadedRecords() {
    const allRecords = state.sharedRecords.concat(state.privateRecords);
    const decrypted = [];
    let skipped = 0;
    for (let i = 0; i < allRecords.length; i += 1) {
      const record = allRecords[i];
      try {
        const plaintext = await decryptRecord(record, state.masterKey, state.departmentSharedKey);
        decrypted.push(mapUnlockedItem(record, plaintext, "Record #" + String(record.id)));
      } catch (error) {
        skipped += 1;
      }
    }
    state.decryptedRecords = decrypted;
    state.isUnlocked = true;
    renderItems();
    setLockedState(false);
    setMessage(
      "Vault unlocked. Loaded " + allRecords.length +
      " record(s): " + decrypted.length + " decrypted, " + skipped + " skipped."
    );
  }

  async function unlockAndDecrypt(masterPassword) {
    if (!window.A2ZCrypto) {
      throw new Error("crypto_engine_unavailable");
    }
    setMessage("Decrypting credentials...");

    const derived = await window.A2ZCrypto.deriveKeys(masterPassword, AUTH_SALT_PREFIX + state.username, {
      argon2: window.argon2
    });
    state.masterKey = derived.masterEncryptionKey;

    const departmentName = String(state.department || "").trim();
    if (!departmentName) {
      if (state.sharedRecords.length) {
        throw new Error("department_context_missing");
      }
      state.departmentSharedKey = null;
    } else {
      const deptDerived = await window.A2ZCrypto.deriveKeys(
        "org-service::" + departmentName,
        ORG_SHARED_SALT_PREFIX + departmentName,
        { argon2: window.argon2 }
      );
      state.departmentSharedKey = deptDerived.masterEncryptionKey;
    }
    await decryptLoadedRecords();
  }

  async function bootstrapDataOnly() {
    const data = await getJson("/api/vault/dashboard");
    state.username = String(data.username || "");
    state.department = data.department || "";
    state.sharedRecords = Array.isArray(data.shared_passwords) ? data.shared_passwords : [];
    state.privateRecords = Array.isArray(data.private_passwords) ? data.private_passwords : [];
    
    if (els.department) els.department.textContent = state.department || "-";
    if (els.userName && state.username) els.userName.textContent = state.username;
    if (els.userBadge && state.username) els.userBadge.textContent = state.username.charAt(0).toUpperCase();
  }

  async function savePrivateRecord(event) {
    event.preventDefault();
    if (!state.isUnlocked || !state.masterKey) {
      setMessage("Unlock the vault first.", true);
      return;
    }
    const serviceName = els.serviceName.value.trim();
    const serviceUsername = els.serviceUsername.value.trim();
    const serviceUrl = els.serviceUrl.value.trim();
    const servicePassword = els.servicePassword.value;
    if (!serviceName || !serviceUsername || !servicePassword) {
      setMessage("Service name, username, and password are required.", true);
      return;
    }

    var isShared = state.serviceScope === "shared" && !state.editingRecordId;

    // Choose the encryption key based on scope.
    var encryptionKey = state.masterKey;
    if (isShared) {
      if (!state.departmentSharedKey) {
        setMessage("Department context unavailable. Cannot share.", true);
        return;
      }
      encryptionKey = state.departmentSharedKey;
    }

    const encrypted = await window.A2ZCrypto.encryptAesGcm({
      service: serviceName,
      username: serviceUsername,
      url: serviceUrl,
      password: servicePassword
    }, encryptionKey);
    const payload = {
      service_name: serviceName,
      service_username: serviceUsername,
      service_url: serviceUrl,
      ciphertext_blob: encrypted.ciphertext,
      iv_blob: encrypted.iv
    };
    if (state.editingRecordId) {
      await api("/api/vault/private-records/" + state.editingRecordId, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      setMessage("Private service updated.");
    } else if (isShared) {
      await api("/api/vault/shared-records", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setMessage("Shared service added to department.");
    } else {
      await api("/api/vault/private-records", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setMessage("Private service added.");
    }
    closeServiceModal(true);
    await bootstrapDataOnly();
    await decryptLoadedRecords();
  }

  async function toggleFavorite(recordId) {
    const record = state.decryptedRecords.find(function (entry) {
      return entry.id === recordId;
    });
    if (!record) return;
    const endpoint = "/api/vault/favorites/" + recordId;
    if (record.is_favorite) {
      await api(endpoint, { method: "DELETE" });
    } else {
      await api(endpoint, { method: "POST", body: "{}" });
    }
    record.is_favorite = !record.is_favorite;
    renderItems();
  }

  async function deletePrivateRecord(recordId) {
    await api("/api/vault/private-records/" + recordId, { method: "DELETE" });
    setMessage("Private service deleted.");
    await bootstrapDataOnly();
    await decryptLoadedRecords();
  }

  function setActiveFilter(nextFilter) {
    state.activeFilter = nextFilter;
    els.sideItems.forEach(function (button) {
      button.classList.toggle("active", button.getAttribute("data-filter") === nextFilter);
    });
    renderItems();
  }

  function attachGridHandlers() {
    els.grid.addEventListener("click", async function (event) {
      const favoriteBtn = event.target.closest("[data-favorite-record]");
      if (favoriteBtn) {
        const recordId = Number(favoriteBtn.getAttribute("data-favorite-record"));
        toggleFavorite(recordId).catch(function (error) {
          setMessage(error.message, true);
        });
        return;
      }

      const eyeBtn = event.target.closest("[data-target]");
      if (eyeBtn) {
        const targetId = eyeBtn.getAttribute("data-target");
        const field = targetId ? document.getElementById(targetId) : null;
        if (!field) return;
        const showing = field.type === "text";
        field.type = showing ? "password" : "text";
        eyeBtn.innerHTML = showing ? EYE_SVG : EYE_OFF_SVG;
        eyeBtn.setAttribute("aria-label", showing ? "Reveal password" : "Hide password");
        eyeBtn.setAttribute("title", showing ? "Reveal password" : "Hide password");
        refreshIcons();
        return;
      }

      const copyBtn = event.target.closest("[data-copy-target]");
      if (copyBtn) {
        const targetId = copyBtn.getAttribute("data-copy-target");
        const field = targetId ? document.getElementById(targetId) : null;
        if (!field || !field.value) return;
        try {
          await navigator.clipboard.writeText(field.value);
          copyBtn.innerHTML = CHECK_SVG;
          refreshIcons();
          setTimeout(function () {
            copyBtn.innerHTML = COPY_SVG;
            refreshIcons();
          }, 1200);
        } catch (error) {
          setMessage("Copy failed.", true);
        }
        return;
      }

      const editBtn = event.target.closest("[data-edit-record]");
      if (editBtn) {
        const id = Number(editBtn.getAttribute("data-edit-record"));
        const record = state.decryptedRecords.find(function (entry) {
          return entry.id === id && entry.scope === "private";
        });
        if (record) {
          openServiceModal(record);
        }
        return;
      }

      const deleteBtn = event.target.closest("[data-delete-record]");
      if (deleteBtn) {
        const id = Number(deleteBtn.getAttribute("data-delete-record"));
        deletePrivateRecord(id).catch(function (error) {
          setMessage(error.message, true);
        });
      }
    });
  }

  async function bootstrap() {
    await bootstrapDataOnly();
    lockVault();
    const devMasterPassword = sessionStorage.getItem("a2z_dev_master_password");
    if (devMasterPassword) {
      const loader = beginDecryptProgress();
      try {
        await unlockAndDecrypt(devMasterPassword);
        await finishDecryptProgress(loader);
      } catch (error) {
        abortDecryptProgress(loader);
        throw error;
      }
      return;
    }
    setMessage("");
  }

  function secureLogout() {
    fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRF-Token": readCookie("a2z_csrf") || "" }
    }).catch(function () {});
    if (window.A2ZSecurity) {
      window.A2ZSecurity.wipeVolatileState({
        stateObjects: [state],
        textNodes: [els.department, els.message]
      });
    }
    els.grid.innerHTML = "";
    window.location.href = "/login";
  }

  els.logout.addEventListener("click", function () {
    secureLogout();
  });

  els.lockToggle.addEventListener("click", function () {
    if (state.isUnlocked) {
      lockVault();
      return;
    }
    openUnlockModal();
  });

  els.unlockCancel.addEventListener("click", function () {
    closeUnlockModal(true);
  });

  els.unlockModal.addEventListener("click", function (event) {
    if (event.target && event.target.getAttribute("data-close-unlock") === "true") {
      closeUnlockModal(true);
    }
  });

  els.unlockForm.addEventListener("submit", function (event) {
    event.preventDefault();
    const password = els.unlockPassword.value;
    if (!password) return;

    const loader = beginDecryptProgress();
    unlockAndDecrypt(password).then(function () {
      return finishDecryptProgress(loader);
    }).catch(function (error) {
      abortDecryptProgress(loader);
      if (error.message === "department_context_missing") {
        setMessage("Department context is missing for shared vault records.", true);
        return;
      }
      setMessage(error.message === "OperationError" ? "Invalid key material for this vault." : error.message, true);
    }).finally(function () {
      closeUnlockModal(true);
    });
  });

  els.search.addEventListener("input", function () {
    state.searchQuery = els.search.value || "";
    renderItems();
  });

  els.sideItems.forEach(function (button) {
    button.addEventListener("click", function () {
      setActiveFilter(button.getAttribute("data-filter") || "all");
    });
  });

  els.addService.addEventListener("click", function () {
    if (!state.isUnlocked) {
      setMessage("Unlock the vault before adding services.", true);
      return;
    }
    openServiceModal(null);
  });

  els.serviceCancel.addEventListener("click", function () {
    closeServiceModal(true);
  });

  els.serviceModal.addEventListener("click", function (event) {
    if (event.target && event.target.getAttribute("data-close-service") === "true") {
      closeServiceModal(true);
    }
  });

  els.serviceForm.addEventListener("submit", function (event) {
    savePrivateRecord(event).catch(function (error) {
      setMessage(error.message, true);
    });
  });

  // Scope toggle buttons (Private / Share with Dept)
  var scopeToggle = document.getElementById("service-scope-toggle");
  if (scopeToggle) {
    scopeToggle.addEventListener("click", function (event) {
      var btn = event.target.closest(".scope-option");
      if (!btn) return;
      setScopeToggle(btn.getAttribute("data-scope") || "private");
    });
  }

  // Service password eye toggle
  var servicePwToggle = document.getElementById("service-password-toggle");
  if (servicePwToggle) {
    servicePwToggle.addEventListener("click", function () {
      var field = document.getElementById("service-password");
      if (!field) return;
      var show = field.type === "password";
      field.type = show ? "text" : "password";
      servicePwToggle.innerHTML = show ? EYE_OFF_SVG : EYE_SVG;
      refreshIcons();
    });
  }

  attachGridHandlers();
  initSidebarToggle();
  refreshIcons();
  setDecryptProgress(DECRYPT_PROGRESS_BASE);

  bootstrap().catch(function (error) {
    setMessage(error.message, true);
  });
})();
