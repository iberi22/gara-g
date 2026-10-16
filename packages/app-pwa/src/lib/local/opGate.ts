/**
 * opGate.ts — Candado compartido/exclusivo entre operaciones de datos y
 * transiciones de cifrado (activar/desactivar protección).
 *
 * Las transiciones migran TODAS las filas, pero las escrituras capturan estado
 * y clave ANTES del cifrado asíncrono. Sin exclusión, una escritura en curso
 * puede confirmarse después de la migración y quedar en el modo equivocado
 * (fila cifrada con protección "off" y sin sobre, o plaintext con
 * protección activa). Este candado da acceso compartido a las operaciones
 * normales y exclusivo a las transiciones.
 *
 * Vive en su propio módulo para que el adaptador de registros y el almacén de
 * identidad compartan la MISMA puerta (antes el candado era privado del
 * adaptador y los guardados de keypair lo esquivaban).
 */

let pendingDataOps = 0;
let transitionActive = false;
let transitionTail: Promise<void> = Promise.resolve();
const opWaiters: Array<() => void> = [];
const transitionWaiters: Array<() => void> = [];

function flushWaiters(waiters: Array<() => void>): void {
  for (const waiter of waiters.splice(0)) waiter();
}

/** Acceso compartido: muchas operaciones de datos pueden convivir. */
export async function beginDataOp(): Promise<() => void> {
  while (transitionActive) {
    await new Promise<void>((resolve) => opWaiters.push(resolve));
  }
  pendingDataOps++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pendingDataOps--;
    if (pendingDataOps === 0) flushWaiters(transitionWaiters);
  };
}

/** Acceso exclusivo: una transición espera a que terminen los datos en curso. */
export async function beginTransition(): Promise<() => void> {
  // Solo una transición a la vez.
  const previous = transitionTail;
  let releaseTail!: () => void;
  transitionTail = new Promise<void>((resolve) => {
    releaseTail = resolve;
  });
  await previous;

  transitionActive = true;
  while (pendingDataOps > 0) {
    await new Promise<void>((resolve) => transitionWaiters.push(resolve));
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    transitionActive = false;
    releaseTail();
    flushWaiters(opWaiters);
  };
}
