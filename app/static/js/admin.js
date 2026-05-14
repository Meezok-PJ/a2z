(function () {
  "use strict";

  const state = {
    activeView: "users",
    departments: [],
    users: [],
    requests: [],
    query: "",
    currentUser: null,
    selectedVaultDepartmentId: 0,
    vaultRecords: [],
    privateMetadataRecords: [],
    editingVaultRecordId: null,
    activeVaultTab: "shared",
    vaultUserQuery: "",
    expandedAuditUserId: 0,
    bulkFile: null,
    bulkParsedRows: []
  };
  const ORG_SHARED_SALT_PREFIX = "a2z-org-shared-v1:";
  const SIDEBAR_COLLAPSE_KEY = "a2z_sidebar_collapsed";
  const SIDEBAR_MOBILE_MEDIA = "(max-width: 840px)";
  const DEFAULT_SERVICES = {
    IT_Department: [
      { service: "OPNsense Firewall", username: "it-admin", url: "https://firewall.local", password: "ChangeMe#123" },
      { service: "VPN Gateway", username: "netops", url: "https://vpn.local", password: "ChangeMe#123" }
    ],
    HR_Department: [
      { service: "Payroll Gateway", username: "hr-payroll", url: "https://payroll.local", password: "ChangeMe#123" }
    ],
    Finance: [
      { service: "Treasury Portal", username: "finance-admin", url: "https://treasury.local", password: "ChangeMe#123" }
    ],
    Management: [
      { service: "Board Reporting", username: "exec", url: "https://reports.local", password: "ChangeMe#123" }
    ]
  };
  const els = {
    usersPanel: document.getElementById("users-panel"),
    requestsPanel: document.getElementById("requests-panel"),
    vaultsPanel: document.getElementById("vaults-panel"),
    search: document.getElementById("admin-search"),
    createForm: document.getElementById("create-user-form"),
    newUsername: document.getElementById("new-username"),
    newDepartment: document.getElementById("new-department"),
    usersList: document.getElementById("users-list"),
    requestsList: document.getElementById("requests-list"),
    accountResetRequestsList: document.getElementById("account-reset-requests-list"),
    vaultForm: document.getElementById("vault-service-form"),
    vaultDepartmentId: document.getElementById("vault-department-id"),
    vaultDepartmentOptions: document.getElementById("vault-department-options"),
    vaultDepartmentValue: document.querySelector("#vault-department-dropdown .custom-dropdown-value"),
    vaultServiceName: document.getElementById("vault-service-name"),
    vaultServiceUsername: document.getElementById("vault-service-username"),
    vaultServiceUrl: document.getElementById("vault-service-url"),
    vaultServicePassword: document.getElementById("vault-service-password"),
    vaultServicesList: document.getElementById("vault-services-list"),
    departmentUsersList: document.getElementById("vault-department-users"),
    vaultUserSearch: document.getElementById("vault-user-search"),
    vaultTabButtons: Array.prototype.slice.call(document.querySelectorAll("[data-vault-tab]")),
    message: document.getElementById("admin-message"),
    logout: document.getElementById("admin-logout"),
    viewButtons: Array.prototype.slice.call(document.querySelectorAll("[data-view]")),
    sidebarBody: document.querySelector(".vault-body"),
    sidebarToggles: Array.prototype.slice.call(document.querySelectorAll("[data-sidebar-toggle]"))
  };

  function setMessage(text, isError) {
    els.message.textContent = text || "";
    els.message.classList.toggle("is-error", Boolean(isError));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function statusPill(label, icon, variant) {
    const tone = variant === "alert" || variant === "success" ? variant : "default";
    const safeLabel = escapeHtml(label);
    if (tone === "success") {
      return '<span class="admin-status-icon admin-status-icon-success" tabindex="0" role="img" title="' + safeLabel + '" aria-label="' + safeLabel + '">' +
        '<i data-feather="' + icon + '" aria-hidden="true"></i>' +
        "</span>";
    }
    const className = tone === "default" ? "admin-pill" : "admin-pill admin-pill-" + tone;
    return '<span class="' + className + '"><i data-feather="' + icon + '" aria-hidden="true"></i><span>' + safeLabel + "</span></span>";
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

  function refreshIcons() {
    if (window.feather && typeof window.feather.replace === "function") {
      window.feather.replace({ width: 16, height: 16, strokeWidth: 2 });
    }
  }

  async function api(url, options) {
    const csrfToken = readCookie("a2z_csrf");
    const method = String((options && options.method) || "GET").toUpperCase();
    const headers = {
      "Content-Type": "application/json"
    };
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      headers["X-CSRF-Token"] = csrfToken || "";
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

  async function performAdminStepUp() {
    const code = window.prompt("Enter your current TOTP code to continue:");
    if (!code) {
      throw new Error("step_up_cancelled");
    }
    await api("/api/auth/admin-step-up", {
      method: "POST",
      body: JSON.stringify({ code: String(code).trim() })
    });
  }

  async function withStepUp(action) {
    try {
      return await action();
    } catch (error) {
      if (error && error.message === "step_up_required") {
        await performAdminStepUp();
        return action();
      }
      throw error;
    }
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

  function setActiveView(viewName) {
    var valid = ["users", "requests", "vaults", "bulk"];
    state.activeView = valid.indexOf(viewName) !== -1 ? viewName : "users";
    els.usersPanel.classList.toggle("hidden", state.activeView !== "users");
    els.requestsPanel.classList.toggle("hidden", state.activeView !== "requests");
    els.vaultsPanel.classList.toggle("hidden", state.activeView !== "vaults");
    var bulkPanel = document.getElementById("bulk-panel");
    if (bulkPanel) bulkPanel.classList.toggle("hidden", state.activeView !== "bulk");
    els.viewButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-view") === state.activeView);
    });
    if (state.activeView === "vaults") {
      loadVaultRecords(state.selectedVaultDepartmentId || Number(els.vaultDepartmentId.value || 0)).catch(function (error) {
        setMessage(error.message, true);
      });
    }
  }

  function setActiveVaultTab(tabName) {
    const nextTab = tabName === "audit" ? "audit" : "shared";
    state.activeVaultTab = nextTab;
    els.vaultsPanel.setAttribute("data-inner-tab", nextTab);
    els.vaultTabButtons.forEach(function (btn) {
      const isActive = btn.getAttribute("data-vault-tab") === nextTab;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  function buildDepartmentOptions(departments, selectedId) {
    let options = '<div class="custom-dropdown-option disabled">Select department</div>';
    departments.forEach(function (d) {
      options += '<div class="custom-dropdown-option' + (d.id === selectedId ? ' selected' : '') + '" data-value="' + d.id + '">' + escapeHtml(d.name) + '</div>';
    });
    return options;
  }

  function buildCustomDropdown(departments, selectedId, userId) {
    let valueText = "Select department";
    let optionsHtml = '<div class="custom-dropdown-option disabled">Select department</div>';
    departments.forEach(function(d) {
      const isSelected = d.id === selectedId;
      if (isSelected) valueText = escapeHtml(d.name);
      optionsHtml += '<div class="custom-dropdown-option' + (isSelected ? ' selected' : '') + '" data-value="' + d.id + '">' + escapeHtml(d.name) + '</div>';
    });
    
    return '<div class="custom-dropdown" tabindex="0">' +
      '<div class="custom-dropdown-trigger"><span class="custom-dropdown-value">' + valueText + '</span>' +
      '<span class="admin-select-caret" aria-hidden="true">▾</span></div>' +
      '<div class="custom-dropdown-options">' + optionsHtml + '</div>' +
      '<input type="hidden" class="admin-select" data-user-id="' + userId + '" value="' + (selectedId || "") + '">' +
      '</div>';
  }

  async function loadDepartments() {
    const data = await api("/api/admin/departments");
    state.departments = data.departments || [];
    const optionsEl = document.getElementById("new-department-options");
    const valueEl = document.querySelector("#new-department-dropdown .custom-dropdown-value");
    if (!state.departments.length) {
      optionsEl.innerHTML = buildDepartmentOptions([], 0);
      setMessage("No departments available. Reload this page.", true);
      return state.departments;
    }
    const initialDepartmentId = state.departments[0].id;
    optionsEl.innerHTML = buildDepartmentOptions(state.departments, initialDepartmentId);
    els.newDepartment.value = String(initialDepartmentId);
    valueEl.textContent = state.departments[0].name;
    els.vaultDepartmentOptions.innerHTML = buildDepartmentOptions(state.departments, initialDepartmentId);
    els.vaultDepartmentId.value = String(initialDepartmentId);
    els.vaultDepartmentValue.textContent = state.departments[0].name;
    state.selectedVaultDepartmentId = initialDepartmentId;
    return state.departments;
  }

  function renderUsers() {
    const departments = state.departments;
    const query = state.query.trim().toLowerCase();
    const users = state.users.filter(function (user) {
      if (!query) return true;
      return String(user.username || "").toLowerCase().indexOf(query) !== -1 ||
        String(user.department || "").toLowerCase().indexOf(query) !== -1;
    });
    const rows = users.map(function (user) {
      const safeSelectedDepartmentId = state.departments.some(function (d) { return d.id === user.department_id; })
        ? user.department_id
        : 0;
      const select = '<span class="admin-select-wrap">' +
        buildCustomDropdown(departments, safeSelectedDepartmentId, user.id) +
        '</span>';
      const statusTag = user.mfa_reset_requested
        ? statusPill("MFA Reset Pending", "alert-triangle", "alert")
        : statusPill("Active", "check", "success");
      return '<div class="admin-row">' +
        '<div class="admin-row-main"><strong>' + escapeHtml(user.username) + "</strong>" +
        "<span>" + escapeHtml(user.department || "-") + "</span>" + statusTag + "</div>" +
        '<div class="admin-row-actions">' + select +
          '<button data-save-user="' + user.id + '" type="button" class="vault-primary-btn admin-action-btn" title="Save department change">Save</button></div>' +
        "</div>";
    });
    els.usersList.innerHTML = rows.join("") || '<div class="admin-row"><div class="admin-row-main"><strong>No users found.</strong></div></div>';
  }

  async function loadUsers() {
    const data = await api("/api/admin/users");
    state.users = data.users || [];
    renderUsers();
    if (state.selectedVaultDepartmentId) {
      renderDepartmentUsers(state.selectedVaultDepartmentId);
    }
  }

  async function loadRequests() {
    const data = await api("/api/admin/mfa-requests");
    state.requests = data.requests || [];
    const rows = state.requests.map(function (request) {
      return '<div class="admin-row">' +
        '<div class="admin-row-main"><strong>' + escapeHtml(request.username) + "</strong>" +
        "<span>" + escapeHtml(request.department || "-") + "</span></div>" +
        '<div class="admin-row-actions">' +
          '<button data-approve="' + request.id + '" type="button" class="vault-primary-btn admin-action-btn" title="Approve MFA reset request">Approve</button>' +
          '<button data-decline="' + request.id + '" type="button" class="vault-secondary-btn admin-action-btn" title="Decline MFA reset request">Decline</button>' +
        "</div></div>";
    });
    els.requestsList.innerHTML = rows.join("") || '<div class="admin-row"><div class="admin-row-main"><strong>No pending requests.</strong></div></div>';
  }

  async function loadAccountResetRequests() {
    if (!els.accountResetRequestsList) return;
    const data = await api("/api/admin/account-reset-requests", { method: "GET" });
    const requests = data.requests || [];
    const rows = requests.map(function (req) {
      const reason = req.reason ? ('<span>' + escapeHtml(req.reason) + "</span>") : '<span>-</span>';
      const disclosure = statusPill("Reset includes password + 2FA and forces FTL.", "alert-octagon", "alert");
      return '<div class="admin-row">' +
        '<div class="admin-row-main"><strong>' + escapeHtml(req.username) + "</strong>" +
        "<span>" + escapeHtml(req.department || "-") + "</span>" +
        reason + disclosure + "</div>" +
        '<div class="admin-row-actions">' +
          '<button data-account-approve="' + req.id + '" type="button" class="vault-primary-btn admin-action-btn" title="Approve account reset">Approve reset</button>' +
          '<button data-account-decline="' + req.id + '" type="button" class="vault-secondary-btn admin-action-btn" title="Decline account reset">Decline</button>' +
        "</div></div>";
    });
    els.accountResetRequestsList.innerHTML = rows.join("") || '<div class="admin-row"><div class="admin-row-main"><strong>No pending account resets.</strong></div></div>';
  }

  function parseEncryptedPayload(record) {
    if (record.ciphertext_blob) {
      try {
        const parsed = JSON.parse(record.ciphertext_blob);
        if (parsed && parsed.iv && parsed.ciphertext) {
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

  function getDepartmentName(departmentId) {
    const dept = state.departments.find(function (item) {
      return item.id === Number(departmentId);
    });
    return dept ? String(dept.name || "") : "";
  }

  async function ensureDepartmentSharedKey(departmentId) {
    if (!window.A2ZCrypto || !window.argon2) {
      throw new Error("crypto_engine_unavailable");
    }
    const departmentName = getDepartmentName(departmentId);
    if (!departmentName) {
      throw new Error("invalid_department");
    }
    const derived = await window.A2ZCrypto.deriveKeys(
      "org-service::" + departmentName,
      ORG_SHARED_SALT_PREFIX + departmentName,
      { argon2: window.argon2 }
    );
    return derived.masterEncryptionKey;
  }

  async function encryptServiceRecord(serviceObj, departmentId) {
    const key = await ensureDepartmentSharedKey(departmentId);
    return window.A2ZCrypto.encryptAesGcm(serviceObj, key);
  }

  async function decryptServiceRecord(record, departmentId) {
    const key = await ensureDepartmentSharedKey(departmentId);
    const payload = parseEncryptedPayload(record);
    const decrypted = await window.A2ZCrypto.decryptAesGcm(payload, key, { parseJson: true });
    const data = decrypted && typeof decrypted === "object" ? decrypted : {};
    return {
      id: record.id,
      service: data.service || "Service",
      username: data.username || "-",
      url: data.url || "",
      password: data.password || ""
    };
  }

  async function loadVaultRecords(departmentId) {
    const targetId = Number(departmentId || 0);
    if (!targetId) return;
    state.selectedVaultDepartmentId = targetId;
    const data = await api("/api/admin/vault-records?department_id=" + targetId, { method: "GET" });
    const records = data.records || [];
    const privateMetadata = data.private_records || [];
    const decrypted = [];
    for (let i = 0; i < records.length; i += 1) {
      try {
        decrypted.push(await decryptServiceRecord(records[i], targetId));
      } catch (error) {}
    }
    state.vaultRecords = decrypted;
    state.privateMetadataRecords = privateMetadata;
    state.expandedAuditUserId = 0;
    renderVaultRecords();
    renderDepartmentUsers(targetId);
  }

  function renderVaultRecords() {
    const rows = state.vaultRecords.map(function (row) {
      const fieldId = "vault-password-" + row.id;
      return '<div class="admin-row">' +
        '<div class="admin-row-main"><strong>' + escapeHtml(row.service) + "</strong>" +
        '<span>' + escapeHtml(row.username) + (row.url ? " • " + escapeHtml(row.url) : "") + "</span>" +
        '<div class="credential-password">' +
          '<input id="' + fieldId + '" type="password" value="' + escapeHtml(row.password) + '" readonly>' +
          '<button type="button" class="credential-eye" data-toggle-password="' + fieldId + '" title="Reveal password" aria-label="Toggle password"><i data-feather="eye"></i></button>' +
          '<button type="button" class="credential-eye" data-copy-password="' + fieldId + '" title="Copy password" aria-label="Copy password"><i data-feather="copy"></i></button>' +
        "</div>" +
        "</div>" +
        '<div class="admin-row-actions">' +
          '<button data-edit-record="' + row.id + '" type="button" class="vault-secondary-btn admin-action-btn" title="Edit service" aria-label="Edit service"><i data-feather="edit-2"></i></button>' +
          '<button data-delete-record="' + row.id + '" type="button" class="vault-secondary-btn admin-action-btn" title="Delete service" aria-label="Delete service"><i data-feather="trash-2"></i></button>' +
        "</div></div>";
    });
    els.vaultServicesList.innerHTML = rows.join("") || '<div class="admin-row"><div class="admin-row-main"><strong>No department services yet.</strong></div></div>';
    refreshIcons();
  }

  function getPrivateMetadataForUser(username) {
    const target = String(username || "").toLowerCase();
    return state.privateMetadataRecords.filter(function (row) {
      return String(row.owner_username || "").toLowerCase() === target;
    });
  }

  function renderDepartmentUsers(departmentId) {
    const targetId = Number(departmentId || 0);
    const query = String(state.vaultUserQuery || "").trim().toLowerCase();
    const users = state.users.filter(function (user) {
      return Number(user.department_id || 0) === targetId;
    }).filter(function (user) {
      if (!query) return true;
      return String(user.username || "").toLowerCase().indexOf(query) !== -1;
    });
    const rows = users.map(function (user) {
      const statusTag = user.is_setup
        ? statusPill("Setup Complete", "check", "success")
        : statusPill("Setup Pending", "clock", "alert");
      const metadata = getPrivateMetadataForUser(user.username);
      const isExpanded = state.expandedAuditUserId === Number(user.id || 0);
      const metadataRows = metadata.map(function (entry) {
        const serviceLabel = escapeHtml(entry.service_name || "Private Service");
        const urlLabel = entry.service_url ? escapeHtml(entry.service_url) : "-";
        return '<div class="admin-audit-entry">' +
          '<strong>' + serviceLabel + "</strong>" +
          '<span>URL: ' + urlLabel + "</span>" +
          statusPill("Password hidden", "lock", "default") +
          "</div>";
      }).join("");
      const metadataBlock = metadataRows || '<div class="admin-audit-empty">No private metadata entries for this user.</div>';
      return '<div class="admin-row admin-audit-row">' +
        '<button type="button" class="admin-audit-toggle" data-toggle-audit-user="' + Number(user.id || 0) + '" title="' + (isExpanded ? "Collapse audit details" : "Expand audit details") + '" aria-expanded="' + (isExpanded ? "true" : "false") + '">' +
          '<div class="admin-row-main"><strong>' + escapeHtml(user.username) + "</strong>" +
          '<span>User Private Entries (Metadata Only)</span></div>' +
          '<div class="admin-row-actions">' + statusTag + '<span class="admin-audit-caret" aria-hidden="true">' + (isExpanded ? "▴" : "▾") + "</span></div>" +
        "</button>" +
        '<div class="admin-audit-metadata' + (isExpanded ? "" : " hidden") + '">' + metadataBlock + "</div>" +
        "</div>";
    });
    els.departmentUsersList.innerHTML = rows.join("") || '<div class="admin-row"><div class="admin-row-main"><strong>No assigned users found for this department.</strong></div></div>';
  }

  function resetVaultForm() {
    state.editingVaultRecordId = null;
    els.vaultServiceName.value = "";
    els.vaultServiceUsername.value = "";
    els.vaultServiceUrl.value = "";
    els.vaultServicePassword.value = "";
  }

  async function saveVaultService(event) {
    event.preventDefault();
    const departmentId = Number(els.vaultDepartmentId.value || 0);
    const serviceName = els.vaultServiceName.value.trim();
    const username = els.vaultServiceUsername.value.trim();
    const url = els.vaultServiceUrl.value.trim();
    const password = els.vaultServicePassword.value;
    if (!departmentId || !serviceName || !username || !password) {
      setMessage("Department, service, username, and password are required.", true);
      return;
    }
    const ciphertext = await encryptServiceRecord({
      service: serviceName,
      username: username,
      url: url,
      password: password
    }, departmentId);
    const payload = {
      department_id: departmentId,
      service_name: serviceName,
      service_username: username,
      service_url: url,
      iv_blob: ciphertext.iv,
      ciphertext_blob: ciphertext.ciphertext
    };
    if (state.editingVaultRecordId) {
      await api("/api/admin/vault-records/" + state.editingVaultRecordId, {
        method: "PATCH",
        body: JSON.stringify({
          service_name: serviceName,
          service_username: username,
          service_url: url,
          iv_blob: payload.iv_blob,
          ciphertext_blob: payload.ciphertext_blob
        })
      });
      setMessage("Encrypted service updated.");
    } else {
      await api("/api/admin/vault-records", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setMessage("Encrypted service added.");
    }
    resetVaultForm();
    await loadVaultRecords(departmentId);
  }

  async function seedDepartmentDefaultsOnce() {
    if (localStorage.getItem("a2z_admin_seeded_defaults_v1") === "1") return;
    const seededAny = [];
    for (let i = 0; i < state.departments.length; i += 1) {
      const dept = state.departments[i];
      const defaults = DEFAULT_SERVICES[dept.name] || [];
      if (!defaults.length) continue;
      const existing = await api("/api/admin/vault-records?department_id=" + dept.id, { method: "GET" });
      const existingRecords = existing.records || [];
      let decryptableCount = 0;
      for (let r = 0; r < existingRecords.length; r += 1) {
        try {
          await decryptServiceRecord(existingRecords[r], dept.id);
          decryptableCount += 1;
        } catch (error) {}
      }
      if (decryptableCount > 0) continue;
      for (let j = 0; j < defaults.length; j += 1) {
        const encrypted = await encryptServiceRecord(defaults[j], dept.id);
        await api("/api/admin/vault-records", {
          method: "POST",
          body: JSON.stringify({
            department_id: dept.id,
            iv_blob: encrypted.iv,
            ciphertext_blob: encrypted.ciphertext
          })
        });
      }
      seededAny.push(dept.name);
    }
    localStorage.setItem("a2z_admin_seeded_defaults_v1", "1");
    if (seededAny.length) {
      setMessage("Seeded encrypted defaults for: " + seededAny.join(", "));
    }
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
        inputElements: [els.newUsername, els.search],
        textNodes: [els.message]
      });
    }
    els.usersList.innerHTML = "";
    els.requestsList.innerHTML = "";
    sessionStorage.removeItem("a2z_dev_master_password");
    sessionStorage.removeItem("a2z_dev_auth_hash");
    sessionStorage.removeItem("a2z_dev_crypto_username");
    window.location.href = "/login";
  }

  async function bootstrap() {
    initSidebarToggle();
    state.currentUser = await api("/api/auth/me", { method: "GET" });
    await loadDepartments();
    try {
      await seedDepartmentDefaultsOnce();
    } catch (error) {
      setMessage("Unable to initialize department vault crypto.", true);
    }
    await loadUsers();
    await loadRequests();
    await loadAccountResetRequests();
    try {
      await loadVaultRecords(state.selectedVaultDepartmentId);
    } catch (error) {}
    setActiveView("users");
    setActiveVaultTab("shared");

    // Admin service password eye toggle
    var adminPwToggle = document.getElementById("admin-service-pw-toggle");
    if (adminPwToggle) {
      adminPwToggle.addEventListener("click", function () {
        var field = document.getElementById("vault-service-password");
        if (!field) return;
        var show = field.type === "password";
        field.type = show ? "text" : "password";
        adminPwToggle.innerHTML = show ? '<i data-feather="eye-off" aria-hidden="true"></i>' : '<i data-feather="eye" aria-hidden="true"></i>';
        refreshIcons();
      });
    }

    els.createForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      try {
        if (!els.newDepartment.value) {
          setMessage("Select a department first.", true);
          return;
        }
        await api("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({
            username: els.newUsername.value.trim(),
            department_id: Number(els.newDepartment.value)
          })
        });
        els.newUsername.value = "";
        await loadUsers();
        setMessage("User created.");
      } catch (error) {
        setMessage(error.message, true);
      }
    });

    els.usersList.addEventListener("click", async function (event) {
      const saveId = event.target.getAttribute("data-save-user");
      if (!saveId) return;
      const picker = els.usersList.querySelector('input[data-user-id="' + saveId + '"]');
      if (!picker || !picker.value) {
        setMessage("Select a department first.", true);
        return;
      }
      try {
        await api("/api/admin/users/" + saveId, {
          method: "PATCH",
          body: JSON.stringify({ department_id: Number(picker.value) })
        });
        await loadUsers();
        setMessage("Department updated.");
      } catch (error) {
        setMessage(error.message, true);
      }
    });

    els.requestsList.addEventListener("click", async function (event) {
      const approveId = event.target.getAttribute("data-approve");
      const declineId = event.target.getAttribute("data-decline");
      if (!approveId && !declineId) return;
      try {
        if (approveId) {
          await withStepUp(function () {
            return api("/api/admin/mfa-requests/" + approveId + "/approve", { method: "POST", body: "{}" });
          });
        } else if (declineId) {
          await api("/api/admin/mfa-requests/" + declineId + "/decline", { method: "POST", body: "{}" });
        }
        await loadRequests();
        await loadAccountResetRequests();
        await loadUsers();
        setMessage("Request updated.");
      } catch (error) {
        setMessage(error.message, true);
      }
    });

    if (els.accountResetRequestsList) {
      els.accountResetRequestsList.addEventListener("click", async function (event) {
        const approveId = event.target.getAttribute("data-account-approve");
        const declineId = event.target.getAttribute("data-account-decline");
        if (!approveId && !declineId) return;
        try {
          if (approveId) {
            await withStepUp(function () {
              return api("/api/admin/account-reset-requests/" + approveId + "/approve", { method: "POST", body: "{}" });
            });
          } else if (declineId) {
            await api("/api/admin/account-reset-requests/" + declineId + "/decline", { method: "POST", body: "{}" });
          }
          await loadAccountResetRequests();
          await loadUsers();
          setMessage("Account reset request updated.");
        } catch (error) {
          setMessage(error.message, true);
        }
      });
    }

    els.viewButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        setActiveView(btn.getAttribute("data-view"));
      });
    });

    els.vaultForm.addEventListener("submit", function (event) {
      saveVaultService(event).catch(function (error) {
        setMessage(error.message, true);
      });
    });

    els.vaultServicesList.addEventListener("click", function (event) {
      const toggleTarget = event.target.closest("[data-toggle-password]");
      if (toggleTarget) {
        const fieldId = toggleTarget.getAttribute("data-toggle-password");
        const field = fieldId ? document.getElementById(fieldId) : null;
        if (!field) return;
        const show = field.type === "password";
        field.type = show ? "text" : "password";
        toggleTarget.innerHTML = show ? '<i data-feather="eye-off"></i>' : '<i data-feather="eye"></i>';
        refreshIcons();
        return;
      }
      const copyTarget = event.target.closest("[data-copy-password]");
      if (copyTarget) {
        const fieldId = copyTarget.getAttribute("data-copy-password");
        const field = fieldId ? document.getElementById(fieldId) : null;
        if (!field) return;
        navigator.clipboard.writeText(field.value).then(function () {
          setMessage("Password copied.");
        }).catch(function () {
          setMessage("Copy failed.", true);
        });
        return;
      }
      const editBtn = event.target.closest("[data-edit-record]");
      if (editBtn) {
        const id = Number(editBtn.getAttribute("data-edit-record"));
        const record = state.vaultRecords.find(function (item) { return item.id === id; });
        if (!record) return;
        state.editingVaultRecordId = id;
        els.vaultServiceName.value = record.service;
        els.vaultServiceUsername.value = record.username;
        els.vaultServiceUrl.value = record.url || "";
        els.vaultServicePassword.value = record.password;
        return;
      }
      const deleteBtn = event.target.closest("[data-delete-record]");
      if (deleteBtn) {
        const id = Number(deleteBtn.getAttribute("data-delete-record"));
        withStepUp(function () {
          return api("/api/admin/vault-records/" + id, { method: "DELETE" });
        })
          .then(function () {
            setMessage("Service removed.");
            return loadVaultRecords(state.selectedVaultDepartmentId);
          })
          .catch(function (error) {
            setMessage(error.message, true);
          });
      }
    });

    els.departmentUsersList.addEventListener("click", function (event) {
      const toggle = event.target.closest("[data-toggle-audit-user]");
      if (!toggle) return;
      const userId = Number(toggle.getAttribute("data-toggle-audit-user") || 0);
      if (!userId) return;
      state.expandedAuditUserId = state.expandedAuditUserId === userId ? 0 : userId;
      renderDepartmentUsers(state.selectedVaultDepartmentId);
    });

    els.vaultTabButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        setActiveVaultTab(btn.getAttribute("data-vault-tab"));
      });
    });

    if (els.vaultUserSearch) {
      els.vaultUserSearch.addEventListener("input", function () {
        state.vaultUserQuery = els.vaultUserSearch.value || "";
        renderDepartmentUsers(state.selectedVaultDepartmentId);
      });
    }

    els.search.addEventListener("input", function () {
      state.query = els.search.value || "";
      renderUsers();
    });

    document.addEventListener("click", function (e) {
      if (e.target.closest(".custom-dropdown-trigger")) {
        const dropdown = e.target.closest(".custom-dropdown");
        dropdown.classList.toggle("open");
        document.querySelectorAll(".custom-dropdown.open").forEach(function(d) {
          if (d !== dropdown) d.classList.remove("open");
        });
        return;
      }
      if (e.target.closest(".custom-dropdown-option") && !e.target.classList.contains("disabled")) {
        const option = e.target.closest(".custom-dropdown-option");
        const dropdown = option.closest(".custom-dropdown");
        const val = option.getAttribute("data-value");
        const text = option.textContent;
        dropdown.querySelector(".custom-dropdown-value").textContent = text;
        const hiddenInput = dropdown.querySelector("input[type='hidden']");
        if (hiddenInput) hiddenInput.value = val;
        dropdown.querySelectorAll(".custom-dropdown-option").forEach(function(el) { el.classList.remove("selected"); });
        option.classList.add("selected");
        dropdown.classList.remove("open");
        if (hiddenInput && hiddenInput.id === "vault-department-id") {
          state.selectedVaultDepartmentId = Number(hiddenInput.value || 0);
          loadVaultRecords(state.selectedVaultDepartmentId).catch(function (error) {
            setMessage(error.message, true);
          });
        }
        return;
      }
      document.querySelectorAll(".custom-dropdown.open").forEach(function(d) {
        if (!d.contains(e.target)) d.classList.remove("open");
      });
    });
  }

  els.logout.addEventListener("click", function () {
    secureLogout();
  });

  // ── Bulk Init ──────────────────────────────────────────────────────────────
  (function initBulk() {
    var dropzone = document.getElementById("bulk-dropzone");
    var fileInput = document.getElementById("bulk-file-input");
    var fileInfo = document.getElementById("bulk-file-info");
    var fileName = document.getElementById("bulk-file-name");
    var fileSize = document.getElementById("bulk-file-size");
    var fileRemove = document.getElementById("bulk-file-remove");
    var previewCard = document.getElementById("bulk-preview-card");
    var previewWrap = document.getElementById("bulk-preview-wrap");
    var uploadBtn = document.getElementById("bulk-upload-btn");
    var cancelBtn = document.getElementById("bulk-cancel-btn");
    var progressCard = document.getElementById("bulk-progress-card");
    var progressFill = document.getElementById("bulk-progress-fill");
    var resultsCard = document.getElementById("bulk-results-card");
    var resultsDiv = document.getElementById("bulk-results");
    var templateBtn = document.getElementById("bulk-download-template");

    if (!dropzone || !fileInput) return;

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
      return (bytes / 1048576).toFixed(1) + " MB";
    }

    function resetBulk() {
      state.bulkFile = null;
      state.bulkParsedRows = [];
      fileInfo.classList.add("hidden");
      dropzone.classList.remove("hidden");
      previewCard.classList.add("hidden");
      progressCard.classList.add("hidden");
      resultsCard.classList.add("hidden");
      previewWrap.innerHTML = "";
      resultsDiv.innerHTML = "";
      progressFill.style.width = "0%";
      fileInput.value = "";
    }

    function parseCSV(text) {
      var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
      if (!lines.length) return [];
      var header = lines[0].toLowerCase().split(",").map(function (h) { return h.trim(); });
      var usernameIdx = header.indexOf("username");
      var deptIdx = header.indexOf("department");
      if (usernameIdx === -1 || deptIdx === -1) return null;
      var rows = [];
      for (var i = 1; i < lines.length; i++) {
        var cols = lines[i].split(",").map(function (c) { return c.trim(); });
        if (!cols[usernameIdx] && !cols[deptIdx]) continue;
        rows.push({ username: cols[usernameIdx] || "", department: cols[deptIdx] || "" });
      }
      return rows;
    }

    function renderPreview(rows) {
      var html = '<table class="bulk-preview-table"><thead><tr><th>#</th><th>Username</th><th>Department</th></tr></thead><tbody>';
      rows.forEach(function (r, i) {
        html += "<tr><td>" + (i + 1) + "</td><td>" + escapeHtml(r.username) + "</td><td>" + escapeHtml(r.department) + "</td></tr>";
      });
      html += "</tbody></table>";
      previewWrap.innerHTML = html;
      previewCard.classList.remove("hidden");
    }

    function handleFile(file) {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
        setMessage("Please upload a .csv file.", true);
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        setMessage("File too large. Max 2 MB.", true);
        return;
      }
      state.bulkFile = file;
      fileName.textContent = file.name;
      fileSize.textContent = formatBytes(file.size);
      dropzone.classList.add("hidden");
      fileInfo.classList.remove("hidden");
      resultsCard.classList.add("hidden");

      var reader = new FileReader();
      reader.onload = function (e) {
        var rows = parseCSV(e.target.result);
        if (rows === null) {
          setMessage('Invalid CSV format. Required columns: "username" and "department".', true);
          resetBulk();
          return;
        }
        if (!rows.length) {
          setMessage("CSV contains no data rows.", true);
          resetBulk();
          return;
        }
        state.bulkParsedRows = rows;
        renderPreview(rows);
        setMessage("");
        refreshIcons();
      };
      reader.readAsText(file);
      refreshIcons();
    }

    dropzone.addEventListener("dragover", function (e) {
      e.preventDefault();
      dropzone.classList.add("is-dragover");
    });
    dropzone.addEventListener("dragleave", function () {
      dropzone.classList.remove("is-dragover");
    });
    dropzone.addEventListener("drop", function (e) {
      e.preventDefault();
      dropzone.classList.remove("is-dragover");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        handleFile(e.dataTransfer.files[0]);
      }
    });
    fileInput.addEventListener("change", function () {
      if (fileInput.files && fileInput.files.length) {
        handleFile(fileInput.files[0]);
      }
    });
    fileRemove.addEventListener("click", function () {
      resetBulk();
    });
    cancelBtn.addEventListener("click", function () {
      resetBulk();
    });

    templateBtn.addEventListener("click", function () {
      var csv = "username,department\nj.doe,IT_Department\na.smith,HR_Department\nm.jones,Finance\n";
      var blob = new Blob([csv], { type: "text/csv" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "a2z_bulk_template.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    uploadBtn.addEventListener("click", async function () {
      if (!state.bulkParsedRows.length) {
        setMessage("No rows to upload.", true);
        return;
      }

      // Derive the admin auth_key from session storage (same as login flow).
      var storedAuthHash = sessionStorage.getItem("a2z_dev_auth_hash");
      if (!storedAuthHash) {
        setMessage("Session auth key missing. Please log out and log in again.", true);
        return;
      }

      previewCard.classList.add("hidden");
      progressCard.classList.remove("hidden");
      progressFill.style.width = "20%";
      setMessage("");

      try {
        progressFill.style.width = "50%";
        var result = await api("/api/admin/bulk-init", {
          method: "POST",
          body: JSON.stringify({
            auth_key: storedAuthHash,
            rows: state.bulkParsedRows
          })
        });
        progressFill.style.width = "100%";

        setTimeout(function () {
          progressCard.classList.add("hidden");
          resultsCard.classList.remove("hidden");
          var summaryHtml = '<div class="bulk-results-summary">';
          summaryHtml += '<span class="bulk-stat bulk-stat--success"><i data-feather="check-circle" aria-hidden="true"></i><span>' + (result.created || 0) + ' created</span></span>';
          if (result.errors) {
            summaryHtml += '<span class="bulk-stat bulk-stat--error"><i data-feather="alert-circle" aria-hidden="true"></i><span>' + result.errors + ' errors</span></span>';
          }
          summaryHtml += "</div>";
          if (result.departments_created && result.departments_created.length) {
            summaryHtml += '<p style="margin-top:var(--sp-3);color:var(--text-muted);font-size:0.875rem">New departments: <strong>' + escapeHtml(result.departments_created.join(", ")) + '</strong></p>';
          }
          if (result.results) {
            var errors = result.results.filter(function (r) { return r.status === "error"; });
            if (errors.length) {
              summaryHtml += '<div class="bulk-error-list" style="margin-top:var(--sp-3)">';
              errors.forEach(function (e) {
                summaryHtml += '<div class="bulk-error-item">Row ' + e.row + (e.username ? " (" + escapeHtml(e.username) + ")" : "") + ": " + escapeHtml(e.reason) + "</div>";
              });
              summaryHtml += "</div>";
            }
          }
          resultsDiv.innerHTML = summaryHtml;
          refreshIcons();

          // Refresh the users list in the background.
          loadUsers().catch(function () {});
          loadDepartments().catch(function () {});
        }, 350);
      } catch (error) {
        progressCard.classList.add("hidden");
        setMessage(error.message || "Bulk upload failed.", true);
        resetBulk();
      }
    });
  })();

  bootstrap().catch(function (error) {
    setMessage(error.message, true);
  });
})();
