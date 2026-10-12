/**
 * prefs.server.ts — Lectura y escritura de las preferencias de interfaz de un usuario.
 *
 * Una fila `preference` por usuario y tenant, con id `pref:<userId>`: siguen al usuario
 * entre equipos. Lo guardado se resuelve siempre contra el esquema al leer y al escribir
 * (lib/swal-prefs/resolve.ts), asi que la tabla nunca devuelve claves que la interfaz no
 * conozca. La cookie `gara_onb` evita leer D1 en cada pagina solo para decidir si mostrar
 * el onboarding (ver middleware.ts).
 */
import { createEntity, getEntity, updateEntity } from './domain';
import { GARA_PREFS_SCHEMA, ONBOARDED_COOKIE } from './prefs.config';

export { ONBOARDED_COOKIE };
import { resolvePrefs, type Preferences } from './swal-prefs';

/** Tope del cuerpo de PUT /api/prefs: el esquema completo resuelto ocupa ~2 KB. */
export const MAX_PREFS_BYTES = 16_384;

const prefId = (userId: string) => `pref:${userId}`;

export async function loadUserPrefs(userId: string, instanceId: string): Promise<Preferences> {
  const row = await getEntity<{ prefs?: unknown }>('preference', prefId(userId), instanceId);
  return resolvePrefs(GARA_PREFS_SCHEMA, row?.prefs);
}

export async function saveUserPrefs(userId: string, instanceId: string, input: unknown): Promise<Preferences> {
  const prefs: Preferences = { ...resolvePrefs(GARA_PREFS_SCHEMA, input), updatedAt: new Date().toISOString() };
  // Lo que llega se resuelve con la version actual: un cliente viejo no puede marcar
  // onboarded una version de esquema que no ha visto (resolvePrefs exige version igual).
  const id = prefId(userId);
  const existing = await getEntity('preference', id, instanceId);
  if (existing) await updateEntity('preference', id, { userId, prefs }, instanceId);
  else await createEntity('preference', { userId, prefs }, instanceId, { id });
  return prefs;
}

/** Cabecera Set-Cookie que recuerda en este navegador que ESTE usuario ya hizo el onboarding. */
export function onboardedCookie(userId: string, secure: boolean): string {
  return `${ONBOARDED_COOKIE}=${encodeURIComponent(userId)}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${secure ? '; Secure' : ''}`;
}
