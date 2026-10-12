import { YjsFleetManager, type Fleet, type Vehicle } from './yjsFleet.js';
import {
  enqueue,
  flush,
  attachAutoSync,
  registerBackgroundSync,
  type OutboxOp,
} from './offlineQueue.js';

let fleetManagerInstance: YjsFleetManager | null = null;
let isAutoSyncAttached = false;

export function getFleetManager(instanceId: string = 'default'): YjsFleetManager {
  if (!fleetManagerInstance) {
    fleetManagerInstance = new YjsFleetManager(instanceId);
    if (typeof window !== 'undefined') {
      fleetManagerInstance.initIndexedDB().catch(console.error);
    }
  }
  return fleetManagerInstance;
}

export function createFleetStore(instanceId: string = 'default') {
  const manager = getFleetManager(instanceId);

  const transport = async (op: OutboxOp) => {
    if (op.entity === 'fleet') {
      if (op.action === 'create') manager.createFleet(op.data);
      else if (op.action === 'update') manager.updateFleet(op.entityId, op.data);
      else if (op.action === 'delete') manager.deleteFleet(op.entityId);
    } else if (op.entity === 'vehicle') {
      if (op.action === 'add' || op.action === 'create') manager.addVehicle(op.data);
      else if (op.action === 'update') manager.updateVehicle(op.entityId, op.data);
      else if (op.action === 'delete') manager.deleteVehicle(op.entityId);
    }
  };

  if (typeof window !== 'undefined' && !isAutoSyncAttached) {
    isAutoSyncAttached = true;
    attachAutoSync(() => {
      flush(transport).catch(console.error);
    });
    registerBackgroundSync('gara-flush').catch(() => {});
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      flush(transport).catch(console.error);
    }
  }

  return {
    get fleets(): Fleet[] {
      return manager.listFleets();
    },
    get vehicles(): Vehicle[] {
      return manager.listVehicles();
    },
    listFleets: () => manager.listFleets(),
    listVehicles: (fleetId?: string) => manager.listVehicles(fleetId),
    getFleet: (id: string) => manager.getFleet(id),
    createFleet: (data: Omit<Fleet, 'createdAt' | 'updatedAt'>) => {
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        enqueue({
          idempotencyKey: `fleet-create-${data.id}`,
          entity: 'fleet',
          action: 'create',
          entityId: data.id,
          data,
        }).catch(console.error);
      }
      return manager.createFleet(data);
    },
    updateFleet: (id: string, data: Partial<Omit<Fleet, 'id' | 'createdAt'>>) => {
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        enqueue({
          idempotencyKey: `fleet-update-${id}-${Date.now()}`,
          entity: 'fleet',
          action: 'update',
          entityId: id,
          data,
        }).catch(console.error);
      }
      return manager.updateFleet(id, data);
    },
    deleteFleet: (id: string) => {
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        enqueue({
          idempotencyKey: `fleet-delete-${id}`,
          entity: 'fleet',
          action: 'delete',
          entityId: id,
        }).catch(console.error);
      }
      return manager.deleteFleet(id);
    },
    getVehicle: (id: string) => manager.getVehicle(id),
    addVehicle: (data: Omit<Vehicle, 'createdAt' | 'updatedAt'>) => {
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        enqueue({
          idempotencyKey: `vehicle-add-${data.id}`,
          entity: 'vehicle',
          action: 'add',
          entityId: data.id,
          data,
        }).catch(console.error);
      }
      return manager.addVehicle(data);
    },
    updateVehicle: (id: string, data: Partial<Omit<Vehicle, 'id' | 'createdAt'>>) => {
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        enqueue({
          idempotencyKey: `vehicle-update-${id}-${Date.now()}`,
          entity: 'vehicle',
          action: 'update',
          entityId: id,
          data,
        }).catch(console.error);
      }
      return manager.updateVehicle(id, data);
    },
    deleteVehicle: (id: string) => {
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        enqueue({
          idempotencyKey: `vehicle-delete-${id}`,
          entity: 'vehicle',
          action: 'delete',
          entityId: id,
        }).catch(console.error);
      }
      return manager.deleteVehicle(id);
    },
    flushOutbox: () => flush(transport),
    subscribe: (callback: () => void) => manager.subscribe(callback),
  };
}
