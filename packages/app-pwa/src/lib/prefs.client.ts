/**
 * prefs.client.ts — Store unico de preferencias de GARA-G en el navegador.
 *
 * Todas las islas (menu, garage, onboarding, ajustes) importan este mismo objeto: un solo
 * cache local y un solo evento `swal:prefschange`. Solo para codigo de cliente.
 */
import { createPrefsStore } from './swal-prefs';
import { GARA_PREFS_SCHEMA, PREFS_ENDPOINT, PREFS_STORAGE_KEY } from './prefs.config';

export const prefsStore = createPrefsStore({
  schema: GARA_PREFS_SCHEMA,
  endpoint: PREFS_ENDPOINT,
  storageKey: PREFS_STORAGE_KEY,
});

/**
 * Mismas preferencias, pero sin red: para quien no tiene sesion (modo local). `/api/prefs`
 * exige sesion y respondia 401 en cada carga y cada guardado; aqui el fetcher falla sin salir
 * del navegador, asi que las preferencias quedan en localStorage y no hay ruido en la consola.
 */
export const localPrefsStore = createPrefsStore({
  schema: GARA_PREFS_SCHEMA,
  endpoint: PREFS_ENDPOINT,
  storageKey: PREFS_STORAGE_KEY,
  fetcher: () => Promise.reject(new Error('modo local: sin servidor')),
});
