import * as Y from 'yjs';

export interface Fleet {
  id: string;
  name: string;
  organizationId: string;
  region: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Vehicle {
  id: string;
  fleetId: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  status: 'active' | 'maintenance' | 'decommissioned';
  mileage: number;
  createdAt: number;
  updatedAt: number;
}

export class YjsFleetManager {
  private doc: Y.Doc;
  private instanceId: string;
  private fleetsMap: Y.Map<Fleet>;
  private vehiclesMap: Y.Map<Vehicle>;
  private storageAdapter: IndexedDBStorageManager | null = null;

  constructor(instanceId: string = 'default', doc?: Y.Doc) {
    this.instanceId = instanceId;
    this.doc = doc || new Y.Doc();
    this.fleetsMap = this.doc.getMap<Fleet>(`swal/gara-g/${this.instanceId}/fleets`);
    this.vehiclesMap = this.doc.getMap<Vehicle>(`swal/gara-g/${this.instanceId}/vehicles`);
  }

  public async initIndexedDB(): Promise<void> {
    if (typeof window !== 'undefined' && 'indexedDB' in window) {
      this.storageAdapter = new IndexedDBStorageManager(`swal-gara-g-${this.instanceId}`);
      await this.storageAdapter.init();
      const savedDoc = await this.storageAdapter.load();
      if (savedDoc) {
        Y.applyUpdate(this.doc, savedDoc);
      }
      this.doc.on('update', (update: Uint8Array) => {
        this.storageAdapter?.save(Y.encodeStateAsUpdate(this.doc));
      });
    }
  }

  public getDoc(): Y.Doc {
    return this.doc;
  }

  public getFleetsMap(): Y.Map<Fleet> {
    return this.fleetsMap;
  }

  public getVehiclesMap(): Y.Map<Vehicle> {
    return this.vehiclesMap;
  }

  // Fleet CRUD operations
  public createFleet(fleetData: Omit<Fleet, 'createdAt' | 'updatedAt'>): Fleet {
    const now = Date.now();
    const fleet: Fleet = {
      ...fleetData,
      createdAt: now,
      updatedAt: now,
    };
    this.doc.transact(() => {
      this.fleetsMap.set(fleet.id, fleet);
    });
    return fleet;
  }

  public getFleet(id: string): Fleet | undefined {
    return this.fleetsMap.get(id);
  }

  public updateFleet(id: string, updateData: Partial<Omit<Fleet, 'id' | 'createdAt'>>): Fleet | undefined {
    const existing = this.fleetsMap.get(id);
    if (!existing) return undefined;
    const updated: Fleet = {
      ...existing,
      ...updateData,
      updatedAt: Date.now(),
    };
    this.doc.transact(() => {
      this.fleetsMap.set(id, updated);
    });
    return updated;
  }

  public deleteFleet(id: string): boolean {
    if (!this.fleetsMap.has(id)) return false;
    this.doc.transact(() => {
      this.fleetsMap.delete(id);
      // Clean up associated vehicles
      for (const [vId, vehicle] of this.vehiclesMap.entries()) {
        if (vehicle.fleetId === id) {
          this.vehiclesMap.delete(vId);
        }
      }
    });
    return true;
  }

  public listFleets(): Fleet[] {
    return Array.from(this.fleetsMap.values());
  }

  // Vehicle CRUD operations
  public addVehicle(vehicleData: Omit<Vehicle, 'createdAt' | 'updatedAt'>): Vehicle {
    const now = Date.now();
    const vehicle: Vehicle = {
      ...vehicleData,
      createdAt: now,
      updatedAt: now,
    };
    this.doc.transact(() => {
      this.vehiclesMap.set(vehicle.id, vehicle);
    });
    return vehicle;
  }

  public getVehicle(id: string): Vehicle | undefined {
    return this.vehiclesMap.get(id);
  }

  public updateVehicle(id: string, updateData: Partial<Omit<Vehicle, 'id' | 'createdAt'>>): Vehicle | undefined {
    const existing = this.vehiclesMap.get(id);
    if (!existing) return undefined;
    const updated: Vehicle = {
      ...existing,
      ...updateData,
      updatedAt: Date.now(),
    };
    this.doc.transact(() => {
      this.vehiclesMap.set(id, updated);
    });
    return updated;
  }

  public deleteVehicle(id: string): boolean {
    if (!this.vehiclesMap.has(id)) return false;
    this.doc.transact(() => {
      this.vehiclesMap.delete(id);
    });
    return true;
  }

  public listVehicles(fleetId?: string): Vehicle[] {
    const vehicles = Array.from(this.vehiclesMap.values());
    if (fleetId) {
      return vehicles.filter(v => v.fleetId === fleetId);
    }
    return vehicles;
  }

  public subscribe(callback: () => void): () => void {
    const observer = () => callback();
    this.fleetsMap.observe(observer);
    this.vehiclesMap.observe(observer);
    return () => {
      this.fleetsMap.unobserve(observer);
      this.vehiclesMap.unobserve(observer);
    };
  }
}

export class IndexedDBStorageManager {
  private dbName: string;

  constructor(dbName: string) {
    this.dbName = dbName;
  }

  public async init(): Promise<void> {
    // Storage initialization placeholder compatible with IndexedDB StorageManager
  }

  public async load(): Promise<Uint8Array | null> {
    if (typeof window === 'undefined' || !window.indexedDB) return null;
    return new Promise((resolve) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('docstate')) {
          db.createObjectStore('docstate');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('docstate', 'readonly');
        const store = tx.objectStore('docstate');
        const getReq = store.get('update');
        getReq.onsuccess = () => {
          resolve(getReq.result ? new Uint8Array(getReq.result) : null);
        };
        getReq.onerror = () => resolve(null);
      };
      request.onerror = () => resolve(null);
    });
  }

  public async save(update: Uint8Array): Promise<void> {
    if (typeof window === 'undefined' || !window.indexedDB) return;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('docstate', 'readwrite');
        const store = tx.objectStore('docstate');
        store.put(update, 'update');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }
}
