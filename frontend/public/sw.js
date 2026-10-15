const CACHE_NAME = "cleardoc-app-shell-v1";
const APP_FILES = [
  "",
  "index.html",
  "manifest.webmanifest",
  "favicon.svg",
  "icons/cleardoc-192.png",
  "icons/cleardoc-512.png",
];

function appUrl(file) {
  return new URL(file, self.registration.scope).href;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES.map(appUrl)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("cleardoc-app-shell-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);

  if (
    request.method !== "GET" ||
    requestUrl.origin !== self.location.origin ||
    !requestUrl.href.startsWith(self.registration.scope)
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            await (await caches.open(CACHE_NAME)).put(request, response.clone());
          }
          return response;
        } catch {
          return (
            (await caches.match(request)) ||
            (await caches.match(appUrl("index.html")))
          );
        }
      })(),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(request).then(async (response) => {
        if (response.ok && response.type === "basic") {
          await (await caches.open(CACHE_NAME)).put(request, response.clone());
        }
        return response;
      });
    }),
  );
});
