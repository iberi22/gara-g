/**
 * meshYjsSync.ts — Replica un Y.Doc de telemetria entre los dispositivos de UN tenant sobre
 * el puerto edge-mesh de la app (red `datos`), en lugar de y-webrtc.
 *
 * Por que: y-webrtc dependia de servidores de senalizacion publicos de Yjs que estan caidos
 * (signaling.yjs.dev), asi que la replica nunca arrancaba. El puerto de edge-mesh ya resuelve
 * la senalizacion (PeerJS), la identidad y la firma, y se prueba en memoria sin WebRTC.
 *
 * Alcance y confidencialidad: esto NO es V2V. La telemetria es dato de flota. Los instanceId
 * son adivinables y cualquier nodo puede firmar con su propia clave, asi que ni el nombre de la
 * sala ni la firma bastan: la sala es `telemetry/<roomId>` con un roomId derivado en el servidor
 * (GET /api/mesh/room-key, solo con sesion y solo del tenant de la sesion; el instanceId no
 * aparece en el cable) y CADA payload viaja cifrado con AES-256-GCM (IV aleatorio de 12 bytes,
 * AAD = `roomId|epoca`) bajo una clave que solo entrega ese endpoint. Un par sin la clave puede
 * entrar a la sala, pero no lee nada y sus mensajes no descifran: se descartan. Ademas cada
 * update debe venir firmado (`verified === true`): el emisor es un nodo con identidad.
 * Sin clave (endpoint caido, 401, 503) NO se abre ninguna sala: `attachDocToMesh` lanza y la
 * grafica sigue en local; nunca hay un modo sin cifrar.
 * Limites: la metadata de la sala (quien se conecta, tamano y ritmo de los mensajes) es visible
 * para quien conozca el roomId; la clave solo la reciben los administradores (propietarios) del tenant; los mensajes cifrados
 * grabados pueden reenviarse (los updates de Yjs son idempotentes, no hay efecto nuevo).
 *
 * Claves y epocas: el servidor rota la clave cada semana y entrega tambien la anterior. Se
 * descifra con la actual y la previa; se cifra con la actual. Pasada `rotatesAt`, o al ver un
 * mensaje de una epoca futura, se vuelve a pedir la clave y se pide el estado a los pares.
 *
 * Protocolo (topics en la sala), payload en claro = lo que se cifra:
 * - `telemetry/update`   {e, n, c}  c = AES-GCM(update Yjs); n = IV; e = epoca. Cada cambio local
 *                                   y las respuestas de alta.
 * - `telemetry/sync-req` {e, n, c}  c = AES-GCM(vacio): "enviame lo que tengas"; al unirse y
 *                                   cuando aparece un par nuevo.
 * Los updates de Yjs son idempotentes, asi que reenviar de mas nunca duplica datos.
 *
 * Tamano: el canal de PeerJS rechaza mensajes de ~16 KB y una envolvente firmada ya gasta
 * ~7 KB (firma + clave publica). Los updates se agrupan en lotes de a lo sumo MAX_BATCH_BYTES;
 * tras cifrar (+16 de etiqueta) y base64 quedan < 6 KB. El historial de reenvio es un registro
 * acotado de los ultimos updates.
 */
import * as Y from 'yjs';
import type { MeshMessage, MeshPort } from '../../mesh/contracts';

export const TOPIC_UPDATE = 'telemetry/update';
export const TOPIC_SYNC = 'telemetry/sync-req';
const NETWORK = 'datos' as const;

