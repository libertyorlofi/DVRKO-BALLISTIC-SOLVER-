// Offline cache. Bump VERSION whenever any web file changes so phones pick up the update.
const VERSION = "v8";
const CACHE = "ballistic-" + VERSION;
const FILES = [
  "./", "index.html", "style.css", "app.js", "reticle.js", "manifest.webmanifest",
  "lrf.js", "solver/core.js", "solver/drag_tables.js", "data/index.json", "data/starter_rifle.json",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(FILES);
    const idx = await (await fetch("data/index.json")).json();
    await c.addAll([...idx.reticles.map((f) => "data/reticles/" + f), ...idx.targets.map((f) => "data/targets/" + f)]);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(e.request); } catch { return caches.match("index.html"); }
  })());
});
