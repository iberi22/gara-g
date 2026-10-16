import { DEFAULT_INSTANCE_ID } from './lib/domain.config';
import { defineMiddleware } from 'astro:middleware';
import type { APIContext, MiddlewareNext } from 'astro';
/**
 * src/middleware.ts — Inicializa D1Adapter + auth + RBAC en /fleet/* y /api/fleet/*.
 *
 * - D1: preferida, fallback a Memory adapter.
 * - Auth: cookie session leída vía src/pages/api/fleetApi/auth.ts (KV SESSION lookup).
 * - PUBLIC_DEMO: flag (env, default false). Si es true, /fleet* es de acceso público demo.
 *   Si es false, /fleet* exige sesión con redirect 303 a /login.
 * - RBAC: para /api/fleet/* se valida can(role, entity, action) aquí mismo (defense in depth).
 * - /api/ai/*: NUNCA es público sin gate de tier (mantiene HTTP 402 para free/no autenticado),
 *   independiente del flag PUBLIC_DEMO.
 */
import { env } from 'cloudflare:workers';
import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { withSecurityHeaders } from './lib/securityHeaders.js';
import { getMemoryAdapter, initD1Adapter, setStorageAdapter } from './lib/domain.js';
import { can, rbacEntityFor } from './lib/rbac.js';
import { ONBOARDED_COOKIE, ONBOARDING_PATH } from './lib/prefs.config';
import { pinTenant } from './lib/staging';
import { isRouteHidden } from './lib/features';
import { clientTenantMismatch } from './lib/fleetApi';
import { isCloudPublicPath } from './cloud';
import {
  APP_HOME,
  APP_SEEN_COOKIE,
  GUEST_BLOCKED_PATH,
  GUEST_COOKIE,
  GUEST_COOKIE_VALUE,
  LANDING_QUERY,
  LOCAL_INSTANCE_ID,
  MODE_COOKIE_MAX_AGE,
  isGuestAllowedPath,
} from './lib/appMode';
import {
  type SessionUser,
  getSessionUser,
  getUserFromRequest,
} from './lib/session.js';

type Env = {
  SWAL_D1?: D1Database;
  SESSION?: KVNamespace;
  SWAL_KV?: KVNamespace;
  PUBLIC_DEMO?: string | boolean;
  /** 'production' cierra PUBLIC_DEMO. La sesión de admin de desarrollo además exige
   *  DEV_ADMIN_SESSION="true" y ENVIRONMENT development/local (src/lib/session.ts). */
  ENVIRONMENT?: string;
  /** Origen real de Xavier para el proxy server-side (ver src/lib/xavier.ts). */
  XAVIER_URL?: string;
};

/**
 * Instancia por defecto cuando la sesion no aporta una. Solo para dev/demo:
 * en produccion el instanceId sale de la sesion (ver Tarea P0-3 del plan).
 */
const DEMO_INSTANCE_ID = DEFAULT_INSTANCE_ID;

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/register',
  // Pedir el enlace de acceso no requiere sesion: es la puerta de entrada.
  // El endpoint no filtra si el email existe, asi que abrirlo no da información.
  '/api/auth/magic-request',
  // El canje del token tampoco: el token ES la credencial, y va en la URL.
  '/api/auth/magic',
  // Respaldo cifrado de extremo a extremo: la credencial es el token derivado del codigo
  // de respaldo (Authorization), no la sesion. El servidor solo guarda texto cifrado.
  '/api/sync',
  // Servidores ICE/TURN de la malla: V2V y marketplace funcionan sin cuenta (invitado). Solo
  // entrega credenciales efimeras de relay, acotadas por IP; ninguna otra API se abre.
  '/api/mesh/ice',
  // La landing de marketing es publica por diseño (src/pages/index.astro lo
  // declara así en su docstring) y está prerenderizada: sin esta entrada el
  // prerender la convertía en un stub de redirección a /login y el bundle
  // perdía 25 KB de landing. El fallo cerrado aplica al resto del sitio.
  '/',
];

