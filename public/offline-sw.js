const CACHE_NAME = "magicaldeckgatherer-offline-assets-v2";
const OLD_CACHE_NAMES = ["magicaldeckgatherer-offline-assets-v1"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(["/"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      ...OLD_CACHE_NAMES.map((cacheName) => caches.delete(cacheName)),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/"));
    return;
  }

  const url = new URL(request.url);
  const isImage = request.destination === "image";
  const isNextAsset =
    url.origin === self.location.origin && url.pathname.startsWith("/_next/");
  const isStatic =
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/offline-data/") ||
      url.pathname === "/icon.svg" ||
      url.pathname === "/apple-icon.png");

  if (isNextAsset) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isImage || isStatic) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw error;
  }
}
