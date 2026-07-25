/**
 * maps.js — Leaflet + OSM + RainViewer radar
 * Timeline play/pause + scrubber + smooth crossfade
 * Drop-pin to pick location; view is not force-reset while exploring
 */
(function (global) {
  let map = null;
  let baseLayer = null;
  let radarFront = null;
  let radarBack = null;
  let marker = null;
  let radarTimer = null;
  let fadeRaf = null;
  let radarFrames = [];
  let frameIndex = 0;
  let playing = false;
  let fading = false;
  let currentLayer = 'radar';
  let lastLoc = null;
  let lastForecast = null;
  let controlsWired = false;
  let mapEventsWired = false;
  /** When true, skip setView on the next setLocation (user is exploring) */
  let userExploring = false;
  let pinDropHandler = null;

  // RainViewer free tiles support zoom 0–7 only (higher shows "Zoom Level Not Supported")
  const RADAR_MAX_ZOOM = 7;
  const DEFAULT_ZOOM = 6;
  const PLAY_MS = 1400;
  const FADE_MS = 450;

  function $(id) {
    return document.getElementById(id);
  }

  function ensureMap() {
    if (map) {
      setTimeout(function () {
        map.invalidateSize();
      }, 50);
      return map;
    }
    if (typeof L === 'undefined') {
      console.error('Leaflet not loaded');
      return null;
    }
    const el = $('map');
    if (!el) return null;

    map = L.map(el, {
      zoomControl: true,
      attributionControl: true,
      maxZoom: 12,
      minZoom: 3,
    }).setView([39.5, -98.35], 4);

    baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    wireMapEvents();
    return map;
  }

  function wireMapEvents() {
    if (!map || mapEventsWired) return;
    mapEventsWired = true;

    // Once the user pans/zooms, stop auto-recentering on weather refresh
    map.on('dragstart zoomstart', function () {
      userExploring = true;
    });

    // Tap / click to drop pin (ignore clicks on controls)
    map.on('click', function (e) {
      if (!e || !e.latlng) return;
      dropPin(e.latlng.lat, e.latlng.lng, { fromUser: true });
    });
  }

  /**
   * @param {object} loc
   * @param {{ forceView?: boolean, zoom?: number }} opts
   *   forceView — always re-center (GPS / search / save / recenter button)
   */
  function setLocation(loc, opts) {
    opts = opts || {};
    lastLoc = loc;
    if (!loc || loc.lat == null) return;
    const m = ensureMap();
    if (!m) return;

    const latlng = [loc.lat, loc.lon];
    const shouldView =
      opts.forceView === true ||
      (!userExploring && opts.forceView !== false);

    if (shouldView) {
      const z = opts.zoom != null ? opts.zoom : Math.min(DEFAULT_ZOOM, RADAR_MAX_ZOOM);
      m.setView(latlng, z, { animate: !!opts.animate });
      if (opts.forceView) userExploring = false;
    }

    if (marker) {
      marker.setLatLng(latlng);
    } else {
      marker = L.circleMarker(latlng, {
        radius: 8,
        color: '#e85d4c',
        weight: 2,
        fillColor: '#e85d4c',
        fillOpacity: 0.85,
      }).addTo(m);
    }
    marker.setStyle({
      color: loc.pinned ? '#e85d4c' : '#5b9fd4',
      fillColor: loc.pinned ? '#e85d4c' : '#5b9fd4',
    });
  }

  function dropPin(lat, lon, meta) {
    meta = meta || {};
    const loc = {
      lat: lat,
      lon: lon,
      label: meta.label || 'Finding city…',
      pinned: true,
    };
    lastLoc = loc;
    // Move marker only — keep current pan/zoom so user stays where they tapped
    setLocation(loc, { forceView: false });
    updatePinHint('Finding nearest city…');
    if (typeof pinDropHandler === 'function') {
      pinDropHandler(loc, meta);
    }
  }

  function onPinDrop(fn) {
    pinDropHandler = fn;
  }

  function recenter(loc, zoom) {
    userExploring = false;
    const target = loc || lastLoc;
    if (!target) return;
    setLocation(target, {
      forceView: true,
      zoom: zoom != null ? zoom : DEFAULT_ZOOM,
      animate: true,
    });
  }

  function updatePinHint(text) {
    const el = $('map-pin-hint');
    if (el) el.textContent = text || 'Tap map to drop a pin';
  }

  function setForecast(data) {
    lastForecast = data;
    if (currentLayer === 'wind' || currentLayer === 'fog') {
      showDataOverlay(currentLayer);
    }
  }

  function wireControls() {
    if (controlsWired) return;
    controlsWired = true;
    const playBtn = $('radar-play');
    const prevBtn = $('radar-prev');
    const nextBtn = $('radar-next');
    const slider = $('radar-slider');
    const recenterBtn = $('map-recenter');

    if (playBtn) {
      playBtn.addEventListener('click', function () {
        if (playing) pausePlayback();
        else startPlayback();
      });
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        pausePlayback();
        showRadarFrame(frameIndex - 1, true);
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        pausePlayback();
        showRadarFrame(frameIndex + 1, true);
      });
    }
    if (slider) {
      slider.addEventListener('input', function () {
        pausePlayback();
        showRadarFrame(parseInt(slider.value, 10) || 0, false);
      });
    }
    if (recenterBtn) {
      recenterBtn.addEventListener('click', function () {
        recenter(lastLoc);
      });
    }
  }

  function updateControlsUI() {
    const slider = $('radar-slider');
    const playBtn = $('radar-play');
    const timeEl = $('radar-time');

    if (slider && radarFrames.length) {
      slider.max = String(radarFrames.length - 1);
      slider.value = String(frameIndex);
      slider.disabled = false;
    } else if (slider) {
      slider.disabled = true;
    }

    if (playBtn) {
      playBtn.textContent = playing ? '❚❚' : '▶';
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      playBtn.classList.toggle('playing', playing);
    }

    if (timeEl && radarFrames[frameIndex] && radarFrames[frameIndex].time) {
      const t = new Date(radarFrames[frameIndex].time * 1000);
      timeEl.textContent = t.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } else if (timeEl) {
      timeEl.textContent = '—';
    }

    const legend = $('map-legend');
    if (legend) {
      legend.textContent = playing
        ? 'Playing radar · RainViewer'
        : 'Tap map to pin · RainViewer';
    }
  }

  function setControlsVisible(show) {
    const bar = $('radar-controls');
    if (bar) bar.classList.toggle('hidden', !show);
  }

  async function loadRadarFrames() {
    try {
      const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      if (!res.ok) throw new Error('RainViewer ' + res.status);
      const json = await res.json();
      const past = (json.radar && json.radar.past) || [];
      const nowcast = (json.radar && json.radar.nowcast) || [];
      radarFrames = past.concat(nowcast);
      if (!radarFrames.length) {
        updateControlsUI();
        return;
      }
      frameIndex = Math.max(0, past.length - 1);
      showRadarFrame(frameIndex, false);
    } catch (err) {
      console.warn('Radar load failed', err);
      const legend = $('map-legend');
      if (legend) legend.textContent = 'Radar unavailable (offline?)';
    }
  }

  function radarUrl(frame) {
    return (
      'https://tilecache.rainviewer.com' +
      frame.path +
      '/256/{z}/{x}/{y}/2/1_1.png'
    );
  }

  function cancelFade() {
    if (fadeRaf) {
      cancelAnimationFrame(fadeRaf);
      fadeRaf = null;
    }
    fading = false;
    if (radarBack && map) {
      map.removeLayer(radarBack);
      radarBack = null;
    }
  }

  function makeRadarLayer(url, opacity) {
    return L.tileLayer(url, {
      opacity: opacity,
      maxZoom: 12,
      maxNativeZoom: RADAR_MAX_ZOOM,
      minZoom: 1,
      zIndex: 210,
      // No error tiles message spam — blank past native zoom
      errorTileUrl:
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    });
  }

  function showRadarFrame(idx, animate) {
    if (!map || !radarFrames.length) {
      updateControlsUI();
      return;
    }

    const next =
      ((idx % radarFrames.length) + radarFrames.length) % radarFrames.length;
    if (next === frameIndex && radarFront && animate) {
      updateControlsUI();
      return;
    }

    frameIndex = next;
    const frame = radarFrames[frameIndex];
    const url = radarUrl(frame);
    const targetOpacity = 0.65;
    const newLayer = makeRadarLayer(url, animate ? 0 : targetOpacity);

    if (!animate || !radarFront) {
      cancelFade();
      if (radarFront) {
        map.removeLayer(radarFront);
        radarFront = null;
      }
      radarFront = newLayer;
      if (currentLayer === 'radar') radarFront.addTo(map);
      updateControlsUI();
      return;
    }

    cancelFade();
    radarBack = radarFront;
    radarFront = newLayer;
    if (currentLayer === 'radar') {
      radarFront.addTo(map);
      if (radarBack) {
        radarBack.setZIndex(200);
        radarFront.setZIndex(210);
      }
    }

    fading = true;
    const t0 = performance.now();

    function step(now) {
      const t = Math.min(1, (now - t0) / FADE_MS);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      if (radarFront) radarFront.setOpacity(targetOpacity * e);
      if (radarBack) radarBack.setOpacity(targetOpacity * (1 - e));

      if (t < 1) {
        fadeRaf = requestAnimationFrame(step);
      } else {
        fading = false;
        fadeRaf = null;
        if (radarBack && map) {
          map.removeLayer(radarBack);
          radarBack = null;
        }
        if (radarFront) radarFront.setOpacity(targetOpacity);
      }
    }

    fadeRaf = requestAnimationFrame(step);
    updateControlsUI();
  }

  function startPlayback() {
    if (!radarFrames.length || radarFrames.length < 2) return;
    playing = true;
    updateControlsUI();
    showRadarFrame(frameIndex + 1, true);
    stopTimerOnly();
    radarTimer = setInterval(function () {
      if (!playing || currentLayer !== 'radar') return;
      if (fading) return;
      if (frameIndex >= radarFrames.length - 1) {
        showRadarFrame(0, true);
      } else {
        showRadarFrame(frameIndex + 1, true);
      }
    }, PLAY_MS);
  }

  function pausePlayback() {
    playing = false;
    stopTimerOnly();
    updateControlsUI();
  }

  function stopTimerOnly() {
    if (radarTimer) {
      clearInterval(radarTimer);
      radarTimer = null;
    }
  }

  function clearRadar() {
    pausePlayback();
    cancelFade();
    if (radarFront && map) {
      map.removeLayer(radarFront);
      radarFront = null;
    }
  }

  function showDataOverlay(kind) {
    const el = $('map-info');
    if (!el) return;
    el.classList.remove('hidden');

    if (!lastForecast || !lastForecast.current) {
      el.innerHTML = '<p class="muted">Load a location first</p>';
      return;
    }
    const c = lastForecast.current;
    const units = localStorage.getItem('units') || 'imperial';
    const windU = units === 'metric' ? 'km/h' : 'mph';

    if (kind === 'wind') {
      const dir = global.PureSkyWeather
        ? global.PureSkyWeather.windDir(c.wind_direction_10m)
        : '';
      el.innerHTML =
        '<div class="map-info-title">Wind</div>' +
        '<div class="map-info-value">' +
        Math.round(c.wind_speed_10m) +
        ' ' +
        windU +
        ' ' +
        dir +
        '</div>' +
        '<p class="muted small">At selected location</p>';
      if ($('map-legend')) $('map-legend').textContent = 'Wind · Open-Meteo';
    } else if (kind === 'fog') {
      const vis = global.PureSkyWeather
        ? global.PureSkyWeather.formatVis(c.visibility, units)
        : '—';
      const foggy = c.visibility != null && c.visibility < 1000;
      el.innerHTML =
        '<div class="map-info-title">Visibility / Fog</div>' +
        '<div class="map-info-value">' +
        vis +
        (foggy ? ' · fog likely' : '') +
        '</div>' +
        '<p class="muted small">At selected location</p>';
      if ($('map-legend')) $('map-legend').textContent = 'Visibility · Open-Meteo';
    }
  }

  function hideDataOverlay() {
    const el = $('map-info');
    if (el) el.classList.add('hidden');
  }

  function setLayer(layer) {
    currentLayer = layer || 'radar';
    ensureMap();
    wireControls();

    document.querySelectorAll('.layer-btn').forEach(function (btn) {
      btn.classList.toggle(
        'active',
        btn.getAttribute('data-layer') === currentLayer
      );
    });

    if (currentLayer === 'radar') {
      hideDataOverlay();
      setControlsVisible(true);
      // Radar tiles only exist up to z7 (maxNativeZoom); higher zooms scale tiles up
      if (!radarFrames.length) {
        loadRadarFrames();
      } else {
        pausePlayback();
        showRadarFrame(frameIndex, false);
        if (radarFront && map && !map.hasLayer(radarFront)) {
          radarFront.addTo(map);
        }
      }
    } else {
      clearRadar();
      setControlsVisible(false);
      showDataOverlay(currentLayer);
    }
  }

  function init(loc, forecast) {
    ensureMap();
    wireControls();
    if (loc) setLocation(loc, { forceView: true });
    if (forecast) setForecast(forecast);
    setLayer(currentLayer || 'radar');
  }

  /** Called when Maps tab is shown — do NOT re-center (that was snapping zoom back) */
  function onShow() {
    ensureMap();
    wireControls();
    setTimeout(function () {
      if (map) map.invalidateSize();
    }, 80);
    setLayer(currentLayer);
  }

  global.PureSkyMaps = {
    init: init,
    onShow: onShow,
    setLocation: setLocation,
    setForecast: setForecast,
    setLayer: setLayer,
    onPinDrop: onPinDrop,
    recenter: recenter,
    dropPin: dropPin,
    updatePinHint: updatePinHint,
  };
})(window);
