/**
 * src/lib/local/types.ts — Formato del volcado de los datos locales (modo sin cuenta).
 *
 * Contrato entre el almacen IndexedDB (src/lib/local/*) y el respaldo cifrado
 * (src/lib/e2ee/*). El respaldo cifra este objeto entero como JSON; el servidor nunca lo ve
 * en claro. Cambiar la forma exige subir `version` y migrar en importLocalData.
 */
import type { DomainRecord } from '../domain';

export interface LocalTombstone {
  id: string;
  deletedAt: string; // ISO 8601
}

export interface LocalDump {
  version: 1;
  exportedAt: string; // ISO 8601
  /** Registros por entidad de domainConfig (vehicle, maintenance, fuelLog...). */
  entities: Record<string, DomainRecord[]>;
  /** Borrados, para que una fusion no resucite lo que el usuario elimino. */
  deleted: Record<string, LocalTombstone[]>;
  /** Claves de localStorage de la app que tambien se respaldan (prefs, pintura del garage...). */
  kv: Record<string, string>;
}
