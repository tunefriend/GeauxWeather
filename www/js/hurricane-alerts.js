/**
 * hurricane-alerts.js — Settings toggle + poll NHC; bridge to native notifications
 */
(function (global) {
  const PREF_KEY = 'geauxweather_hurricane_alerts';
  const SEEN_KEY = 'geauxweather_hurricane_seen';
  const POLL_MS = 15 * 60 * 1000; // while app open

  let pollTimer = null;
  let checking = false;

  function isEnabled() {
    return localStorage.getItem(PREF_KEY) === 'on';
  }

  function setEnabledLocal(on) {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  }

  async function syncPreferences(on) {
    setEnabledLocal(on);
    try {
      if (
        global.Capacitor &&
        global.Capacitor.Plugins &&
        global.Capacitor.Plugins.Preferences
      ) {
        await global.Capacitor.Plugins.Preferences.set({
          key: PREF_KEY,
          value: on ? 'on' : 'off',
        });
      }
    } catch (e) {
      console.warn('hurricane pref write', e);
    }
    try {
      if (
        global.Capacitor &&
        global.Capacitor.Plugins &&
        global.Capacitor.Plugins.GeauxWeatherNative
      ) {
        const n = global.Capacitor.Plugins.GeauxWeatherNative;
        if (typeof n.setHurricaneAlerts === 'function') {
          await n.setHurricaneAlerts({ enabled: !!on });
        }
      }
    } catch (e) {
      console.warn('native setHurricaneAlerts', e);
    }
  }

  function loadSeen() {
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveSeen(map) {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(map));
    } catch (e) {
      /* ignore */
    }
    // Native keeps its own seen map in SharedPreferences; web can also push via check
  }

  function stormFingerprint(s) {
    const adv =
      (s.forecastTrack && s.forecastTrack.advNum) ||
      (s.publicAdvisory && s.publicAdvisory.advNum) ||
      '';
    return {
      name: s.name || s.id || '',
      classification: s.classification || '',
      intensity: String(s.intensity || ''),
      adv: String(adv),
      lat: s.latitudeNumeric,
      lon: s.longitudeNumeric,
    };
  }

  /**
   * Compare NHC storms to last-seen; return list of human alert messages.
   * Also updates seen map when seedOnly is false.
   */
  function diffAlerts(storms, opts) {
    opts = opts || {};
    const seedOnly = !!opts.seedOnly;
    const prev = loadSeen();
    const next = {};
    const alerts = [];

    for (let i = 0; i < storms.length; i++) {
      const s = storms[i];
      const id = s.id || s.name;
      if (!id) continue;
      const fp = stormFingerprint(s);
      next[id] = fp;
      const old = prev[id];
      if (seedOnly) continue;
      if (!old) {
        alerts.push({
          title: 'New tropical cyclone',
          body:
            (fp.classification || 'Storm') +
            ' ' +
            fp.name +
            (fp.intensity ? ' · ' + fp.intensity + ' kt' : ''),
          id: id,
        });
      } else if (old.adv !== fp.adv && fp.adv) {
        alerts.push({
          title: fp.name + ' — new advisory',
          body:
            'Advisory #' +
            fp.adv +
            (fp.intensity ? ' · ' + fp.intensity + ' kt' : '') +
            (fp.classification ? ' · ' + fp.classification : ''),
          id: id + '-adv-' + fp.adv,
        });
      } else if (
        old.intensity &&
        fp.intensity &&
        parseInt(fp.intensity, 10) > parseInt(old.intensity, 10) + 5
      ) {
        alerts.push({
          title: fp.name + ' strengthened',
          body: old.intensity + ' → ' + fp.intensity + ' kt',
          id: id + '-int-' + fp.intensity,
        });
      }
    }

    saveSeen(next);
    return alerts;
  }

  async function fetchStorms() {
    const res = await fetch('https://www.nhc.noaa.gov/CurrentStorms.json', {
      cache: 'no-cache',
    });
    if (!res.ok) throw new Error('NHC ' + res.status);
    const json = await res.json();
    return json.activeStorms || [];
  }

  async function notifyNative(title, body, tag) {
    try {
      if (
        global.Capacitor &&
        global.Capacitor.Plugins &&
        global.Capacitor.Plugins.GeauxWeatherNative &&
        typeof global.Capacitor.Plugins.GeauxWeatherNative.showHurricaneAlert ===
          'function'
      ) {
        await global.Capacitor.Plugins.GeauxWeatherNative.showHurricaneAlert({
          title: title,
          body: body,
          tag: tag || 'hurricane',
        });
        return true;
      }
    } catch (e) {
      console.warn('showHurricaneAlert', e);
    }
    // Web fallback
    try {
      if (global.Notification && Notification.permission === 'granted') {
        new Notification(title, { body: body, tag: tag });
        return true;
      }
    } catch (e2) {
      /* ignore */
    }
    return false;
  }

  async function checkNow(opts) {
    opts = opts || {};
    if (!isEnabled() && !opts.force) return { alerts: [], storms: [] };
    if (checking) return { alerts: [], storms: [] };
    checking = true;
    try {
      const storms = await fetchStorms();
      // First enable: seed without notifying
      const seen = loadSeen();
      const firstRun = Object.keys(seen).length === 0 && !opts.allowSeedNotify;
      const alerts = diffAlerts(storms, { seedOnly: firstRun });
      if (!firstRun) {
        for (let i = 0; i < alerts.length; i++) {
          await notifyNative(alerts[i].title, alerts[i].body, alerts[i].id);
        }
      }
      // Ask native to run its own check/update seen (keeps background in sync)
      try {
        if (
          global.Capacitor &&
          global.Capacitor.Plugins &&
          global.Capacitor.Plugins.GeauxWeatherNative &&
          typeof global.Capacitor.Plugins.GeauxWeatherNative.checkHurricaneAlerts ===
            'function'
        ) {
          await global.Capacitor.Plugins.GeauxWeatherNative.checkHurricaneAlerts({
            seedOnly: firstRun,
          });
        }
      } catch (e) {
        /* ignore */
      }
      return { alerts: alerts, storms: storms, seeded: firstRun };
    } catch (e) {
      console.warn('hurricane check failed', e);
      return { alerts: [], storms: [], error: String(e) };
    } finally {
      checking = false;
    }
  }

  function startPolling() {
    stopPolling();
    if (!isEnabled()) return;
    pollTimer = setInterval(function () {
      checkNow();
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function setEnabled(on) {
    await syncPreferences(!!on);
    if (on) {
      // Seed current storms so we don't spam on enable
      try {
        const storms = await fetchStorms();
        diffAlerts(storms, { seedOnly: true });
      } catch (e) {
        /* ignore */
      }
      startPolling();
      // Schedule native worker
      try {
        if (
          global.Capacitor &&
          global.Capacitor.Plugins &&
          global.Capacitor.Plugins.GeauxWeatherNative &&
          typeof global.Capacitor.Plugins.GeauxWeatherNative.setHurricaneAlerts ===
            'function'
        ) {
          await global.Capacitor.Plugins.GeauxWeatherNative.setHurricaneAlerts({
            enabled: true,
          });
        }
      } catch (e) {
        /* ignore */
      }
    } else {
      stopPolling();
    }
  }

  function wireSettings() {
    const toggle = document.getElementById('hurricane-alerts-toggle');
    if (!toggle) return;
    toggle.checked = isEnabled();
    toggle.addEventListener('change', function () {
      setEnabled(!!toggle.checked);
    });
  }

  function init() {
    wireSettings();
    if (isEnabled()) {
      startPolling();
      // Deferred check after load
      setTimeout(function () {
        checkNow();
      }, 4000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.PureSkyHurricaneAlerts = {
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    checkNow: checkNow,
    startPolling: startPolling,
    stopPolling: stopPolling,
  };
})(window);
