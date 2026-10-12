/**
 * engine.ts — El MeshPort real sobre edge-mesh, independiente del transporte.
 *
 * node.ts lo monta sobre PeerJS (navegador) y memoryPort.ts sobre el transporte en memoria
 * de edge-mesh (pruebas). Toda la semantica del contrato vive aqui, asi que lo que prueban
 * los tests en memoria es el mismo codigo que corre en produccion:
 *
 * - Cada (red, sala) es un namespace `MESH_ROOM_PREFIX[red] + sala` y tiene SU PROPIO
 *   transporte: dos namespaces nunca comparten pares ni mensajes. Ademas el receptor
 *   descarta todo mensaje cuya red/sala declarada no coincida con el transporte por el
 *   que llego (un par de otra sala no puede inyectar en esta).
 * - Los mensajes viajan como envolventes edge-mesh (`createEnvelope`, tipo GOSSIP). Con
 *   `sign` la envolvente se firma con ML-DSA-65 (`signEnvelope`) y lleva la clave publica
 *   del emisor DENTRO del payload firmado. `verified` es true solo si (a) el id del emisor
 *   es el hash de esa clave publica y (b) la firma verifica. Una firma presente pero
 *   invalida se descarta (no se entrega ni como no verificado).
 * - TTL: el receptor descarta si `now - ts > ttlMs`.
 * - Deduplicacion por (id de envolvente, emisor) con ventana propia, ademas de la del
 *   transporte. Los propios ecos se ignoran.
 *
 * El payload debe ser JSON: la firma cubre `JSON.stringify` y PeerJS serializa en JSON.
 */
import {
  type ITransport,
  type PostQuantumIdentity,
  TIPO_MENSAJE,
  createEnvelope,
  createPostQuantumIdentity,
  deserializeKeypair,
  generateKeypair,
  serializeKeypair,
  signEnvelope,
  verifyEnvelopeSignature,
} from './edgeMesh';
import { MESH_ROOM_PREFIX, type MeshMessage, type MeshNetwork, type MeshPort, type PublishOptions } from './contracts';
import { sha256, toHex } from './sha256';

/** Lo que viaja en `envolvente.payload`. Corto a proposito: los latidos V2V salen cada segundo. */
export interface MeshWire {
  /** red */
  n: MeshNetwork;
  /** sala (sin prefijo) */
  r: string;
  /** topic */
  t: string;
  /** payload del dominio */
  p: unknown;
  /** hora de emision (ms epoch) */
  ts: number;
  /** ttl en ms, si lo hay */
  ttl?: number;
  /** clave publica ML-DSA-65 del emisor (base64); solo en mensajes firmados */
  pk?: string;
}

export interface MeshEngine extends MeshPort {
  /** Identidad usada para firmar. */
  readonly identity: PostQuantumIdentity;
  /** Clave del keypair serializada (para persistirla). */
  exportKeypair(): string;
  /** @internal Entrega una envolvente como si llegara por el transporte de esa sala (pruebas). */
  receive(network: MeshNetwork, room: string, env: unknown): Promise<void>;
}

export interface EngineOptions {
  /** Keypair serializado (`serializeKeypair`); si falta se genera uno nuevo. */
  keypair?: string;
  /** Crea y conecta el transporte de un namespace. */
  openTransport(namespace: string, nodeId: string): Promise<ITransport>;
  /** Reloj inyectable (TTL y dedup). */
  now?: () => number;
  /** Ventana de deduplicacion; por defecto 60 s. */
  dedupWindowMs?: number;
}

export function namespaceFor(network: MeshNetwork, room: string): string {
  return `${MESH_ROOM_PREFIX[network]}${room}`;
}

/** Id de nodo = primeros 128 bits del SHA-256 de la clave publica: no se puede suplantar sin la clave. */
/** Desfase de reloj tolerado entre pares (ms). */
export const MAX_CLOCK_SKEW_MS = 30_000;

export function nodeIdFromPublicKey(pk: Uint8Array): string {
  return toHex(sha256(pk)).slice(0, 32);
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** La firma viaja en base64; ademas se aceptan `{ "0": n, ... }` y arrays (JSON de un Uint8Array). */
function asBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (typeof v === 'string') {
    try {
      return unb64(v);
    } catch {
      return null;
    }
  }
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  if (v && typeof v === 'object') return Uint8Array.from(Object.values(v as Record<string, number>));
  return null;
}

function isWire(w: unknown): w is MeshWire {
  if (!w || typeof w !== 'object') return false;
  const x = w as Record<string, unknown>;
  return (
    (x.n === 'v2v' || x.n === 'datos') &&
    typeof x.r === 'string' &&
    typeof x.t === 'string' &&
    typeof x.ts === 'number' &&
    (x.ttl === undefined || typeof x.ttl === 'number') &&
    (x.pk === undefined || typeof x.pk === 'string')
  );
}

interface RoomState {
  network: MeshNetwork;
  room: string;
  transport: ITransport;
  handler: (ev: CustomEvent<{ envolvente: unknown }>) => void;
}