/** Bytes crudos por mensaje: 4300 -> ~5.8 KB en base64 tras cifrar, con margen bajo el limite de 16 KB. */
export const MAX_BATCH_BYTES = 4300;
/** Etiqueta de autenticacion de AES-GCM. */
const GCM_TAG_BYTES = 16;
const IV_BYTES = 12;
const LOG_CAP = 300;
const REPLY_COOLDOWN_MS = 2000;
const PEER_POLL_MS = 1000;
/** Reintento si el endpoint de claves falla en una renovacion. */
const REFRESH_RETRY_MS = 30_000;
/** Minimo entre dos peticiones de clave disparadas por mensajes de una epoca futura. */
const FUTURE_EPOCH_REFRESH_MS = 15_000;
/** Dispersion tras `rotatesAt` para que todos los dispositivos no pidan a la vez. */
const ROTATE_JITTER_MS = 20_000;
/** Suelo del temporizador: un reloj adelantado no debe provocar peticiones en bucle. */
const MIN_REFRESH_MS = 30_000;
const MAX_TIMER_MS = 2 ** 31 - 1;
/** Origen con el que se aplican los updates remotos (para no reenviarlos como locales). */
const REMOTE = Symbol('mesh-remote');

/** Sala de la replica: `roomId` es el hex que entrega el servidor, nunca el instanceId. */
export function telemetryRoom(roomId: string): string {
  return `telemetry/${roomId}`;
}

/** Lo que devuelve GET /api/mesh/room-key. */
export interface RoomKeyMaterial {
  roomId: string;
  epoch: number;
  /** AES-256 en base64url. */
  key: string;
  previous?: { epoch: number; key: string };
  /** ms epoch en que empieza la epoca siguiente. */
  rotatesAt?: number;
}
export type RoomKeyFetcher = () => Promise<RoomKeyMaterial>;

