/**
 * GeauxWeather
 * Copyright (C) 2026 TuneFriend / James
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * severe-storm alerts — Settings toggle; location-based NWS + nearby NHC
 * (file name kept for script tag compatibility)
 *
 * Alerts for home (active) or default location:
 *  - Tornado / severe thunderstorm / tropical NWS alerts at that point
 *  - NHC tropical cyclones within ~500 mi
 */
(function (global) {
  const PREF_KEY = 'geauxweather_hurricane_alerts'; // kept for existing installs
  const SEEN_KEY = 'geauxweather_severe_seen';
  const LOC_KEY = 'geauxweather_location';
  const DEFAULT_KEY = 'geauxweather_default';
  const POLL_MS = 15 * 60 * 1000;
  const TROPICAL_RADIUS_MI = 500;

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
      console.warn('severe pref write', e);
    }
    try {
      if (
        global.Capacitor &&
        global.Capacitor.Plugins &&
        global.Capacitor.Plugins.GeauxWeatherNative &&
        typeof global.Capacitor.Plugins.GeauxWeatherNative.setHurricaneAlerts ===
          'function'
      ) {
        await global.Capacitor.Plugins.GeauxWeatherNative.setHurricaneAlerts({
          enabled: !!on,
        });
      }
    } catch (e) {
      console.warn('native setHurricaneAlerts', e);
    }
  }

  function loadSeen() {
    try {
      const raw =
        localStorage.getItem(SEEN_KEY) ||
        localStorage.getItem('geauxweather_hurricane_seen');
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
  }

  function parseLoc(raw) {
    if (!raw) return null;
    try {
      const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (o && o.lat != null && o.lon != null) {
        return {
          lat: Number(o.lat),
          lon: Number(o.lon),
          label: o.label || o.name || 'Your location',
        };
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  async function resolveAlertLocation() {
    // Prefer active home location, then default city
    let loc = null;
    try {
      if (global.PureSkyLocation) {
        if (typeof global.PureSkyLocation.loadSavedLocation === 'function') {
          loc = parseLoc(await global.PureSkyLocation.loadSavedLocation());
        }
        if (
          !loc &&
          typeof global.PureSkyLocation.loadDefaultLocation === 'function'
        ) {
          loc = parseLoc(await global.PureSkyLocation.loadDefaultLocation());
        }
      }
    } catch (e) {
      /* ignore */
    }
    if (!loc) {
      try {
        if (
          global.Capacitor &&
          global.Capacitor.Plugins &&
          global.Capacitor.Plugins.Preferences
        ) {
          const Prefs = global.Capacitor.Plugins.Preferences;
          const a = await Prefs.get({ key: LOC_KEY });
          loc = parseLoc(a && a.value);
          if (!loc) {
            const b = await Prefs.get({ key: DEFAULT_KEY });
            loc = parseLoc(b && b.value);
          }
        }
      } catch (e2) {
        /* ignore */
      }
    }
    if (!loc) {
      loc = parseLoc(localStorage.getItem(LOC_KEY));
    }
    if (!loc) {
      loc = parseLoc(localStorage.getItem(DEFAULT_KEY));
    }
    return loc;
  }

  function haversineMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8;
    const toR = Math.PI / 180;
    const dLat = (lat2 - lat1) * toR;
    const dLon = (lon2 - lon1) * toR;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toR) *
        Math.cos(lat2 * toR) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function isSevereEvent(event) {
    const e = (event || '').toLowerCase();
    return (
      e.indexOf('tornado') >= 0 ||
      e.indexOf('severe thunderstorm') >= 0 ||
      e.indexOf('hurricane') >= 0 ||
      e.indexOf('tropical storm') >= 0 ||
      e.indexOf('tropical depression') >= 0 ||
      e.indexOf('storm surge') >= 0 ||
      e.indexOf('extreme wind') >= 0
    );
  }

  async function netFetch(url, as) {
    if (global.PureSkyNet && typeof global.PureSkyNet.fetch === 'function') {
      return global.PureSkyNet.fetch(url, { as: as || 'json' });
    }
    const res = await fetch(url, {
      cache: 'no-cache',
      headers: {
        Accept: 'application/geo+json,application/json',
        'User-Agent': 'GeauxWeather/1.0 (FOSS)',
      },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return as === 'text' ? res.text() : res.json();
  }

  async function fetchNwsAtPoint(lat, lon) {
    const url =
      'https://api.weather.gov/alerts/active?status=actual&point=' +
      encodeURIComponent(lat.toFixed(4) + ',' + lon.toFixed(4));
    const geo = await netFetch(url, 'json');
    const features = (geo && geo.features) || [];
    const out = [];
    for (let i = 0; i < features.length; i++) {
      const props = features[i].properties || {};
      if (!isSevereEvent(props.event)) continue;
      out.push(props);
    }
    return out;
  }

  async function fetchNearbyTropical(lat, lon) {
    const json = await netFetch(
      'https://www.nhc.noaa.gov/CurrentStorms.json',
      'json'
    );
    const storms = (json && json.activeStorms) || [];
    const out = [];
    for (let i = 0; i < storms.length; i++) {
      const s = storms[i];
      if (s.latitudeNumeric == null || s.longitudeNumeric == null) continue;
      const dist = haversineMiles(
        lat,
        lon,
        s.latitudeNumeric,
        s.longitudeNumeric
      );
      if (dist <= TROPICAL_RADIUS_MI) {
        out.push({ storm: s, distMi: dist });
      }
    }
    return out;
  }

  function diffAndCollect(loc, nwsAlerts, tropical, opts) {
    opts = opts || {};
    const seedOnly = !!opts.seedOnly;
    const prev = loadSeen();
    const next = {};
    const alerts = [];
    const place = (loc && loc.label) || 'your location';

    for (let i = 0; i < nwsAlerts.length; i++) {
      const p = nwsAlerts[i];
      const alertId =
        p.id || p.event + '|' + (p.sent || '') + '|' + (p.areaDesc || '');
      const key = 'nws:' + alertId;
      next[key] = { event: p.event, headline: p.headline || '' };
      if (seedOnly) continue;
      if (prev[key]) continue;
      alerts.push({
        title: p.event || 'Severe weather',
        body:
          (p.severity ? p.severity + ' · ' : '') +
          (p.areaDesc || place) +
          ' · near ' +
          place,
        id: key,
      });
    }

    for (let i = 0; i < tropical.length; i++) {
      const t = tropical[i];
      const s = t.storm;
      const id = s.id || s.name;
      if (!id) continue;
      const adv =
        (s.forecastTrack && s.forecastTrack.advNum) ||
        (s.publicAdvisory && s.publicAdvisory.advNum) ||
        '';
      const key = 'nhc:' + id;
      const fp = {
        name: s.name || id,
        classification: s.classification || '',
        intensity: String(s.intensity || ''),
        adv: String(adv),
        distMi: Math.round(t.distMi),
      };
      next[key] = fp;
      if (seedOnly) continue;
      const old = prev[key];
      const near = Math.round(t.distMi) + ' mi from ' + place;
      if (!old) {
        alerts.push({
          title: 'Tropical cyclone near you',
          body:
            (fp.classification || 'Storm') +
            ' ' +
            fp.name +
            (fp.intensity ? ' · ' + fp.intensity + ' kt' : '') +
            ' · ' +
            near,
          id: key,
        });
      } else if (old.adv !== fp.adv && fp.adv) {
        alerts.push({
          title: fp.name + ' — new advisory',
          body: 'Advisory #' + fp.adv + ' · ' + near,
          id: key + '-adv-' + fp.adv,
        });
      } else if (
        old.intensity &&
        fp.intensity &&
        parseInt(fp.intensity, 10) > parseInt(old.intensity, 10) + 5
      ) {
        alerts.push({
          title: fp.name + ' strengthened',
          body: old.intensity + ' → ' + fp.intensity + ' kt · ' + near,
          id: key + '-int-' + fp.intensity,
        });
      }
    }

    saveSeen(next);
    return alerts;
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
          tag: tag || 'severe',
        });
        return true;
      }
    } catch (e) {
      console.warn('showHurricaneAlert', e);
    }
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
    if (!isEnabled() && !opts.force) return { alerts: [] };
    if (checking) return { alerts: [] };
    checking = true;
    try {
      const loc = await resolveAlertLocation();
      if (!loc) {
        console.warn('Severe alerts: no home/default location');
        return { alerts: [], noLocation: true };
      }

      const seen = loadSeen();
      const firstRun = Object.keys(seen).length === 0 && !opts.allowSeedNotify;

      let nws = [];
      let tropical = [];
      try {
        nws = await fetchNwsAtPoint(loc.lat, loc.lon);
      } catch (e) {
        console.warn('NWS point alerts failed', e);
      }
      try {
        tropical = await fetchNearbyTropical(loc.lat, loc.lon);
      } catch (e) {
        console.warn('NHC nearby failed', e);
      }

      const alerts = diffAndCollect(loc, nws, tropical, { seedOnly: firstRun });
      if (!firstRun) {
        for (let i = 0; i < alerts.length; i++) {
          await notifyNative(alerts[i].title, alerts[i].body, alerts[i].id);
        }
      }

      try {
        if (
          global.Capacitor &&
          global.Capacitor.Plugins &&
          global.Capacitor.Plugins.GeauxWeatherNative &&
          typeof global.Capacitor.Plugins.GeauxWeatherNative
            .checkHurricaneAlerts === 'function'
        ) {
          await global.Capacitor.Plugins.GeauxWeatherNative.checkHurricaneAlerts(
            { seedOnly: firstRun }
          );
        }
      } catch (e) {
        /* ignore */
      }

      return {
        alerts: alerts,
        location: loc,
        nwsCount: nws.length,
        tropicalCount: tropical.length,
        seeded: firstRun,
      };
    } catch (e) {
      console.warn('severe check failed', e);
      return { alerts: [], error: String(e) };
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
      try {
        await checkNow({ force: true, allowSeedNotify: false });
        // Ensure seed: if first run, checkNow already seeded
        const seen = loadSeen();
        if (Object.keys(seen).length === 0) {
          const loc = await resolveAlertLocation();
          if (loc) {
            let nws = [];
            let tropical = [];
            try {
              nws = await fetchNwsAtPoint(loc.lat, loc.lon);
            } catch (e) {}
            try {
              tropical = await fetchNearbyTropical(loc.lat, loc.lon);
            } catch (e) {}
            diffAndCollect(loc, nws, tropical, { seedOnly: true });
          }
        }
      } catch (e) {
        /* ignore */
      }
      startPolling();
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

  function updateHint() {
    const hint = document.getElementById('hurricane-alerts-hint');
    if (!hint) return;
    resolveAlertLocation().then(function (loc) {
      if (!hint) return;
      if (loc && loc.label) {
        hint.textContent =
          'Tornado, severe thunderstorm & nearby hurricanes for ' +
          loc.label +
          ' (home or default). Checks every few hours.';
      } else {
        hint.textContent =
          'Tornado, severe thunderstorm & nearby tropical storms for your home or default location. Set a location first.';
      }
    });
  }

  function init() {
    wireSettings();
    updateHint();
    if (isEnabled()) {
      startPolling();
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
  global.PureSkySevereAlerts = global.PureSkyHurricaneAlerts;
})(window);
