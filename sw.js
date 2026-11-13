const CACHE = "local-rppg-v1";
const APP_SHELL = ["./", "./index.html", "./style.css", "./app.js", "./signal.js", "./manifest.webmanifest", "./icon.svg", "./models/face_landmarker.task", "./vendor/vision_bundle.mjs", "./vendor/wasm/vision_wasm_internal.js", "./vendor/wasm/vision_wasm_internal.wasm", "./vendor/wasm/vision_wasm_nosimd_internal.js", "./vendor/wasm/vision_wasm_nosimd_internal.wasm"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
    if (response.ok && new URL(event.request.url).origin === location.origin) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }))));
});
