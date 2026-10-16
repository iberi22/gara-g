/**
 * tests/security-headers.test.ts — cabeceras de seguridad en toda respuesta del Worker.
 *
 * Contexto (2026-10-15): gara-g.swal.network no enviaba ni CSP ni HSTS. Ahora:
 *   - Astro emite la CSP de cada pagina con los hashes de sus scripts inline
 *     (`security.csp`, ver tests/csp-inline-hashes.test.ts para el emparejamiento),
 *   - el middleware pone las cabeceras fijas en TODAS las respuestas (exito, redirect 303,
 *     401/403/404 y JSON) y una CSP de respaldo donde Astro no llega,
 *   - los assets estaticos las llevan por `public/_headers`.
 *
 * Aqui se comprueba, con el middleware real y un `next()` simulado, que:
 *   - las cabeceras fijas salen en todas las respuestas,
 *   - la CSP que ya viene puesta NO se pisa (la del vault, con `sandbox`),
 *   - el respaldo no lleva `'unsafe-eval'` ni `'unsafe-inline'` en `script-src`,
 *   - `public/_headers` no se desincroniza de SECURITY_HEADERS.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';

import { onRequest } from '../src/middleware.js';
import { cspConfig, cspDirectives, signalOriginsFrom } from '../src/lib/csp.js';
import {
  CLOUDFLARE_INSIGHTS_BEACON_ORIGIN,
  CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN,
  CSP_HTML_FALLBACK,
  CSP_NONE,
  CSP_SERVICE_WORKER,
  SECURITY_HEADERS,
  withSecurityHeaders,
} from '../src/lib/securityHeaders.js';

const envMock = env as unknown as Record<string, unknown>;
const APP = 'https://gara-g.swal.network';

function ctx(path: string, init: RequestInit = {}) {
  const cookie = (init.headers as Record<string, string>)?.cookie ?? '';
  const jar = Object.fromEntries(
    cookie
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k, v]) => k && v),
  ) as Record<string, string>;
  return {
    url: new URL(`${APP}${path}`),
    request: new Request(`${APP}${path}`, init),
    cookies: { get: (k: string) => (jar[k] ? { value: jar[k] } : undefined) },
    locals: {} as Record<string, unknown>,
    redirect: (to: string, code: number) => new Response(null, { status: code, headers: { Location: to } }),
  } as any;
}

const json = async () =>
  new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });

/** Una pagina SSR como la que devuelve Astro: ya con SU cabecera de CSP. */
const htmlWithCsp = (csp: string) => async () =>
  new Response('<!doctype html><html><body>hola</body></html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': csp },
  });

beforeEach(() => {
  envMock.ENVIRONMENT = 'production';
  delete envMock.SWAL_D1;
  delete envMock.PUBLIC_DEMO;
});

