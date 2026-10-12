/**
 * webview.ts — Detección de ejecución dentro del WebView de la app móvil (Flutter/Android/iOS).
 *
 * Se considera modo WebView si el parámetro de consulta `?embed=app` está presente,
 * o si el User-Agent del navegador contiene la firma `GaraGApp`.
 */

/**
 * Determina si la página se está ejecutando dentro del contenedor de la aplicación móvil.
 *
 * @param searchParams Cadena de consulta o instancia de URLSearchParams
 * @param userAgent Cadena de User-Agent opcional (o navigator.userAgent en el navegador)
 */
export function isWebViewMode(
  searchParams?: URLSearchParams | string | null,
  userAgent?: string | null,
): boolean {
  // 1. Evaluar parámetros de URL
  if (searchParams) {
    if (typeof searchParams === 'string') {
      const cleaned = searchParams.startsWith('?') ? searchParams.slice(1) : searchParams;
      const params = new URLSearchParams(cleaned);
      if (params.get('embed') === 'app') return true;
    } else if (searchParams.get('embed') === 'app') {
      return true;
    }
  } else if (typeof window !== 'undefined' && window.location?.search) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('embed') === 'app') return true;
  }

  // 2. Evaluar User Agent
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  if (ua && ua.includes('GaraGApp')) {
    return true;
  }

  return false;
}
