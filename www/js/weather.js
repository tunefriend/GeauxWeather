/**
 * weather.js — Open-Meteo current / hourly / daily
 * Classic script (no modules)
 */
(function (global) {
  const BASE = 'https://api.open-meteo.com/v1/forecast';

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
      ].join(','),
      temperature_unit: tempUnit,
      wind_speed_unit: windUnit,
      precipitation_unit: precipUnit,
      timezone: 'auto',
      forecast_days: 10,
    });

    const res = await fetch(BASE + '?' + params);
    if (!res.ok) throw new Error('Open-Meteo ' + res.status);
    return res.json();
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

  global.PureSkyWeather = {
    fetchForecast: fetchForecast,
    codeToCondition: codeToCondition,
    windDir: windDir,
    formatVis: formatVis,
  };
})(window);
