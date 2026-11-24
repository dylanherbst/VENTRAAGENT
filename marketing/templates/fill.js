// Fills [data-slot] elements from window.__VENTRA__ = { theme, slots: { name: value } }.
// Values are plain text (HTML is escaped). Formatting: *word* -> gradient accent, a newline -> line break.
// Array values render as list items. A slot set to "" is hidden (see base.css [data-slot]:empty).
(function () {
  var data = window.__VENTRA__ || {};
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmt(s) {
    return esc(s).replace(/\*([^*]+)\*/g, "<em>$1</em>").replace(/\n/g, "<br>");
  }
  function apply() {
    var canvas = document.querySelector(".canvas");
    if (canvas && data.theme) canvas.setAttribute("data-theme", data.theme);
    var slots = data.slots || {};
    Object.keys(slots).forEach(function (key) {
      document.querySelectorAll('[data-slot="' + key + '"]').forEach(function (el) {
        var v = slots[key];
        if (v === null || v === undefined) return;
        if (Array.isArray(v)) {
          el.innerHTML = v.map(function (item) { return "<li>" + fmt(item) + "</li>"; }).join("");
        } else {
          el.innerHTML = fmt(v);
        }
      });
    });
    document.documentElement.setAttribute("data-filled", "1");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);
  else apply();
})();
