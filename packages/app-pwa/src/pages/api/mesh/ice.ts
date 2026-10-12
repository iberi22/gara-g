/**
 * GET /api/mesh/ice — Servidores ICE (STUN + TURN) para las conexiones WebRTC de la malla.
 *
 * Por que: detras de NAT de operador (CGNAT, redes moviles) STUN no basta y el par a par no
 * abre; hace falta un relay TURN. Se usa Cloudflare TURN (1 000 GB/mes de salida gratis, luego
 * 0,05 USD/GB), asi que las credenciales NO se reparten sin limite.
 *
 * Contrato: SIEMPRE 200 `{ ok, iceServers, ttl, relay }` con `Cache-Control: no-store`. Nunca
 * 5xx: si la malla no consigue TURN sigue funcionando con STUN, como antes.
 *   - Sin secretos TURN_KEY_ID / TURN_KEY_API_TOKEN (aun no creados) -> STUN publico de
 *     Cloudflare y `relay:false`. En cuanto se definan los secretos, se activa solo.
 *   - Limitador MESH_ICE_LIMITER (10/min por IP, ver normalize-wrangler-config.mjs): si dice
 *     que no, STUN-only (falla cerrado a STUN, no 429/503). Sin binding (dev) no limita.
 *   - La llamada a Cloudflare tiene timeout (3 s); error, timeout o respuesta rara -> STUN-only.
 *   - Credenciales con TTL de 1 h. El token de la API de TURN nunca se devuelve ni se registra.
 *
 * Acceso: publico a proposito (V2V y marketplace funcionan sin cuenta); el middleware lo lista
 * en PUBLIC_PATHS. No entrega nada sensible: credenciales efimeras de relay, acotadas por IP.
 *
 * Secretos (opcionales): `wrangler secret put TURN_KEY_ID` y `wrangler secret put TURN_KEY_API_TOKEN`.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

export const ICE_TTL_SECONDS = 3600;
export const ICE_UPSTREAM_TIMEOUT_MS = 3000;
export const STUN_ONLY = [{ urls: 'stun:stun.cloudflare.com:3478' }];

type Limiter = { limit(opts: { key: string }): Promise<{ success: boolean }> };
interface IceEnv {
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  MESH_ICE_LIMITER?: Limiter;
}

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function reply(iceServers: unknown[], relay: boolean): Response {
  return new Response(JSON.stringify({ ok: true, iceServers, ttl: ICE_TTL_SECONDS, relay }), {
    status: 200,
    headers: HEADERS,
  });
}

const stunOnly = () => reply(STUN_ONLY, false);

/** Deja solo entradas con forma de RTCIceServer (urls string|string[], username/credential string). */
function sanitize(raw: unknown): Record<string, unknown>[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const out: Record<string, unknown>[] = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const { urls, username, credential } = s as Record<string, unknown>;
    const okUrls = typeof urls === 'string' || (Array.isArray(urls) && urls.length > 0 && urls.every((u) => typeof u === 'string'));
    if (!okUrls) continue;
    const entry: Record<string, unknown> = { urls };
    if (typeof username === 'string') entry.username = username;
    if (typeof credential === 'string') entry.credential = credential;
    out.push(entry);
  }
  return out;
}

export const GET: APIRoute = async ({ request }) => {
  const e = env as unknown as IceEnv;
  const keyId = typeof e.TURN_KEY_ID === 'string' ? e.TURN_KEY_ID.trim() : '';
  const token = typeof e.TURN_KEY_API_TOKEN === 'string' ? e.TURN_KEY_API_TOKEN.trim() : '';
  if (!keyId || !token) return stunOnly();

  try {
    if (e.MESH_ICE_LIMITER) {
      const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
      const { success } = await e.MESH_ICE_LIMITER.limit({ key: ip });
      if (!success) return stunOnly();
    }

    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: ICE_TTL_SECONDS }),
        signal: AbortSignal.timeout(ICE_UPSTREAM_TIMEOUT_MS),
      },
    );
    if (!res.ok) return stunOnly();
    const data = (await res.json()) as { iceServers?: unknown };
    const iceServers = sanitize(data?.iceServers);
    const hasTurn = iceServers.some((s) => typeof s.credential === 'string');
    return hasTurn ? reply(iceServers, true) : stunOnly();
  } catch {
    return stunOnly(); // timeout, red o JSON invalido: sin detalles ni el token en logs
  }
};
