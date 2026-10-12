/**
 * iceServers.ts — Servidores ICE (STUN/TURN) para los transportes WebRTC, pedidos a
 * GET /api/mesh/ice una vez por sesion de pagina y cacheados en memoria hasta ~80% del ttl.
 *
 * Sin dependencias de edge-mesh (cabe en cualquier bundle). Devuelve `undefined` si no hay
 * relay disponible (endpoint caido, `relay:false`, sin red): el llamador entonces NO pasa
 * `config` a PeerJS y se queda con su comportamiento por defecto (STUN publico de PeerJS).
 */
export interface IceConfig {
  iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
}

const REFRESH_FRACTION = 0.8;
const FETCH_TIMEOUT_MS = 4_000;
const RETRY_AFTER_FAIL_MS = 60_000;

let cached: { value: IceConfig | undefined; until: number } | null = null;
let inflight: Promise<IceConfig | undefined> | null = null;

export function resetIceCache(): void {
  cached = null;
  inflight = null;
}

async function load(fetchImpl: typeof fetch): Promise<IceConfig | undefined> {
  const now = Date.now();
  try {
    const res = await fetchImpl('/api/mesh/ice', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`ice ${res.status}`);
    const body = (await res.json()) as { iceServers?: IceConfig['iceServers']; ttl?: number; relay?: boolean };
    const ttlMs = (typeof body.ttl === 'number' && body.ttl > 0 ? body.ttl : 3600) * 1000;
    const ok = body.relay === true && Array.isArray(body.iceServers) && body.iceServers.length > 0;
    cached = { value: ok ? { iceServers: body.iceServers! } : undefined, until: now + ttlMs * REFRESH_FRACTION };
  } catch {
    // Falla: comportamiento actual y reintento en un minuto (sin martillar el endpoint).
    cached = { value: undefined, until: now + RETRY_AFTER_FAIL_MS };
  }
  return cached.value;
}

/** `config` de RTCPeerConnection con los ICE servers con relay, o `undefined` (sin cambios). */
export async function getIceConfig(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<IceConfig | undefined> {
  if (cached && Date.now() < cached.until) return cached.value;
  inflight ??= load(fetchImpl).finally(() => {
    inflight = null;
  });
  return inflight;
}
