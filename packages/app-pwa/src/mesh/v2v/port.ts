/**
 * port.ts — De donde salen los MeshPort del radar.
 *
 * PRIVACIDAD: V2V NUNCA usa `getMeshPort()`. Su `nodeId` es la identidad persistente del
 * dispositivo y viaja como `from` en cada mensaje: con eso se seguiria a un coche aunque el id
 * de la baliza rote. V2V usa puertos desechables (clave ML-DSA en memoria, otros transportes)
 * y pide uno NUEVO por cada ranura de id, para que `from` rote a la vez que el id.
 * (`createEphemeralPort` es un singleton y no sirve para rotar; node.ts expone
 * `createFreshEphemeralPort`.)
 *
 * `import.meta.glob` evita que el empaquetador falle si `node.ts` no existe en la rama. Si no
 * existe o falla al cargar, el radar cae a un LocalMeshHub en memoria (no ve a nadie mas) para
 * que la pagina se pinte.
 */
import type { MeshPort } from '../contracts';
import { LocalMeshHub } from '../localHub';

export interface V2VPortSource {
  /** Un puerto desechable nuevo por llamada. */
  portFactory: () => Promise<MeshPort>;
  /** true = hub en memoria (no hay red real). */
  simulated: boolean;
}

const nodeModules = import.meta.glob('../node.{ts,js}');

type NodeModule = { createFreshEphemeralPort?: () => Promise<MeshPort> };

export async function acquireV2VPort(): Promise<V2VPortSource> {
  const loader = Object.values(nodeModules)[0];
  if (loader) {
    try {
      const mod = (await loader()) as NodeModule;
      if (typeof mod.createFreshEphemeralPort === 'function') {
        return { portFactory: mod.createFreshEphemeralPort, simulated: false };
      }
    } catch {
      // Si el nodo real falla al cargar, el radar sigue en local en vez de quedarse en blanco.
    }
  }
  const hub = new LocalMeshHub();
  let n = 0;
  return {
    portFactory: async () => hub.createPort(`radar-local-${Math.random().toString(36).slice(2, 8)}-${n++}`),
    simulated: true,
  };
}