describe('cabeceras de seguridad', () => {
  it('una pagina HTML sale con HSTS, nosniff, Referrer-Policy, X-Frame-Options y Permissions-Policy', async () => {
    // Como en el build: en `astro dev` (y en vitest) DEV es true y el HTML de dev va sin
    // X-Frame-Options ni CSP; ver el describe de modo dev.
    vi.stubEnv('DEV', false);
    const res = await onRequest(ctx('/login'), async () => new Response('<html>hola</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }));
    vi.unstubAllEnvs();
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains; preload');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    // geolocation: la posicion del vehiculo (V2V) y el buscador del mercado dependen de ella.
    expect(res.headers.get('Permissions-Policy')).toBe('camera=(self), geolocation=(self), microphone=()');
    expect(await res.text()).toContain('hola');
  });

  it('la CSP que emite Astro no se toca (es la que lleva los hashes)', async () => {
    const politica = "default-src 'self'; script-src 'self' 'sha256-abc123='; frame-ancestors 'none'";
    const res = await onRequest(ctx('/login'), htmlWithCsp(politica));
    expect(res.headers.get('Content-Security-Policy')).toBe(politica);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('si un HTML llega sin CSP se le pone el respaldo, sin unsafe-inline', async () => {
    // Como en el build: en dev (`astro dev`, y vitest) el HTML va sin respaldo.
    vi.stubEnv('DEV', false);
    const res = await onRequest(ctx('/login'), async () => new Response('<html>404</html>', {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
    }));
    vi.unstubAllEnvs();
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toBe(CSP_HTML_FALLBACK);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('unsafe-inline');
  });

  it('el redirect del guard de sesion tambien sale con las cabeceras', async () => {
    const res = await onRequest(ctx('/fleet'), async () => new Response('NEXT', { status: 200 }));
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toContain('/login');
    expect(res.headers.get('Strict-Transport-Security')).toBe(SECURITY_HEADERS['Strict-Transport-Security']);
    // Sin sesion, /fleet redirige antes de renderizar: es una respuesta sin HTML.
    expect(res.headers.get('Content-Security-Policy')).toBe(CSP_NONE);
  });

  it('una API JSON sale con la politica cerrada (no carga subrecursos)', async () => {
    const res = await onRequest(
      ctx('/api/fleet/vehicle', { headers: { cookie: 'session=token-falso' } }),
      json,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('Content-Security-Policy')).toBe(CSP_NONE);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('nunca aparece unsafe-eval, ni unsafe-inline en script-src', () => {
    for (const politica of [CSP_HTML_FALLBACK, CSP_NONE, cspDirectives().join('; ')]) {
      expect(politica).not.toContain('unsafe-eval');
    }
    expect(CSP_HTML_FALLBACK).not.toContain('unsafe-inline');
    expect(CSP_NONE).not.toContain('unsafe');
    const scriptSrc = CSP_HTML_FALLBACK.split('; ').find((d) => d.startsWith('script-src')) ?? '';
    expect(scriptSrc).not.toContain('unsafe-inline');
  });

  it('las directivas llevan los origenes del inventario y ninguno de mas', () => {
    const csp = cspDirectives().join('; ');
    expect(csp).toContain('https://0.peerjs.com');
    expect(csp).toContain('wss://0.peerjs.com');
    // Cloudflare Web Analytics (inyectado en el edge): el beacon carga de
    // static.cloudflareinsights.com y mide a cloudflareinsights.com.
    expect(csp).toContain(CLOUDFLARE_INSIGHTS_BEACON_ORIGIN);
    expect(CSP_HTML_FALLBACK).toContain(CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN);
    // Xavier se habla por /api/xavier (mismo origen): no es un origen del navegador.
    expect(csp).not.toContain('xavier.swal.network');
    // Es de Fi'ze; en esta app no aparece.
    expect(csp).not.toContain('gos.swal.network');
    // Surreal/edge-hive es codigo muerto (src/lib/surreal.ts no lo importa nadie).
    expect(csp).not.toContain('edge.swal.dev');
    // Inventario cerrado: fuera de la senalizacion y los dos hosts de Cloudflare Web
    // Analytics no hay ningun otro origen externo.
    const hosts = new Set(
      [...csp.matchAll(/(?:https?|wss):\/\/[^\s'";]+/g)].map((m) => m[0]),
    );
    expect([...hosts].sort()).toEqual(
      [
        'https://0.peerjs.com',
        'wss://0.peerjs.com',
        CLOUDFLARE_INSIGHTS_BEACON_ORIGIN,
      ].sort(),
    );
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("frame-src 'self'");
  });

  it('la CSP permite el beacon de Cloudflare Web Analytics y nada mas', () => {
    // script-src del respaldo: 'self' + el script del beacon, sin inline ni comodines.
    const scriptSrc = CSP_HTML_FALLBACK.split('; ').find((d) => d.startsWith('script-src')) ?? '';
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain(CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN);
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('*');
    // connect-src: 'self' + senalizacion + el endpoint del beacon.
    const connectSrc = cspDirectives().join('; ').split('; ').find((d) => d.startsWith('connect-src')) ?? '';
    expect(connectSrc).toContain(CLOUDFLARE_INSIGHTS_BEACON_ORIGIN);
    expect(connectSrc).not.toContain('*');
    // security.csp de Astro: mismos recursos ('self' se repite porque `resources`
    // sobreescribe el defecto de Astro) y la lista de hashes intacta.
    const config = cspConfig();
    expect(config.scriptDirective.resources).toEqual(["'self'", CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN]);
    expect(config.scriptDirective.hashes.length).toBeGreaterThanOrEqual(9);
  });

  it('el origen de senalizacion configurado en el build entra en connect-src', () => {
    const csp = cspDirectives('https://mesh.swal.network/').join('; ');
    expect(csp).toContain('https://mesh.swal.network');
    expect(csp).toContain('wss://mesh.swal.network');
    // Sin configurar manda el broker publico por defecto de PeerJS, y solo ese.
    const porDefecto = cspDirectives(undefined).join('; ');
    expect(porDefecto).toContain('https://0.peerjs.com');
    expect(porDefecto).not.toContain('mesh.swal.network');
    // Una senalizacion en LAN (http/ws) es valida, pero solo la que se configure.
    expect(signalOriginsFrom('http://192.168.1.20:4444')).toEqual([
      'http://192.168.1.20:4444',
      'ws://192.168.1.20:4444',
    ]);
    expect(signalOriginsFrom('no-es-una-url')).toEqual([]);
    expect(signalOriginsFrom('ftp://host/x')).toEqual([]);
    expect(signalOriginsFrom(undefined)).toEqual([]);
  });

  it('el literal del broker por defecto coincide con src/mesh/node.ts', () => {
    const fuente = readFileSync(join(process.cwd(), 'src', 'mesh', 'node.ts'), 'utf-8');
    expect(fuente).toContain("export const DEFAULT_SIGNAL_URL = 'https://0.peerjs.com/'");
    expect(cspDirectives().join('; ')).toContain('https://0.peerjs.com');
  });

  it('public/_headers no se desincroniza de SECURITY_HEADERS', () => {
    const headers = readFileSync(join(process.cwd(), 'public', '_headers'), 'utf-8');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(headers, `falta ${name} en public/_headers`).toContain(`${name}: ${value}`);
    }
    expect(headers).toContain(`Content-Security-Policy: ${CSP_NONE}`);
  });

  it('ninguna plantilla .astro usa manejadores en atributos (la CSP los bloquea)', () => {
    // `onsubmit="return confirm(...)"` bloqueado = el formulario de borrar se envia sin
    // preguntar. Para eso esta `data-confirm` (src/lib/confirmSubmit.ts).
    const dir = join(process.cwd(), 'src');
    const astro = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith('.astro'));
    const con = astro.filter((f) => /\son[a-z]+=("|'|\{`)/.test(readFileSync(join(dir, f), 'utf-8')));
    expect(con).toEqual([]);
  });

  it('public/_headers: la CSP va por ruta y no cierra los fetch() de los workers', () => {
    const texto = readFileSync(join(process.cwd(), 'public', '_headers'), 'utf-8');
    const bloques = new Map<string, Record<string, string>>();
    let ruta = '';
    for (const linea of texto.split('\n')) {
      if (!linea.trim() || linea.trimStart().startsWith('#')) continue;
      if (!/^\s/.test(linea)) {
        ruta = linea.trim();
        bloques.set(ruta, {});
        continue;
      }
      const [nombre, ...valor] = linea.trim().split(':');
      bloques.get(ruta)![nombre.trim()] = valor.join(':').trim();
    }
    // Cloudflare concatena valores repetidos: una CSP en `/*` se sumaria a la de cada ruta.
    expect(bloques.get('/*')?.['Content-Security-Policy']).toBeUndefined();
    expect(bloques.get('/sw.js')?.['Content-Security-Policy']).toBe(CSP_SERVICE_WORKER);
    expect(CSP_SERVICE_WORKER).toContain("default-src 'self'");
    // Los bundles pueden arrancar Web Workers (motor de IA local): sin CSP propia.
    const deAstro = [...bloques.keys()].filter((r) => r.startsWith('/_astro'));
    expect(deAstro).toEqual([]);
    for (const r of ['/favicon.svg', '/icons/*', '/manifest.json']) {
      expect(bloques.get(r)?.['Content-Security-Policy'], r).toBe(CSP_NONE);
    }
  });
});

describe('modo dev (astro dev no emite security.csp)', () => {
  it('el HTML de dev no recibe la CSP de respaldo ni X-Frame-Options (iframe del ClientRouter)', () => {
    const res = withSecurityHeaders(
      new Response('<!doctype html><script>1</script>', { headers: { 'Content-Type': 'text/html' } }),
      { dev: true },
    );
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
    // `astro dev` mete la pagina destino en un iframe del mismo origen para preparar los
    // componentes `client:only` (ClientRouter): con DENY la navegacion SPA no termina.
    expect(res.headers.get('X-Frame-Options')).toBeNull();
    expect(res.headers.get('Strict-Transport-Security')).toBe(SECURITY_HEADERS['Strict-Transport-Security']);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('en dev el JSON sigue cerrado y en produccion el HTML lleva el respaldo', () => {
    const json = withSecurityHeaders(
      new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
      { dev: true },
    );
    expect(json.headers.get('Content-Security-Policy')).toBe(CSP_NONE);
    const html = withSecurityHeaders(new Response('<p>x</p>', { headers: { 'Content-Type': 'text/html' } }));
    expect(html.headers.get('Content-Security-Policy')).toBe(CSP_HTML_FALLBACK);
  });
});

describe('framing del vault (/r2/...?inline=1)', () => {
  it('el documento embebido permite el framing propio, no el de terceros', () => {
    const res = withSecurityHeaders(
      new Response('%PDF-1.4', { status: 200, headers: { 'Content-Type': 'application/pdf' } }),
      { sameOriginFraming: true },
    );
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'self'");
    expect(res.headers.get('Content-Security-Policy')).not.toContain("frame-ancestors 'none'");
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('el resto del sitio sigue con frame-ancestors none / X-Frame-Options DENY', () => {
    const res = withSecurityHeaders(
      new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Content-Security-Policy')).toBe(CSP_NONE);
  });

  it('una CSP que ya trae la ruta no se pisa (sandbox del vault)', () => {
    const politica = "default-src 'none'; sandbox";
    const res = withSecurityHeaders(
      new Response('%PDF-1.4', {
        status: 200,
        headers: { 'Content-Type': 'application/pdf', 'Content-Security-Policy': politica },
      }),
      { sameOriginFraming: true },
    );
    expect(res.headers.get('Content-Security-Policy')).toBe(politica);
    expect(res.headers.get('Strict-Transport-Security')).toBe(SECURITY_HEADERS['Strict-Transport-Security']);
  });

  it('el middleware detecta la ruta del vault', async () => {
    // Sin sesion, /r2/... responde 303: lo que se comprueba es que la ruta entra por la
    // rama del framing propio (si el guard cambiara a 200, la CSP del documento tambien).
    const res = await onRequest(
      ctx('/r2/gara-g-default-instance/packs/x.pdf?inline=1'),
      async () => new Response('NEXT', { status: 200 }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'self'");
  });
});
