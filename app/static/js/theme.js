(function () {
  "use strict";

  var THEME_KEY = "a2z_theme";
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (error) {
      return null;
    }
  }

  function getSystemTheme() {
    return media && media.matches ? "dark" : "light";
  }

  function getCurrentTheme() {
    return document.documentElement.getAttribute("data-theme") || getStoredTheme() || getSystemTheme();
  }

  function setStoredTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {}
  }

  function applyTheme(theme) {
    var normalized = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", normalized);
    updateToggleButtons(normalized);
  }

  function updateToggleButtons(theme) {
    var nextTheme = theme === "dark" ? "light" : "dark";
    var icon = theme === "dark" ? "sun" : "moon";
    var label = theme === "dark" ? "Enable light mode" : "Enable dark mode";
    var toggles = document.querySelectorAll("[data-theme-toggle]");
    toggles.forEach(function (btn) {
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
      btn.setAttribute("data-next-theme", nextTheme);
      btn.innerHTML = '<i data-feather="' + icon + '" aria-hidden="true"></i>';
    });
    if (window.feather && typeof window.feather.replace === "function") {
      window.feather.replace({ width: 16, height: 16, strokeWidth: 2 });
    }
  }

  function bindToggles() {
    var toggles = document.querySelectorAll("[data-theme-toggle]");
    toggles.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var current = getCurrentTheme();
        var next = current === "dark" ? "light" : "dark";
        setStoredTheme(next);
        applyTheme(next);
      });
    });
  }

  function initTheme() {
    applyTheme(getCurrentTheme());
    bindToggles();
  }

  if (media && typeof media.addEventListener === "function") {
    media.addEventListener("change", function () {
      if (!getStoredTheme()) {
        applyTheme(getSystemTheme());
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTheme);
  } else {
    initTheme();
  }
})();
