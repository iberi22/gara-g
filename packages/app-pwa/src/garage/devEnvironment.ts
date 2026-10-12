/**
 * devEnvironment.ts — ¿Estamos en desarrollo/tests de forma EXPLICITA?
 *
 * Los secretos HMAC del garage (tokens de anuncios, pseudonimos del foro) tienen una clave
 * fija de desarrollo. Usarla "si no es production" es un fallo ABIERTO: con un binding mal
 * configurado (ENVIRONMENT ausente) la clave publica del repo firmaria en produccion. Por eso
 * la regla es una lista blanca corta: ENVIRONMENT en development/dev/test, o sin ENVIRONMENT
 * declarado pero corriendo bajo Vite dev o vitest. Un ENVIRONMENT declarado distinto manda
 * sobre todo lo demas.
 */
import { env } from 'cloudflare:workers';

export function isExplicitDev(): boolean {
  const declared = (env as unknown as { ENVIRONMENT?: string }).ENVIRONMENT?.toLowerCase();
  if (declared === 'development' || declared === 'dev' || declared === 'test') return true;
  if (declared !== undefined && declared !== '') return false;
  const viteDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV;
  if (viteDev === true) return true;
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return Boolean(nodeEnv?.VITEST);
}
