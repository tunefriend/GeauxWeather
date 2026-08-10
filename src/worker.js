/**
 * GeauxWeather — Cloudflare Worker
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
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

    let assetUrl = url;
    // Serve versioned homepage (avoids sticky /index.html edge cache)
    if (url.pathname === "/" || url.pathname === "/index.html") {
      assetUrl = new URL("/home-v3.html", url.origin);
    }

    const res = await env.ASSETS.fetch(new Request(assetUrl, request));
    const headers = new Headers(res.headers);
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
