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
 * weather.js — Open-Meteo current / hourly / daily
 * Classic script (no modules)
 */
(function (global) {
  const BASE = 'https://api.open-meteo.com/v1/forecast';
  const AQ_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';

  /** US EPA AQI bands */
  function usAqiLabel(aqi) {
    const n = Number(aqi);
    if (isNaN(n)) return { text: '—', key: 'unknown' };
    if (n <= 50) return { text: 'Good', key: 'good' };
    if (n <= 100) return { text: 'Moderate', key: 'moderate' };
    if (n <= 150) return { text: 'Unhealthy (sensitive)', key: 'usg' };
    if (n <= 200) return { text: 'Unhealthy', key: 'unhealthy' };
    if (n <= 300) return { text: 'Very unhealthy', key: 'very' };
    return { text: 'Hazardous', key: 'hazardous' };
  }

  /** European AQI bands (EEA) */
  function euAqiLabel(aqi) {
    const n = Number(aqi);
    if (isNaN(n)) return { text: '—', key: 'unknown' };
    if (n <= 20) return { text: 'Good', key: 'good' };
    if (n <= 40) return { text: 'Fair', key: 'good' };
    if (n <= 60) return { text: 'Moderate', key: 'moderate' };
    if (n <= 80) return { text: 'Poor', key: 'usg' };
    if (n <= 100) return { text: 'Very poor', key: 'unhealthy' };
    return { text: 'Extremely poor', key: 'hazardous' };
  }

  async function fetchAirQuality(lat, lon) {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current: 'us_aqi,european_aqi,pm2_5,pm10',
      timezone: 'auto',
    });
    const res = await fetch(AQ_BASE + '?' + params);
    if (!res.ok) throw new Error('Open-Meteo AQ ' + res.status);
    return res.json();
  }

  async function fetchForecast(lat, lon, units) {
    units = units || 'imperial';
    const tempUnit = units === 'metric' ? 'celsius' : 'fahrenheit';
    const windUnit = units === 'metric' ? 'kmh' : 'mph';
    const precipUnit = units === 'metric' ? 'mm' : 'inch';

    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current: [
        'temperature_2m',
        'relative_humidity_2m',
        'dew_point_2m',
        'apparent_temperature',
        'precipitation',
        'weather_code',
        'cloud_cover',
        'pressure_msl',
        'wind_speed_10m',
        'wind_direction_10m',
        'uv_index',
        'visibility',
      ].join(','),
      hourly: [
        'temperature_2m',
        'precipitation_probability',
        'weather_code',
        'wind_speed_10m',
        'wind_direction_10m',
      ].join(','),
      daily: [
        'weather_code',
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_sum',
        'precipitation_probability_max',
        'uv_index_max',
        'sunrise',
        'sunset',
        'wind_speed_10m_max',
        'wind_direction_10m_dominant',
      ].join(','),
      // Next-hour rain graph (WeatherBug-style): 15-min steps for ~2h
      minutely_15: [
        'precipitation',
        'precipitation_probability',
        'weather_code',
      ].join(','),
      forecast_minutely_15: 8,
      temperature_unit: tempUnit,
      wind_speed_unit: windUnit,
      precipitation_unit: precipUnit,
      timezone: 'auto',
      forecast_days: 10,
    });

    const res = await fetch(BASE + '?' + params);
    if (!res.ok) throw new Error('Open-Meteo ' + res.status);
    const data = await res.json();
    // Attach air quality (best-effort; don't fail the whole forecast)
    try {
      const aq = await fetchAirQuality(lat, lon);
      data.air_quality = aq.current || null;
    } catch (e) {
      data.air_quality = null;
    }
    return data;
  }

  function codeToCondition(code) {
    const map = {
      0: { text: 'Clear', icon: '☀️' },
      1: { text: 'Mainly clear', icon: '🌤' },
      2: { text: 'Partly cloudy', icon: '⛅' },
      3: { text: 'Overcast', icon: '☁️' },
      45: { text: 'Fog', icon: '🌫' },
      48: { text: 'Rime fog', icon: '🌫' },
      51: { text: 'Light drizzle', icon: '🌦' },
      53: { text: 'Drizzle', icon: '🌦' },
      55: { text: 'Heavy drizzle', icon: '🌧' },
      61: { text: 'Light rain', icon: '🌧' },
      63: { text: 'Rain', icon: '🌧' },
      65: { text: 'Heavy rain', icon: '🌧' },
      71: { text: 'Light snow', icon: '🌨' },
      73: { text: 'Snow', icon: '❄️' },
      75: { text: 'Heavy snow', icon: '❄️' },
      80: { text: 'Rain showers', icon: '🌦' },
      81: { text: 'Showers', icon: '🌧' },
      82: { text: 'Heavy showers', icon: '🌧' },
      95: { text: 'Thunderstorm', icon: '⛈' },
      96: { text: 'T-storm + hail', icon: '⛈' },
      99: { text: 'T-storm + heavy hail', icon: '⛈' },
    };
    return map[code] || { text: '—', icon: '☁️' };
  }

  function windDir(deg) {
    if (deg == null) return '';
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(deg / 45) % 8];
  }

  function formatVis(meters, units) {
    if (meters == null) return '—';
    if (units === 'metric') {
      return meters >= 1000
        ? (meters / 1000).toFixed(1) + ' km'
        : Math.round(meters) + ' m';
    }
    const miles = meters / 1609.34;
    return miles >= 10 ? Math.round(miles) + ' mi' : miles.toFixed(1) + ' mi';
  }

  /**
   * Coarse sky mood for backgrounds + status chrome.
   * @returns {'sunny'|'cloudy'|'rain'}
   */
  function codeToMood(code) {
    const c = Number(code);
    if (c === 0 || c === 1) return 'sunny'; // Clear / Mainly clear
    // Rain, drizzle, showers, thunderstorms
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 99)) return 'rain';
    // Partly cloudy, overcast, fog, snow → cloudy scene
    return 'cloudy';
  }

  global.PureSkyWeather = {
    fetchForecast: fetchForecast,
    fetchAirQuality: fetchAirQuality,
    usAqiLabel: usAqiLabel,
    euAqiLabel: euAqiLabel,
    codeToCondition: codeToCondition,
    codeToMood: codeToMood,
    windDir: windDir,
    formatVis: formatVis,
  };
})(window);