/**
 * Rutas que exigen sesion.
 *
 * El guard se escribio al reves durante meses: la autenticacion solo se exigia
 * dentro de `if (pathname === '/fleet' || pathname.startsWith('/fleet/'))`, de
 * modo que cualquier pagina fuera de /fleet* pasaba sin comprobar nada. Las
 * cuatro que quedaron fuera (/alerts, /telemetry, /documents, /fleets)
 * devolvian 200 sin sesion en produccion, y /alerts renderizaba el Instance ID
 * del tenant en la pagina publica.
 *
 * Ahora manda la lista blanca: PUBLIC_PATHS es lo unico publico y todo lo demas
 * necesita sesion. Una pagina nueva nace protegida, que es la unica direccion
 * en la que un olvido no sea un agujero.
 *
 * PUBLIC_DEMO sigue mandando sobre /fleet* y es el unico modo en que una ruta
 * protegida se sirve sin sesion. Ver isPublicDemoEnabled.
 */
function requiereSesion(pathname: string): boolean {
  // Webhooks firmados del modulo cloud (src/cloud): publicos SOLO con el modulo activo
  // (GARA_CLOUD=1). La credencial es la firma, que valida el propio handler.
  if (isCloudPublicPath(pathname)) return false;
  return !PUBLIC_PATHS.some((p) => {
    if (pathname === p) return true;
    // Prefijo de segmento, no de cadena: '/fleet' cubre '/fleet/x' pero no
    // '/fleetx'. '/' es el unico caso especial: sin barra al final seria el
    // prefijo de todas las rutas y dejaria el sitio entero publico, que es
    // justo el fallo que esta allowlist viene a cerrar.
    if (p === '/') return pathname === '/';
    const base = p.endsWith('/') ? p : `${p}/`;
    return pathname.startsWith(base);
  });
}

/**
 * Paginas publicas SIN fijar tenant: /fleet/bienvenida es a donde lleva la CTA de la landing
 * ("Empezar sin cuenta"), asi que tiene que abrirse sin sesion y sin cookie. No va en
 * PUBLIC_PATHS porque con sesion SI necesita el tenant (lee las preferencias del usuario).
 */
function esBienvenida(pathname: string): boolean {
  return pathname === ONBOARDING_PATH || pathname === `${ONBOARDING_PATH}/`;
}

function esPaginaFleet(pathname: string): boolean {
  return pathname === '/fleet' || pathname.startsWith('/fleet/');
}

// Entities extraídas del path /api/fleet/<entity>
function extractEntityFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/api\/fleet\/([^/?]+)/);
  return m ? m[1] : null;
}

/**
 * ¿Esta el modo demo publico activo?
 *
 * Solo puede venir del entorno, y solo fuera de produccion. Ni la query ni una
 * cabecera pueden activarlo: con ellas, `?public_demo=true` abria `/fleet/*`
 * entero sin sesion y servia las placas de todos los tenants (12 placas
 * filtradas en produccion el 2026-10-01).
 */
function isPublicDemoEnabled(): boolean {
  let environment: string | undefined;
  try {
    environment = (env as unknown as Env).ENVIRONMENT as string | undefined;
  } catch {
    /* sin env: seguimos con process.env */
  }
  if (environment === undefined && typeof process !== 'undefined') {
    environment = process.env.ENVIRONMENT;
  }
  if (environment === 'production') return false;

  let demo: unknown;
  try {
    demo = (env as unknown as Env).PUBLIC_DEMO;
  } catch {
    /* sin env: seguimos con process.env */
  }
  if (demo === undefined && typeof process !== 'undefined') {
    demo = process.env.PUBLIC_DEMO;
  }

  return demo === 'true' || demo === '1' || demo === true;
}

