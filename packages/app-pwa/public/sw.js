/* Gara-G Service Worker — PWA offline support (app shell local-first)
 *
 * Regla que gobierna este fichero: NADA que dependa de una sesión se guarda
 * indefinidamente, y el HTML de una navegación solo se usa como último recurso
 * cuando la red falla. El SW no sabe si hay cookie ni si el token caducó, así
 * que su caché es un almacén compartido entre usuarios del mismo navegador.
 *
 * Historia: con `cacheFirst` sobre las páginas, las de sesión (/alerts,
 * /telemetry, /documents, /drivers, /geofences, /fuel, /fleets) quedaban
 * servidas para siempre: tras un logout, o en un móvil de flota compartido, el
 * siguiente conductor veía los datos del anterior, y tras un despliegue nuevo
 * se veían las páginas viejas. Por eso las navegaciones dejaron de cachearse,
 * pero entonces recargar /fleet sin red devolvía un 503 y la app local-first
 * no abría. El término medio:
 *
 *   - Navegaciones (HTML): RED PRIMERO. Si la red responde, se guarda una copia
 *     saneada en `PAGES_CACHE` (una caché aparte, versionada por build) y se
 *     sirve la respuesta viva. Si la red falla, se sirve esa copia: la UI
 *     renderiza con los datos locales de IndexedDB. El `Set-Cookie` se elimina
 *     antes de guardar, las redirecciones a otra ruta (p. ej. /login) NO se
 *     guardan bajo la clave de la ruta pedida, y el logout purga la caché
 *     (PURGE_CACHES).
 *   - /api/*: red, nunca cache. Son respuestas autenticadas y deben ser frescas.
 *   - /r2/*: red, nunca cache. Son documentos privados (SOAT, pólizas).
 *   - Assets estáticos (extensión): cache primero, con versión de build.
 *
 * Contexto seguro: además de https, se acepta http en localhost/127.0.0.1
 * (localhost es contexto seguro por spec), que es la única forma de probar el
 * modo offline contra `astro dev` / `astro preview` locales.
 */

const BUILD_ID = '__BUILD_ID__';
const CACHE = `gara-g-static-${BUILD_ID}`;
// El HTML de las navegaciones va en su propia caché: así el `activate` y la
// purga de logout pueden vaciarla sin tocar los assets inmutables.
const PAGES_CACHE = `gara-g-pages-${BUILD_ID}`;
const STATIC_ASSETS = [
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/favicon.svg',
];

// Extensiones que sí son inmutables. Solo entra lo que no depende de una sesión.
const STATIC_EXT = /\.(?:js|css|woff2?|png|jpe?g|svg|webp|ico|json|wasm)$/i;

// Hosts locales (contexto seguro aunque el protocolo sea http).
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// App shell de último recurso cuando la ruta pedida nunca se visitó online.
const OFFLINE_FALLBACK = '/';

// Tope de páginas cacheadas: un móvil de flota puede recorrer decenas de rutas.
const MAX_PAGES = 40;

// ── Install: precache assets + app shell de respaldo ──────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {
        /* un asset que falta no debe tumbar el SW */
      })
      .then(() => warmOfflineFallback())
      .then(() => self.skipWaiting()),
  );
});

/**
 * Guarda el app shell de respaldo (la landing pública, sin datos de sesión).
 * Best-effort: si no hay red durante el install, no pasa nada; la navegación
 * online posterior lo cacheará igual.
 */
async function warmOfflineFallback() {
  try {
    const response = await fetch(OFFLINE_FALLBACK, { credentials: 'same-origin' });
    if (isCacheablePage(response)) {
      const cache = await caches.open(CACHE);
      await cache.put(OFFLINE_FALLBACK, sanitizePage(response.clone()));
    }
  } catch {
    /* sin red al instalar: el respaldo se cacheará en la primera visita */
  }
}

