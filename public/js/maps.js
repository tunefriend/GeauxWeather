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
 * maps.js — Leaflet + OSM + RainViewer radar
 * Wind field (Open-Meteo grid arrows + particles)
 * Hurricane (NHC CurrentStorms)
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

  // Wind field
  let windLayerGroup = null;
  let windParticleLayer = null;
  let windFetchTimer = null;
  let windMoveHandler = null;
  let windFetchId = 0;

  // Hurricane
  let hurricaneLayerGroup = null;
  let hurricaneFetchId = 0;

  // Tornado / severe (NWS alerts)
  let tornadoLayerGroup = null;
  let tornadoFetchId = 0;

  // Solar eclipse paths (static GeoJSON on geauxweather.com)
  let eclipseLayerGroup = null;
  let eclipseFetchId = 0;
  let eclipseData = null;
  let eclipseSelectedId = null;

  // RainViewer free tiles support zoom 0–7 only (higher shows "Zoom Level Not Supported")
  const RADAR_MAX_ZOOM = 7;
  const DEFAULT_ZOOM = 6;
  const PLAY_MS = 1400;
  const FADE_MS = 450;
  const WIND_GRID = 7; // 7×7 = 49 points
  const WIND_DEBOUNCE_MS = 450;

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
    if (currentLayer === 'fog') {
      showDataOverlay('fog');
    } else if (currentLayer === 'wind') {
      updateWindPinLegend();
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

    if (currentLayer === 'radar') {
      const legend = $('map-legend');
      if (legend) {
        legend.textContent = playing
          ? 'Playing radar · RainViewer'
          : 'Tap map to pin · RainViewer';
      }
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

  // ─── Wind field (Open-Meteo grid + particles) ───────────────────────────

  function windUnits() {
    return localStorage.getItem('units') === 'metric' ? 'metric' : 'imperial';
  }

  /** Color scale is defined in mph for consistent appearance across unit settings. */
  function windColor(speedMph) {
    if (speedMph < 5) return '#7ec8e3';
    if (speedMph < 10) return '#5b9fd4';
    if (speedMph < 15) return '#3dcc8c';
    if (speedMph < 25) return '#f0c14a';
    if (speedMph < 35) return '#e89a3c';
    if (speedMph < 50) return '#e85d4c';
    return '#c44dff';
  }

  function toMph(speed, units) {
    if (speed == null || isNaN(speed)) return 0;
    return units === 'metric' ? Number(speed) * 0.621371 : Number(speed);
  }

  /** Meteorological from-direction deg → CSS rotation so arrow points where wind goes */
  function windToCssDeg(fromDeg) {
    // Wind FROM direction: blow toward fromDeg + 180. SVG arrow points up (0 = north).
    return ((fromDeg + 180) % 360 + 360) % 360;
  }

  function sampleWindGrid(bounds) {
    const west = bounds.getWest();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const north = bounds.getNorth();
    const n = WIND_GRID;
    const lats = [];
    const lons = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        lats.push(south + ((north - south) * (i + 0.5)) / n);
        lons.push(west + ((east - west) * (j + 0.5)) / n);
      }
    }
    return { lats: lats, lons: lons };
  }

  function clearWind() {
    windFetchId++;
    if (windFetchTimer) {
      clearTimeout(windFetchTimer);
      windFetchTimer = null;
    }
    if (map && windMoveHandler) {
      map.off('moveend', windMoveHandler);
      windMoveHandler = null;
    }
    if (windParticleLayer && map) {
      map.removeLayer(windParticleLayer);
      windParticleLayer = null;
    }
    if (windLayerGroup && map) {
      map.removeLayer(windLayerGroup);
      windLayerGroup = null;
    }
  }

  function scheduleWindRefresh() {
    if (windFetchTimer) clearTimeout(windFetchTimer);
    windFetchTimer = setTimeout(function () {
      windFetchTimer = null;
      if (currentLayer === 'wind') loadWindField();
    }, WIND_DEBOUNCE_MS);
  }

  function wireWindMove() {
    if (!map || windMoveHandler) return;
    windMoveHandler = function () {
      if (currentLayer === 'wind') scheduleWindRefresh();
    };
    map.on('moveend', windMoveHandler);
  }

  function makeWindArrowIcon(speedMph, fromDeg) {
    const color = windColor(toMph(speedMph, 'imperial'));
    const rot = windToCssDeg(fromDeg);
    // Arrow points up; CSS rotates to wind-to direction
    const html =
      '<div class="wind-arrow" style="transform:rotate(' +
      rot +
      'deg)">' +
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M12 3 L12 18" stroke="' +
      color +
      '" stroke-width="2.4" stroke-linecap="round"/>' +
      '<path d="M12 3 L7.5 9.5 M12 3 L16.5 9.5" stroke="' +
      color +
      '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="12" cy="19.5" r="1.6" fill="' +
      color +
      '"/>' +
      '</svg></div>';
    return L.divIcon({
      className: 'wind-arrow-icon',
      html: html,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }

  /**
   * Lightweight canvas particle flow (Windfinder-style) using same grid samples.
   */
  function createWindParticleLayer(samples) {
    if (typeof L === 'undefined') return null;

    const ParticleLayer = L.Layer.extend({
      initialize: function (pts) {
        this._pts = pts || [];
        this._particles = [];
        this._raf = null;
      },
      onAdd: function (m) {
        this._map = m;
        const size = m.getSize();
        this._canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated');
        this._canvas.width = size.x;
        this._canvas.height = size.y;
        this._canvas.style.pointerEvents = 'none';
        this._canvas.style.position = 'absolute';
        this._canvas.style.left = '0';
        this._canvas.style.top = '0';
        this._canvas.style.zIndex = '350';
        const pane = m.getPanes().overlayPane;
        pane.appendChild(this._canvas);
        this._reset();
        this._spawn(Math.min(220, 80 + this._pts.length * 3));
        const self = this;
        this._onMove = function () {
          self._reset();
        };
        m.on('moveend zoomend resize', this._onMove);
        this._running = true;
        this._loop();
      },
      onRemove: function (m) {
        this._running = false;
        if (this._raf) cancelAnimationFrame(this._raf);
        if (this._canvas && this._canvas.parentNode) {
          this._canvas.parentNode.removeChild(this._canvas);
        }
        if (this._onMove) m.off('moveend zoomend resize', this._onMove);
        this._canvas = null;
        this._particles = [];
      },
      setSamples: function (pts) {
        this._pts = pts || [];
      },
      _reset: function () {
        if (!this._map || !this._canvas) return;
        const size = this._map.getSize();
        const topLeft = this._map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this._canvas, topLeft);
        if (this._canvas.width !== size.x || this._canvas.height !== size.y) {
          this._canvas.width = size.x;
          this._canvas.height = size.y;
        }
      },
      _nearest: function (lat, lon) {
        let best = null;
        let bestD = Infinity;
        for (let i = 0; i < this._pts.length; i++) {
          const p = this._pts[i];
          const d = (p.lat - lat) * (p.lat - lat) + (p.lon - lon) * (p.lon - lon);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        return best;
      },
      _spawn: function (n) {
        if (!this._map) return;
        const b = this._map.getBounds();
        this._particles = [];
        for (let i = 0; i < n; i++) {
          this._particles.push({
            lat: b.getSouth() + Math.random() * (b.getNorth() - b.getSouth()),
            lon: b.getWest() + Math.random() * (b.getEast() - b.getWest()),
            age: Math.random() * 80,
            life: 50 + Math.random() * 70,
          });
        }
      },
      _loop: function () {
        const self = this;
        if (!this._running || !this._canvas || !this._map) return;
        const ctx = this._canvas.getContext('2d');
        const w = this._canvas.width;
        const h = this._canvas.height;
        // Trail fade
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';

        const b = this._map.getBounds();
        for (let i = 0; i < this._particles.length; i++) {
          const p = this._particles[i];
          p.age++;
          if (p.age > p.life || !b.contains([p.lat, p.lon])) {
            p.lat = b.getSouth() + Math.random() * (b.getNorth() - b.getSouth());
            p.lon = b.getWest() + Math.random() * (b.getEast() - b.getWest());
            p.age = 0;
            p.life = 50 + Math.random() * 70;
          }
          const near = this._nearest(p.lat, p.lon);
          if (!near) continue;
          // Move with wind (toward direction)
          const toRad = ((near.dir + 180) * Math.PI) / 180;
          const speed = Math.max(0.2, near.speedMph);
          // degrees per frame scaled by zoom
          const zoom = this._map.getZoom();
          const scale = (0.00035 * speed) / Math.max(1, zoom / 4);
          p.lat += Math.cos(toRad) * scale;
          p.lon += Math.sin(toRad) * scale;

          const pt = this._map.latLngToContainerPoint([p.lat, p.lon]);
          const alpha = Math.max(0.15, 1 - p.age / p.life);
          ctx.beginPath();
          ctx.fillStyle = windColor(near.speedMph);
          ctx.globalAlpha = alpha * 0.85;
          ctx.arc(pt.x, pt.y, 1.4 + Math.min(2.2, speed / 20), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        this._raf = requestAnimationFrame(function () {
          self._loop();
        });
      },
    });

    return new ParticleLayer(samples);
  }

  async function loadWindField() {
    const m = ensureMap();
    if (!m || currentLayer !== 'wind') return;
    const myId = ++windFetchId;
    const legend = $('map-legend');
    const units = windUnits();
    const windApiUnit = units === 'metric' ? 'kmh' : 'mph';
    if (legend) legend.textContent = 'Loading wind…';

    try {
      const bounds = m.getBounds().pad(0.05);
      const grid = sampleWindGrid(bounds);
      const url =
        'https://api.open-meteo.com/v1/forecast?' +
        'latitude=' +
        grid.lats.join(',') +
        '&longitude=' +
        grid.lons.join(',') +
        '&current=wind_speed_10m,wind_direction_10m' +
        '&wind_speed_unit=' +
        windApiUnit;

      const res = await fetch(url);
      if (!res.ok) throw new Error('Open-Meteo ' + res.status);
      let data = await res.json();
      if (!Array.isArray(data)) data = [data];

      const samples = [];
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const c = row.current || {};
        const lat = row.latitude != null ? row.latitude : grid.lats[i];
        const lon = row.longitude != null ? row.longitude : grid.lons[i];
        const speed = c.wind_speed_10m != null ? c.wind_speed_10m : 0;
        const dir = c.wind_direction_10m != null ? c.wind_direction_10m : 0;
        samples.push({
          lat: lat,
          lon: lon,
          speedMph: toMph(speed, units),
          speed: speed,
          units: units,
          dir: dir,
        });
      }

      if (myId !== windFetchId || currentLayer !== 'wind') return;

      if (windLayerGroup) {
        m.removeLayer(windLayerGroup);
        windLayerGroup = null;
      }
      windLayerGroup = L.layerGroup();
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const mk = L.marker([s.lat, s.lon], {
          icon: makeWindArrowIcon(s.speedMph, s.dir),
          interactive: false,
          keyboard: false,
        });
        windLayerGroup.addLayer(mk);
      }
      windLayerGroup.addTo(m);

      if (windParticleLayer) {
        m.removeLayer(windParticleLayer);
        windParticleLayer = null;
      }
      windParticleLayer = createWindParticleLayer(samples);
      if (windParticleLayer) windParticleLayer.addTo(m);

      updateWindPinLegend();
      if (legend) {
        if (units === 'metric') {
          legend.innerHTML =
            'Wind · Open-Meteo · ' +
            '<span class="wind-legend-scale">' +
            swatch('#7ec8e3', '<8') +
            swatch('#5b9fd4', '16') +
            swatch('#3dcc8c', '24') +
            swatch('#f0c14a', '40') +
            swatch('#e85d4c', '56+') +
            ' km/h</span>';
        } else {
          legend.innerHTML =
            'Wind · Open-Meteo · ' +
            '<span class="wind-legend-scale">' +
            swatch('#7ec8e3', '<5') +
            swatch('#5b9fd4', '10') +
            swatch('#3dcc8c', '15') +
            swatch('#f0c14a', '25') +
            swatch('#e85d4c', '35+') +
            ' mph</span>';
        }
      }
    } catch (err) {
      console.warn('Wind field failed', err);
      if (myId !== windFetchId) return;
      if (legend) legend.textContent = 'Wind unavailable (offline?)';
      showDataOverlay('wind');
    }
  }

  function swatch(color, label) {
    return (
      '<span class="wind-legend-swatch"><i style="background:' +
      color +
      '"></i>' +
      label +
      '</span>'
    );
  }

  function updateWindPinLegend() {
    const el = $('map-info');
    if (!el) return;
    if (!lastForecast || !lastForecast.current) {
      el.classList.add('hidden');
      return;
    }
    const c = lastForecast.current;
    const units = localStorage.getItem('units') || 'imperial';
    const windU = units === 'metric' ? 'km/h' : 'mph';
    // Forecast already in user units; map wind is always mph — convert for display if metric
    let speed = c.wind_speed_10m;
    // pin uses forecast units already from Open-Meteo fetch in weather.js
    const dir = global.PureSkyWeather
      ? global.PureSkyWeather.windDir(c.wind_direction_10m)
      : '';
    el.classList.remove('hidden');
    el.innerHTML =
      '<div class="map-info-title">Wind at pin</div>' +
      '<div class="map-info-value">' +
      Math.round(speed) +
      ' ' +
      windU +
      ' ' +
      dir +
      '</div>' +
      '<p class="muted small">Arrows show field · particles show flow</p>';
  }

  // ─── Hurricane (NHC) ────────────────────────────────────────────────────

  function stormCategory(classification, intensityKt) {
    const cls = (classification || '').toUpperCase();
    const kt = parseInt(intensityKt, 10) || 0;
    if (cls === 'HU' || cls === 'MH') {
      if (kt >= 137) return { label: 'Cat 5 Hurricane', css: 'cat-mh', emoji: '🌀' };
      if (kt >= 113) return { label: 'Cat 4 Hurricane', css: 'cat-mh', emoji: '🌀' };
      if (kt >= 96) return { label: 'Cat 3 Hurricane', css: 'cat-hu', emoji: '🌀' };
      if (kt >= 83) return { label: 'Cat 2 Hurricane', css: 'cat-hu', emoji: '🌀' };
      if (kt >= 64) return { label: 'Cat 1 Hurricane', css: 'cat-hu', emoji: '🌀' };
      return { label: 'Hurricane', css: 'cat-hu', emoji: '🌀' };
    }
    if (cls === 'TS' || kt >= 34) {
      return { label: 'Tropical Storm', css: 'cat-ts', emoji: '🌧' };
    }
    if (cls === 'TD' || cls === 'SD' || cls === 'SS') {
      return { label: 'Tropical Depression', css: '', emoji: '☁' };
    }
    if (cls === 'PTC' || cls === 'PC') {
      return { label: 'Post-Tropical', css: '', emoji: '🌫' };
    }
    return { label: classification || 'Storm', css: '', emoji: '🌀' };
  }

  function clearHurricane() {
    hurricaneFetchId++;
    if (hurricaneLayerGroup && map) {
      map.removeLayer(hurricaneLayerGroup);
      hurricaneLayerGroup = null;
    }
  }

  async function loadHurricanes() {
    const m = ensureMap();
    if (!m || currentLayer !== 'hurricane') return;
    const myId = ++hurricaneFetchId;
    const legend = $('map-legend');
    const info = $('map-info');
    if (legend) legend.textContent = 'Loading storms · NHC…';
    if (info) {
      info.classList.remove('hidden');
      info.innerHTML = '<p class="muted">Fetching active tropical cyclones…</p>';
    }

    try {
      let json;
      if (global.PureSkyNet && typeof global.PureSkyNet.fetch === 'function') {
        json = await global.PureSkyNet.fetch(
          'https://www.nhc.noaa.gov/CurrentStorms.json',
          { as: 'json' }
        );
      } else {
        const res = await fetch('https://www.nhc.noaa.gov/CurrentStorms.json', {
          cache: 'no-cache',
        });
        if (!res.ok) throw new Error('NHC ' + res.status);
        json = await res.json();
      }
      if (myId !== hurricaneFetchId || currentLayer !== 'hurricane') return;

      const storms = json.activeStorms || [];
      if (hurricaneLayerGroup && m) {
        m.removeLayer(hurricaneLayerGroup);
        hurricaneLayerGroup = null;
      }
      hurricaneLayerGroup = L.layerGroup();

      if (!storms.length) {
        if (info) {
          info.innerHTML =
            '<div class="map-info-title">Active storms</div>' +
            '<div class="map-info-value" style="font-size:1.05rem">None right now</div>' +
            '<p class="muted small">No tropical cyclones in NHC advisories</p>';
        }
        if (legend) legend.textContent = 'Hurricane · NHC · All clear';
        // Wide Atlantic/EP view for context
        if (!userExploring) {
          m.setView([20, -70], 3, { animate: true });
        }
        return;
      }

      const bounds = [];
      const names = [];
      const geomJobs = [];

      for (let i = 0; i < storms.length; i++) {
        const s = storms[i];
        const lat = s.latitudeNumeric;
        const lon = s.longitudeNumeric;
        if (lat == null || lon == null) continue;
        const cat = stormCategory(s.classification, s.intensity);
        names.push(s.name || s.id);
        bounds.push([lat, lon]);

        const icon = L.divIcon({
          className: 'storm-marker-icon',
          html:
            '<div class="storm-marker ' +
            cat.css +
            '" title="' +
            (s.name || '') +
            '">' +
            cat.emoji +
            '</div>',
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        });

        const dir =
          s.movementDir != null
            ? global.PureSkyWeather
              ? global.PureSkyWeather.windDir(s.movementDir)
              : s.movementDir + '°'
            : '—';
        const speed =
          s.movementSpeed != null ? s.movementSpeed + ' kt' : '—';
        const advisory =
          s.publicAdvisory && s.publicAdvisory.url
            ? s.publicAdvisory.url
            : 'https://www.nhc.noaa.gov/';
        const advNum =
          (s.forecastTrack && s.forecastTrack.advNum) ||
          (s.publicAdvisory && s.publicAdvisory.advNum) ||
          '—';

        const html =
          '<div class="storm-popup-title">' +
          escapeHtml(cat.emoji + ' ' + (s.name || s.id)) +
          '</div>' +
          '<div class="storm-popup-meta">' +
          escapeHtml(cat.label) +
          ' · ' +
          escapeHtml(String(s.intensity || '—')) +
          ' kt · ' +
          escapeHtml(String(s.pressure || '—')) +
          ' mb</div>' +
          '<div class="storm-popup-meta">Adv #' +
          escapeHtml(String(advNum)) +
          ' · Moving ' +
          escapeHtml(String(dir)) +
          ' at ' +
          escapeHtml(String(speed)) +
          '</div>' +
          '<div class="storm-popup-meta">' +
          escapeHtml(s.latitude || '') +
          ' ' +
          escapeHtml(s.longitude || '') +
          '</div>' +
          '<div class="storm-popup-meta" style="margin-top:6px">' +
          '<a href="' +
          escapeHtml(advisory) +
          '" target="_blank" rel="noopener">NHC advisory</a></div>';

        const mk = L.marker([lat, lon], { icon: icon, zIndexOffset: 500 });
        mk.bindPopup(html, { maxWidth: 260 });
        hurricaneLayerGroup.addLayer(mk);

        // Cone + forecast track + past (best) track from NHC KMZ
        geomJobs.push(addStormGeometry(s, hurricaneLayerGroup, bounds));
      }

      hurricaneLayerGroup.addTo(m);

      // Load geometry in parallel (don't block markers)
      Promise.all(geomJobs).then(function () {
        if (myId !== hurricaneFetchId || currentLayer !== 'hurricane') return;
        if (bounds.length) {
          try {
            m.fitBounds(bounds, { padding: [40, 40], maxZoom: 6, animate: true });
            userExploring = true;
          } catch (e) {
            /* ignore */
          }
        }
        if (legend) {
          legend.textContent = 'Cone · track · past path · NHC';
        }
      });

      if (bounds.length) {
        try {
          m.fitBounds(bounds, { padding: [48, 48], maxZoom: 6, animate: true });
          userExploring = true;
        } catch (e) {
          /* ignore */
        }
      }

      if (info) {
        info.innerHTML =
          '<div class="map-info-title">Active storms</div>' +
          '<div class="map-info-value" style="font-size:1.05rem">' +
          storms.length +
          ' · ' +
          escapeHtml(names.join(', ')) +
          '</div>' +
          '<p class="muted small">Cone + forecast track · tap storm · NHC</p>';
      }
      if (legend) legend.textContent = 'Loading cone/track · NHC…';
    } catch (err) {
      console.warn('Hurricane load failed', err);
      if (info) {
        info.innerHTML =
          '<div class="map-info-title">Hurricane</div>' +
          '<p class="muted">Could not load NHC data</p>' +
          '<p class="muted small">' +
          escapeHtml(String((err && err.message) || err || '')) +
          '</p>';
      }
      if (legend) legend.textContent = 'Hurricane unavailable';
    }
  }

  /**
   * Fetch NHC KMZ cone / forecast track / best (past) track and draw on map.
   * Extends bounds[] with geometry points when present.
   */
  async function addStormGeometry(storm, layerGroup, bounds) {
    if (!global.PureSkyKmz || typeof global.PureSkyKmz.fetchKmzGeometry !== 'function') {
      return;
    }
    const jobs = [];

    const coneUrl = storm.trackCone && storm.trackCone.kmzFile;
    if (coneUrl) {
      jobs.push(
        global.PureSkyKmz.fetchKmzGeometry(coneUrl).then(function (geom) {
          const polys = geom.polygons || [];
          for (let i = 0; i < polys.length; i++) {
            const poly = L.polygon(polys[i], {
              color: '#f0c14a',
              weight: 1.5,
              opacity: 0.9,
              fillColor: '#e8d24a',
              fillOpacity: 0.22,
              interactive: false,
            });
            layerGroup.addLayer(poly);
            for (let j = 0; j < polys[i].length; j++) bounds.push(polys[i][j]);
          }
        }).catch(function (e) {
          console.warn('Cone KMZ failed', storm.id, e);
        })
      );
    }

    const trackUrl = storm.forecastTrack && storm.forecastTrack.kmzFile;
    if (trackUrl) {
      jobs.push(
        global.PureSkyKmz.fetchKmzGeometry(trackUrl).then(function (geom) {
          const lines = geom.lines || [];
          // Prefer longest line (full 5-day track)
          lines.sort(function (a, b) {
            return b.length - a.length;
          });
          for (let i = 0; i < lines.length; i++) {
            const isMain = i === 0;
            const line = L.polyline(lines[i], {
              color: isMain ? '#1a1a1a' : '#333333',
              weight: isMain ? 3 : 2,
              opacity: isMain ? 0.9 : 0.55,
              dashArray: isMain ? null : '4 6',
              interactive: false,
            });
            layerGroup.addLayer(line);
            for (let j = 0; j < lines[i].length; j++) bounds.push(lines[i][j]);
            // Forecast points along main track
            if (isMain) {
              for (let j = 0; j < lines[i].length; j++) {
                const pt = L.circleMarker(lines[i][j], {
                  radius: j === 0 ? 5 : 3.5,
                  color: '#0b0f14',
                  weight: 1,
                  fillColor: j === 0 ? '#e85d4c' : '#ffffff',
                  fillOpacity: 1,
                  interactive: false,
                });
                layerGroup.addLayer(pt);
              }
            }
          }
        }).catch(function (e) {
          console.warn('Track KMZ failed', storm.id, e);
        })
      );
    }

    const pastUrl = storm.bestTrackGIS && storm.bestTrackGIS.kmzFile;
    if (pastUrl) {
      jobs.push(
        global.PureSkyKmz.fetchKmzGeometry(pastUrl).then(function (geom) {
          const lines = geom.lines || [];
          for (let i = 0; i < lines.length; i++) {
            const line = L.polyline(lines[i], {
              color: '#5b9fd4',
              weight: 2.5,
              opacity: 0.85,
              dashArray: '6 8',
              interactive: false,
            });
            layerGroup.addLayer(line);
            for (let j = 0; j < lines[i].length; j++) bounds.push(lines[i][j]);
          }
        }).catch(function (e) {
          console.warn('Best track KMZ failed', storm.id, e);
        })
      );
    }

    await Promise.all(jobs);
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Tornado / severe weather (NWS api.weather.gov) ─────────────────────

  const TORNADO_EVENTS = [
    'Tornado Warning',
    'Tornado Watch',
    'Tornado Emergency',
    'Severe Thunderstorm Warning',
    'Severe Thunderstorm Watch',
  ];

  function tornadoStyle(eventName) {
    const e = (eventName || '').toLowerCase();
    if (e.indexOf('tornado emergency') >= 0) {
      return { color: '#c44dff', fillColor: '#9b2dff', fillOpacity: 0.35, weight: 2.5 };
    }
    if (e.indexOf('tornado warning') >= 0) {
      return { color: '#e85d4c', fillColor: '#e85d4c', fillOpacity: 0.32, weight: 2.5 };
    }
    if (e.indexOf('tornado watch') >= 0) {
      return { color: '#f0c14a', fillColor: '#f0c14a', fillOpacity: 0.2, weight: 2 };
    }
    if (e.indexOf('severe thunderstorm warning') >= 0) {
      return { color: '#e89a3c', fillColor: '#e89a3c', fillOpacity: 0.22, weight: 2 };
    }
    if (e.indexOf('severe thunderstorm watch') >= 0) {
      return { color: '#5b9fd4', fillColor: '#5b9fd4', fillOpacity: 0.14, weight: 1.5 };
    }
    return { color: '#888', fillColor: '#888', fillOpacity: 0.15, weight: 1.5 };
  }

  function clearTornado() {
    tornadoFetchId++;
    if (tornadoLayerGroup && map) {
      map.removeLayer(tornadoLayerGroup);
      tornadoLayerGroup = null;
    }
  }

  /** GeoJSON lon/lat rings → Leaflet [lat,lon] rings */
  function geoJsonToLatLngs(coords, type) {
    if (!coords) return [];
    if (type === 'Polygon') {
      return coords.map(function (ring) {
        return ring.map(function (c) {
          return [c[1], c[0]];
        });
      });
    }
    if (type === 'MultiPolygon') {
      // Flatten to list of polygons (each is array of rings)
      return coords.map(function (poly) {
        return poly.map(function (ring) {
          return ring.map(function (c) {
            return [c[1], c[0]];
          });
        });
      });
    }
    if (type === 'Point') {
      return [[coords[1], coords[0]]];
    }
    return [];
  }

  function formatAlertTime(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch (e) {
      return iso;
    }
  }

  async function loadTornadoes() {
    const m = ensureMap();
    if (!m || currentLayer !== 'tornado') return;
    const myId = ++tornadoFetchId;
    const legend = $('map-legend');
    const info = $('map-info');
    if (legend) legend.textContent = 'Loading alerts · NWS…';
    if (info) {
      info.classList.remove('hidden');
      info.innerHTML = '<p class="muted">Fetching tornado &amp; severe alerts…</p>';
    }

    try {
      // NWS free GeoJSON; User-Agent required — native bridge sets it
      const eventQ = TORNADO_EVENTS.map(encodeURIComponent).join(',');
      const url =
        'https://api.weather.gov/alerts/active?event=' +
        eventQ +
        '&status=actual';

      let geo;
      if (global.PureSkyNet && typeof global.PureSkyNet.fetch === 'function') {
        geo = await global.PureSkyNet.fetch(url, { as: 'json' });
      } else {
        const res = await fetch(url, {
          cache: 'no-cache',
          headers: {
            Accept: 'application/geo+json',
            'User-Agent': 'GeauxWeather/1.0 (FOSS weather app)',
          },
        });
        if (!res.ok) throw new Error('NWS ' + res.status);
        geo = await res.json();
      }

      if (myId !== tornadoFetchId || currentLayer !== 'tornado') return;

      if (tornadoLayerGroup && m) {
        m.removeLayer(tornadoLayerGroup);
        tornadoLayerGroup = null;
      }
      tornadoLayerGroup = L.layerGroup();

      const features = (geo && geo.features) || [];
      const bounds = [];
      const counts = {
        torWarn: 0,
        torWatch: 0,
        torEmerg: 0,
        svrWarn: 0,
        svrWatch: 0,
      };

      for (let i = 0; i < features.length; i++) {
        const f = features[i];
        const props = f.properties || {};
        const eventName = props.event || 'Alert';
        const el = eventName.toLowerCase();
        if (el.indexOf('tornado emergency') >= 0) counts.torEmerg++;
        else if (el.indexOf('tornado warning') >= 0) counts.torWarn++;
        else if (el.indexOf('tornado watch') >= 0) counts.torWatch++;
        else if (el.indexOf('severe thunderstorm warning') >= 0) counts.svrWarn++;
        else if (el.indexOf('severe thunderstorm watch') >= 0) counts.svrWatch++;

        const style = tornadoStyle(eventName);
        const geom = f.geometry;
        if (!geom) continue;

        const headline = props.headline || eventName;
        const area = props.areaDesc || '';
        const ends = formatAlertTime(props.ends || props.expires);
        const severity = props.severity || '';
        const popup =
          '<div class="storm-popup-title">' +
          escapeHtml(eventName) +
          '</div>' +
          '<div class="storm-popup-meta">' +
          escapeHtml(area) +
          '</div>' +
          (severity
            ? '<div class="storm-popup-meta">' + escapeHtml(severity) + '</div>'
            : '') +
          '<div class="storm-popup-meta">Until ' +
          escapeHtml(ends) +
          '</div>' +
          (headline
            ? '<div class="storm-popup-meta" style="margin-top:6px">' +
              escapeHtml(headline) +
              '</div>'
            : '');

        if (geom.type === 'Polygon') {
          const rings = geoJsonToLatLngs(geom.coordinates, 'Polygon');
          if (!rings.length) continue;
          const poly = L.polygon(rings, style);
          poly.bindPopup(popup, { maxWidth: 280 });
          tornadoLayerGroup.addLayer(poly);
          rings[0].forEach(function (ll) {
            bounds.push(ll);
          });
        } else if (geom.type === 'MultiPolygon') {
          const polys = geoJsonToLatLngs(geom.coordinates, 'MultiPolygon');
          for (let p = 0; p < polys.length; p++) {
            const poly = L.polygon(polys[p], style);
            poly.bindPopup(popup, { maxWidth: 280 });
            tornadoLayerGroup.addLayer(poly);
            if (polys[p][0]) {
              polys[p][0].forEach(function (ll) {
                bounds.push(ll);
              });
            }
          }
        } else if (geom.type === 'Point') {
          const ll = [geom.coordinates[1], geom.coordinates[0]];
          const mk = L.circleMarker(ll, {
            radius: 8,
            color: style.color,
            fillColor: style.fillColor,
            fillOpacity: 0.85,
            weight: 2,
          });
          mk.bindPopup(popup, { maxWidth: 280 });
          tornadoLayerGroup.addLayer(mk);
          bounds.push(ll);
        }
      }

      tornadoLayerGroup.addTo(m);

      const torTotal = counts.torWarn + counts.torWatch + counts.torEmerg;
      const svrTotal = counts.svrWarn + counts.svrWatch;

      if (!features.length) {
        if (info) {
          info.innerHTML =
            '<div class="map-info-title">Tornado &amp; severe</div>' +
            '<div class="map-info-value" style="font-size:1.05rem">All clear</div>' +
            '<p class="muted small">No active tornado or severe thunderstorm alerts (NWS)</p>';
        }
        if (legend) legend.textContent = 'Tornado · NWS · All clear';
        // CONUS overview
        if (!userExploring) {
          m.setView([39.5, -98.35], 4, { animate: true });
        }
        return;
      }

      if (bounds.length) {
        try {
          m.fitBounds(bounds, { padding: [36, 36], maxZoom: 8, animate: true });
          userExploring = true;
        } catch (e) {
          /* ignore */
        }
      }

      if (info) {
        const parts = [];
        if (counts.torEmerg) parts.push(counts.torEmerg + ' emergency');
        if (counts.torWarn) parts.push(counts.torWarn + ' TOR warn');
        if (counts.torWatch) parts.push(counts.torWatch + ' TOR watch');
        if (counts.svrWarn) parts.push(counts.svrWarn + ' SVR warn');
        if (counts.svrWatch) parts.push(counts.svrWatch + ' SVR watch');
        info.innerHTML =
          '<div class="map-info-title">Active alerts</div>' +
          '<div class="map-info-value" style="font-size:1.05rem">' +
          features.length +
          (torTotal ? ' · ' + torTotal + ' tornado' : '') +
          (svrTotal ? ' · ' + svrTotal + ' severe' : '') +
          '</div>' +
          '<p class="muted small">' +
          escapeHtml(parts.join(' · ') || 'Tap polygons for details') +
          ' · NWS</p>';
      }
      if (legend) {
        legend.textContent =
          'Red TOR warn · Yellow TOR watch · Orange SVR · NWS';
      }
    } catch (err) {
      console.warn('Tornado load failed', err);
      if (info) {
        info.innerHTML =
          '<div class="map-info-title">Tornado</div>' +
          '<p class="muted">Could not load NWS alerts</p>' +
          '<p class="muted small">' +
          escapeHtml(String((err && err.message) || err || '')) +
          '</p>';
      }
      if (legend) legend.textContent = 'Tornado unavailable';
    }
  }

  // ─── Fog / generic overlay ──────────────────────────────────────────────

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

  // ─── Solar eclipse tracker ─────────────────────────────────────────────

  function clearEclipse() {
    if (eclipseLayerGroup && map) {
      map.removeLayer(eclipseLayerGroup);
      eclipseLayerGroup = null;
    }
  }

  function pickDefaultEclipse(catalog) {
    if (!catalog || !catalog.length) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let next = null;
    for (let i = 0; i < catalog.length; i++) {
      const d = new Date(catalog[i].date + 'T12:00:00Z');
      if (d >= today) {
        next = catalog[i];
        break;
      }
    }
    return next || catalog[catalog.length - 1];
  }

  function formatEclipseDate(iso) {
    try {
      const d = new Date(iso + 'T12:00:00Z');
      return d.toLocaleDateString([], {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
    } catch (e) {
      return iso;
    }
  }

  function drawEclipse(selectedId, opts) {
    opts = opts || {};
    const m = ensureMap();
    if (!m || !eclipseData) return;
    const catalog = eclipseData.catalog || [];
    const eclipses = eclipseData.eclipses || [];
    if (!selectedId) {
      const def = pickDefaultEclipse(catalog);
      selectedId = def ? def.id : null;
    }
    eclipseSelectedId = selectedId;

    clearEclipse();
    eclipseLayerGroup = L.layerGroup();
    const bounds = [];
    let drawn = 0;

    for (let i = 0; i < eclipses.length; i++) {
      const pack = eclipses[i];
      // Each pack is a FeatureCollection with its own properties.id
      const props = pack.properties || {};
      if (selectedId && props.id && props.id !== selectedId) continue;

      const color = props.color || '#a855f7';
      const feats = pack.features || [];

      for (let f = 0; f < feats.length; f++) {
        const feat = feats[f];
        const kind = (feat.properties && feat.properties.kind) || '';
        const geom = feat.geometry;
        if (!geom) continue;

        const popupHtml =
          '<div class="storm-popup-title">🌑 ' +
          escapeHtml(props.name || 'Solar eclipse') +
          '</div>' +
          '<div class="storm-popup-meta">' +
          escapeHtml(formatEclipseDate(props.date)) +
          ' · ' +
          escapeHtml(String(props.type || 'total')) +
          '</div>' +
          '<div class="storm-popup-meta" style="margin-top:6px">' +
          escapeHtml(props.description || '') +
          '</div>' +
          (props.nasa
            ? '<div class="storm-popup-meta" style="margin-top:6px"><a href="' +
              escapeHtml(props.nasa) +
              '" target="_blank" rel="noopener">NASA eclipse map</a></div>'
            : '');

        if (kind === 'totality' && geom.type === 'Polygon') {
          // Outer ring only: array of [lat, lon]
          const outer = (geom.coordinates[0] || []).map(function (c) {
            return [c[1], c[0]];
          });
          if (outer.length < 3) continue;
          const poly = L.polygon(outer, {
            color: color,
            weight: 3,
            opacity: 1,
            fillColor: color,
            fillOpacity: 0.4,
            interactive: true,
          });
          poly.bindPopup(popupHtml, { maxWidth: 300 });
          eclipseLayerGroup.addLayer(poly);
          outer.forEach(function (ll) {
            bounds.push(ll);
          });
          drawn++;
        } else if (kind === 'centerline' && geom.type === 'LineString') {
          const latlngs = geom.coordinates.map(function (c) {
            return [c[1], c[0]];
          });
          if (latlngs.length < 2) continue;
          const line = L.polyline(latlngs, {
            color: '#ffffff',
            weight: 3,
            opacity: 0.95,
            dashArray: '8 6',
          });
          line.bindPopup(popupHtml, { maxWidth: 300 });
          eclipseLayerGroup.addLayer(line);
          latlngs.forEach(function (ll) {
            bounds.push(ll);
          });
          drawn++;
        }
      }
    }

    eclipseLayerGroup.addTo(m);

    // Always zoom to the path when opening Eclipse or switching date
    if (bounds.length && opts.fit !== false) {
      try {
        m.fitBounds(bounds, { padding: [36, 36], maxZoom: 4, animate: true });
      } catch (e) {
        /* ignore */
      }
    }

    const info = $('map-info');
    const legend = $('map-legend');
    const sel =
      catalog.find(function (c) {
        return c.id === eclipseSelectedId;
      }) || pickDefaultEclipse(catalog);

    if (info) {
      info.classList.remove('hidden');
      if (!sel) {
        info.innerHTML =
          '<div class="map-info-title">Eclipse</div>' +
          '<p class="muted">No eclipse data in catalog</p>';
      } else {
        let chips = '';
        for (let i = 0; i < catalog.length; i++) {
          const c = catalog[i];
          const on = c.id === sel.id;
          chips +=
            '<button type="button" class="eclipse-pick' +
            (on ? ' active' : '') +
            '" data-eclipse-id="' +
            escapeHtml(c.id) +
            '">' +
            escapeHtml(c.date) +
            '</button>';
        }
        info.innerHTML =
          '<div class="map-info-title">Solar eclipse tracker</div>' +
          '<div class="map-info-value" style="font-size:1.05rem">' +
          escapeHtml(sel.name) +
          '</div>' +
          '<p class="muted small">' +
          escapeHtml(formatEclipseDate(sel.date)) +
          ' · colored band = path of totality</p>' +
          '<p class="muted small">' +
          escapeHtml(sel.description || '') +
          '</p>' +
          '<div class="eclipse-picks">' +
          chips +
          '</div>' +
          (sel.nasa
            ? '<p class="muted small" style="margin-top:8px"><a href="' +
              escapeHtml(sel.nasa) +
              '" target="_blank" rel="noopener">NASA map (exact times)</a></p>'
            : '') +
          '<p class="muted small">Never look at the Sun without certified eclipse glasses.' +
          (drawn ? '' : ' (path failed to draw — try another date)') +
          '</p>';

        info.querySelectorAll('.eclipse-pick').forEach(function (btn) {
          btn.addEventListener('click', function () {
            drawEclipse(btn.getAttribute('data-eclipse-id'), { fit: true });
          });
        });
      }
    }
    if (legend) {
      legend.textContent = drawn
        ? 'Colored band = path of totality · white dashed = centerline'
        : 'Eclipse path not drawn — try another date chip';
    }
  }

  async function loadEclipses() {
    const m = ensureMap();
    if (!m || currentLayer !== 'eclipse') return;
    const myId = ++eclipseFetchId;
    const legend = $('map-legend');
    const info = $('map-info');
    if (legend) legend.textContent = 'Loading eclipse paths…';
    if (info) {
      info.classList.remove('hidden');
      info.innerHTML = '<p class="muted">Loading solar eclipse tracker…</p>';
    }

    try {
      // Always revalidate so SW/cache updates ship
      const res = await fetch('/data/eclipses.json?v=2', { cache: 'no-cache' });
      if (!res.ok) throw new Error('eclipses ' + res.status);
      eclipseData = await res.json();
      if (myId !== eclipseFetchId || currentLayer !== 'eclipse') return;
      // Fresh layer open → always fly to the path
      drawEclipse(eclipseSelectedId, { fit: true });
    } catch (err) {
      console.warn('Eclipse load failed', err);
      if (info) {
        info.innerHTML =
          '<div class="map-info-title">Eclipse</div>' +
          '<p class="muted">Could not load eclipse paths</p>' +
          '<p class="muted small">' +
          escapeHtml(String((err && err.message) || err || '')) +
          '</p>';
      }
      if (legend) legend.textContent = 'Eclipse data unavailable';
    }
  }

  function setLayer(layer) {
    currentLayer = layer || 'radar';
    ensureMap();
    wireControls();

    document.querySelectorAll('.layer-btn[data-layer]').forEach(function (btn) {
      btn.classList.toggle(
        'active',
        btn.getAttribute('data-layer') === currentLayer
      );
    });

    // Tear down non-active overlays
    if (currentLayer !== 'radar') clearRadar();
    if (currentLayer !== 'wind') clearWind();
    if (currentLayer !== 'hurricane') clearHurricane();
    if (currentLayer !== 'tornado') clearTornado();
    if (currentLayer !== 'eclipse') clearEclipse();

    if (currentLayer === 'radar') {
      hideDataOverlay();
      setControlsVisible(true);
      if (!radarFrames.length) {
        loadRadarFrames();
      } else {
        pausePlayback();
        showRadarFrame(frameIndex, false);
        if (radarFront && map && !map.hasLayer(radarFront)) {
          radarFront.addTo(map);
        }
      }
    } else if (currentLayer === 'wind') {
      setControlsVisible(false);
      wireWindMove();
      loadWindField();
    } else if (currentLayer === 'hurricane') {
      setControlsVisible(false);
      loadHurricanes();
    } else if (currentLayer === 'tornado') {
      setControlsVisible(false);
      loadTornadoes();
    } else if (currentLayer === 'eclipse') {
      setControlsVisible(false);
      // Drop leftover wind/fog info immediately
      const info = $('map-info');
      if (info) {
        info.classList.remove('hidden');
        info.innerHTML = '<p class="muted">Loading solar eclipse tracker…</p>';
      }
      loadEclipses();
    } else {
      // fog
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
