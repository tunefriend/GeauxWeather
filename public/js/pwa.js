/* GeauxWeather PWA — register SW + install button */
(function () {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function (err) {
      console.warn("SW register failed", err);
    });
  });

  var deferred = null;
  var btn = null;

  function setInstallVisible(show) {
    btn = document.getElementById("pwa-install-btn");
    var hint = document.getElementById("pwa-install-hint");
    if (!btn) return;
    if (show) {
      btn.hidden = false;
      btn.disabled = false;
      if (hint) hint.hidden = true;
    }
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    setInstallVisible(true);
  });

  window.addEventListener("appinstalled", function () {
    deferred = null;
    btn = document.getElementById("pwa-install-btn");
    if (btn) {
      btn.hidden = true;
    }
    var status = document.getElementById("pwa-install-status");
    if (status) {
      status.textContent = "Installed — open GeauxWeather from your Start menu or app list.";
      status.hidden = false;
    }
  });

  document.addEventListener("DOMContentLoaded", function () {
    btn = document.getElementById("pwa-install-btn");
    if (!btn) return;
    btn.addEventListener("click", async function () {
      if (!deferred) {
        var status = document.getElementById("pwa-install-status");
        if (status) {
          status.hidden = false;
          status.textContent =
            "Use your browser menu: Install app / Apps → Install GeauxWeather (Edge or Chrome).";
        }
        return;
      }
      deferred.prompt();
      try {
        await deferred.userChoice;
      } catch (_) {}
      deferred = null;
      btn.hidden = true;
    });

    // Already running as installed PWA
    if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
      btn.hidden = true;
      var status = document.getElementById("pwa-install-status");
      if (status) {
        status.hidden = false;
        status.textContent = "Running as installed app.";
      }
      var hint = document.getElementById("pwa-install-hint");
      if (hint) hint.hidden = true;
    }
  });
})();
