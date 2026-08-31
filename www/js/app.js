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
 * PureSky — shell, home vs map pin, Places folder
 * Home (Today) stays on GPS / default city; map pins don't steal home.
 */
(function () {
  const L = window.PureSkyLocation;
  const W = window.PureSkyWeather;
  /** Keep in sync with android/app/build.gradle versionName */
  const APP_VERSION = '1.0.14';

  const screens = {
    today: document.getElementById('screen-today'),
    '10day': document.getElementById('screen-10day'),
    maps: document.getElementById('screen-maps'),
    places: document.getElementById('screen-places'),
    settings: document.getElementById('screen-settings'),
  };
  const navBtns = document.querySelectorAll('.nav-btn');
  const statusEl = document.getElementById('status');
  const locNameEl = document.getElementById('loc-name');
  const unitsSelect = document.getElementById('units');
  const overlay = document.getElementById('search-overlay');
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');

  /** Home location shown on Today / 10-Day */
  let homeLoc = null;
  /** Pin currently dropped on the map (not home until user opens it from Places) */
  let mapPinLoc = null;
  let lastUpdatedAt = null;
  let units = localStorage.getItem('units') || 'imperial';
  /** true when home was set from GPS this session / last refresh */
  let homeFromGps = false;
  let searchMode = 'home'; // 'home' | 'addPlace'
  let placesRefreshing = false;
  /** Dynamic sky scenes behind the UI (Settings can disable → solid black) */
  let skyBgEnabled = localStorage.getItem('sky_bg') !== 'off';
  let lastWeatherCode = null;
  let lastIsNight = false;

  function showScreen(name) {
    Object.keys(screens).forEach(function (k) {
      if (screens[k]) screens[k].classList.remove('active');
    });
    navBtns.forEach(function (b) {
      b.classList.remove('active');
    });
    if (screens[name]) screens[name].classList.add('active');
    const btn = document.querySelector('.nav-btn[data-screen="' + name + '"]');
    if (btn) btn.classList.add('active');
  }
  // Used by severe-alert deep links from native notifications
  window.__geauxShowScreen = showScreen;

  navBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      const name = btn.getAttribute('data-screen');
      showScreen(name);
      if (name === 'maps' && window.PureSkyMaps) {
        window.PureSkyMaps.onShow();
      }
      if (name === 'places') {
        renderPlacesList();
        refreshPlacesWeather();
      }
    });
  });

  /** Home-screen widget look (native reads CapacitorStorage geauxweather_widget_style) */
  function defaultWidgetStyle() {
    return { bgOpacity: 0, bgColor: '#141a22', textColor: '#ffffff' };
  }

  function loadWidgetStyle() {
    try {
      const raw = localStorage.getItem('geauxweather_widget_style');
      if (!raw) return defaultWidgetStyle();
      const o = JSON.parse(raw);
      return {
        bgOpacity: Math.max(0, Math.min(100, Number(o.bgOpacity) || 0)),
        bgColor: typeof o.bgColor === 'string' ? o.bgColor : '#141a22',
        textColor: typeof o.textColor === 'string' ? o.textColor : '#ffffff',
      };
    } catch (e) {
      return defaultWidgetStyle();
    }
  }

  function opacityLabel(n) {
    if (n <= 0) return 'Transparent';
    if (n >= 100) return 'Solid';
    return n + '%';
  }

  function syncWidgetStyleControls(style) {
    const op = document.getElementById('widget-opacity');
    const opLab = document.getElementById('widget-opacity-label');
    const bg = document.getElementById('widget-bg-color');
    const text = document.getElementById('widget-text-color');
    if (op) op.value = String(style.bgOpacity);
    if (opLab) opLab.textContent = opacityLabel(style.bgOpacity);
    if (bg) bg.value = normalizeHexColor(style.bgColor, '#141a22');
    if (text) text.value = normalizeHexColor(style.textColor, '#ffffff');
  }

  function normalizeHexColor(hex, fallback) {
    if (!hex || typeof hex !== 'string') return fallback;
    let h = hex.trim();
    if (h.charAt(0) !== '#') h = '#' + h;
    if (/^#[0-9a-fA-F]{3}$/.test(h)) {
      h =
        '#' +
        h.charAt(1) +
        h.charAt(1) +
        h.charAt(2) +
        h.charAt(2) +
        h.charAt(3) +
        h.charAt(3);
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(h)) return fallback;
    return h.toLowerCase();
  }

  async function saveWidgetStyle(style, opts) {
    opts = opts || {};
    const payload = JSON.stringify({
      bgOpacity: style.bgOpacity,
      bgColor: normalizeHexColor(style.bgColor, '#141a22'),
      textColor: normalizeHexColor(style.textColor, '#ffffff'),
    });
    localStorage.setItem('geauxweather_widget_style', payload);
    try {
      if (
        window.Capacitor &&
        window.Capacitor.isNativePlatform &&
        window.Capacitor.isNativePlatform() &&
        window.Capacitor.Plugins &&
        window.Capacitor.Plugins.Preferences
      ) {
        await window.Capacitor.Plugins.Preferences.set({
          key: 'geauxweather_widget_style',
          value: payload,
        });
      }
    } catch (e) {
      console.warn('widget style prefs write skipped', e);
    }
    if (opts.refresh !== false) {
      try {
        if (
          window.Capacitor &&
          window.Capacitor.Plugins &&
          window.Capacitor.Plugins.GeauxWeatherNative &&
          typeof window.Capacitor.Plugins.GeauxWeatherNative.refreshChrome ===
            'function'
        ) {
          await window.Capacitor.Plugins.GeauxWeatherNative.refreshChrome();
        }
      } catch (e) {
        console.warn('widget style refresh skipped', e);
      }
    }
  }

  function wireWidgetStyleSettings() {
    const op = document.getElementById('widget-opacity');
    const opLab = document.getElementById('widget-opacity-label');
    const bg = document.getElementById('widget-bg-color');
    const text = document.getElementById('widget-text-color');
    let style = loadWidgetStyle();
    syncWidgetStyleControls(style);

    function readFromUi() {
      return {
        bgOpacity: op ? parseInt(op.value, 10) || 0 : 0,
        bgColor: bg ? bg.value : '#141a22',
        textColor: text ? text.value : '#ffffff',
      };
    }

    let saveTimer = null;
    function scheduleSave() {
      style = readFromUi();
      if (opLab) opLab.textContent = opacityLabel(style.bgOpacity);
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        saveWidgetStyle(style);
      }, 120);
    }

    if (op) {
      op.addEventListener('input', scheduleSave);
      op.addEventListener('change', scheduleSave);
    }
    if (bg) bg.addEventListener('input', scheduleSave);
    if (text) text.addEventListener('input', scheduleSave);

    document.querySelectorAll('.widget-swatch[data-text]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const c = btn.getAttribute('data-text');
        if (text && c) {
          text.value = normalizeHexColor(c, '#ffffff');
          scheduleSave();
        }
      });
    });
  }

  function loadPrefs() {
    if (unitsSelect) unitsSelect.value = units;
    const skyToggle = document.getElementById('sky-bg-toggle');
    if (skyToggle) skyToggle.checked = skyBgEnabled;
    const hurToggle = document.getElementById('hurricane-alerts-toggle');
    if (hurToggle) {
      hurToggle.checked = localStorage.getItem('geauxweather_hurricane_alerts') === 'on';
    }
    syncWidgetStyleControls(loadWidgetStyle());
    const about = document.getElementById('app-about');
    if (about) {
      about.textContent =
        'GeauxWeather · v' + APP_VERSION + ' · GPL-3.0 · Open-Meteo · NHC · No tracking';
    }
  }
  if (unitsSelect) {
    unitsSelect.addEventListener('change', function () {
      units = unitsSelect.value;
      localStorage.setItem('units', units);
      if (homeLoc) loadHomeWeather(homeLoc, true);
      refreshPlacesWeather(true);
    });
  }
  const skyBgToggle = document.getElementById('sky-bg-toggle');
  if (skyBgToggle) {
    skyBgToggle.addEventListener('change', function () {
      skyBgEnabled = !!skyBgToggle.checked;
      localStorage.setItem('sky_bg', skyBgEnabled ? 'on' : 'off');
      setSkyMood(lastWeatherCode, lastIsNight);
    });
  }
  wireWidgetStyleSettings();

  function setStatus(msg, ms) {
    statusEl.textContent = msg || '';
    if (ms) {
      setTimeout(function () {
        if (statusEl.textContent === msg) {
          if (lastUpdatedAt) showLastUpdated();
          else statusEl.textContent = '';
        }
      }, ms);
    }
  }

  function showLastUpdated() {
    if (!lastUpdatedAt) return;
    const t = new Date(lastUpdatedAt);
    const label = t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    statusEl.textContent = 'Updated ' + label;
  }

  function precipUnitLabel() {
    return units === 'metric' ? 'mm' : 'in';
  }

  function formatPrecip(val) {
    if (val == null || Number(val) === 0) return '0 ' + precipUnitLabel();
    if (units === 'metric') return (Math.round(val * 10) / 10) + ' mm';
    return (Math.round(val * 100) / 100) + ' in';
  }

  function formatTimeISO(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (_) {
      return '—';
    }
  }

  function snapshotFromForecast(loc, data) {
    const c = data.current;
    const cond = W.codeToCondition(c.weather_code);
    return {
      temp: Math.round(c.temperature_2m),
      condition: cond.text,
      weatherCode: c.weather_code,
      label: (loc && loc.label) || null,
      weatherAt: Date.now(),
    };
  }

  function ensureStars() {
    const el = document.getElementById('sky-stars');
    if (!el || el.dataset.ready === '1') return;
    const n = 48;
    let html = '';
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 100;
      const y = Math.random() * 70;
      const s = 1 + Math.random() * 2;
      const d = 2 + Math.random() * 4;
      const delay = Math.random() * 5;
      html +=
        '<span class="star" style="left:' +
        x +
        '%;top:' +
        y +
        '%;width:' +
        s +
        'px;height:' +
        s +
        'px;animation-duration:' +
        d +
        's;animation-delay:' +
        delay +
        's"></span>';
    }
    el.innerHTML = html;
    el.dataset.ready = '1';
  }

  function isNightFromDaily(data) {
    try {
      const d = data && data.daily;
      if (!d || !d.sunrise || !d.sunset) return false;
      const rise = new Date(d.sunrise[0]).getTime();
      const set = new Date(d.sunset[0]).getTime();
      const now = Date.now();
      if (!rise || !set || isNaN(rise) || isNaN(set)) return false;
      return now < rise || now >= set;
    } catch (_) {
      return false;
    }
  }

  function setSkyMood(weatherCode, isNight) {
    if (weatherCode != null) lastWeatherCode = weatherCode;
    if (typeof isNight === 'boolean') lastIsNight = isNight;
    const classes = [
      'sky-mood-sunny',
      'sky-mood-cloudy',
      'sky-mood-rain',
      'sky-mood-night',
      'sky-mood-default',
    ];
    const sky = document.getElementById('sky-bg');
    const theme = document.querySelector('meta[name="theme-color"]');

    if (!skyBgEnabled) {
      document.body.classList.remove.apply(document.body.classList, classes);
      document.body.classList.add('sky-mood-default');
      if (sky) {
        sky.classList.remove.apply(sky.classList, classes);
        sky.classList.add('sky-mood-default');
        sky.classList.add('sky-bg-off');
      }
      if (theme) theme.setAttribute('content', '#0b0f14');
      return;
    }

    if (sky) sky.classList.remove('sky-bg-off');
    let mood =
      W.codeToMood && typeof W.codeToMood === 'function'
        ? W.codeToMood(lastWeatherCode)
        : 'cloudy';
    // Night sky with stars unless it's actively raining/storming
    if (lastIsNight && mood !== 'rain') {
      mood = 'night';
      ensureStars();
    }

    document.body.classList.remove.apply(document.body.classList, classes);
    document.body.classList.add('sky-mood-' + mood);
    if (sky) {
      sky.classList.remove.apply(sky.classList, classes);
      sky.classList.add('sky-mood-' + mood);
    }
    if (theme) {
      const colors = {
        sunny: '#2a5f8a',
        rain: '#151c28',
        cloudy: '#3a424e',
        night: '#0a0e18',
      };
      theme.setAttribute('content', colors[mood] || '#0b0f14');
    }
  }

  function renderCurrent(data) {
    const c = data.current;
    const cond = W.codeToCondition(c.weather_code);
    const deg = units === 'metric' ? '°C' : '°F';
    const windU = units === 'metric' ? 'km/h' : 'mph';

    const night = isNightFromDaily(data);
    setSkyMood(c.weather_code, night);

    const t = Math.round(c.temperature_2m);
    const tempNum = document.getElementById('temp-num');
    const tempNow = document.getElementById('temp-now');
    if (tempNum) tempNum.textContent = String(t);
    // Degree is a separate hang-off glyph so digits stay optically centered
    if (tempNow) tempNow.setAttribute('aria-label', t + ' degrees');
    document.getElementById('cond-now').textContent = cond.icon + ' ' + cond.text;
    document.getElementById('feels').textContent =
      'Feels ' + Math.round(c.apparent_temperature) + deg;

    // Sunrise / sunset for today
    const riseEl = document.getElementById('sunrise-now');
    const setEl = document.getElementById('sunset-now');
    if (riseEl && setEl && data.daily) {
      riseEl.textContent = formatTimeISO(data.daily.sunrise ? data.daily.sunrise[0] : null);
      setEl.textContent = formatTimeISO(data.daily.sunset ? data.daily.sunset[0] : null);
    }

    const metrics = [
      {
        label: 'Wind',
        value:
          Math.round(c.wind_speed_10m) +
          ' ' +
          windU +
          ' ' +
          W.windDir(c.wind_direction_10m),
      },
      { label: 'Humidity', value: c.relative_humidity_2m + '%' },
      {
        label: 'Dew point',
        value:
          c.dew_point_2m != null ? Math.round(c.dew_point_2m) + deg : '—',
      },
      { label: 'UV', value: c.uv_index != null ? String(Math.round(c.uv_index)) : '—' },
      { label: 'Visibility', value: W.formatVis(c.visibility, units) },
      { label: 'Precip', value: formatPrecip(c.precipitation) },
      {
        label: 'Pressure',
        value: c.pressure_msl != null ? Math.round(c.pressure_msl) + ' hPa' : '—',
      },
    ];
    document.getElementById('metrics-today').innerHTML = metrics
      .map(function (m) {
        return (
          '<div class="metric"><div class="metric-label">' +
          m.label +
          '</div><div class="metric-value">' +
          m.value +
          '</div></div>'
        );
      })
      .join('');
  }

  function renderHourly(data) {
    const h = data.hourly;
    const now = Date.now();
    let start = 0;
    for (let i = 0; i < h.time.length; i++) {
      if (new Date(h.time[i]).getTime() >= now - 30 * 60 * 1000) {
        start = i;
        break;
      }
    }
    const cards = [];
    for (let i = start; i < Math.min(start + 24, h.time.length); i++) {
      const t = new Date(h.time[i]);
      // Compact hour labels (avoid wrap under large Android font/display sizes)
      let label = 'Now';
      if (i !== start) {
        const h12 = t.getHours() % 12 || 12;
        const ap = t.getHours() < 12 ? 'a' : 'p';
        label = h12 + ap;
      }
      const cond = W.codeToCondition(h.weather_code[i]);
      const pop =
        h.precipitation_probability && h.precipitation_probability[i] != null
          ? h.precipitation_probability[i]
          : null;
      const popHtml =
        pop != null && pop > 0
          ? '<div class="hour-pop">' + pop + '%</div>'
          : '<div class="hour-pop dim">—</div>';
      const windSp =
        h.wind_speed_10m && h.wind_speed_10m[i] != null
          ? Math.round(h.wind_speed_10m[i])
          : null;
      const windD =
        h.wind_direction_10m && h.wind_direction_10m[i] != null
          ? W.windDir(h.wind_direction_10m[i])
          : '';
      const windHtml =
        windSp != null
          ? '<div class="hour-wind" title="Wind">' +
            windSp +
            (windD ? ' ' + windD : '') +
            '</div>'
          : '<div class="hour-wind dim">—</div>';
      cards.push(
        '<div class="hour-card"><div class="hour-time">' +
          label +
          '</div><div class="hour-icon">' +
          cond.icon +
          '</div><div class="hour-temp">' +
          Math.round(h.temperature_2m[i]) +
          '°</div>' +
          windHtml +
          popHtml +
          '</div>'
      );
    }
    document.getElementById('hourly').innerHTML = cards.join('');
  }

  function renderDaily(data) {
    const d = data.daily;
    const rows = d.time.map(function (dateStr, i) {
      const dt = new Date(dateStr + 'T12:00:00');
      const name = i === 0 ? 'Today' : dt.toLocaleDateString([], { weekday: 'short' });
      const cond = W.codeToCondition(d.weather_code[i]);
      const popVal =
        d.precipitation_probability_max && d.precipitation_probability_max[i] != null
          ? d.precipitation_probability_max[i]
          : null;
      const pop = popVal != null ? popVal + '%' : '—';
      const precip = formatPrecip(d.precipitation_sum ? d.precipitation_sum[i] : 0);
      const uv =
        d.uv_index_max && d.uv_index_max[i] != null
          ? Math.round(d.uv_index_max[i])
          : '—';
      const sunrise = formatTimeISO(d.sunrise ? d.sunrise[i] : null);
      const sunset = formatTimeISO(d.sunset ? d.sunset[i] : null);
      const windU = units === 'metric' ? 'km/h' : 'mph';
      const windMax =
        d.wind_speed_10m_max && d.wind_speed_10m_max[i] != null
          ? Math.round(d.wind_speed_10m_max[i])
          : null;
      const windDirDaily =
        d.wind_direction_10m_dominant && d.wind_direction_10m_dominant[i] != null
          ? W.windDir(d.wind_direction_10m_dominant[i])
          : '';
      const windLabel =
        windMax != null
          ? windMax + (windDirDaily ? ' ' + windDirDaily : '')
          : '—';
      const windDetail =
        windMax != null
          ? windMax + ' ' + windU + (windDirDaily ? ' ' + windDirDaily : '')
          : '—';

      return (
        '<div class="day-block">' +
        '<button type="button" class="day-row" aria-expanded="false">' +
        '<div class="day-name">' +
        name +
        '</div>' +
        '<div class="day-icon">' +
        cond.icon +
        '</div>' +
        '<div class="day-pop">' +
        (popVal != null && popVal > 0 ? pop : '') +
        '</div>' +
        '<div class="day-wind" title="Max wind">' +
        (windMax != null ? windLabel : '') +
        '</div>' +
        '<div class="day-temps">' +
        '<span class="day-high">' +
        Math.round(d.temperature_2m_max[i]) +
        '°</span>' +
        '<span class="day-low">' +
        Math.round(d.temperature_2m_min[i]) +
        '°</span>' +
        '</div>' +
        '<span class="day-chevron">▾</span>' +
        '</button>' +
        '<div class="day-detail hidden">' +
        '<div class="day-detail-grid">' +
        '<div><span class="muted">Precip</span><strong>' +
        precip +
        '</strong></div>' +
        '<div><span class="muted">Chance</span><strong>' +
        pop +
        '</strong></div>' +
        '<div><span class="muted">Wind max</span><strong>' +
        windDetail +
        '</strong></div>' +
        '<div><span class="muted">UV max</span><strong>' +
        uv +
        '</strong></div>' +
        '<div><span class="muted">Sunrise</span><strong>' +
        sunrise +
        '</strong></div>' +
        '<div><span class="muted">Sunset</span><strong>' +
        sunset +
        '</strong></div>' +
        '<div><span class="muted">Sky</span><strong>' +
        cond.text +
        '</strong></div>' +
        '</div></div></div>'
      );
    });
    const dailyEl = document.getElementById('daily');
    dailyEl.innerHTML = rows.join('');

    dailyEl.querySelectorAll('.day-row').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const block = btn.parentElement;
        const detail = block.querySelector('.day-detail');
        const open = !detail.classList.contains('hidden');
        dailyEl.querySelectorAll('.day-detail').forEach(function (el) {
          el.classList.add('hidden');
        });
        dailyEl.querySelectorAll('.day-row').forEach(function (b) {
          b.setAttribute('aria-expanded', 'false');
          b.classList.remove('expanded');
        });
        if (!open) {
          detail.classList.remove('hidden');
          btn.setAttribute('aria-expanded', 'true');
          btn.classList.add('expanded');
        }
      });
    });
  }

  function renderAll(data) {
    renderCurrent(data);
    renderHourly(data);
    renderDaily(data);
  }

  async function writeWidgetSnapshot(loc, data) {
    try {
      const c = data.current;
      const d = data.daily;
      const cond = W.codeToCondition(c.weather_code);
      const payload = JSON.stringify({
        label: (loc && loc.label) || 'GeauxWeather',
        temp: Math.round(c.temperature_2m) + '°',
        condition: cond.icon + ' ' + cond.text,
        weatherCode: c.weather_code != null ? c.weather_code : -1,
        high: d && d.temperature_2m_max ? Math.round(d.temperature_2m_max[0]) + '°' : '—°',
        low: d && d.temperature_2m_min ? Math.round(d.temperature_2m_min[0]) + '°' : '—°',
        units: units,
        updatedAt: Date.now(),
      });
      localStorage.setItem('geauxweather_widget', payload);
      // Keep style in CapacitorStorage so native widget can apply opacity/colors
      await saveWidgetStyle(loadWidgetStyle(), { refresh: false });
      try {
        if (
          window.Capacitor &&
          window.Capacitor.isNativePlatform &&
          window.Capacitor.isNativePlatform() &&
          window.Capacitor.Plugins &&
          window.Capacitor.Plugins.Preferences
        ) {
          await window.Capacitor.Plugins.Preferences.set({
            key: 'geauxweather_widget',
            value: payload,
          });
        }
      } catch (e) {
        console.warn('Preferences write skipped', e);
      }
      // Push to home/lock widgets + status notification
      try {
        if (
          window.Capacitor &&
          window.Capacitor.Plugins &&
          window.Capacitor.Plugins.GeauxWeatherNative &&
          typeof window.Capacitor.Plugins.GeauxWeatherNative.refreshChrome === 'function'
        ) {
          await window.Capacitor.Plugins.GeauxWeatherNative.refreshChrome();
        }
      } catch (e) {
        console.warn('refreshChrome skipped', e);
      }
    } catch (e) {
      console.warn('widget snapshot failed', e);
    }
  }

  /**
   * Load weather for HOME (Today). Optionally update map marker without stealing view.
   */
  async function loadHomeWeather(loc, quiet, mapOpts) {
    if (!loc || loc.lat == null || loc.lon == null) return;
    mapOpts = mapOpts || {};
    homeLoc = loc;
    locNameEl.textContent = loc.label || '—';
    if (!quiet) setStatus('Loading…');
    const todayEl = document.getElementById('screen-today');
    if (todayEl) todayEl.classList.add('loading');

    try {
      const data = await W.fetchForecast(loc.lat, loc.lon, units);
      renderAll(data);
      lastUpdatedAt = Date.now();
      showLastUpdated();
      writeWidgetSnapshot(loc, data);
      await L.saveLocation(loc);

      if (window.PureSkyMaps) {
        // Only force map view when explicitly requested (search/GPS/select place)
        if (mapOpts.forceMapView) {
          window.PureSkyMaps.setLocation(loc, { forceView: true });
        } else if (!mapPinLoc) {
          // Keep home marker in sync if user isn't exploring a pin
          window.PureSkyMaps.setLocation(loc, { forceView: false });
        }
        window.PureSkyMaps.setForecast(data);
      }
      if (window.PureSkyCache) {
        window.PureSkyCache.saveForecast(loc, data, units);
      }
    } catch (err) {
      console.error(err);
      setStatus('Could not load forecast');
      const cached = window.PureSkyCache ? window.PureSkyCache.loadForecast() : null;
      if (cached && cached.data) {
        renderAll(cached.data);
        lastUpdatedAt = cached.at || null;
        const age = window.PureSkyCache.ageLabel(cached.at);
        setStatus('Offline · last known' + (age ? ' (' + age + ')' : ''), 4000);
      }
    } finally {
      if (todayEl) todayEl.classList.remove('loading');
    }
  }

  /** Open a saved place as the home screen */
  async function openPlaceAsHome(place) {
    const loc = {
      lat: place.lat,
      lon: place.lon,
      label: place.label || place.name,
      pinned: false,
      source: 'saved',
    };
    homeFromGps = false;
    mapPinLoc = null;
    closeSearch();
    showScreen('today');
    await loadHomeWeather(loc, false, { forceMapView: true });
  }

  async function useGpsAsHome() {
    setStatus('Getting location…');
    if (btnGps) {
      btnGps.disabled = true;
      btnGps.textContent = 'Locating…';
    }
    try {
      const pos = await L.getCurrentPosition();
      let label = 'Current location';
      if (L.reverseGeocode) {
        try {
          const place = await L.reverseGeocode(pos.lat, pos.lon);
          if (place && place.label) label = place.label;
        } catch (_) {}
      }
      const loc = {
        lat: pos.lat,
        lon: pos.lon,
        label: label,
        source: 'gps',
      };
      homeFromGps = true;
      mapPinLoc = null;
      closeSearch();
      await loadHomeWeather(loc, false, { forceMapView: true });
    } catch (err) {
      console.warn(err);
      const msg =
        (err && err.message) ||
        (err && err.errorMessage) ||
        'Location denied or unavailable';
      setStatus(
        /denied|permission/i.test(String(msg))
          ? 'Allow location in Settings → Apps → GeauxWeather'
          : 'Location unavailable — try again or search a city',
        5000
      );
    } finally {
      if (btnGps) {
        btnGps.disabled = false;
        btnGps.textContent = 'Use current location (set home)';
      }
    }
  }

  /**
   * Header refresh:
   * - GPS on / available → refresh current GPS as home
   * - GPS off → refresh default city (or last home)
   */
  async function refreshHome() {
    setStatus('Refreshing…');
    try {
      const pos = await L.getCurrentPosition();
      let label = 'Current location';
      try {
        const place = await L.reverseGeocode(pos.lat, pos.lon);
        if (place && place.label) label = place.label;
      } catch (_) {}
      homeFromGps = true;
      mapPinLoc = null;
      await loadHomeWeather(
        { lat: pos.lat, lon: pos.lon, label: label, source: 'gps' },
        false,
        { forceMapView: false }
      );
      setStatus('Updated from GPS', 2000);
      return;
    } catch (err) {
      console.warn('GPS refresh failed, using default', err);
      homeFromGps = false;
    }

    // GPS off / denied → default city or last home
    let loc = null;
    try {
      loc = await L.loadDefaultLocation();
    } catch (_) {}
    if (!loc) loc = homeLoc;
    if (!loc) {
      try {
        loc = await L.loadSavedLocation();
      } catch (_) {}
    }
    if (loc && loc.lat != null) {
      await loadHomeWeather(loc, false, { forceMapView: false });
      setStatus('Updated default location', 2000);
    } else {
      setStatus('No default location — search or use GPS', 4000);
      openSearch('home');
    }
  }

  // --- Map pin (does NOT change home) ---
  async function onMapPinDrop(loc) {
    setStatus('Finding nearest city…');
    loc.pinned = true;

    // Resolve nearest city name (Nominatim) before weather/save
    try {
      if (L.reverseGeocode) {
        const place = await L.reverseGeocode(loc.lat, loc.lon);
        if (place && (place.label || place.name)) {
          loc.label = place.label || place.name;
          loc.name = place.name;
        }
      }
    } catch (e) {
      console.warn('reverse geocode failed', e);
    }
    if (!loc.label || loc.label === 'Finding city…' || loc.label === 'Dropped pin') {
      loc.label =
        Math.abs(loc.lat).toFixed(2) +
        '°' +
        (loc.lat >= 0 ? 'N' : 'S') +
        ', ' +
        Math.abs(loc.lon).toFixed(2) +
        '°' +
        (loc.lon >= 0 ? 'E' : 'W');
    }
    mapPinLoc = loc;

    // Fetch forecast for pin only — leave Today on homeLoc
    try {
      const data = await W.fetchForecast(loc.lat, loc.lon, units);
      if (window.PureSkyMaps) {
        window.PureSkyMaps.setLocation(loc, { forceView: false });
        window.PureSkyMaps.setForecast(data);
      }
      const snap = snapshotFromForecast(loc, data);
      mapPinLoc = Object.assign({}, loc, snap, { label: loc.label });
      updateSaveButton();
      if (window.PureSkyMaps && window.PureSkyMaps.updatePinHint) {
        window.PureSkyMaps.updatePinHint(
          loc.label + ' · ' + snap.temp + '° ' + snap.condition + ' · Save to Places'
        );
      }
      setStatus('Pin: ' + loc.label + ' · ' + snap.temp + '° ' + snap.condition, 4000);
      setTimeout(function () {
        if (homeLoc) locNameEl.textContent = homeLoc.label || '—';
      }, 4200);
    } catch (e) {
      console.warn(e);
      setStatus('Could not load pin weather', 3000);
      updateSaveButton();
    }
  }

  async function updateSaveButton() {
    const btn = document.getElementById('btn-save-place');
    if (!btn) return;
    const target = mapPinLoc;
    if (!target || target.lat == null) {
      btn.disabled = true;
      btn.textContent = 'Save';
      btn.classList.remove('saved');
      return;
    }
    btn.disabled = false;
    let already = false;
    try {
      const places = await L.loadPlaces();
      const key = L.placeKey(target);
      already = places.some(function (p) {
        return p.key === key;
      });
    } catch (_) {}
    if (already) {
      btn.textContent = 'Saved';
      btn.classList.add('saved');
    } else {
      btn.textContent = 'Save';
      btn.classList.remove('saved');
    }
  }

  async function saveMapPinToPlaces() {
    if (!mapPinLoc) {
      setStatus('Drop a pin first', 2000);
      return;
    }
    const btn = document.getElementById('btn-save-place');
    try {
      let entry = Object.assign({}, mapPinLoc);

      // Always try to resolve a real city name before saving
      const needsName =
        !entry.label ||
        entry.label === 'Dropped pin' ||
        entry.label === 'Finding city…' ||
        /^\d+\.\d+°/.test(entry.label);
      if (needsName && L.reverseGeocode) {
        try {
          const place = await L.reverseGeocode(entry.lat, entry.lon);
          if (place && (place.label || place.name)) {
            entry.label = place.label || place.name;
            entry.name = place.name;
          }
        } catch (_) {}
      }
      if (!entry.label || entry.label === 'Dropped pin' || entry.label === 'Finding city…') {
        entry.label = 'Near pin';
      }

      if (entry.temp == null) {
        const data = await W.fetchForecast(entry.lat, entry.lon, units);
        Object.assign(entry, snapshotFromForecast(entry, data));
        entry.label = entry.label; // keep city name over snapshot
      }
      mapPinLoc = entry;
      await L.addPlace(entry);
      if (btn) {
        btn.textContent = 'Saved';
        btn.classList.add('saved');
      }
      setStatus('Saved ' + entry.label + ' · home unchanged', 2500);
      if (window.PureSkyMaps && window.PureSkyMaps.updatePinHint) {
        window.PureSkyMaps.updatePinHint('Saved · ' + entry.label);
      }
      if (screens.places && screens.places.classList.contains('active')) {
        renderPlacesList();
      }
    } catch (e) {
      console.warn(e);
      setStatus('Could not save place', 2500);
    }
  }

  // --- Places list UI ---
  function placeCardHtml(p, i) {
    const cond = p.condition
      ? p.condition
      : p.weatherCode != null
        ? W.codeToCondition(p.weatherCode).text
        : '—';
    const icon =
      p.weatherCode != null ? W.codeToCondition(p.weatherCode).icon : '📍';
    const temp = p.temp != null ? p.temp + '°' : '—°';
    const defBadge = p.isDefault
      ? '<span class="place-badge">Default</span>'
      : '';
    return (
      '<article class="place-card" data-idx="' +
      i +
      '" data-key="' +
      (p.key || '') +
      '">' +
      '<div class="place-thumb" aria-hidden="true">' +
      '<img src="assets/gps-pin.svg" alt="" width="40" height="40" />' +
      '</div>' +
      '<div class="place-body">' +
      '<div class="place-name">' +
      (p.label || 'Place') +
      defBadge +
      '</div>' +
      '<div class="place-wx">' +
      '<span class="place-icon">' +
      icon +
      '</span>' +
      '<span class="place-temp">' +
      temp +
      '</span>' +
      '<span class="place-cond">' +
      cond +
      '</span>' +
      '</div>' +
      '</div>' +
      '<button type="button" class="place-del" data-del="' +
      i +
      '" aria-label="Remove">✕</button>' +
      '</article>'
    );
  }

  async function renderPlacesList() {
    const el = document.getElementById('places-list');
    if (!el) return;
    let places = [];
    try {
      places = await L.loadPlaces();
    } catch (_) {}
    if (!places.length) {
      el.innerHTML =
        '<div class="places-empty muted">' +
        '<p>No saved locations yet.</p>' +
        '<p class="small">Tap + or save a map pin.</p>' +
        '</div>';
      return;
    }
    // Default first
    places = places.slice().sort(function (a, b) {
      return (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0);
    });
    el.innerHTML = places.map(placeCardHtml).join('');

    el.querySelectorAll('.place-card').forEach(function (card) {
      const idx = +card.getAttribute('data-idx');
      let holdTimer = null;
      let held = false;

      function clearHold() {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
      }

      card.addEventListener('click', function (e) {
        if (e.target.closest('.place-del')) return;
        if (held) {
          held = false;
          return;
        }
        const p = places[idx];
        if (p) openPlaceAsHome(p);
      });

      card.addEventListener(
        'touchstart',
        function (e) {
          if (e.target.closest('.place-del')) return;
          held = false;
          holdTimer = setTimeout(async function () {
            held = true;
            const p = places[idx];
            if (!p) return;
            try {
              await L.setPlaceAsDefault(p);
              setStatus('Default: ' + (p.label || 'place'), 2500);
              renderPlacesList();
            } catch (err) {
              console.warn(err);
            }
          }, 550);
        },
        { passive: true }
      );
      card.addEventListener('touchend', clearHold);
      card.addEventListener('touchmove', clearHold);
      card.addEventListener('touchcancel', clearHold);

      // Desktop long-press
      card.addEventListener('mousedown', function (e) {
        if (e.target.closest('.place-del')) return;
        held = false;
        holdTimer = setTimeout(async function () {
          held = true;
          const p = places[idx];
          if (!p) return;
          await L.setPlaceAsDefault(p);
          setStatus('Default: ' + (p.label || 'place'), 2500);
          renderPlacesList();
        }, 550);
      });
      card.addEventListener('mouseup', clearHold);
      card.addEventListener('mouseleave', clearHold);
    });

    el.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        const p = places[+btn.getAttribute('data-del')];
        if (!p) return;
        await L.removePlace(p);
        renderPlacesList();
        updateSaveButton();
      });
    });
  }

  async function refreshPlacesWeather(force) {
    if (placesRefreshing) return;
    placesRefreshing = true;
    try {
      let places = await L.loadPlaces();
      if (!places.length) return;
      const STALE = 20 * 60 * 1000;
      for (let i = 0; i < places.length; i++) {
        const p = places[i];
        if (
          !force &&
          p.weatherAt &&
          Date.now() - p.weatherAt < STALE &&
          p.temp != null
        ) {
          continue;
        }
        try {
          const data = await W.fetchForecast(p.lat, p.lon, units);
          const snap = snapshotFromForecast(p, data);
          await L.updatePlaceWeather(p, snap);
        } catch (_) {}
      }
      await renderPlacesList();
    } finally {
      placesRefreshing = false;
    }
  }

  // --- Search / add ---
  function openSearch(mode) {
    searchMode = mode || 'home';
    overlay.classList.remove('hidden');
    searchInput.value = '';
    searchResults.innerHTML = '';
    searchInput.placeholder =
      searchMode === 'addPlace' ? 'Add a city or place…' : 'City or place…';
    const gpsBtn = document.getElementById('btn-use-gps');
    if (gpsBtn) {
      gpsBtn.style.display = searchMode === 'addPlace' ? 'none' : '';
    }
    searchInput.focus();
  }
  function closeSearch() {
    overlay.classList.add('hidden');
  }

  async function onSearchSelect(place) {
    if (searchMode === 'addPlace') {
      // Save to Places only — do not switch home
      closeSearch();
      setStatus('Adding…');
      try {
        const data = await W.fetchForecast(place.lat, place.lon, units);
        const snap = snapshotFromForecast(place, data);
        await L.addPlace({
          lat: place.lat,
          lon: place.lon,
          label: place.label || place.name,
          temp: snap.temp,
          condition: snap.condition,
          weatherCode: snap.weatherCode,
          weatherAt: snap.weatherAt,
        });
        setStatus('Added ' + (place.label || place.name), 2500);
        showScreen('places');
        renderPlacesList();
      } catch (e) {
        console.warn(e);
        setStatus('Could not add place', 2500);
      }
      return;
    }
    // Set as home
    homeFromGps = false;
    mapPinLoc = null;
    closeSearch();
    await loadHomeWeather(
      {
        lat: place.lat,
        lon: place.lon,
        label: place.label || place.name,
        source: 'search',
      },
      false,
      { forceMapView: true }
    );
  }

  let searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      if (q.length < 2) {
        searchResults.innerHTML = '';
        return;
      }
      searchTimer = setTimeout(async function () {
        try {
          const results = await L.searchCity(q);
          if (!results.length) {
            searchResults.innerHTML = '<p class="muted small">No results</p>';
            return;
          }
          searchResults.innerHTML = results
            .map(function (r, i) {
              return (
                '<button class="search-item" data-i="' +
                i +
                '">' +
                r.label +
                '</button>'
              );
            })
            .join('');
          searchResults.querySelectorAll('.search-item').forEach(function (btn) {
            btn.addEventListener('click', function () {
              onSearchSelect(results[+btn.getAttribute('data-i')]);
            });
          });
        } catch (err) {
          searchResults.innerHTML = '<p class="muted small">Search failed</p>';
        }
      }, 280);
    });
  }

  const btnLoc = document.getElementById('btn-loc');
  const btnClose = document.getElementById('search-close');
  const btnGps = document.getElementById('btn-use-gps');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnAddPlace = document.getElementById('btn-add-place');
  const btnSavePlace = document.getElementById('btn-save-place');

  if (btnLoc) {
    btnLoc.addEventListener('click', function () {
      openSearch('home');
    });
  }
  if (btnClose) btnClose.addEventListener('click', closeSearch);
  if (btnGps) btnGps.addEventListener('click', useGpsAsHome);
  if (btnAddPlace) {
    btnAddPlace.addEventListener('click', function () {
      openSearch('addPlace');
    });
  }
  if (btnSavePlace) {
    btnSavePlace.addEventListener('click', saveMapPinToPlaces);
  }
  if (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeSearch();
    });
  }
  if (btnRefresh) {
    btnRefresh.addEventListener('click', function () {
      refreshHome();
    });
  }

  const DONATE_URL = 'https://liberapay.com/west66/donate';
  const WEBSITE_URL = 'https://geauxweather.com';
  const FEEDBACK_EMAIL = 'puresky.weather@proton.me';

  function openExternalLink(url) {
    try {
      if (
        window.Capacitor &&
        window.Capacitor.isNativePlatform &&
        window.Capacitor.isNativePlatform() &&
        window.Capacitor.Plugins &&
        window.Capacitor.Plugins.App &&
        typeof window.Capacitor.Plugins.App.openUrl === 'function'
      ) {
        window.Capacitor.Plugins.App.openUrl({ url: url });
        return;
      }
    } catch (_) {}
    if (url.indexOf('mailto:') === 0) {
      window.location.href = url;
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  const btnFeedback = document.getElementById('btn-feedback');
  if (btnFeedback) {
    btnFeedback.addEventListener('click', function (e) {
      e.preventDefault();
      const subject = encodeURIComponent('GeauxWeather feedback');
      const body = encodeURIComponent(
        'Hi GeauxWeather team,\n\n' +
          'App version: ' + APP_VERSION + '\n' +
          'Device: ' +
          (navigator.userAgent || '') +
          '\n\n' +
          'Feedback:\n'
      );
      openExternalLink(
        'mailto:' + FEEDBACK_EMAIL + '?subject=' + subject + '&body=' + body
      );
    });
  }

  const btnDonate = document.getElementById('btn-donate');
  if (btnDonate) {
    btnDonate.addEventListener('click', function (e) {
      e.preventDefault();
      openExternalLink(DONATE_URL);
    });
  }

  const btnWebsite = document.getElementById('btn-website');
  if (btnWebsite) {
    btnWebsite.addEventListener('click', function (e) {
      e.preventDefault();
      openExternalLink(WEBSITE_URL);
    });
  }

  document.querySelectorAll('.layer-btn[data-layer]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const layer = btn.getAttribute('data-layer');
      if (window.PureSkyMaps) {
        window.PureSkyMaps.setLayer(layer);
      }
    });
  });

  if (window.PureSkyMaps && window.PureSkyMaps.onPinDrop) {
    window.PureSkyMaps.onPinDrop(onMapPinDrop);
  }

  // Pull-to-refresh → same as header refresh (GPS or default)
  // Important: Maps tab keeps #screens at scrollTop 0, so pull-to-refresh used to
  // fire while panning the map (Pieter feedback). Skip on Maps / map chrome.
  (function setupPullRefresh() {
    const scroller = document.getElementById('screens');
    if (!scroller) return;
    const indicator = document.createElement('div');
    indicator.className = 'pull-indicator';
    indicator.id = 'pull-indicator';
    indicator.textContent = 'Pull to refresh';
    if (scroller.firstChild) {
      scroller.insertBefore(indicator, scroller.firstChild);
    } else {
      scroller.appendChild(indicator);
    }
    let startY = 0;
    let pulling = false;
    const THRESHOLD = 70;

    function mapsScreenActive() {
      const maps = document.getElementById('screen-maps');
      return !!(maps && maps.classList.contains('active'));
    }

    function touchOnMapUi(target) {
      if (!target || !target.closest) return false;
      return !!(
        target.closest('#map') ||
        target.closest('.leaflet-container') ||
        target.closest('#radar-controls') ||
        target.closest('#rain-outlook') ||
        target.closest('.map-toolbar') ||
        target.closest('.map-pin-bar') ||
        target.closest('#map-info') ||
        target.closest('#map-legend')
      );
    }

    scroller.addEventListener(
      'touchstart',
      function (e) {
        if (mapsScreenActive() || touchOnMapUi(e.target)) {
          pulling = false;
          return;
        }
        if (scroller.scrollTop <= 0) {
          startY = e.touches[0].clientY;
          pulling = true;
        }
      },
      { passive: true }
    );
    scroller.addEventListener(
      'touchmove',
      function (e) {
        if (!pulling) return;
        if (mapsScreenActive() || touchOnMapUi(e.target)) {
          pulling = false;
          indicator.classList.remove('visible');
          return;
        }
        const dy = e.touches[0].clientY - startY;
        if (dy > 10 && scroller.scrollTop <= 0) {
          indicator.classList.add('visible');
          indicator.textContent =
            dy > THRESHOLD ? 'Release to refresh' : 'Pull to refresh';
        }
      },
      { passive: true }
    );
    scroller.addEventListener('touchend', function (e) {
      if (!pulling) return;
      pulling = false;
      const dy =
        (e.changedTouches && e.changedTouches[0]
          ? e.changedTouches[0].clientY
          : 0) - startY;
      indicator.classList.remove('visible');
      indicator.textContent = 'Pull to refresh';
      if (mapsScreenActive()) return;
      if (dy > THRESHOLD) refreshHome();
    });
  })();

  async function boot() {
    loadPrefs();
    showScreen('today');

    if (window.PureSkyMaps && window.PureSkyMaps.onPinDrop) {
      window.PureSkyMaps.onPinDrop(onMapPinDrop);
    }

    // Prefer last home, else default, else GPS
    let saved = await L.loadSavedLocation();
    if (!saved || saved.lat == null) {
      saved = await L.loadDefaultLocation();
    }

    if (saved && saved.lat != null) {
      const cached = window.PureSkyCache && window.PureSkyCache.loadForecast();
      if (
        cached &&
        cached.data &&
        cached.loc &&
        cached.loc.lat === saved.lat &&
        cached.loc.lon === saved.lon
      ) {
        homeLoc = saved;
        locNameEl.textContent = saved.label || '—';
        renderAll(cached.data);
        lastUpdatedAt = cached.at || null;
        const age = window.PureSkyCache.ageLabel(cached.at);
        setStatus(age ? 'Cached · ' + age : 'Cached');
      }
      homeFromGps = saved.source === 'gps';
      await loadHomeWeather(saved, false, { forceMapView: true });
      return;
    }

    try {
      await useGpsAsHome();
    } catch (e) {
      setStatus('Tap 📍 or Places to set location');
      locNameEl.textContent = 'Set location';
    }
  }

  /** Auto-refresh current conditions so Today doesn't stay stuck on cached Clear/etc. */
  const WEATHER_REFRESH_MS = 15 * 60 * 1000;
  const WEATHER_STALE_MS = 10 * 60 * 1000;
  let weatherRefreshTimer = null;

  async function refreshIfStale(reason) {
    if (!homeLoc || homeLoc.lat == null) return;
    const age = lastUpdatedAt ? Date.now() - lastUpdatedAt : Infinity;
    if (age < WEATHER_STALE_MS) return;
    try {
      await loadHomeWeather(homeLoc, true, { forceMapView: false });
    } catch (e) {
      console.warn('auto weather refresh failed', reason, e);
    }
  }

  function startWeatherAutoRefresh() {
    if (weatherRefreshTimer) clearInterval(weatherRefreshTimer);
    weatherRefreshTimer = setInterval(function () {
      if (document.visibilityState === 'visible') {
        refreshIfStale('interval');
      }
    }, WEATHER_REFRESH_MS);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      refreshIfStale('visible');
      if (window.PureSkyMaps && typeof window.PureSkyMaps.reloadRadar === 'function') {
        window.PureSkyMaps.reloadRadar();
      }
    }
  });
  window.addEventListener('pageshow', function () {
    refreshIfStale('pageshow');
  });

  boot();
  startWeatherAutoRefresh();
  console.log('PureSky · home vs pin · Places tab');
})();
