/**
 * port.ts — Un solo punto para obtener el MeshPort de la red de datos.
 *
 * Usa el nodo edge-mesh real (`src/mesh/node.ts`). Si no carga (WebRTC bloqueado, sin firma,
 * navegacion privada rara), cae a un `LocalMeshHub` en memoria SOLO para que la pagina no se
 * caiga: no hay pares y se ve el estado vacio. Ese fallback no es una red.
 *
 * Por que `import.meta.glob` y no `import('../node')`: node.ts solo debe empaquetarse en el
 * cliente y en un chunk aparte; el glob lo resuelve en build y devuelve {} si falta.
 *
 * Demanda anonima: `demandPortFactory` abre un puerto con identidad desechable NUEVO cada
 * vez (ver market.ts) con `createFreshEphemeralPort()` de node.ts: clave y nodeId nuevos en
 * cada llamada, quien lo pide lo cierra, y los singletons quedan intactos.
 */
import type { MeshPort } from '../contracts';
import { LocalMeshHub } from '../localHub';

export interface DatosPorts {
  port: MeshPort;
  /** Puerto desechable nuevo por llamada, para la demanda. Ausente = no se publica demanda. */
  demandPortFactory?: () => Promise<MeshPort>;
  /** false = fallback en memoria (sin pares reales). */
  real: boolean;
}

type NodeModule = {
  getMeshPort?: () => Promise<MeshPort> | MeshPort;
  createFreshEphemeralPort?: () => Promise<MeshPort> | MeshPort;
};

const nodeModules = import.meta.glob<NodeModule>('../node.{ts,js}');

let fallbackHub: LocalMeshHub | null = null;

export async function acquireDatosPorts(): Promise<DatosPorts> {
  const load = Object.values(nodeModules)[0];
  if (load) {
    try {
      const mod = await load();
      if (mod.getMeshPort) {
        const port = await mod.getMeshPort();
        const make = mod.createFreshEphemeralPort;
        return { port, demandPortFactory: make ? async () => make() : undefined, real: true };
      }
    } catch {
      // El nodo real no cargo: se sigue con el fallback en memoria.
    }
  }
  fallbackHub ??= new LocalMeshHub();
  const hub = fallbackHub;
  const rid = () => Math.random().toString(36).slice(2, 10);
  return { port: hub.createPort(`local-${rid()}`), demandPortFactory: async () => hub.createPort(`eph-${rid()}`), real: false };
}
