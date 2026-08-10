/**
 * GeauxWeather — Cloudflare Worker
 * Serves the static landing site (public/).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export default {
  async fetch(request, env) {
    // Static assets via Workers Assets binding
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("GeauxWeather site not configured", { status: 500 });
  },
};
