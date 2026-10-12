/**
 * node.ts — El nodo edge-mesh REAL del navegador, expuesto como MeshPort.
 *
 * `getMeshPort()` devuelve un singleton por pestana: identidad post-cuantica persistida
 * (IndexedDB, con memoria de respaldo), transporte PeerJS por sala y toda la semantica del
 * contrato (aislamiento por namespace, firmas, TTL, dedup) de engine.ts.
 *
 * SOLO navegador: edge-mesh (peerjs, noble, ethers, yjs...) no debe entrar al Worker, que en
 * Workers Free tiene 10 ms de CPU por peticion. Por eso este modulo no importa edge-mesh de
 * forma estatica: lo carga con `import()` dentro de `getMeshPort()`, y en el servidor lanza.
 *
 * Senalizacion: `PUBLIC_MESH_SIGNAL_URL` (p. ej. `https://mesh.swal.network/`), si no el
 * broker publico de PeerJS (`https://0.peerjs.com/`, el valor por defecto de PeerJS: el
 * transporte de edge-mesh sin configurar apunta a localhost:9000, inservible en un navegador).
 *
 * Descubrimiento: PeerJS no lista pares. Cada sala tiene SLOTS ids deterministas
 * (`gg-<hash de la sala>-<n>`): el nodo intenta reclamar uno (si esta tomado pasa al
 * siguiente, y si todos lo estan usa un id aleatorio) y se conecta a los demas slots; despues
 * el propio transporte intercambia listas de pares y la malla se completa sola.
 */
import type { ITransport } from './edgeMesh';
import type { MeshPort } from './contracts';
import { loadSerializedKeypair, saveSerializedKeypair } from './identityStore';
import { getIceConfig, type IceConfig } from './iceServers';
import { sha256, toHex } from './sha256';

export const DEFAULT_SIGNAL_URL = 'https://0.peerjs.com/';
// El transporte pasa `key: undefined` y PeerJS lo manda como "key=undefined"; hay que fijar la clave por defecto.
const PEER_KEY = 'peerjs';
const SLOTS = 4;
const CLAIM_TIMEOUT_MS = 8_000;
const REPROBE_MS = 10_000;

export interface MeshNodeOptions {
  /** URL del servidor de senalizacion PeerJS; pisa `PUBLIC_MESH_SIGNAL_URL`. */
  signalUrl?: string;
}

let singleton: Promise<MeshPort> | null = null;
let ephemeral: Promise<MeshPort> | null = null;

export function resolveSignalUrl(override?: string): string {
  const fromEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.PUBLIC_MESH_SIGNAL_URL;
  const url = (override ?? fromEnv ?? '').trim();
  return url || DEFAULT_SIGNAL_URL;
}

export async function getMeshPort(opts: MeshNodeOptions = {}): Promise<MeshPort> {
  if (typeof window === 'undefined') {
    throw new Error('getMeshPort() solo funciona en el navegador: edge-mesh no se carga en el servidor/Worker');
  }
  if (!singleton) {
    singleton = createBrowserPort(opts).catch((e) => {
      singleton = null;
      throw e;
    });
  }
  return singleton;
}

/**
 * Segundo puerto con identidad desechable: keypair generado en memoria, nunca persistido, asi
 * que `msg.from` no es el id estable del dispositivo (senales anonimas de demanda, V2V). Firmar
 * funciona, con la clave desechable. Tiene sus PROPIOS transportes PeerJS (mismo servidor de
 * senalizacion, otro peer id por sala): edge-mesh liga un transporte a una identidad. Singleton
 * por pestana; para rotar la identidad, `resetMeshPort()` y volver a pedirlo.
 */
export async function createEphemeralPort(opts: MeshNodeOptions = {}): Promise<MeshPort> {
  if (typeof window === 'undefined') {
    throw new Error('createEphemeralPort() solo funciona en el navegador: edge-mesh no se carga en el servidor/Worker');
  }
  if (!ephemeral) {
    ephemeral = createBrowserPort(opts, false).catch((e) => {
      ephemeral = null;
      throw e;
    });
  }
  return ephemeral;
}