function isProduction(): boolean {
  try {
    if ((env as unknown as Env).ENVIRONMENT === 'production') return true;
  } catch {
    /* sin env */
  }
  return typeof process !== 'undefined' && process.env.ENVIRONMENT === 'production';
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Cabeceras de seguridad (HSTS, nosniff, Referrer-Policy, X-Frame-Options,
  // Permissions-Policy) sobre TODA respuesta: exito, redirect 303, 401/403/404/402 y
  // errores. Por eso el envoltorio va por fuera del handler: los `return` tempranos de
  // abajo (auth, demo, RBAC) no pasarian por aqui si no.
  //
  // La CSP la pone Astro (`security.csp` en astro.config.mjs) con los hashes de los
  // scripts inline; esto solo respeta la que venga y cubre con una de respaldo lo que no
  // pasa por ahi (404/500 del framework y respuestas no-HTML).
  //
  // Excepcion: los documentos del vault (GET /r2/...?inline=1) se embeben en un <iframe>
  // del propio origen en el lector de manuales, asi que para esa ruta el framing se limita
  // a `'self'`/SAMEORIGIN en vez de `'none'`/DENY. Ver src/lib/securityHeaders.ts.
  const { pathname } = context.url;
  const sameOriginFraming = pathname === '/r2' || pathname.startsWith('/r2/');
  return withSecurityHeaders(await handleRequest(context, next), {
    sameOriginFraming,
    dev: import.meta.env.DEV,
  });
});

