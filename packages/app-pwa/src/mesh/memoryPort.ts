/**
 * memoryPort.ts — MeshPort real (firma ML-DSA-65, deduplicacion, TTL) sobre el transporte
 * EN MEMORIA de edge-mesh. Sirve para probar cada red (v2v, datos) sin WebRTC con el mismo
 * motor que corre en produccion (engine.ts). Alternativa realista a `LocalMeshHub`.
 *
 * Los puertos que comparten `networkId` se ven entre si por sala; con distinto `networkId`
 * estan aislados (cada `networkId` es otro universo). No importar desde codigo de produccion
 * ni desde el barrel: arrastra edge-mesh.
 */
import { MemoryTransport } from './edgeMesh';
import type { MeshPort } from './contracts';
import { type MeshEngine, createEngine } from './engine';

export interface MemoryMeshPortOptions {
  /** Universo en memoria; puertos con el mismo id se encuentran. Por defecto `default`. */
  networkId?: string;
  /** Keypair serializado para fijar la identidad (p. ej. rotar el id V2V cada dia). */
  keypair?: string;
  /** Reloj inyectable (TTL y dedup). */
  now?: () => number;
  /** Ventana de deduplicacion en ms. */
  dedupWindowMs?: number;
}

export type MemoryMeshPort = MeshPort & Pick<MeshEngine, 'exportKeypair' | 'receive'>;

/** Id de sala del transporte en memoria para (networkId, namespace); util para inyectar trafico crudo en tests. */
export function memoryRoomId(networkId: string, namespace: string): string {
  return `${networkId}\u0000${namespace}`;
}

/** Crea un puerto en memoria (sincrono: la identidad se genera al momento). */
export function createMemoryMeshPort(opts: MemoryMeshPortOptions = {}): MemoryMeshPort {
  const networkId = opts.networkId ?? 'default';
  return createEngine({
    keypair: opts.keypair,
    now: opts.now,
    dedupWindowMs: opts.dedupWindowMs,
    async openTransport(namespace, nodeId) {
      const t = new MemoryTransport(nodeId, { roomId: memoryRoomId(networkId, namespace) });
      await t.conectar();
      return t;
    },
  });
}
