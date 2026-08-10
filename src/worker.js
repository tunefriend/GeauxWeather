/**
 * GeauxWeather — Cloudflare Worker
 * Serves the static landing site (public/).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export default {
  async fetch(request, env) {
    if (!env.ASSETS) {
      return new Response("GeauxWeather site not configured", { status: 500 });
    }
    const url = new URL(request.url);
    const res = await env.ASSETS.fetch(request);
    // Avoid sticky HTML cache on custom domains during rapid updates
    if (res.status === 200 && (url.pathname === "/" || url.pathname.endsWith(".html"))) {
      const headers = new Headers(res.headers);
      headers.set("Cache-Control", "public, max-age=60, must-revalidate");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }
    return res;
  },
};
