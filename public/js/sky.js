/**
 * Interactive weather sky for geauxweather.com
 * Live Open-Meteo mood + parallax + click-to-cycle
 */
(function () {
  const MOODS = ['sunny', 'cloudy', 'rain', 'night'];
  const THEME = {
    sunny: '#2a5f8a',
    cloudy: '#3a424e',
    rain: '#151c28',
    night: '#0a0e18',
  };

  let mood = 'cloudy';
  let auto = true;
  let weatherCode = null;
  let isNight = false;
  let placeLabel = '';
  let tempLabel = '';
  let reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function codeToMood(code) {
    const c = Number(code);
    if (c === 0 || c === 1) return 'sunny';
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 99)) return 'rain';
    return 'cloudy';
  }

  function codeLabel(code) {
    const c = Number(code);
    if (c === 0) return 'Clear';
    if (c === 1) return 'Mostly clear';
    if (c === 2) return 'Partly cloudy';
    if (c === 3) return 'Overcast';
    if (c >= 45 && c <= 48) return 'Fog';
    if (c >= 51 && c <= 67) return 'Rain';
    if (c >= 71 && c <= 77) return 'Snow';
    if (c >= 80 && c <= 82) return 'Showers';
    if (c >= 95) return 'Thunderstorm';
    return 'Cloudy';
  }

  function ensureStars() {
    const el = document.getElementById('sky-stars');
    if (!el || el.dataset.ready === '1') return;
    let html = '';
    for (let i = 0; i < 56; i++) {
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

  function applyMood(next) {
    mood = next;
    if (mood === 'night' || (isNight && mood !== 'rain' && auto)) {
      if (mood !== 'rain') mood = auto && isNight ? 'night' : mood;
      if (mood === 'night') ensureStars();
    }
    const classes = MOODS.map(function (m) {
      return 'sky-mood-' + m;
    });
    document.body.classList.remove.apply(document.body.classList, classes);
    document.body.classList.add('sky-mood-' + mood);
    const sky = document.getElementById('sky-bg');
    if (sky) {
      sky.classList.remove.apply(sky.classList, classes);
      sky.classList.add('sky-mood-' + mood);
    }
    const theme = document.querySelector('meta[name="theme-color"]');
    if (theme) theme.setAttribute('content', THEME[mood] || '#0b1220');
    updateChip();
  }

  function updateChip() {
    const el = document.getElementById('sky-live-text');
    if (!el) return;
    if (placeLabel && tempLabel) {
      el.textContent =
        placeLabel +
        ' · ' +
        tempLabel +
        ' · ' +
        (weatherCode != null ? codeLabel(weatherCode) : mood) +
        (auto ? '' : ' (preview)');
    } else {
      el.textContent = 'Sky: ' + mood + (auto ? ' · loading live weather…' : ' (preview)');
    }
  }

  function setParallax(nx, ny) {
    if (reduced) return;
    // nx, ny in [-1, 1]
    const layers = document.querySelectorAll('.sky-parallax');
    layers.forEach(function (layer) {
      const depth = parseFloat(layer.getAttribute('data-depth') || '8', 10);
      const x = (-nx * depth).toFixed(2);
      const y = (-ny * depth * 0.6).toFixed(2);
      layer.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    });
  }

  function onPointer(e) {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const cx = e.clientX != null ? e.clientX : (e.touches && e.touches[0].clientX) || w / 2;
    const cy = e.clientY != null ? e.clientY : (e.touches && e.touches[0].clientY) || h / 2;
    setParallax((cx / w) * 2 - 1, (cy / h) * 2 - 1);
  }

  function flashLightning() {
    const sky = document.getElementById('sky-bg');
    if (!sky || mood !== 'rain') return;
    sky.classList.add('flash');
    setTimeout(function () {
      sky.classList.remove('flash');
    }, 80);
    setTimeout(function () {
      if (Math.random() > 0.5) {
        sky.classList.add('flash');
        setTimeout(function () {
          sky.classList.remove('flash');
        }, 60);
      }
    }, 120);
  }

  function cycleMood() {
    auto = false;
    const i = MOODS.indexOf(mood);
    applyMood(MOODS[(i + 1) % MOODS.length]);
    if (mood === 'rain') flashLightning();
    if (mood === 'night') ensureStars();
  }

  function useLive() {
    auto = true;
    resolveAndLoad();
  }

  async function reverseLabel(lat, lon) {
    try {
      const u =
        'https://nominatim.openstreetmap.org/reverse?lat=' +
        encodeURIComponent(lat) +
        '&lon=' +
        encodeURIComponent(lon) +
        '&format=json&zoom=10&addressdetails=1';
      const res = await fetch(u, { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const data = await res.json();
      const a = data.address || {};
      return a.city || a.town || a.village || a.municipality || a.county || data.name || null;
    } catch (_) {
      return null;
    }
  }

  async function loadWeather(lat, lon) {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: 'temperature_2m,weather_code,is_day',
      daily: 'sunrise,sunset',
      temperature_unit: 'fahrenheit',
      timezone: 'auto',
      forecast_days: '1',
    });
    const res = await fetch('https://api.open-meteo.com/v1/forecast?' + params);
    if (!res.ok) throw new Error('weather ' + res.status);
    const data = await res.json();
    const c = data.current || {};
    weatherCode = c.weather_code;
    tempLabel =
      c.temperature_2m != null ? Math.round(c.temperature_2m) + '°F' : '';
    // Prefer API is_day, fallback sunrise/sunset
    if (c.is_day != null) {
      isNight = Number(c.is_day) === 0;
    } else if (data.daily && data.daily.sunrise && data.daily.sunset) {
      const rise = new Date(data.daily.sunrise[0]).getTime();
      const set = new Date(data.daily.sunset[0]).getTime();
      const now = Date.now();
      isNight = now < rise || now >= set;
    }
    let next = codeToMood(weatherCode);
    if (isNight && next !== 'rain') next = 'night';
    if (auto) applyMood(next);
    else updateChip();
  }

  function getPosition() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error('no geo'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        },
        reject,
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
      );
    });
  }

  async function resolveAndLoad() {
    // Default: Baton Rouge area (Geaux) if geo denied
    let lat = 30.4515;
    let lon = -91.1871;
    placeLabel = 'Baton Rouge';
    try {
      const pos = await getPosition();
      lat = pos.lat;
      lon = pos.lon;
      const name = await reverseLabel(lat, lon);
      placeLabel = name || lat.toFixed(2) + '°, ' + lon.toFixed(2) + '°';
    } catch (_) {
      // keep default
    }
    updateChip();
    try {
      await loadWeather(lat, lon);
    } catch (e) {
      console.warn(e);
      if (auto) applyMood(isNightGuess() ? 'night' : 'cloudy');
    }
  }

  function isNightGuess() {
    const h = new Date().getHours();
    return h < 6 || h >= 20;
  }

  function boot() {
    isNight = isNightGuess();
    applyMood(isNight ? 'night' : 'cloudy');
    ensureStars();

    window.addEventListener('mousemove', onPointer, { passive: true });
    window.addEventListener('touchmove', onPointer, { passive: true });

    const cycleBtn = document.getElementById('sky-cycle');
    if (cycleBtn) cycleBtn.addEventListener('click', cycleMood);
    const liveBtn = document.getElementById('sky-live-btn');
    if (liveBtn) liveBtn.addEventListener('click', useLive);

    // Occasional lightning when raining
    setInterval(function () {
      if (mood === 'rain' && Math.random() < 0.12) flashLightning();
    }, 4000);

    resolveAndLoad();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
