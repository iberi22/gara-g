/**
 * securityHeaders.ts — cabeceras de seguridad de las respuestas del Worker (F12).
 *
 * Antes del 2026-10-15 gara-g.swal.network no enviaba ni CSP ni HSTS: una inyeccion de
 * script en cualquier pagina se ejecutaba sin freno y el sitio se dejaba embeber en un
 * iframe ajeno. Esto lo cierra.
 *
 * --- Reparto de responsabilidades -------------------------------------------------
 *
 * La CSP de verdad la genera Astro por pagina (`security.csp` en astro.config.mjs), con
 * los hashes SHA-256 de cada `<script is:inline>` de la app calculados en el build (ver
 * src/lib/csp.ts): la cabecera la pone el framework en las rutas SSR.
 *
 * Exporta, sin tocar la cabecera si ya viene puesta:
 *   - las cabeceras fijas (HSTS, nosniff, Referrer-Policy, X-Frame-Options,
 *     Permissions-Policy) en TODA respuesta, incluidas las que devuelve el middleware
 *     antes de renderizar (303 del guard de sesion, 401/403/402);
 *   - una CSP de respaldo para lo que no pasa por `security.csp`: los 404/500 que pinta
 *     el framework y las respuestas que no son HTML (JSON de la API, redirecciones). El
 *     respaldo NO lleva `'unsafe-inline'` en `script-src` ni `'unsafe-eval'` en ninguna
 *     parte; en HTML se queda en `script-src 'self'` mas el beacon de Cloudflare Web
 *     Analytics (`static.cloudflareinsights.com`) y en no-HTML se cierra todo.
 *
 * Este modulo corre en el Worker: solo usa `import.meta.env` (sin `node:*`). El calculo de
 * hashes vive en src/lib/csp.ts, que es de build.
 */

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Redundante con `frame-ancestors 'none'` para los navegadores que aun no lo aplican.
  'X-Frame-Options': 'DENY',
  // `geolocation=(self)` no es decorativo: es la posicion del vehiculo en V2V
  // (src/mesh/v2v/v2vNode.ts) y el buscador de talleres del mercado
  // (src/components/mercado/controller.ts). Con `geolocation=()` se apagan las dos.
  'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=()',
};

/**
 * Opciones por respuesta.
 *
 * `sameOriginFraming`: solo para los documentos del vault (`GET /r2/...?inline=1`), que el
 * lector de manuales embebe en un `<iframe>` del MISMO origen
 * (src/components/garage-dossier/DossierManuals.svelte). Con `DENY`/`'none'` el iframe no
 * carga y el manual no se puede leer. El framing de terceros sigue prohibido.
 */
export interface SecurityHeaderOptions {
  sameOriginFraming?: boolean;
  /**
   * `astro dev` no emite `security.csp` (solo el build lo hace) y ademas el ClientRouter
   * carga la pagina destino en un `<iframe>` oculto y DEL MISMO ORIGEN para preparar sus
   * componentes `client:only` (astro/dist/transitions/router.js, `prepareForClientOnlyComponents`,
   * que solo corre bajo `import.meta.env.DEV`). Por eso, en dev y solo para HTML:
   * sin esta bandera el respaldo `script-src 'self'` caeria sobre cada pagina de dev y
   * bloquearia todos sus scripts inline, y `X-Frame-Options: DENY` bloquearia ese iframe
   * (la navegacion SPA del E2E, que corre sobre `astro dev`, se queda a medias). En dev el
   * HTML va sin CSP y sin `X-Frame-Options`, como sin este cambio; JSON y demas respuestas
   * siguen con CSP_NONE y con las cabeceras fijas completas.
   */
  dev?: boolean;
}

/**
 * Origenes externos que el navegador llama de verdad (inventario con `rg` del 2026-10-15).
 *
 * - `https://0.peerjs.com` + `wss://0.peerjs.com`: broker de senalizacion PeerJS por
 *   defecto de la malla (src/mesh/node.ts DEFAULT_SIGNAL_URL). PeerJS usa el HTTP para
 *   pedir el id de peer y el WSS para el socket.
 *
 * - `https://static.cloudflareinsights.com` (script-src) +
 *   `https://cloudflareinsights.com` (connect-src): Cloudflare Web Analytics. Cloudflare
 *   lo inyecta en el edge (`beacon.min.js`), asi que no hay literal en el repo que lo
 *   pida: sin estos dos origenes la CSP que emite Astro desde #44 (`script-src-elem`)
 *   bloquea el beacon y la analitica que funcionaba antes de la CSP se pierde. Solo
 *   estos dos hosts, sin comodines ni 'unsafe-inline'.
 *
 * Fuera, con motivo (inventario completo en el informe de la tarea):
 *   - xavier: el navegador usa `/api/xavier/*` (mismo origen); el salto a Xavier lo da el
 *     Worker (src/pages/api/xavier/_proxy.ts).
 *   - `gos.swal.network`: no aparece ni una vez en esta app (es de Fi'ze).
 *   - `edge.swal.dev`: solo lo menciona src/lib/surreal.ts, que no importa nadie.
 *   - `mesh.swal.network` / `relay.swal.network`: ningun literal en el repo. Si el
 *     despliegue usa senalizacion propia entra por `PUBLIC_MESH_SIGNAL_URL`, que
 *     src/lib/csp.ts anade a `connect-src` en el build (aqui no se puede leer: el
 *     respaldo cubre JSON y paginas de error, donde no hay malla que conectar).
 *   - `rtc.live.cloudflare.com` (TURN): lo llama el Worker en src/pages/api/mesh/ice.ts.
 */
