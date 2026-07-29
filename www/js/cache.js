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
 * cache.js — offline last-known forecast + location
 * localStorage now; Capacitor Preferences when native
 */
(function (global) {
  const FORECAST_KEY = 'geauxweather_last_forecast';
  const LOC_KEY = 'geauxweather_location';
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