export function createEngine(opts: EngineOptions): MeshEngine {
  const now = opts.now ?? (() => Date.now());
  const dedupWindowMs = opts.dedupWindowMs ?? 60_000;
  const kp = opts.keypair ? deserializeKeypair(opts.keypair) : generateKeypair();
  const publicKey = kp.parPublico;
  const nodeId = nodeIdFromPublicKey(publicKey);
  const identity = createPostQuantumIdentity(nodeId, kp);
  const pkB64 = b64(publicKey);

  const rooms = new Map<string, RoomState>();
  const listeners = new Map<string, Set<(m: MeshMessage) => void>>();
  const seen = new Map<string, number>();
  let closed = false;
  let inbox: Promise<unknown> = Promise.resolve();

  const topicKey = (network: MeshNetwork, topic: string) => `${network}\u0000${topic}`;

  function isDuplicate(key: string): boolean {
    const t = now();
    const prev = seen.get(key);
    if (prev !== undefined && t - prev < dedupWindowMs) return true;
    seen.set(key, t);
    if (seen.size > 10_000) {
      for (const [k, ts] of seen) if (t - ts >= dedupWindowMs) seen.delete(k);
    }
    return false;
  }

  async function onEnvelope(network: MeshNetwork, room: string, raw: unknown) {
    if (closed || !raw || typeof raw !== 'object') return;
    const e = raw as Record<string, unknown>;
    if (e.tipo !== TIPO_MENSAJE.GOSSIP || typeof e.id !== 'string' || typeof e.origen !== 'string') return;
    if (!isWire(e.payload)) return;
    const wire = e.payload;
    // Aislamiento: el mensaje debe declarar la misma red y sala que el transporte por el que llego.
    if (wire.n !== network || wire.r !== room) return;
    if (e.origen === nodeId) return;
    if (wire.ttl !== undefined && now() - wire.ts > wire.ttl) return;
    // El ts lo declara el emisor: uno del futuro haria que su mensaje no venciera nunca. Se
    // tolera el desfase normal de relojes de telefono y nada mas.
    if (wire.ts > now() + MAX_CLOCK_SKEW_MS) return;

    const hasSig = e.firma !== null && e.firma !== undefined;
    let verified = false;
    if (hasSig) {
      const sig = asBytes(e.firma);
      if (!sig || !wire.pk) return;
      let pub: Uint8Array;
      try {
        pub = unb64(wire.pk);
      } catch {
        return;
      }
      // El id del emisor debe ser el hash de la clave que firma; si no, es suplantacion.
      if (nodeIdFromPublicKey(pub) !== e.origen) return;
      const env = { ...(e as object), firma: sig } as Parameters<typeof verifyEnvelopeSignature>[0];
      verified = await verifyEnvelopeSignature(env, pub, identity);
      if (!verified) return; // firma presente e invalida: se descarta
    }

    if (isDuplicate(`${e.id}:${e.origen}`)) return;

    const msg: MeshMessage = {
      network,
      room,
      topic: wire.t,
      payload: wire.p,
      from: e.origen,
      ts: wire.ts,
      verified,
    };
    for (const cb of listeners.get(topicKey(network, wire.t)) ?? []) {
      try {
        cb(structuredClone(msg));
      } catch {
        /* un suscriptor que falla no tumba a los demas */
      }
    }
  }

  const rk = (network: MeshNetwork, room: string) => `${network}\u0000${room}`;

  return {
    nodeId,
    identity,
    exportKeypair: () => serializeKeypair(kp),

    async join(network, room) {
      if (closed) throw new Error('puerto cerrado');
      const key = rk(network, room);
      if (rooms.has(key)) return;
      const transport = await opts.openTransport(namespaceFor(network, room), nodeId);
      const handler = (ev: CustomEvent<{ envolvente: unknown }>) => {
        // En cadena: verificar una firma es asincrono y no debe dejar que un mensaje posterior adelante a uno firmado.
        inbox = inbox.then(() => onEnvelope(network, room, ev.detail.envolvente)).catch(() => {});
      };
      transport.on('mensaje', handler as never);
      rooms.set(key, { network, room, transport, handler });
    },

    async leave(network, room) {
      const key = rk(network, room);
      const st = rooms.get(key);
      if (!st) return;
      rooms.delete(key);
      st.transport.off('mensaje', st.handler as never);
      await st.transport.cerrar();
    },

    async publish<T>(network: MeshNetwork, room: string, topic: string, payload: T, o: PublishOptions = {}) {
      if (closed) throw new Error('puerto cerrado');
      const st = rooms.get(rk(network, room));
      if (!st) throw new Error(`no unido a ${network}/${room}`);
      const wire: MeshWire = { n: network, r: room, t: topic, p: payload, ts: now() };
      if (o.ttlMs !== undefined) wire.ttl = o.ttlMs;
      if (o.sign) wire.pk = pkB64;
      let env = createEnvelope(TIPO_MENSAJE.GOSSIP, nodeId, '*', wire);
      if (o.sign) {
        env = await signEnvelope(env, identity);
        // El canal JSON de PeerJS rechaza mensajes de 16300 bytes o mas, y un Uint8Array de 3309 bytes
        // serializado a JSON ({"0":n,...}) ocupa ~30 KB. En el cable la firma va en base64 (~4,4 KB).
        env = { ...env, firma: b64(env.firma as Uint8Array) as unknown as Uint8Array };
      }
      await st.transport.transmitir(env);
    },

    subscribe<T>(network: MeshNetwork, topic: string, cb: (msg: MeshMessage<T>) => void) {
      const k = topicKey(network, topic);
      if (!listeners.has(k)) listeners.set(k, new Set());
      const set = listeners.get(k)!;
      set.add(cb as (m: MeshMessage) => void);
      return () => {
        set.delete(cb as (m: MeshMessage) => void);
      };
    },

    peerCount(network, room) {
      return rooms.get(rk(network, room))?.transport.obtenerConexiones().length ?? 0;
    },

    async close() {
      closed = true;
      const all = [...rooms.values()];
      rooms.clear();
      listeners.clear();
      seen.clear();
      for (const st of all) {
        st.transport.off('mensaje', st.handler as never);
        try {
          await st.transport.cerrar();
        } catch {
          /* ya cerrado */
        }
      }
    },

    receive: (network, room, env) => onEnvelope(network, room, env),
  };
}
