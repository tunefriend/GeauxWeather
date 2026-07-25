/**
 * cache.js — offline last-known forecast + location
 * localStorage now; Capacitor Preferences when native
 */
(function (global) {
  const FORECAST_KEY = 'puresky_last_forecast';
  const LOC_KEY = 'puresky_location';
  const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h still "useful"

  function readRaw(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function writeRaw(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch (_) {}
  }

  function saveForecast(loc, data, units) {
    const payload = {
      loc: loc,
      data: data,
      units: units,
      at: Date.now(),
    };
    writeRaw(FORECAST_KEY, JSON.stringify(payload));
    return payload;
  }

  function loadForecast() {
    const raw = readRaw(FORECAST_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.data) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function ageLabel(at) {
    if (!at) return '';
    const mins = Math.round((Date.now() - at) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.round(hrs / 24) + 'd ago';
  }

  function isStale(at) {
    if (!at) return true;
    return Date.now() - at > MAX_AGE_MS;
  }

  global.PureSkyCache = {
    saveForecast: saveForecast,
    loadForecast: loadForecast,
    ageLabel: ageLabel,
    isStale: isStale,
    MAX_AGE_MS: MAX_AGE_MS,
  };
})(window);
