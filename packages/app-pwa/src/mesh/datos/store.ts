/**
 * store.ts — Persistencia local del mercado (bandeja, ofertas propias, bloqueos, consentimiento).
 *
 * Mismo enfoque que el almacen local del garage (src/lib/local): IndexedDB con `idb`, cargado
 * con import dinamico para que no entre al bundle SSR del Worker. Va en una base propia
 * (`gara-mercado`) y no en `gara-local`: esa base se respalda cifrada y se fusiona entre
 * dispositivos con un esquema versionado, y la bandeja de ofertas ajenas no debe entrar ahi.
 * Si IndexedDB falla (navegacion privada antigua, SSR, tests) cae a memoria sin romper nada.
 */
import type { OptInPreferences } from '../../lib/marketplaceOptIn';
import type { DemandDetail } from './demand';
import type { VendorOffer } from './offer';

export interface ReceivedOffer {
  offer: VendorOffer;
  /** Nodo vendedor (el `from` verificado del mensaje). */
  from: string;
  receivedAt: number;
}

export interface PersistedMarket {
  v: 1;
  received: ReceivedOffer[];
  own: VendorOffer[];
  blockedSellers: string[];
  blockedOffers: string[];
  dismissed: string[];
  reports: { offerId: string; from: string; reason: string; at: number }[];
  prefs: OptInPreferences | null;
  demandEnabled: boolean;
  demandDetail: DemandDetail;
  region: string | null;
  /** Ultima vez que se publico demanda por necesidad (clave local, nunca sale). */
  lastDemand: Record<string, number>;
}

export const EMPTY_PERSISTED: PersistedMarket = {
  v: 1,
  received: [],
  own: [],
  blockedSellers: [],
  blockedOffers: [],
  dismissed: [],
  reports: [],
  prefs: null,
  demandEnabled: false,
  demandDetail: 'basic',
  region: null,
  lastDemand: {},
};

export interface MarketStore {
  load(): Promise<PersistedMarket | null>;
  save(data: PersistedMarket): Promise<void>;
}

export function createMemoryStore(initial: PersistedMarket | null = null): MarketStore {
  let data: PersistedMarket | null = initial ? structuredClone(initial) : null;
  return {
    async load() {
      return data ? structuredClone(data) : null;
    },
    async save(d) {
      data = structuredClone(d);
    },
  };
}

const DB = 'gara-mercado';
const KEY = 'state';

/** IndexedDB si se puede; si no, memoria. Un solo registro: es un estado chico y se reemplaza entero. */
export function createIdbStore(): MarketStore {
  const mem = createMemoryStore();
  let db: Promise<import('idb').IDBPDatabase | null> | null = null;
  const open = () =>
    (db ??= (async () => {
      try {
        if (typeof indexedDB === 'undefined') return null;
        const { openDB } = await import('idb');
        return await openDB(DB, 1, { upgrade: (d) => void d.createObjectStore('kv') });
      } catch {
        return null;
      }
    })());
  return {
    async load() {
      const d = await open();
      if (!d) return mem.load();
      try {
        const v = (await d.get('kv', KEY)) as PersistedMarket | undefined;
        return v && v.v === 1 ? { ...EMPTY_PERSISTED, ...v } : null;
      } catch {
        return mem.load();
      }
    },
    async save(data) {
      const d = await open();
      if (!d) return mem.save(data);
      try {
        await d.put('kv', structuredClone(data), KEY);
      } catch {
        await mem.save(data);
      }
    },
  };
}
