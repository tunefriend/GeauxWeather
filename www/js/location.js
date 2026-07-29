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
 * location.js — GPS + Open-Meteo geocoding + saved location
 * Classic script (no modules) so file:// preview + Capacitor WebView work
 */
(function (global) {
  const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
  // Open-Meteo has no reverse endpoint; use Nominatim (OSM) for nearest city
  const REVERSE_NOMINATIM =
    'https://nominatim.openstreetmap.org/reverse';
  const LOC_KEY = 'geauxweather_location'; // active home location (Today)
  const DEFAULT_KEY = 'geauxweather_default'; // preferred city when GPS is off
  const PLACES_KEY = 'geauxweather_places';

  function isNative() {
    return !!(
      global.Capacitor &&
      typeof global.Capacitor.isNativePlatform === 'function' &&
      global.Capacitor.isNativePlatform()
    );
  }

  /** Capacitor native plugin proxy (no bundler / no dynamic import needed) */
  function nativePlugin(name) {
    if (!isNative()) return null;
    try {
      if (global.Capacitor.Plugins && global.Capacitor.Plugins[name]) {
        return global.Capacitor.Plugins[name];
      }
    } catch (_) {}
    return null;
  }

  function browserPosition() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not available'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            source: 'browser',
          });
        },
        function (err) {
          reject(err);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      );
    });
  }

  async function getCurrentPosition() {
    var Geo = nativePlugin('Geolocation');
    if (Geo) {
      try {
        // Explicit permission request so Android shows the system dialog
        if (typeof Geo.requestPermissions === 'function') {
          var perm = await Geo.requestPermissions();
          var locationState =
            (perm && (perm.location || perm.coarseLocation)) || '';
          if (
            locationState &&
            locationState !== 'granted' &&
            locationState !== 'prompt'
          ) {
            throw new Error('Location permission denied');
          }
        }
        var pos = await Geo.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 60000,
        });
        return {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          source: 'gps',
        };
      } catch (err) {
        console.warn('Capacitor Geolocation failed, trying browser API', err);
        // Fall through to browser geolocation (sometimes works in WebView)
        try {
          return await browserPosition();
        } catch (err2) {
          throw err;
        }
      }
    }

    return browserPosition();
  }

  function buildPlaceLabel(name, admin1, country) {
    var parts = [name];
    if (admin1 && admin1 !== name) parts.push(admin1);
    else if (country && country !== name) parts.push(country);
    return parts.join(', ');
  }

  async function reverseNominatim(lat, lon) {
    var params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      format: 'json',
      zoom: '12',
      addressdetails: '1',
      'accept-language': 'en',
    });
    var res = await fetch(REVERSE_NOMINATIM + '?' + params, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    var data = await res.json();
    if (!data || data.error) return null;

    var a = data.address || {};
    var name =
      a.city ||
      a.town ||
      a.village ||
      a.municipality ||
      a.city_district ||
      a.suburb ||
      a.hamlet ||
      a.locality ||
      a.county ||
      data.name ||
      null;
    if (!name) return null;

    var admin1 = a.state || a.region || a.state_district || '';
    var country = a.country || '';
    return {
      name: name,
      admin1: admin1,
      country: country,
      label: buildPlaceLabel(name, admin1, country),
    };
  }

  /** Free client endpoint — no API key */
  async function reverseBigDataCloud(lat, lon) {
    var url =
      'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' +
      encodeURIComponent(lat) +
      '&longitude=' +
      encodeURIComponent(lon) +
      '&localityLanguage=en';
    var res = await fetch(url);
    if (!res.ok) return null;
    var data = await res.json();
    var name =
      data.city ||
      data.locality ||
      data.principalSubdivision ||
      null;
    if (!name) return null;
    var admin1 = data.principalSubdivision || '';
    var country = data.countryName || '';
    return {
      name: name,
      admin1: admin1,
      country: country,
      label: buildPlaceLabel(name, admin1, country),
    };
  }

  /**
   * Nearest city/place for a lat/lon.
   * Prefers city → town → village → municipality → county.
   */
  async function reverseGeocode(lat, lon) {
    try {
      var place = await reverseNominatim(lat, lon);
      if (place) return place;
    } catch (e) {
      console.warn('Nominatim reverse failed', e);
    }
    try {
      return await reverseBigDataCloud(lat, lon);
    } catch (e) {
      console.warn('BigDataCloud reverse failed', e);
      return null;
    }
  }

  async function searchCity(query) {
    if (!query || query.trim().length < 2) return [];
    var params = new URLSearchParams({
      name: query.trim(),
      count: 8,
      language: 'en',
      format: 'json',
    });
    var res = await fetch(GEOCODE + '?' + params);
    if (!res.ok) throw new Error('Geocode ' + res.status);
    var data = await res.json();
    return (data.results || []).map(function (r) {
      return {
        name: r.name,
        admin1: r.admin1 || '',
        country: r.country || '',
        lat: r.latitude,
        lon: r.longitude,
        label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
      };
    });
  }

  async function saveLocation(loc) {
    var payload = JSON.stringify({
      lat: loc.lat,
      lon: loc.lon,
      label: loc.label || loc.name || 'Saved',
      savedAt: Date.now(),
    });
    var Prefs = nativePlugin('Preferences');
    if (Prefs && typeof Prefs.set === 'function') {
      try {
        await Prefs.set({ key: LOC_KEY, value: payload });
        return;
      } catch (_) {}
    }
    try {
      localStorage.setItem(LOC_KEY, payload);
    } catch (_) {}
  }

  async function loadSavedLocation() {
    var Prefs = nativePlugin('Preferences');
    if (Prefs && typeof Prefs.get === 'function') {
      try {
        var result = await Prefs.get({ key: LOC_KEY });
        if (result && result.value) return JSON.parse(result.value);
      } catch (_) {}
    }
    try {
      var raw = localStorage.getItem(LOC_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  async function storageGet(key) {
    var Prefs = nativePlugin('Preferences');
    if (Prefs && typeof Prefs.get === 'function') {
      try {
        var result = await Prefs.get({ key: key });
        if (result && result.value) return result.value;
      } catch (_) {}
    }
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  async function storageSet(key, value) {
    var Prefs = nativePlugin('Preferences');
    if (Prefs && typeof Prefs.set === 'function') {
      try {
        await Prefs.set({ key: key, value: value });
        return;
      } catch (_) {}
    }
    try {
      localStorage.setItem(key, value);
    } catch (_) {}
  }

  /** Favorites list (pinned / saved places) */
  async function loadPlaces() {
    try {
      var raw = await storageGet(PLACES_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }

  async function savePlaces(list) {
    await storageSet(PLACES_KEY, JSON.stringify(list || []));
  }

  function placeKey(loc) {
    return (
      Math.round(Number(loc.lat) * 1000) / 1000 +
      ',' +
      Math.round(Number(loc.lon) * 1000) / 1000
    );
  }

  /**
   * Add or update a saved place. Merges weather snapshot fields if provided.
   * Does NOT change home location.
   */
  async function addPlace(loc) {
    if (!loc || loc.lat == null || loc.lon == null) return loadPlaces();
    var list = await loadPlaces();
    var key = placeKey(loc);
    var prev = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) {
        prev = list[i];
        break;
      }
    }
    var entry = {
      lat: loc.lat,
      lon: loc.lon,
      label: loc.label || loc.name || (prev && prev.label) || 'Saved place',
      savedAt: Date.now(),
      key: key,
      isDefault: !!(loc.isDefault || (prev && prev.isDefault)),
      temp: loc.temp != null ? loc.temp : prev ? prev.temp : null,
      condition: loc.condition || (prev && prev.condition) || null,
      weatherCode: loc.weatherCode != null ? loc.weatherCode : prev ? prev.weatherCode : null,
      weatherAt: loc.weatherAt || (prev && prev.weatherAt) || null,
    };
    list = list.filter(function (p) {
      return p.key !== key;
    });
    list.unshift(entry);
    if (list.length > 30) list = list.slice(0, 30);
    await savePlaces(list);
    return list;
  }

  async function updatePlaceWeather(locOrKey, snap) {
    var key =
      typeof locOrKey === 'string' ? locOrKey : placeKey(locOrKey);
    var list = await loadPlaces();
    var found = false;
    list = list.map(function (p) {
      if (p.key !== key) return p;
      found = true;
      return Object.assign({}, p, {
        temp: snap.temp,
        condition: snap.condition,
        weatherCode: snap.weatherCode,
        weatherAt: Date.now(),
        label: snap.label || p.label,
      });
    });
    if (found) await savePlaces(list);
    return list;
  }

  async function removePlace(locOrKey) {
    var key =
      typeof locOrKey === 'string' ? locOrKey : placeKey(locOrKey);
    var list = await loadPlaces();
    list = list.filter(function (p) {
      return p.key !== key;
    });
    await savePlaces(list);
    return list;
  }

  async function saveDefaultLocation(loc) {
    if (!loc || loc.lat == null) return;
    var payload = JSON.stringify({
      lat: loc.lat,
      lon: loc.lon,
      label: loc.label || loc.name || 'Default',
      key: placeKey(loc),
      savedAt: Date.now(),
    });
    await storageSet(DEFAULT_KEY, payload);
    // Mark in places list
    var list = await loadPlaces();
    var key = placeKey(loc);
    list = list.map(function (p) {
      return Object.assign({}, p, { isDefault: p.key === key });
    });
    await savePlaces(list);
  }

  async function loadDefaultLocation() {
    try {
      var raw = await storageGet(DEFAULT_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    // Fall back to first place marked default
    try {
      var places = await loadPlaces();
      for (var i = 0; i < places.length; i++) {
        if (places[i].isDefault) return places[i];
      }
    } catch (_) {}
    return null;
  }

  async function setPlaceAsDefault(locOrKey) {
    var key =
      typeof locOrKey === 'string' ? locOrKey : placeKey(locOrKey);
    var list = await loadPlaces();
    var target = null;
    list = list.map(function (p) {
      var isDef = p.key === key;
      if (isDef) target = p;
      return Object.assign({}, p, { isDefault: isDef });
    });
    await savePlaces(list);
    if (target) await saveDefaultLocation(target);
    return target;
  }

  global.PureSkyLocation = {
    getCurrentPosition: getCurrentPosition,
    reverseGeocode: reverseGeocode,
    searchCity: searchCity,
    saveLocation: saveLocation,
    loadSavedLocation: loadSavedLocation,
    loadPlaces: loadPlaces,
    addPlace: addPlace,
    updatePlaceWeather: updatePlaceWeather,
    removePlace: removePlace,
    placeKey: placeKey,
    saveDefaultLocation: saveDefaultLocation,
    loadDefaultLocation: loadDefaultLocation,
    setPlaceAsDefault: setPlaceAsDefault,
  };
})(window);
