/* Gara-G Service Worker — PWA offline support
 *
 * Regla que gobierna este fichero: NADA que dependa de una sesión entra en la
 * caché. Un SW no sabe si hay cookie ni si el token caducó, así que su_cache es
 * un almacén compartido entre usuarios del mismo navegador. Con `cacheFirst`
 * sobre las páginas, las de sesión (/alerts, /telemetry, /documents,
 * /drivers, /geofences, /fuel, /fleets) quedaban servidas para siempre: tras
 * un logout, o en un móvil de flota compartido, el siguiente conductor veía los
 * datos del anterior, y tras un despliegue nuevo se veían las páginas viejas.
 *
 * Estrategia por tipo:
 *   - Navegaciones (HTML): red primero, SIN cachear. El 503 offline es explícito.
 *   - /api/*: red, nunca cache. Son respuestas autenticadas.
 *   - /r2/*: red, nunca cache. Son documentos privados (SOAT, pólizas).
 *   - Assets estáticos (extensión): cache primero, con versión de build.
 */

const BUILD_ID = '__BUILD_ID__';
const CACHE = `gara-g-${BUILD_ID}`;
const STATIC_ASSETS = ['/manifest.json', '/icons/icon-192x192.png', '/icons/icon-512x512.png'];

// Extensiones que sí son inmutables. Solo entra lo que no depende de una sesión.
const STATIC_EXT = /\.(?:js|css|woff2?|png|jpe?g|svg|webp|ico|json|wasm)$/i;

// ── Install: precache app shell ────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {
        /* un asset que falta no debe tumbar el SW */
      })
      .then(() => self.skipWaiting()),
  );
});

// ── Activate: purga TODAS las caches anteriores ───────────────────────────────
// Borra tambien las de sesiones ya abiertas: sus entradas son datos de otro
// usuario y no pueden sobrevivir al despliegue.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ── Message: purga explícita (logout) ──────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'PURGE_CACHES' || event.data === 'GARA_PURGE') {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => (self.registration ? self.registration.update() : undefined)),
    );
  }
});

// ── Sync: Background Sync registration for gara-flush ────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'gara-flush' || event.tag === 'gara-g-offline-sync') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'GARA_FLUSH', tag: event.tag });
        });
      }),
    );
  }
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.protocol !== 'https:') return;
  if (url.hostname !== self.location.hostname) return; // cross-origin

  // API: red, sin cache. Respuestas autenticadas, a veces con Set-Cookie.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnly(request));
    return;
  }

  // Documentos privados: red, sin cache, aunque vengan con Cache-Control publico.
  // La cabecera del Worker no decide esto; si lo hiciera, un documento borrado
  // seguiría vivo en el edge un año y en el navegador indefinidamente.
  if (url.pathname.startsWith('/r2/')) {
    event.respondWith(networkOnly(request));
    return;
  }

  // Navegaciones: red primero y NUNCA cachear. Cubre la landing y las páginas
  // de sesión sin tener que enumerarlas (que es como se colaron).
  if (request.mode === 'navigate') {
    event.respondWith(navigateNetworkFirst(request));
    return;
  }

  // El resto solo si es un asset con extensión: los scripts y estilos.
  if (STATIC_EXT.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Cualquier otra cosa (favicon sin extensión, rutas raras): pasa de largo.
});

/** Red, sin tocar la caché. Devuelve 503 explícito si no hay red. */
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return jsonError(503, 'offline');
  }
}

/**
 * Navegaciones: primero la red. Si no hay red, se sirve la landing cacheada
 * como último recurso; cualquier otra respuesta va Straight to network.
 */
async function navigateNetworkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    const shell = await caches.match('/');
    return shell || htmlError(503, 'Offline — sin conexión');
  }
}

/** Assets inmutables: cache primero, con escritura al vuelo. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

function jsonError(status, error) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function htmlError(status, message) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
