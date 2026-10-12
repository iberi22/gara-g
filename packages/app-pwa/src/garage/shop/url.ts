/**
 * url.ts — Validacion de URLs https para anuncios.
 *
 * Existe como modulo aparte (y no como helper suelto de la ruta) porque es la unica
 * barrera que separa "el anunciante manda a un sitio" de "el anunciante manda a un
 * script". Vive en la isla del shop para que las rutas y el portal usen EXACTAMENTE la
 * misma regla: si la ruta valida una cosa y la UI otra, la UI termina ..
 * <<creyendo>> que un anuncio es valido cuando la ruta lo va a rechazar.
 */
const HTTPS_URL = /^https:\/\/[^\s"'<>]+$/i;

/** URLs de redireccion permitidas dentro de la app: rutas internas, sin `//` ni esquemas. */
const INTERNAL_PATH = /^\/[\w\-./%?=&:@]*(?:[?#][^\s"'<>]*)?$/;

/** true si es una URL https absoluta y parseable. */
export function isValidHttpsUrl(value: string | undefined | null): boolean {
  if (!value || !HTTPS_URL.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Destino seguro para un 302. Prioriza https externo (validado) y, si no hay,
 * una ruta interna. Cualquier otra cosa cae en `fallback`: al redirect de un clic solo
 * puede ir a la web del anunciante o a la pagina del garage, nunca a un esquema raro
 * (`javascript:`, `data:`, un host de confianza pero http) que el navegador ejecutaria.
 */
export function safeRedirectTarget(url: string | undefined | null, fallback: string): string {
  if (isValidHttpsUrl(url)) return url as string;
  if (url && INTERNAL_PATH.test(url) && !url.startsWith('//')) return url;
  return fallback;
}