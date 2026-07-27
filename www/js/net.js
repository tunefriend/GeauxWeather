/**
 * net.js — fetch that bypasses WebView CORS for NOAA/NHC via native bridge
 * (nhc.noaa.gov does not send Access-Control-Allow-Origin)
 */
(function (global) {
  const ALLOWED_HOST_RE =
    /^(?:[\w-]+\.)*(?:noaa\.gov|weather\.gov|rainviewer\.com|open-meteo\.com)$/i;

  function isNative() {
    try {
      return !!(
        global.Capacitor &&
        global.Capacitor.isNativePlatform &&
        global.Capacitor.isNativePlatform() &&
        global.Capacitor.Plugins &&
        global.Capacitor.Plugins.GeauxWeatherNative
      );
    } catch (e) {
      return false;
    }
  }

  function hostAllowed(urlStr) {
    try {
      const u = new URL(urlStr);
      return ALLOWED_HOST_RE.test(u.hostname);
    } catch (e) {
      return false;
    }
  }

  function b64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  /**
   * @param {string} url
   * @param {{ as?: 'text'|'json'|'arrayBuffer' }} opts
   */
  async function fetchNoCors(url, opts) {
    opts = opts || {};
    const as = opts.as || 'text';

    if (isNative() && hostAllowed(url)) {
      const plugin = global.Capacitor.Plugins.GeauxWeatherNative;
      if (typeof plugin.httpGet === 'function') {
        const ret = await plugin.httpGet({ url: url, binary: as === 'arrayBuffer' });
        if (!ret || ret.status < 200 || ret.status >= 300) {
          throw new Error('HTTP ' + (ret && ret.status));
        }
        if (as === 'arrayBuffer') {
          return b64ToArrayBuffer(ret.bodyBase64 || '');
        }
        if (as === 'json') {
          return JSON.parse(ret.body || '{}');
        }
        return ret.body || '';
      }
    }

    // Browser / fallback
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (as === 'arrayBuffer') return res.arrayBuffer();
    if (as === 'json') return res.json();
    return res.text();
  }

  global.PureSkyNet = {
    fetch: fetchNoCors,
    isNative: isNative,
  };
})(window);