export const DEFAULT_SIGNAL_ORIGINS = ['https://0.peerjs.com', 'wss://0.peerjs.com'];

/**
 * Cloudflare Web Analytics (inyectado por Cloudflare en el edge, sin literal en el
 * repo): el script del beacon y el endpoint al que envia las mediciones. Ver el
 * inventario de arriba.
 */
export const CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN = 'https://static.cloudflareinsights.com';
export const CLOUDFLARE_INSIGHTS_BEACON_ORIGIN = 'https://cloudflareinsights.com';

/** Origenes `https`/`wss` de un servidor de senalizacion PeerJS (HTTP(S) + WS(S)). */
export function signalOriginsFrom(signalUrl?: string): string[] {
  const raw = (signalUrl ?? '').trim();
  if (!raw) return [];
  try {
    const url = new URL(raw);
    // PeerJS habla HTTP(S) para el id de peer y WS(S) para el socket: hacen falta los dos.
    if (url.protocol === 'https:' || url.protocol === 'wss:') {
      return [`https://${url.host}`, `wss://${url.host}`];
    }
    if (url.protocol === 'http:') return [`http://${url.host}`, `ws://${url.host}`];
    return [];
  } catch {
    return [];
  }
}

export function signalOrigins(signalUrl?: string): string[] {
  return [...new Set([...DEFAULT_SIGNAL_ORIGINS, ...signalOriginsFrom(signalUrl)])];
}

/**
 * Directivas fijas. `img-src` lleva `https:` a proposito: la foto del vehiculo
 * (`photoUrl`) y la imagen del anuncio del garage son URLs que teclea el usuario y no se
 * pueden enumerar. Una imagen no ejecuta codigo y el `Referrer-Policy` de arriba evita la
 * fuga de ruta; apretarlo a `'self'` deja la ficha del vehiculo sin foto. Los tiles de
 * OpenStreetMap de Leaflet caen dentro de ese `https:`.
 */
export function cspDirectives(signalUrl?: string): string[] {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    // El lector de manuales embebe GET /r2/... (mismo origen) en un <iframe>.
    "frame-src 'self'",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    `connect-src 'self' ${signalOrigins(signalUrl).join(' ')} ${CLOUDFLARE_INSIGHTS_BEACON_ORIGIN}`,
  ];
}

function frameDirective(options: SecurityHeaderOptions): string {
  return options.sameOriginFraming ? "frame-ancestors 'self'" : "frame-ancestors 'none'";
}

/** HTML que no pasa por `security.csp` (404/500 del framework). */
export const CSP_HTML_FALLBACK = [
  ...cspDirectives(),
  `script-src 'self' ${CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN}`,
  "style-src 'self'",
].join('; ');

/** Respuestas que no son HTML: no cargan subrecursos, asi que se cierra todo. */
export const CSP_NONE = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

/**
 * CSP de `/sw.js`. Un service worker se rige por la CSP de SU propia respuesta, no por la
 * del documento: con CSP_NONE su `connect-src` caeria en `'none'` y cada `fetch()` de
 * public/sw.js (navegaciones, /api/, assets) fallaria en produccion. Solo pide al propio
 * origen (lo de fuera lo deja pasar sin `respondWith`), asi que basta `'self'`.
 */
export const CSP_SERVICE_WORKER = "default-src 'self'; base-uri 'none'";

/** Respaldo segun el tipo de respuesta y si se permite el framing propio (vault /r2/). */
function fallbackCsp(isHtml: boolean, options: SecurityHeaderOptions): string {
  if (!options.sameOriginFraming) return isHtml ? CSP_HTML_FALLBACK : CSP_NONE;
  return isHtml
    ? [...cspDirectives(), `script-src 'self' ${CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN}`, "style-src 'self'", frameDirective(options)].join('; ')
    : `default-src 'none'; ${frameDirective(options)}; base-uri 'none'`;
}

function isHtmlResponse(response: Response): boolean {
  const type = response.headers.get('Content-Type') ?? '';
  return /^text\/html\b/i.test(type);
}

/**
 * Anade las cabeceras de seguridad a una respuesta ya renderizada. La CSP que trae Astro
 * (`security.csp`) NO se toca: se respeta tal cual (incluida la `sandbox` que pone la ruta
 * del vault). Solo se pone una de respaldo si no hay ninguna.
 */
export function withSecurityHeaders(
  response: Response,
  options: SecurityHeaderOptions = {},
): Response {
  const headers = new Headers(response.headers);
  const isHtml = isHtmlResponse(response);
  // En dev el HTML va tambien sin `X-Frame-Options`: el iframe oculto del ClientRouter (ver
  // `dev` arriba) es del mismo origen y `DENY` lo bloquea. En produccion ese iframe no
  // existe (`import.meta.env.DEV` en router.js), asi que la politica estricta no cambia.
  const devHtml = Boolean(options.dev) && isHtml;
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (devHtml && name === 'X-Frame-Options') continue;
    headers.set(name, value);
  }
  if (options.sameOriginFraming) headers.set('X-Frame-Options', 'SAMEORIGIN');
  if (!headers.has('Content-Security-Policy') && !devHtml) {
    headers.set('Content-Security-Policy', fallbackCsp(isHtml, options));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