// ── Activate: purga TODAS las caches anteriores ───────────────────────────────
// Borra tambien las de sesiones ya abiertas: sus entradas son datos de otro
// usuario y no pueden sobrevivir al despliegue.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE && k !== PAGES_CACHE).map((k) => caches.delete(k)),
        ),
      )
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
  if (!isSecureContextUrl(url)) return;
  if (url.hostname !== self.location.hostname) return; // cross-origin

  // En http local (dev/preview) el SW solo sirve el shell de navegacion: los
  // assets de Vite (con query, /@fs, /@id) y las APIs se dejan pasar. Dos
  // motivos: sin red su fallo debe seguir siendo el error de red normal del
  // navegador (ERR_INTERNET_DISCONNECTED) y no un 503 sintetico del SW, y las
  // APIs de dev las mockea Playwright con `page.route`, que no ve las peticiones
  // que el SW atiende. En https (produccion) se aplican todas las estrategias.
  if (url.protocol === 'http:' && request.mode !== 'navigate') return;

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

  // Navegaciones: red primero; sin red, el HTML cacheado de esa ruta (o el shell).
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

/** https siempre; http solo en localhost (contexto seguro por spec). */
function isSecureContextUrl(url) {
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
}

/** Red, sin tocar la caché. Devuelve 503 explícito si no hay red. */
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return jsonError(503, 'offline');
  }
}

/**
 * Navegaciones: primero la red. Si responde, se guarda una copia saneada para
 * poder abrir la ruta sin red. Si falla, se sirve la copia cacheada de esa ruta
 * (ignorando la query) y, como último recurso, el app shell de respaldo.
 */
async function navigateNetworkFirst(request) {
  const cache = await caches.open(PAGES_CACHE);
  const key = pageKey(request.url);
  let response;
  try {
    response = await fetch(request);
  } catch {
    const cached = await cache.match(key);
    if (cached) return cached;
    const shell = await caches.match(OFFLINE_FALLBACK);
    return shell || htmlError(503, 'Offline — sin conexión');
  }
  // La escritura en cache va aparte del fetch: si falla (cuota llena), la
  // respuesta viva que el servidor acaba de dar sigue sirviendo.
  if (isCacheablePage(response, request)) {
    try {
      await cache.put(key, sanitizePage(response.clone()));
      await trimCache(cache, MAX_PAGES);
    } catch {
      /* no se pudo guardar el shell; la respuesta viva no se descarta */
    }
  }
  return response;
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

/**
 * Clave estable de una página: la ruta sin query ni hash. `?deleted=…`,
 * `?instanceId=…` o un `?t=` de HMR no crean una entrada distinta del mismo
 * shell; al servir offline se ignora la query, como el
 * `ignoreURLParametersMatching` de Workbox en Fi'ze.
 */
function pageKey(rawUrl) {
  const url = new URL(rawUrl);
  url.search = '';
  url.hash = '';
  return url.toString();
}

/**
 * Solo se guarda una navegación si es un documento HTML propio y completo
 * (200). Si el servidor redirigió a otra ruta (p. ej. /fleet → /login sin
 * sesión), NO se guarda bajo la clave de la ruta pedida: si no, un usuario sin
 * sesión dejaría el login cacheado como si fuera su panel.
 */
function isCacheablePage(response, request) {
  if (!response || response.status !== 200) return false;
  if (response.type !== 'basic' && response.type !== 'default') return false;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return false;
  if (request && response.redirected) {
    const finalPath = new URL(response.url).pathname;
    const requestPath = new URL(request.url).pathname;
    if (finalPath !== requestPath) return false;
  }
  return true;
}

/**
 * El HTML cacheado nunca debe reenviar `Set-Cookie`: la cookie ya se aplicó en
 * la respuesta viva y la copia no es una respuesta autenticada nueva.
 */
function sanitizePage(response) {
  const headers = new Headers(response.headers);
  headers.delete('set-cookie');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Recorta la caché de páginas a `max` entradas (las más antiguas primero). */
async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (const key of keys.slice(0, keys.length - max)) await cache.delete(key);
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
