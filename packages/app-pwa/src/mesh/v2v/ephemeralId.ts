/**
 * ephemeralId.ts — El id que viaja en las balizas V2V.
 *
 * Reglas: nace de una semilla aleatoria del dispositivo que se renueva cada dia UTC, y el id
 * rota cada ~10 minutos dentro del dia. Nunca se deriva de la cuenta, el tenant ni el VIN: ni
 * siquiera se guarda en disco, asi que al cerrar la pestaña la semilla desaparece. El rodar
 * del id evita que un observador pegado a la via siga a un coche por un trayecto largo; el
 * rodar de la semilla corta cualquier enlace entre un dia y el siguiente.
 *
 * Las rotaciones caen en instantes fijos del reloj (multiplos de 10 min desde las 00:00 UTC),
 * iguales para todos: asi "aparecio un id nuevo justo cuando desaparecio el viejo" no delata
 * a nadie, porque todos los vehiculos cambian a la vez.
 */

export const ID_ROTATE_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface EphemeralIdOptions {
  now?: () => number;
  /** Fuente de bytes aleatorios. Por defecto crypto.getRandomValues. */
  randomBytes?: (n: number) => Uint8Array;
  rotateMs?: number;
}

function defaultRandom(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** Mezcla de 32 bits (murmur3 finalizado) sobre semilla + ranura. No es un hash criptografico:
 *  la semilla es secreta y aleatoria, y el id solo debe ser opaco e impredecible entre ranuras. */
function mix(seed: Uint8Array, slot: number): number {
  let h = 0x9e3779b9 ^ slot;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed[i], 0x85ebca6b);
    h = (h << 13) | (h >>> 19);
    h = Math.imul(h, 5) + 0xe6546b64;
  }
  h ^= seed.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface EphemeralIdSource {
  /** Id u32 vigente en este instante. */
  current(): number;
  /** Numero de ranura (dia UTC, ranura del dia) por si la UI quiere avisar de la rotacion. */
  slot(): string;
}

export function createEphemeralIdSource(opts: EphemeralIdOptions = {}): EphemeralIdSource {
  const now = opts.now ?? (() => Date.now());
  const random = opts.randomBytes ?? defaultRandom;
  const rotate = opts.rotateMs ?? ID_ROTATE_MS;
  let day = -1;
  let seed: Uint8Array = new Uint8Array(16);

  function refresh() {
    const t = now();
    const d = Math.floor(t / DAY_MS);
    // Semilla nueva al cambiar de dia UTC (tambien si el reloj salta hacia atras).
    if (d !== day) {
      seed = random(16);
      day = d;
    }
    return { d, s: Math.floor((t - d * DAY_MS) / rotate) };
  }

  return {
    current() {
      const { s } = refresh();
      return mix(seed, s);
    },
    slot() {
      const { d, s } = refresh();
      return `${d}:${s}`;
    },
  };
}
