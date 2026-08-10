/* GeauxWeather popup — Open-Meteo, no tracking */

const DEFAULT = {
  lat: 30.5021,
  lon: -90.7476,
  label: "Livingston, LA",
  units: "fahrenheit",
};

function $(id) {
  return document.getElementById(id);
}

function setStatus(msg, isErr) {
  const el = $("status");
  el.textContent = msg || "";
  el.className = "status" + (isErr ? " err" : "");
}

function codeLabel(code) {
  const c = Number(code);
  if (c === 0) return "☀️ Clear";
  if (c === 1) return "🌤 Mostly clear";
  if (c === 2) return "⛅ Partly cloudy";
  if (c === 3) return "☁️ Overcast";
  if (c >= 45 && c <= 48) return "🌫 Fog";
  if (c >= 51 && c <= 67) return "🌧 Rain";
  if (c >= 71 && c <= 77) return "❄️ Snow";
  if (c >= 80 && c <= 82) return "🌦 Showers";
  if (c >= 95) return "⛈ Thunderstorm";
  return "☁️ Cloudy";
}

function windDir(deg) {
  if (deg == null || Number.isNaN(deg)) return "";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

async function getStoredLoc() {
  const { loc } = await chrome.storage.sync.get("loc");
  return loc || DEFAULT;
}

async function setStoredLoc(loc) {
  await chrome.storage.sync.set({ loc });
  // notify service worker to refresh badge
  try {
    await chrome.runtime.sendMessage({ type: "loc-updated" });
  } catch (_) {}
}

async function fetchWeather(lat, lon, units = "fahrenheit") {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current:
      "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,relative_humidity_2m,uv_index",
    temperature_unit: units,
    wind_speed_unit: units === "celsius" ? "kmh" : "mph",
    timezone: "auto",
  });
  const res = await fetch("https://api.open-meteo.com/v1/forecast?" + params);
  if (!res.ok) throw new Error("Weather request failed");
  return res.json();
}

function render(loc, data) {
  const c = data.current || {};
  $("place").textContent = loc.label || "—";
  $("temp").textContent =
    c.temperature_2m != null ? Math.round(c.temperature_2m) + "°" : "—°";
  $("cond").textContent = codeLabel(c.weather_code);
  $("feels").textContent =
    c.apparent_temperature != null
      ? "Feels " + Math.round(c.apparent_temperature) + "°"
      : "Feels —";
  const windUnit = "mph";
  $("wind").textContent =
    c.wind_speed_10m != null
      ? Math.round(c.wind_speed_10m) + " " + windUnit + " " + windDir(c.wind_direction_10m)
      : "—";
  $("hum").textContent =
    c.relative_humidity_2m != null ? c.relative_humidity_2m + "%" : "—";
  $("uv").textContent = c.uv_index != null ? String(Math.round(c.uv_index)) : "—";
}

async function loadAt(lat, lon, label) {
  setStatus("Loading…");
  try {
    const data = await fetchWeather(lat, lon);
    const loc = { lat, lon, label: label || "Saved location", units: "fahrenheit" };
    await setStoredLoc(loc);
    render(loc, data);
    setStatus("");
  } catch (e) {
    console.warn(e);
    setStatus("Could not load weather.", true);
  }
}

function getGeo() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("no-geo"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

async function reverseLabel(lat, lon) {
  try {
    const u =
      "https://nominatim.openstreetmap.org/reverse?lat=" +
      encodeURIComponent(lat) +
      "&lon=" +
      encodeURIComponent(lon) +
      "&format=json&zoom=10&addressdetails=1";
    const res = await fetch(u, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address || {};
    const name = a.city || a.town || a.village || a.municipality || a.county || data.name;
    const region = a.state || "";
    if (name && region && region !== name) return name + ", " + region;
    return name || null;
  } catch (_) {
    return null;
  }
}

async function useGeo() {
  const btn = $("btn-geo");
  btn.disabled = true;
  setStatus("Getting location… (allow when prompted)");
  try {
    const pos = await getGeo();
    const label = (await reverseLabel(pos.lat, pos.lon)) || "Current location";
    await loadAt(pos.lat, pos.lon, label);
  } catch (e) {
    if (e && e.code === 1) {
      setStatus("Location blocked — allow for this extension, or search a city.", true);
    } else {
      setStatus("Location unavailable — search a city instead.", true);
    }
  } finally {
    btn.disabled = false;
  }
}

async function searchCity(q) {
  if (!q || q.trim().length < 2) return [];
  const params = new URLSearchParams({
    name: q.trim(),
    count: 6,
    language: "en",
    format: "json",
  });
  const res = await fetch("https://geocoding-api.open-meteo.com/v1/search?" + params);
  if (!res.ok) throw new Error("search failed");
  const data = await res.json();
  return (data.results || []).map((r) => ({
    lat: r.latitude,
    lon: r.longitude,
    label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
  }));
}

function showResults(list) {
  const ul = $("results");
  if (!list.length) {
    ul.hidden = true;
    ul.innerHTML = "";
    return;
  }
  ul.innerHTML = list
    .map(
      (r, i) =>
        `<li><button type="button" data-i="${i}">${r.label}</button></li>`
    )
    .join("");
  ul.hidden = false;
  ul.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = list[+btn.dataset.i];
      ul.hidden = true;
      ul.innerHTML = "";
      $("city").value = item.label;
      loadAt(item.lat, item.lon, item.label);
    });
  });
}

async function runSearch() {
  const q = $("city").value;
  setStatus("Searching…");
  try {
    const list = await searchCity(q);
    if (!list.length) {
      setStatus("No cities found.", true);
      showResults([]);
      return;
    }
    setStatus("");
    showResults(list);
  } catch (_) {
    setStatus("Search failed.", true);
  }
}

async function boot() {
  $("btn-refresh").addEventListener("click", async () => {
    const loc = await getStoredLoc();
    await loadAt(loc.lat, loc.lon, loc.label);
  });
  $("btn-geo").addEventListener("click", useGeo);
  $("btn-search").addEventListener("click", runSearch);
  $("city").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
    }
  });

  const loc = await getStoredLoc();
  await loadAt(loc.lat, loc.lon, loc.label);
}

document.addEventListener("DOMContentLoaded", boot);