/**
 * Como `createEphemeralPort`, pero CADA llamada devuelve un puerto nuevo (otra clave
 * desechable, otro `nodeId`, otros transportes) y quien lo pide es dueno de cerrarlo. No
 * toca ni cierra los singletons. Lo usa V2V para rotar `msg.from` junto con el id efimero.
 */
export async function createFreshEphemeralPort(opts: MeshNodeOptions = {}): Promise<MeshPort> {
  if (typeof window === 'undefined') {
    throw new Error('createFreshEphemeralPort() solo funciona en el navegador: edge-mesh no se carga en el servidor/Worker');
  }
  return createBrowserPort(opts, false);
}

/** Cierra los singletons (pruebas / cierre de sesion). */
export async function resetMeshPort(): Promise<void> {
  const ps = [singleton, ephemeral];
  singleton = null;
  ephemeral = null;
  for (const p of ps) if (p) await (await p.catch(() => null))?.close();
}

async function createBrowserPort(opts: MeshNodeOptions, persist = true): Promise<MeshPort> {
  const [{ createEngine }, { PeerJSTransport }] = await Promise.all([import('./engine'), import('./edgeMesh')]);
  const relayUrl = resolveSignalUrl(opts.signalUrl);

  const stored = persist ? await loadSerializedKeypair() : null;
  const engine = createEngine({
    keypair: stored ?? undefined,
    async openTransport(namespace, nodeId) {
      // TURN (CGNAT en redes moviles): se pide una vez por sesion y se cachea; sin relay, undefined.
      return openPeerRoom(PeerJSTransport, relayUrl, namespace, nodeId, await getIceConfig());
    },
  });
  if (persist && !stored) await saveSerializedKeypair(engine.exportKeypair());
  return engine;
}

export type PeerCtor = new (nodoId: string, options: { peerId: string; relayUrl: string; key: string; config?: IceConfig }) => ITransport & {
  conectarRemoto(id: string): Promise<void>;
};

export async function openPeerRoom(
  Peer: PeerCtor,
  relayUrl: string,
  namespace: string,
  nodeId: string,
  config?: IceConfig,
): Promise<ITransport> {
  const hash = toHex(sha256(new TextEncoder().encode(namespace))).slice(0, 16);
  const slotId = (i: number) => `gg-${hash}-${i}`;

  let transport: (ITransport & { conectarRemoto(id: string): Promise<void> }) | null = null;
  let mine = '';
  for (let i = 0; i <= SLOTS && !transport; i++) {
    mine = i < SLOTS ? slotId(i) : `gg-${hash}-r${toHex(crypto.getRandomValues(new Uint8Array(6)))}`;
    const t = new Peer(nodeId, { peerId: mine, relayUrl, key: PEER_KEY, ...(config ? { config } : {}) });
    const outcome = await new Promise<'open' | 'taken' | 'timeout'>((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), CLAIM_TIMEOUT_MS);
      t.on('conectado', (ev) => {
        if (ev.detail.nodoId === nodeId) {
          clearTimeout(timer);
          resolve('open');
        }
      });
      t.on('error', (ev) => {
        const m = `${ev.detail.mensaje ?? ''} ${(ev.detail.error as { type?: string } | undefined)?.type ?? ''}`;
        if (m.includes('unavailable-id')) {
          clearTimeout(timer);
          resolve('taken');
        }
      });
    });
    if (outcome === 'taken') {
      await t.cerrar();
      continue;
    }
    // 'timeout': sin senalizacion todavia; el transporte reintenta solo, lo dejamos vivir.
    transport = t;
  }
  const t = transport!;

  const probe = () => {
    if (!t.estaConectado()) return;
    const linked = new Set(t.obtenerConexiones());
    for (let i = 0; i < SLOTS; i++) {
      const id = slotId(i);
      if (id !== mine && !linked.has(id)) void t.conectarRemoto(id).catch(() => {});
    }
  };
  probe();
  t.on('conectado', (ev) => {
    if (ev.detail.nodoId === nodeId) probe(); // reconexion con el broker
  });
  const timer = setInterval(probe, REPROBE_MS);
  const close = t.cerrar.bind(t);
  t.cerrar = async () => {
    clearInterval(timer);
    await close();
  };
  return t;
}
