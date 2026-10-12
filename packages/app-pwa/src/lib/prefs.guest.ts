/**
 * prefs.guest.ts — Entrar y salir del modo local (sin cuenta) desde el navegador.
 *
 * La cookie `gara_mode=guest` la lee el middleware (src/middleware.ts) para dejar pasar a las
 * paginas de GUEST_ALLOWED_PATHS sin sesion. No es una credencial: no abre ninguna API.
 * Solo para codigo de cliente. Los nombres y la duracion viven en lib/appMode.ts.
 */
import { GUEST_COOKIE, GUEST_COOKIE_VALUE, MODE_COOKIE_MAX_AGE } from './appMode';

const secure = (): string => (typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '');

/** Fija la cookie de modo local (un año). */
export function enterGuestMode(): void {
  document.cookie = `${GUEST_COOKIE}=${GUEST_COOKIE_VALUE}; Max-Age=${MODE_COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure()}`;
}

/** Borra la cookie de modo local. Los datos locales (IndexedDB, localStorage) se quedan. */
export function leaveGuestMode(): void {
  document.cookie = `${GUEST_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure()}`;
}
