/**
 * contracts.ts — El contrato que comparten las dos redes de GARA-G sobre edge-mesh.
 *
 * GARA-G corre DOS redes sobre el mismo nodo edge-mesh del navegador:
 *
 * - `v2v`   — red de control de navegacion. Mensajes efimeros (segundos) entre vehiculos
 *             cercanos: posicion, rumbo, velocidad y eventos de peligro, para evitar accidentes.
 *             Salas por celda geografica fina (ver geocell.ts). Nada se persiste.
 * - `datos` — red de datos / mercado automotriz. Ofertas firmadas de vendedores (talleres,
 *             repuestos, aseguradoras) y senales anonimas de demanda de los duenos, siempre
 *             detras del consentimiento (marketplaceOptIn). Salas por region (celda gruesa).
 *
 * Las dos redes se tocan en un solo punto: los agregados de navegacion de la red v2v
 * (peligros y densidad de trafico, con privacidad diferencial) son un producto de la red
 * de datos. Nunca viaja una traza individual.
 *
 * Por que un puerto y no edge-mesh directo: el dominio de cada red (v2v/**, datos/**) se
 * prueba con `createMemoryMeshPort` sin WebRTC, y edge-mesh se carga perezosamente SOLO en
 * el cliente (el Worker tiene 10 ms de CPU por peticion y no debe empaquetarlo).
 */

export type MeshNetwork = 'v2v' | 'datos';

export interface MeshMessage<T = unknown> {
  network: MeshNetwork;
  room: string;
  topic: string;
  payload: T;
  /** Id del par que lo emitio (en v2v es efimero y rota; ver v2v/). */
  from: string;
  /** Hora de emision declarada por el emisor (ms epoch). */
  ts: number;
  /** true solo si llego firmado y la firma verifico contra la identidad del emisor. */
  verified: boolean;
}

export interface PublishOptions {
  /** Firmar con la identidad post-cuantica del nodo (caro: usar en ofertas y peligros, no en latidos). */
  sign?: boolean;
  /** Pasado este tiempo los receptores descartan el mensaje. */
  ttlMs?: number;
}

export interface MeshPort {
  /** Id estable del nodo (identidad edge-mesh). */
  readonly nodeId: string;
  join(network: MeshNetwork, room: string): Promise<void>;
  leave(network: MeshNetwork, room: string): Promise<void>;
  publish<T>(network: MeshNetwork, room: string, topic: string, payload: T, opts?: PublishOptions): Promise<void>;
  /** Devuelve la funcion para desuscribirse. Recibe mensajes de todas las salas unidas de esa red. */
  subscribe<T>(network: MeshNetwork, topic: string, cb: (msg: MeshMessage<T>) => void): () => void;
  /** Pares conectados en esa sala (para la UI: "3 vehiculos cerca"). */
  peerCount(network: MeshNetwork, room: string): number;
  close(): Promise<void>;
}

/** Prefijo de sala; edge-mesh aisla namespaces, asi que v2v y datos nunca se mezclan. */
export const MESH_ROOM_PREFIX: Record<MeshNetwork, string> = {
  v2v: 'gara/v2v/',
  datos: 'gara/datos/',
};