/** Pide la clave al servidor con la cookie de sesion. Lanza si no hay sesion o no hay secreto (401/503). */
export const fetchRoomKey: RoomKeyFetcher = async () => {
  const res = await fetch('/api/mesh/room-key', { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw new Error(`room-key: HTTP ${res.status}`);
  return (await res.json()) as RoomKeyMaterial;
};

export interface MeshSync {
  /** Pares conectados en la sala ahora mismo. */
  peers(): number;
  /** Avisa de cambios en el numero de pares; devuelve la baja. */
  onPeers(cb: (n: number) => void): () => void;
  /** Epoca de la clave con la que se cifra ahora. */
  epoch(): number;
  /** Vuelve a pedir la clave (rotacion). Si falla conserva la que tenia. */
  refreshKeys(): Promise<void>;
  /** Deja la sala y deja de escuchar el doc. No cierra el puerto (es del singleton de la pestana). */
  destroy(): Promise<void>;
}

interface Envelope {
  e: number;
  n: string;
  c: string;
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function fromB64Url(s: string): Uint8Array {
  const std = s.replaceAll('-', '+').replaceAll('_', '/');
  return fromB64(std + '='.repeat((4 - (std.length % 4)) % 4));
}

const textEnc = new TextEncoder();

interface Keyring {
  roomId: string;
  epoch: number;
  keys: Map<number, CryptoKey>;
  rotatesAt?: number;
}

async function importKey(b64url: string): Promise<CryptoKey> {
  const raw = fromB64Url(b64url);
  if (raw.length !== 32) throw new Error('room-key: la clave debe ser de 256 bits');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function buildKeyring(m: RoomKeyMaterial): Promise<Keyring> {
  if (
    !m ||
    typeof m.roomId !== 'string' ||
    !/^[0-9a-f]{32}$/.test(m.roomId) ||
    !Number.isInteger(m.epoch) ||
    typeof m.key !== 'string'
  ) {
    throw new Error('room-key: respuesta invalida');
  }
  const keys = new Map<number, CryptoKey>();
  keys.set(m.epoch, await importKey(m.key));
  if (m.previous && Number.isInteger(m.previous.epoch) && typeof m.previous.key === 'string') {
    keys.set(m.previous.epoch, await importKey(m.previous.key));
  }
  return { roomId: m.roomId, epoch: m.epoch, keys, rotatesAt: typeof m.rotatesAt === 'number' ? m.rotatesAt : undefined };
}

export async function attachDocToMesh(
  doc: Y.Doc,
  port: MeshPort,
  getKeys: RoomKeyFetcher = fetchRoomKey,
): Promise<MeshSync> {
  // Sin clave no hay sala: si el fetch o la validacion fallan, esto lanza y NO se une a nada.
  let ring = await buildKeyring(await getKeys());
  const roomId = ring.roomId;
  const room = telemetryRoom(roomId);
  await port.join(NETWORK, room);

  const aad = (epoch: number) => textEnc.encode(`${roomId}|${epoch}`);

  const seal = async (plain: Uint8Array): Promise<Envelope> => {
    const epoch = ring.epoch;
    const key = ring.keys.get(epoch)!;
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(epoch) as BufferSource },
        key,
        plain as BufferSource,
      ),
    );
    return { e: epoch, n: toB64(iv), c: toB64(ct) };
  };

  /** null si no es una envolvente valida, es de una epoca que no tenemos o no descifra. */
  const open = async (payload: unknown): Promise<Uint8Array | null> => {
    const env = payload as Partial<Envelope> | null | undefined;
    if (!env || typeof env !== 'object') return null;
    const { e, n, c } = env;
    if (!Number.isInteger(e) || typeof n !== 'string' || typeof c !== 'string') return null;
    if (n.length !== 16 || c.length > Math.ceil(((MAX_BATCH_BYTES + GCM_TAG_BYTES) * 4) / 3) + 4) return null;
    const epoch = e as number;
    const key = ring.keys.get(epoch);
    if (!key) {
      if (epoch > ring.epoch) void refreshOnFutureEpoch();
      return null;
    }
    try {
      const iv = fromB64(n);
      if (iv.length !== IV_BYTES) return null;
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(epoch) as BufferSource },
        key,
        fromB64(c) as BufferSource,
      );
      return new Uint8Array(plain);
    } catch {
      return null; // no es de quien tiene la clave (o esta manipulado): se descarta
    }
  };

  const log: Uint8Array[] = [];
  let destroyed = false;
  let lastReplyAt = 0;
  let lastPeers = port.peerCount(NETWORK, room);
  const peerListeners = new Set<(n: number) => void>();
  // Un solo hilo de salida: firmar y cifrar son asincronos y el orden de los updates importa.
  let outbox: Promise<unknown> = Promise.resolve();

  const send = (topic: string, plain: Uint8Array, sign: boolean) => {
    outbox = outbox
      .then(async () => {
        if (destroyed) return;
        await port.publish(NETWORK, room, topic, await seal(plain), { sign });
      })
      .catch((e) => console.warn('mesh telemetry: no se pudo publicar', e));
  };

  const sendUpdate = (u: Uint8Array) => send(TOPIC_UPDATE, u, true);
  const sendSyncReq = () => send(TOPIC_SYNC, new Uint8Array(0), false);

  const sendLog = () => {
    let batch: Uint8Array[] = [];
    let size = 0;
    const flush = () => {
      if (batch.length) sendUpdate(batch.length === 1 ? batch[0] : Y.mergeUpdates(batch));
      batch = [];
      size = 0;
    };
    for (const u of log) {
      if (size + u.length > MAX_BATCH_BYTES) flush();
      batch.push(u);
      size += u.length;
    }
    flush();
  };

  const onDocUpdate = (u: Uint8Array, origin: unknown) => {
    log.push(u);
    if (log.length > LOG_CAP) log.shift();
    if (origin === REMOTE) return;
    if (u.length > MAX_BATCH_BYTES) {
      console.warn('mesh telemetry: update local demasiado grande para el canal, no se replica', u.length);
      return;
    }
    sendUpdate(u);
  };
  // Lo que el doc ya tenia antes de adjuntarse tambien se ofrece a los pares.
  const existing = Y.encodeStateAsUpdate(doc);
  if (existing.length > 2) onDocUpdate(existing, 'initial');
  doc.on('update', onDocUpdate);

  const offUpdate = port.subscribe<unknown>(NETWORK, TOPIC_UPDATE, (msg: MeshMessage<unknown>) => {
    if (destroyed || msg.room !== room || !msg.verified) return;
    void (async () => {
      const plain = await open(msg.payload);
      if (!plain || destroyed) return;
      try {
        Y.applyUpdate(doc, plain, REMOTE);
      } catch {
        /* update corrupto de un par con clave: se ignora */
      }
    })();
  });

  const offSync = port.subscribe<unknown>(NETWORK, TOPIC_SYNC, (msg: MeshMessage<unknown>) => {
    if (destroyed || msg.room !== room) return;
    void (async () => {
      // Solo quien tiene la clave puede pedir el estado (y no consume el enfriamiento un intruso).
      if ((await open(msg.payload)) === null || destroyed) return;
      const t = Date.now();
      if (t - lastReplyAt < REPLY_COOLDOWN_MS) return;
      lastReplyAt = t;
      sendLog();
    })();
  });

  // --- Renovacion de claves ---
  let rotateTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFutureRefreshAt = 0;
  let refreshing: Promise<void> | null = null;

  const scheduleRotation = (delay: number) => {
    if (rotateTimer) clearTimeout(rotateTimer);
    rotateTimer = setTimeout(() => void refreshKeys(), Math.min(Math.max(delay, MIN_REFRESH_MS), MAX_TIMER_MS));
  };

  const refreshKeys = (): Promise<void> => {
    if (destroyed) return Promise.resolve();
    refreshing ??= (async () => {
      try {
        const next = await buildKeyring(await getKeys());
        if (destroyed) return;
        // El nombre de la sala es estable: si cambiara, no es nuestra sala y no se toca nada.
        if (next.roomId !== roomId) throw new Error('room-key: el roomId cambio');
        const changed = next.epoch !== ring.epoch;
        ring = next;
        scheduleRotation(ring.rotatesAt ? ring.rotatesAt - Date.now() + Math.random() * ROTATE_JITTER_MS : REFRESH_RETRY_MS * 10);
        if (changed) {
          // Los pares pudieron mandar algo cifrado con la clave nueva antes de que la tuvieramos.
          sendSyncReq();
          sendLog();
        }
      } catch (e) {
        console.warn('mesh telemetry: no se pudo renovar la clave, se conserva la actual', e);
        if (!destroyed) scheduleRotation(REFRESH_RETRY_MS);
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  };

  async function refreshOnFutureEpoch() {
    const t = Date.now();
    if (t - lastFutureRefreshAt < FUTURE_EPOCH_REFRESH_MS) return;
    lastFutureRefreshAt = t;
    await refreshKeys();
  }

  if (ring.rotatesAt) scheduleRotation(ring.rotatesAt - Date.now() + Math.random() * ROTATE_JITTER_MS);

  // PeerJS no avisa de pares nuevos al motor: se sondea el contador y, cuando sube, se pide
  // al recien llegado que envie su estado (y se le envia el nuestro con su propio sync-req).
  const timer = setInterval(() => {
    const n = port.peerCount(NETWORK, room);
    if (n === lastPeers) return;
    const grew = n > lastPeers;
    lastPeers = n;
    peerListeners.forEach((cb) => cb(n));
    if (grew) {
      sendSyncReq();
      sendLog();
    }
  }, PEER_POLL_MS);

  sendSyncReq();

  return {
    peers: () => port.peerCount(NETWORK, room),
    onPeers(cb) {
      peerListeners.add(cb);
      return () => peerListeners.delete(cb);
    },
    epoch: () => ring.epoch,
    refreshKeys,
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      clearInterval(timer);
      if (rotateTimer) clearTimeout(rotateTimer);
      doc.off('update', onDocUpdate);
      offUpdate();
      offSync();
      peerListeners.clear();
      await outbox;
      await port.leave(NETWORK, room).catch(() => {});
    },
  };
}
