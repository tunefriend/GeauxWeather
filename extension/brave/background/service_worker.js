/* GeauxWeather service worker — badge temperature */

const DEFAULT = {
  lat: 30.5021,
  lon: -90.7476,
  label: "Livingston, LA",
  units: "fahrenheit",
};

async function getLoc() {
  const { loc } = await chrome.storage.sync.get("loc");
  return loc || DEFAULT;
}

async function fetchTemp(loc) {
  const params = new URLSearchParams({
    latitude: String(loc.lat),
    longitude: String(loc.lon),
    current: "temperature_2m,weather_code",
    temperature_unit: loc.units || "fahrenheit",
    timezone: "auto",
  });
  const res = await fetch("https://api.open-meteo.com/v1/forecast?" + params);
  if (!res.ok) throw new Error("weather " + res.status);
  const data = await res.json();
  return data.current || {};
}

async function updateBadge() {
  try {
    const loc = await getLoc();
    const cur = await fetchTemp(loc);
    if (cur.temperature_2m == null) {
      await chrome.action.setBadgeText({ text: "" });
      return;
    }
    const t = Math.round(cur.temperature_2m);
    await chrome.action.setBadgeText({ text: String(t) + "°" });
    await chrome.action.setBadgeBackgroundColor({ color: "#1e3a5f" });
    await chrome.action.setTitle({
      title: `GeauxWeather · ${loc.label || "Weather"} · ${t}°`,
    });
  } catch (e) {
    console.warn("badge update failed", e);
    await chrome.action.setBadgeText({ text: "" });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("gw-refresh", { periodInMinutes: 20 });
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("gw-refresh", { periodInMinutes: 20 });
  updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "gw-refresh") updateBadge();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "loc-updated") {
    updateBadge().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

// initial
updateBadge();
