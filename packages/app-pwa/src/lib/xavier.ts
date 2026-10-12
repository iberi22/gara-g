/**
 * SWAL-GARA Xavier Namespace & Node Integration
 * Manages Xavier namespace app/gara-g/instance/{instanceId}, health probing,
 * and 60-second heartbeat lifecycle for edge-mesh & xavier-memory-node.
 */

/**
 * Endpoint por defecto de la memoria de agentes.
 *
 * ⚠  Antes era `http://localhost:8006`. Ese valor solo funciona si el NAVEGADOR del
 * usuario corre en la misma máquina que el nodo Xavier —es decir, nunca en producción—.
 * El navegador del usuario final (en Santiago, o en una voleadora) no resuelve
 * localhost:8006, así que la memoria de agentes fallaba en silencio: el código existía,
 * el flujo no. Verificado el 2026-09-30.
 *
 * Ahora el cliente habla con el proxy del Worker, que corre en el servidor y sí alcanza
 * a Xavier: `env.XAVIER_URL` (ver src/pages/api/xavier/_proxy.ts).
 */
export const XAVIER_DEFAULT_ENDPOINT = '/api/xavier';
export const XAVIER_HEARTBEAT_INTERVAL_MS = 60000; // 60s
export const INSTANCE_STORAGE_KEY = 'gara_g_xavier_instance_id';
// La fuente de verdad del tenant es domain.config.ts, el archivo base de una app
// nueva. Antes el literal vivia duplicado aqui y en 14 ficheros mas, y esa
// duplicacion es la que rompio el aislamiento de tenant.
import { DEFAULT_INSTANCE_ID } from './domain.config';
export { DEFAULT_INSTANCE_ID };

export interface XavierHealthStatus {
  alive: boolean;
  endpoint: string;
  latencyMs: number;
  timestamp: number;
  status?: string;
  version?: string;
}

export interface XavierHeartbeatPayload {
  instanceId: string;
  namespace: string;
  timestamp: number;
  heartbeatIntervalSec: number;
  status: 'active' | 'inactive' | 'degraded';
  metadata?: Record<string, unknown>;
}

export interface XavierHeartbeatResult {
  success: boolean;
  endpoint: string;
  timestamp: number;
  nextHeartbeatMs: number;
  error?: string;
}

let inMemoryInstanceId: string | null = null;

/**
 * Gets the persisted instance ID, defaulting to DEFAULT_INSTANCE_ID.
 */
export function getInstanceId(): string {
  if (inMemoryInstanceId) {
    return inMemoryInstanceId;
  }
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(INSTANCE_STORAGE_KEY);
    if (stored) {
      inMemoryInstanceId = stored;
      return stored;
    }
  }
  inMemoryInstanceId = DEFAULT_INSTANCE_ID;
  return DEFAULT_INSTANCE_ID;
}

/**
 * Persists and updates the current instance ID.
 */
export function setInstanceId(instanceId: string): void {
  inMemoryInstanceId = instanceId;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(INSTANCE_STORAGE_KEY, instanceId);
  }
}

/**
 * Formats the canonical Xavier namespace string: app/gara-g/instance/{instanceId}
 */
export function getXavierNamespace(instanceId?: string): string {
  const id = instanceId || getInstanceId();
  return `app/gara-g/instance/${id}`;
}

/**
 * Probes Xavier via the server-side proxy (default `/api/xavier/health`).
 */
export async function probeXavierHealth(
  endpoint: string = XAVIER_DEFAULT_ENDPOINT,
  timeoutMs = 3000,
): Promise<XavierHealthStatus> {
  const startTime = Date.now();
  const url = `${endpoint.replace(/\/$/, '')}/health`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const latencyMs = Date.now() - startTime;
    if (response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        status?: string;
        version?: string;
      };
      return {
        alive: true,
        endpoint,
        latencyMs,
        timestamp: Date.now(),
        status: data.status || 'ok',
        version: data.version || '1.0.0',
      };
    }

    return {
      alive: false,
      endpoint,
      latencyMs,
      timestamp: Date.now(),
      status: `HTTP ${response.status}`,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    return {
      alive: false,
      endpoint,
      latencyMs,
      timestamp: Date.now(),
      status: err instanceof Error ? err.message : 'connection_failed',
    };
  }
}

/**
 * Sends a 60s heartbeat payload to the Xavier node.
 */
export async function applyHeartbeat(
  endpoint: string = XAVIER_DEFAULT_ENDPOINT,
  metadata?: Record<string, unknown>,
): Promise<XavierHeartbeatResult> {
  const instanceId = getInstanceId();
  const namespace = getXavierNamespace(instanceId);
  const url = `${endpoint.replace(/\/$/, '')}/heartbeat`;

  const payload: XavierHeartbeatPayload = {
    instanceId,
    namespace,
    timestamp: Date.now(),
    heartbeatIntervalSec: XAVIER_HEARTBEAT_INTERVAL_MS / 1000,
    status: 'active',
    metadata,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.ok) {
      return {
        success: true,
        endpoint,
        timestamp: Date.now(),
        nextHeartbeatMs: Date.now() + XAVIER_HEARTBEAT_INTERVAL_MS,
      };
    }

    return {
      success: false,
      endpoint,
      timestamp: Date.now(),
      nextHeartbeatMs: Date.now() + XAVIER_HEARTBEAT_INTERVAL_MS,
      error: `HTTP ${response.status}`,
    };
  } catch (err: unknown) {
    return {
      success: false,
      endpoint,
      timestamp: Date.now(),
      nextHeartbeatMs: Date.now() + XAVIER_HEARTBEAT_INTERVAL_MS,
      error: err instanceof Error ? err.message : 'heartbeat_failed',
    };
  }
}

/**
 * Starts a 60-second periodic heartbeat loop.
 * Returns a cleanup function to stop the heartbeat loop.
 */
export function startHeartbeatLoop(
  endpoint: string = XAVIER_DEFAULT_ENDPOINT,
  intervalMs: number = XAVIER_HEARTBEAT_INTERVAL_MS,
  onTick?: (result: XavierHeartbeatResult) => void,
): () => void {
  let timerId: ReturnType<typeof setInterval> | null = null;

  const runHeartbeat = async () => {
    const result = await applyHeartbeat(endpoint);
    if (onTick) {
      onTick(result);
    }
  };

  // Immediate initial heartbeat
  runHeartbeat();

  timerId = setInterval(runHeartbeat, intervalMs);

  return () => {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  };
}

// --- Compat core template: xavierSearch/xavierAdd/xavierNamespace for aui/llm RAG ---
// Gara-g custom health/heartbeat extends core memory API; these wrappers keep imports stable
export async function xavierSearch(query: string, limit = 5, instanceId?: string) {
  const ns = instanceId ? getXavierNamespace(instanceId) : getXavierNamespace(getInstanceId());
  const url = `${XAVIER_DEFAULT_ENDPOINT}/search`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, namespace: ns, limit }),
    });
    if (!res.ok) throw new Error(`xavier ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('[xavier] search offline fallback', e);
    return { memories: [] };
  }
}
export async function xavierAdd(content: string, kind = 'episodic', instanceId?: string) {
  const ns = instanceId ? getXavierNamespace(instanceId) : getXavierNamespace(getInstanceId());
  const url = `${XAVIER_DEFAULT_ENDPOINT}/add`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, kind, namespace: ns }),
    });
    if (!res.ok) throw new Error(`xavier ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('[xavier] add queued offline', e);
    return null;
  }
}
export function xavierNamespace(instanceId?: string) {
  return instanceId ? getXavierNamespace(instanceId) : getXavierNamespace(getInstanceId());
}
