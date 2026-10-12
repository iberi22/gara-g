/**
 * SWAL-GARA Node Gate
 * Pro status is determined strictly by an active @swal/node with a heartbeat <= 60 seconds.
 * Pro gate unlocks: Advanced Marketplace & Advanced Fleet features.
 * Integrates with Xavier Node Service (:8006) for DePIN telemetry verification.
 */

export interface SwalNodeStatus {
  nodeId: string;
  status: 'active' | 'inactive' | 'degraded' | 'offline';
  lastHeartbeat: number; // Unix timestamp in milliseconds or seconds
  karma?: number;
  ipAddress?: string;
  version?: string;
}

export const HEARTBEAT_MAX_AGE_SECONDS = 60;

/**
 * Checks if Pro features are enabled for the given @swal/node.
 * Returns true iff node status is 'active' and lastHeartbeat is within 60 seconds.
 *
 * @param node SwalNodeStatus | null | undefined
 * @param currentTimeMs Optional current time in milliseconds (defaults to Date.now())
 */
export function isProEnabled(node?: SwalNodeStatus | null, currentTimeMs: number = Date.now()): boolean {
  if (!node) {
    return false;
  }

  if (node.status !== 'active') {
    return false;
  }

  const lastHeartbeatMs = node.lastHeartbeat > 1e11 ? node.lastHeartbeat : node.lastHeartbeat * 1000;
  const ageInSeconds = (currentTimeMs - lastHeartbeatMs) / 1000;

  return ageInSeconds >= 0 && ageInSeconds <= HEARTBEAT_MAX_AGE_SECONDS;
}

/**
 * Gate check for Marketplace / Fleet Advanced features.
 */
export function canAccessAdvancedFleet(node?: SwalNodeStatus | null, currentTimeMs: number = Date.now()): boolean {
  return isProEnabled(node, currentTimeMs);
}

export function canAccessAdvancedMarketplace(node?: SwalNodeStatus | null, currentTimeMs: number = Date.now()): boolean {
  return isProEnabled(node, currentTimeMs);
}
