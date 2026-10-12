// mesh.ts — bus de eventos P2P de la app (GOAL #4), ahora sobre el nodo edge-mesh real.
// Antes tenia su propio bus Yjs sobre y-webrtc; ahora es un envoltorio fino de
// `getMeshPort()` (src/mesh/node.ts): misma API publica, una sola identidad y un solo
// transporte por pestana. Sala: swal/{appId}/{instanceId} en la red `datos`.
// Cambio de semantica: el bus Yjs era un Y.Array (CRDT); ahora es gossip efimero con
// deduplicacion, que es lo que el consumidor (aui:update) necesita. Los suscriptores
// locales siguen viendo las publicaciones de su propia pestana (eco local).

import { domainConfig } from './domain.config.js';

export function meshRoom(instanceId?: string) {
  const id = instanceId ?? (domainConfig.instanceId as string);
  return `swal/${domainConfig.appId}/${id}`;
}

type Handler = (data: unknown) => void;
// eco local: sala -> topic -> manejadores
const local = new Map<string, Map<string, Set<Handler>>>();
// suscripcion al puerto por sala, para no duplicar entregas remotas
const portSubs = new Map<string, () => void>();
const joined = new Set<string>();

async function ensureRoom(room: string) {
  const { getMeshPort } = await import('../mesh/node');
  const port = await getMeshPort();
  if (!joined.has(room)) {
    await port.join('datos', room);
    joined.add(room);
  }
  return port;
}

function emitLocal(room: string, topic: string, payload: unknown) {
  for (const cb of local.get(room)?.get(topic) ?? []) {
    try {
      cb(payload);
    } catch {}
  }
}

export async function meshPublish(topic: string, payload: unknown, instanceId?: string) {
  const room = meshRoom(instanceId);
  if (typeof window === 'undefined') {
    console.log(`[mesh stub SSR] ${room}/${topic}`, payload);
    return;
  }
  emitLocal(room, topic, payload);
  try {
    const port = await ensureRoom(room);
    await port.publish('datos', room, topic, payload);
  } catch (e) {
    console.warn('[mesh] publish fallback', e);
    console.log(`[mesh fallback] ${room}/${topic}`, payload);
  }
}

export async function meshSubscribe(topic: string, handler: Handler, instanceId?: string) {
  const room = meshRoom(instanceId);
  if (typeof window === 'undefined') return () => {};
  if (!local.has(room)) local.set(room, new Map());
  const byTopic = local.get(room)!;
  if (!byTopic.has(topic)) byTopic.set(topic, new Set());
  byTopic.get(topic)!.add(handler);

  try {
    const port = await ensureRoom(room);
    const key = `${room}\u0000${topic}`;
    if (!portSubs.has(key)) {
      const off = port.subscribe('datos', topic, (msg) => {
        if (msg.room === room) emitLocal(room, topic, msg.payload);
      });
      portSubs.set(key, off);
    }
  } catch (e) {
    console.warn('[mesh] subscribe fallback', e);
  }
  return () => {
    byTopic.get(topic)?.delete(handler);
  };
}

// Compat: mantiene API previa (publish sin red) si el nodo no esta disponible
export async function meshPublishFallback(topic: string, payload: unknown, instanceId?: string) {
  const room = meshRoom(instanceId);
  console.log(`[mesh] publish ${room}/${topic}`, payload);
}