async function handleRequest(context: APIContext, next: MiddlewareNext): Promise<Response> {
  const { pathname } = context.url;

  // --- D1 init ---
  try {
    const d1 = (env as unknown as Env).SWAL_D1;
    if (d1) {
      initD1Adapter(d1);
    } else {
      setStorageAdapter(getMemoryAdapter());
    }
  } catch {
    setStorageAdapter(getMemoryAdapter());
  }

  // --- FLEET_ONLY: modulos fuera de la entrega (Mercado, Wallet, DePIN, V2V) ---
  // Antes que la autenticacion y con 404, no 401/403: con o sin sesion la respuesta es la
  // misma y no se anuncia que la ruta existe. Ver src/lib/features.ts.
  if (isRouteHidden(pathname)) {
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ ok: false, error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // --- AI tier gate for /api/ai/* ---
  if (pathname.startsWith('/api/ai/')) {
    const token = context.cookies.get('session')?.value ?? '';
    const user = token ? await getSessionUser(token) : null;
    const tierHeader = context.request.headers.get('x-tier-id');

    // Requests with free tier or no session/credits return 402 Payment Required
    if (!user || user.role === 'free' || tierHeader === 'free') {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Inferencia AI requiere suscripción Pro/PAYG (Free tier agotado o no permitido)',
          code: 402,
        }),
        {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  }

  // --- Auth guard: todo lo que no sea PUBLICO exige sesion ---
  const token = context.cookies.get('session')?.value ?? '';
  if (token) {
    const user = await getSessionUser(token);
    if (user) {
      // En el stage el tenant se reescribe a `gara-staging` ANTES de tocar locals.
      // Todo lo que lee el tenant sale de aqui (locals.tenant en /fleet*, /r2/*,
      // /api/garage/*), asi que este es el unico punto donde hay que fijarlo.
      //
      // Sin esto, una cookie de sesion de PRODUCCION — que es valida aqui, porque el
      // namespace KV SESSION es el mismo en los dos Workers — traeria su
      // instanceId de produccion y las escrituras del stage caerian sobre la flota
      // real. Ver src/lib/staging.ts.
      (context.locals as any).user = { ...user, instanceId: pinTenant(user.instanceId) };
    }
  }

  // --- Modo de uso ---
  // La sesion manda: con sesion valida el modo es `cloud` aunque quede la cookie de invitado.
  const sessionAtStart = (context.locals as any).user as SessionUser | undefined;
  const cookieHeader = context.request.headers.get('cookie') ?? '';
  const guestCookie = context.cookies.get(GUEST_COOKIE)?.value === GUEST_COOKIE_VALUE;
  const isGuest = !sessionAtStart && guestCookie;
  if (sessionAtStart) (context.locals as any).mode = 'cloud';
  else if (isGuest) (context.locals as any).mode = 'guest';
  const seenCookie = context.cookies.get(APP_SEEN_COOKIE)?.value;
  const hasSeen = Boolean(seenCookie) || /(?:^|;\s*)gara_app=/.test(cookieHeader);
  const isGet = context.request.method === 'GET';

  // --- Portada: quien ya usa la app no vuelve a verla (salvo con ?inicio) ---
  if (isGet && pathname === '/' && !context.url.searchParams.has(LANDING_QUERY)) {
    if (sessionAtStart) return context.redirect(APP_HOME.cloud, 303);
    if (guestCookie) return context.redirect(APP_HOME.guest, 303);
    // Tuvo cuenta y la sesion expiro (sin cookie de modo local): al login.
    if (hasSeen) return context.redirect(`/login?redirect=${encodeURIComponent(APP_HOME.cloud)}`, 303);
  }

  if (isGuest && !pathname.startsWith('/api/') && requiereSesion(pathname)) {
    // Invitado: solo las paginas de GUEST_ALLOWED_PATHS, con el tenant fijo local (nunca
    // uno real). El resto explica que necesita cuenta. Las APIs siguen exigiendo sesion.
    if (!isGuestAllowedPath(pathname)) {
      // Las barras van sin codificar (?from=/fleet/vehicles): son validas en una query y se leen mejor.
      return context.redirect(`${GUEST_BLOCKED_PATH}?from=${encodeURIComponent(pathname).replaceAll('%2F', '/')}`, 303);
    }
    (context.locals as any).tenant = { instanceId: LOCAL_INSTANCE_ID };
  } else if (requiereSesion(pathname)) {
    const isFleet = pathname === '/fleet' || pathname.startsWith('/fleet/');
    // PUBLIC_DEMO abre /fleet* y nada mas: es el unico camino por el que una
    // ruta protegida se sirve sin sesion. No aplica a /alerts ni al resto.
    const isDemo = isFleet && isPublicDemoEnabled();
    const sinSesionPublica = esBienvenida(pathname) && !(context.locals as any).user;
    if (!isDemo && !sinSesionPublica) {
      const currentToken = context.cookies.get('session')?.value ?? '';
      const user = currentToken ? await getSessionUser(currentToken) : null;
      if (!user) {
        // Una API que responde con un 303 a /login rompe a su cliente: fetch no
        // sigue la redireccion y el cuerpo no es JSON. Se devuelve 401 y la
        // pagina 303, que es lo que cada uno espera.
        if (pathname.startsWith('/api/')) {
          return new Response(JSON.stringify({ ok: false, error: 'No autenticado' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return context.redirect(`/login?redirect=${encodeURIComponent(pathname)}`, 303);
      }
      // El tenant se expone aqui, y no solo dentro de la rama de /api/fleet/,
      // porque `pages/r2/[...path].ts` lo lee de `locals.tenant` y /r2/* nunca
      // pasa por esa rama: con el tenant solo en /api/fleet/, el vault
      // devolvia 403 siempre. Aqui la sesion ya esta validada.
      (context.locals as any).user = user;
      (context.locals as any).tenant = {
        // authenticate() escribe instanceId en toda sesion nueva. Este fallback
        // solo cubre sesiones antiguas, de antes del fix.
        instanceId: pinTenant(user.instanceId ?? DEMO_INSTANCE_ID),
      };
    }
  }

  // --- API auth + RBAC for /api/fleet/<entity> (defense in depth) ---
  if (pathname.startsWith('/api/fleet/')) {
    const segment = extractEntityFromPath(pathname);
    if (segment) {
      // 'files' y 'upload' no son entidades: son rutas sobre 'document'. Sin esta
      // traduccion, can() buscaba ('files','create') y devolvía false para todos
      // los roles, y subir un documento respondía 403 siempre. Ver RBAC_PATH_ALIASES.
      const entity = rbacEntityFor(segment) ?? segment;
      const user = await getUserFromRequest(context.request);
      if (!user) {
        return new Response(JSON.stringify({ ok: false, error: 'No autenticado' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Determine action from method
      const method = context.request.method.toUpperCase();
      const action =
        method === 'GET'
          ? 'read'
          : method === 'POST'
            ? 'create'
            : method === 'PATCH' || method === 'PUT'
              ? 'update'
              : method === 'DELETE'
                ? 'delete'
                : 'read';
      if (!can(user.role, entity, action)) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: `Rol ${user.role} no autorizado para ${action} en ${entity}`,
          }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      // --- Aislamiento multi-tenant ---
      // La PK de D1 es (instance_id, entity, id): el instanceId decide qué filas ve el
      // usuario. Se expone en `locals.tenant` desde la sesión para que
      // src/lib/fleetApi.ts:resolveInstanceId() NUNCA tenga que leerlo del cliente
      // (`?instanceId=` / `x-instance-id`), que permitiría leer la flota de otro
      // cliente cambiando un parámetro. Ver tests/tenancy-isolation.test.ts.
      //
      // `DEMO_INSTANCE_ID` queda solo como red de seguridad para sesiones que
      // vinieran sin tenant (p. ej. las de demo). En producción authenticate()
      // SIEMPRE lo escribe, así que este fallback no debería activarse; si se
      // activa, es que hay una sesión vieja y conviene notarlo.
      const sessionTenant = pinTenant(user.instanceId ?? DEMO_INSTANCE_ID);
      // Un `instanceId` que mande el cliente (query, cabecera o cuerpo) ya no se ignora en
      // silencio: si no es el de la sesion, la peticion es un intento de leer o escribir la
      // flota de otro cliente y se rechaza con 403. Igual al de la sesion, se acepta (las
      // paginas lo envian con el tenant que ya les dio el servidor).
      if (await clientTenantMismatch(context.request, sessionTenant)) {
        return new Response(
          JSON.stringify({ ok: false, error: 'instanceId no corresponde a la sesion' }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      (context.locals as any).tenant = {
        instanceId: sessionTenant,
      };
      (context.locals as any).user = user;
    }
  }

  // --- Onboarding: la primera vez que un usuario entra al dashboard ---
  // Solo en la portada de /fleet (a donde lleva el login) y solo con sesion: los enlaces
  // directos a otras paginas nunca se desvian. La cookie guarda el userId que ya hizo el
  // onboarding en este navegador, para no leer D1 en cada visita; si falta (otro equipo),
  // /fleet/bienvenida consulta las preferencias guardadas y devuelve al usuario aqui.
  const sessionUser = (context.locals as any).user as { userId?: string } | undefined;
  if (
    sessionUser?.userId &&
    context.request.method === 'GET' &&
    (pathname === '/fleet' || pathname === '/fleet/') &&
    context.cookies.get(ONBOARDED_COOKIE)?.value !== sessionUser.userId
  ) {
    return context.redirect(`${ONBOARDING_PATH}?next=${encodeURIComponent(pathname)}`, 303);
  }

  const response = await next();

  // --- Marca de "ya usa la app" ---
  // Con ella (o con sesion) `/` lleva a la app en vez de a la landing. Solo en paginas de
  // /fleet que respondieron bien, y solo para quien tiene sesion o modo local.
  if (
    isGet &&
    !hasSeen &&
    esPaginaFleet(pathname) &&
    (sessionAtStart || isGuest) &&
    response.status >= 200 &&
    response.status < 300
  ) {
    const secure = context.url.protocol === 'https:' || isProduction() ? '; Secure' : '';
    try {
      response.headers.append(
        'Set-Cookie',
        `${APP_SEEN_COOKIE}=1; Max-Age=${MODE_COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`,
      );
    } catch {
      /* cabeceras inmutables: la marca se fijara en la proxima visita */
    }
  }

  return response;
}
