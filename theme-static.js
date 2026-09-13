/** Same key as SPA src/theme.ts — 陰/陽 follows 助太刀トップ. */
(function () {
  var KEY = "bushi.theme";
  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      if (v === "light" || v === "dark") return v;
    } catch (e) {}
    try {
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)
        return "dark";
    } catch (e) {}
    return "light";
  }
  function apply(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    document.documentElement.style.colorScheme = mode;
    try {
      localStorage.setItem(KEY, mode);
    } catch (e) {}
    var btn = document.getElementById("themeToggle");
    if (btn) {
      var dark = mode === "dark";
      btn.setAttribute("aria-label", dark ? "陽モード" : "陰モード");
      btn.title = dark ? "陽" : "陰";
      btn.textContent = dark ? "陽" : "陰";
    }
  }
  var mode = stored();
  apply(mode);
  window.__bushiTheme = {
    get: function () {
      return document.documentElement.getAttribute("data-theme") || "light";
    },
    toggle: function () {
      var next = window.__bushiTheme.get() === "dark" ? "light" : "dark";
      apply(next);
      return next;
    },
  };
  document.addEventListener("DOMContentLoaded", function () {
    apply(window.__bushiTheme.get());
    var btn = document.getElementById("themeToggle");
    if (btn) btn.addEventListener("click", function () { window.__bushiTheme.toggle(); });
  });
})();
