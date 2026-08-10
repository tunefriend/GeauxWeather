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
    let assetUrl = url;

    // Always serve the latest homepage asset (avoids sticky /index.html edge cache)
    if (url.pathname === "/" || url.pathname === "/index.html") {
      assetUrl = new URL("/home-v3.html", url.origin);
    }

    const res = await env.ASSETS.fetch(new Request(assetUrl, request));
    const headers = new Headers(res.headers);
    if (url.pathname === "/" || url.pathname.endsWith(".html") || url.pathname === "/home-v3.html") {
      headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
      headers.set("CDN-Cache-Control", "no-store");
    }
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  },
};
