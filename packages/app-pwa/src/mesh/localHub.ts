/**
 * localHub.ts — Un MeshPort en memoria, sin edge-mesh, para probar el dominio de cada red.
 *
 * Varios puertos creados sobre el mismo hub se ven entre si como pares de una sala. Simula
 * lo que importa al dominio: salas aisladas por red, TTL, y que una firma solo cuenta como
 * verificada si el emisor firmo. La red real (edge-mesh) vive en node.ts.
 */
import type { MeshMessage, MeshNetwork, MeshPort, PublishOptions } from './contracts';

type Listener = (msg: MeshMessage) => void;

export class LocalMeshHub {
  private members = new Map<string, Set<LocalPort>>();
  /** Reloj inyectable para probar TTL sin esperar. */
  constructor(public now: () => number = () => Date.now()) {}

  createPort(nodeId: string): MeshPort {
    return new LocalPort(this, nodeId);
  }

  /** @internal */
  key(network: MeshNetwork, room: string) {
    return `${network}\u0000${room}`;
  }
  /** @internal */
  joinRoom(port: LocalPort, network: MeshNetwork, room: string) {
    const k = this.key(network, room);
    if (!this.members.has(k)) this.members.set(k, new Set());
    this.members.get(k)!.add(port);
  }
  /** @internal */
  leaveRoom(port: LocalPort, network: MeshNetwork, room: string) {
    this.members.get(this.key(network, room))?.delete(port);
  }
  /** @internal */
  roomMembers(network: MeshNetwork, room: string): Set<LocalPort> {
    return this.members.get(this.key(network, room)) ?? new Set();
  }
}

class LocalPort implements MeshPort {
  private listeners = new Map<string, Set<Listener>>();
  private rooms = new Set<string>();
  private closed = false;

  constructor(
    private hub: LocalMeshHub,
    readonly nodeId: string,
  ) {}

  async join(network: MeshNetwork, room: string) {
    this.rooms.add(this.hub.key(network, room));
    this.hub.joinRoom(this, network, room);
  }

  async leave(network: MeshNetwork, room: string) {
    this.rooms.delete(this.hub.key(network, room));
    this.hub.leaveRoom(this, network, room);
  }

  async publish<T>(network: MeshNetwork, room: string, topic: string, payload: T, opts: PublishOptions = {}) {
    if (this.closed) throw new Error('puerto cerrado');
    if (!this.rooms.has(this.hub.key(network, room))) throw new Error(`no unido a ${network}/${room}`);
    const ts = this.hub.now();
    const msg: MeshMessage<T> = { network, room, topic, payload, from: this.nodeId, ts, verified: !!opts.sign };
    for (const peer of this.hub.roomMembers(network, room)) {
      if (peer === this) continue;
      peer.deliver(msg as MeshMessage, opts.ttlMs);
    }
  }

  /** @internal */
  deliver(msg: MeshMessage, ttlMs?: number) {
    if (this.closed) return;
    if (ttlMs !== undefined && this.hub.now() - msg.ts > ttlMs) return;
    // structuredClone: el receptor no debe poder mutar el objeto del emisor (en la red real llega serializado).
    const copy = structuredClone(msg);
    for (const cb of this.listeners.get(`${msg.network}\u0000${msg.topic}`) ?? []) cb(copy);
  }

  subscribe<T>(network: MeshNetwork, topic: string, cb: (msg: MeshMessage<T>) => void) {
    const k = `${network}\u0000${topic}`;
    if (!this.listeners.has(k)) this.listeners.set(k, new Set());
    const set = this.listeners.get(k)!;
    set.add(cb as Listener);
    return () => set.delete(cb as Listener);
  }

  peerCount(network: MeshNetwork, room: string) {
    const n = this.hub.roomMembers(network, room).size;
    return this.rooms.has(this.hub.key(network, room)) ? n - 1 : n;
  }

  async close() {
    this.closed = true;
    for (const k of this.rooms) {
      const [network, room] = k.split('\u0000') as [MeshNetwork, string];
      this.hub.leaveRoom(this, network, room);
    }
    this.rooms.clear();
    this.listeners.clear();
  }
}
