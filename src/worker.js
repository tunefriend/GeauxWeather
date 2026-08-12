/**
 * GeauxWeather — Cloudflare Worker
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const PROXY_HOST_RE =
  /^(?:[\w-]+\.)*(?:noaa\.gov|weather\.gov)$/i;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

async function handleProxy(request, url) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
  }

  const target = url.searchParams.get("url");
  if (!target) {
    return new Response("Missing url", { status: 400, headers: corsHeaders() });
  }

  let dest;
  try {
    dest = new URL(target);
  } catch {
    return new Response("Bad url", { status: 400, headers: corsHeaders() });
  }

  if (dest.protocol !== "https:" && dest.protocol !== "http:") {
    return new Response("Invalid protocol", { status: 400, headers: corsHeaders() });
  }
  if (!PROXY_HOST_RE.test(dest.hostname)) {
    return new Response("Host not allowed", { status: 403, headers: corsHeaders() });
  }

  const upstream = await fetch(dest.toString(), {
    method: "GET",
    headers: {
      Accept: request.headers.get("Accept") || "*/*",
      "User-Agent": "GeauxWeather/1.0 (+https://geauxweather.com; FOSS weather)",
    },
    redirect: "follow",
  });

  const headers = new Headers(corsHeaders());
  const ct = upstream.headers.get("Content-Type");
  if (ct) headers.set("Content-Type", ct);
  headers.set("Cache-Control", "public, max-age=120");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    if (!env.ASSETS) {
      return new Response("GeauxWeather site not configured", { status: 500 });
    }

    const url = new URL(request.url);

    // Force HTTPS (geolocation + lock icon require a secure context)
    let scheme = url.protocol === "http:" ? "http" : "https";
    const visitor = request.headers.get("cf-visitor");
    if (visitor) {
      try {
        const v = JSON.parse(visitor);
        if (v && v.scheme) scheme = v.scheme;
      } catch (_) {}
    }
    if (scheme === "http") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

    // Proxy NOAA / NWS (no CORS in browser) for website maps
    if (url.pathname === "/api/proxy") {
      return handleProxy(request, url);
    }

    // Approximate visitor location from Cloudflare (IP / VPN endpoint)
    if (url.pathname === "/api/geo") {
      const cf = request.cf || {};
      const lat = cf.latitude != null ? Number(cf.latitude) : null;
      const lon = cf.longitude != null ? Number(cf.longitude) : null;
      const city = cf.city || null;
      const region = cf.region || cf.regionCode || null;
      const country = cf.country || null;
      let label = null;
      if (city && region) label = city + ", " + region;
      else if (city && country) label = city + ", " + country;
      else if (city) label = city;
      else if (region && country) label = region + ", " + country;
      else if (country) label = country;

      const body = {
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
        city,
        region,
        country,
        label,
        source: "cloudflare-ip",
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "private, no-store",
          ...corsHeaders(),
        },
      });
    }

    let assetUrl = url;
    // Serve versioned homepage (avoids sticky /index.html edge cache)
    if (url.pathname === "/" || url.pathname === "/index.html") {
      assetUrl = new URL("/home-v3.html", url.origin);
    }

    const res = await env.ASSETS.fetch(new Request(assetUrl, request));
    const headers = new Headers(res.headers);

    // Correct MIME types for PWA assets
    if (url.pathname.endsWith(".webmanifest") || url.pathname === "/manifest.webmanifest") {
      headers.set("Content-Type", "application/manifest+json; charset=utf-8");
    }
    if (url.pathname === "/sw.js") {
      headers.set("Content-Type", "application/javascript; charset=utf-8");
      // Service worker must revalidate so updates ship quickly
      headers.set("Cache-Control", "no-cache, max-age=0, must-revalidate");
      headers.set("Service-Worker-Allowed", "/");
    }

    if (
      url.pathname === "/" ||
      url.pathname.endsWith(".html") ||
      url.pathname === "/home-v3.html"
    ) {
      headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
      headers.set("CDN-Cache-Control", "no-store");
      // Help browsers upgrade mixed/legacy HTTP bookmarks
      headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  },
};
