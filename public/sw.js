/* GeauxWeather service worker — shell offline; JS/CSS always revalidate */
const CACHE = "geauxweather-shell-v4";
const SHELL = [
  "/",
  "/home-v3.html",
  "/manifest.webmanifest",
  "/icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/css/sky.css",
  "/js/sky.js",
  "/privacy.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isApi(url) {
  return (
    url.hostname.includes("open-meteo.com") ||
    url.hostname.includes("openstreetmap.org") ||
    url.hostname.includes("rainviewer") ||
    url.hostname.includes("usgs.gov") ||
    url.pathname.startsWith("/cdn-cgi/")
  );
}

/** Maps/app logic must not stick on an old cached copy (Rivers/Lightning etc.). */
function isRevalidateFirst(url) {
  const p = url.pathname;
  return (
    p.startsWith("/js/") ||
    p.startsWith("/css/") ||
    p.startsWith("/data/") ||
    p === "/sw.js"
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache cross-origin weather/geo APIs — always network
  if (url.origin !== self.location.origin || isApi(url)) {
    return;
  }

  // Navigations: network first, fall back to cached shell
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match("/").then((r) => r || caches.match("/home-v3.html"))
        )
    );
    return;
  }

  // JS/CSS/data: network first so map layers update after deploy
  if (isRevalidateFirst(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Other same-origin static (icons, images): cache first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (
          res.ok &&
          (url.pathname.startsWith("/icons/") ||
            url.pathname.endsWith(".png") ||
            url.pathname.endsWith(".webmanifest") ||
            url.pathname.endsWith(".jpg") ||
            url.pathname.endsWith(".webp"))
        ) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
