const CACHE_NAME = "pdv-cache-v1.6.5";
const PRECACHE_URLS = ["/", "/index.html", "/manifest.json", "/version.json"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  console.log("🔧 Service Worker: Nueva versión instalada");
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
  event.waitUntil(
    caches.keys().then((keys) => {
      const toDelete = keys.filter((k) => k !== CACHE_NAME);
      return Promise.all(toDelete.map((k) => caches.delete(k))).then(
        (results) => {
          const removedAny = results.some(Boolean);
          if (removedAny) {
            console.log("🗑️ Service Worker: Caches antiguos eliminados");
            return self.clients.matchAll({ type: "window" }).then((clients) => {
              clients.forEach((client) => {
                try {
                  client.postMessage({ type: "NEW_VERSION_AVAILABLE" });
                } catch (e) {
                  /* ignore */
                }
              });
            });
          }
          return Promise.resolve();
        },
      );
    }),
  );
  console.log("✅ Service Worker: Activado y listo");
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // No interceptar llamadas a APIs externas (Supabase, CDNs, etc.)
  if (url.origin !== location.origin) return;

  // Solo interceptar GET
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      // No está en caché → intentar red
      return fetch(event.request)
        .then((response) => {
          // Cachear assets válidos (JS, CSS, imágenes, fuentes)
          if (response && response.status === 200) {
            const contentType = response.headers.get("content-type") || "";
            const esAsset =
              contentType.includes("application/javascript") ||
              contentType.includes("text/javascript") ||
              contentType.includes("text/css") ||
              contentType.includes("image/") ||
              contentType.includes("font/") ||
              contentType.includes("text/html");
            if (esAsset) {
              const copy = response.clone();
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(event.request, copy));
            }
          }
          return response;
        })
        .catch(() => {
          // Sin red y sin caché:
          // - Navegación (F5, abrir app) → devolver index.html desde caché
          // - Assets (JS/CSS) → NO devolver HTML, dejar que falle con error
          //   correcto (evita el error de MIME type)
          if (event.request.mode === "navigate") {
            return caches.match("/index.html");
          }
          // Para assets, devolver respuesta vacía opaca o undefined
          return undefined;
        });
    }),
  );
});
