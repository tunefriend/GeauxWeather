/**
 * Web bridge so app maps.js / kmz.js work on geauxweather.com
 * - PureSkyNet: proxy NOAA/NWS through /api/proxy (CORS)
 * - PureSkyWeather: small helpers for wind dir / visibility labels
 */
(function (global) {
  function needsProxy(urlStr) {
    try {
      var u = new URL(urlStr);
      return /(?:^|\.)(?:noaa\.gov|weather\.gov)$/i.test(u.hostname);
    } catch (e) {
      return false;
    }
  }

  function proxied(urlStr) {
    return "/api/proxy?url=" + encodeURIComponent(urlStr);
  }

  async function fetchThrough(urlStr, opts) {
    opts = opts || {};
    var as = opts.as || "json";
    var finalUrl = needsProxy(urlStr) ? proxied(urlStr) : urlStr;
    var headers = { Accept: as === "json" ? "application/json, application/geo+json, */*" : "*/*" };
    var res = await fetch(finalUrl, { cache: "no-cache", headers: headers });
    if (!res.ok) throw new Error("HTTP " + res.status);
    if (as === "arrayBuffer") return res.arrayBuffer();
    if (as === "text") return res.text();
    return res.json();
  }

  function windDir(deg) {
    if (deg == null || isNaN(Number(deg))) return "";
    var dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return dirs[Math.round(Number(deg) / 22.5) % 16];
  }

  function formatVis(meters, units) {
    if (meters == null || isNaN(Number(meters))) return "—";
    var m = Number(meters);
    if (units === "metric") {
      if (m >= 1000) return (m / 1000).toFixed(1) + " km";
      return Math.round(m) + " m";
    }
    // imperial: miles
    var mi = m / 1609.344;
    if (mi >= 10) return Math.round(mi) + " mi";
    if (mi >= 1) return mi.toFixed(1) + " mi";
    return Math.round(mi * 5280) + " ft";
  }

  global.PureSkyNet = {
    fetch: fetchThrough,
  };

  global.PureSkyWeather = {
    windDir: windDir,
    formatVis: formatVis,
  };
})(window);
