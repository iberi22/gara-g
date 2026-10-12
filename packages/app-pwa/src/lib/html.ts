/**
 * lib/html.ts — el unico lugar donde se escapa texto para meterlo en HTML.
 *
 * Leaflet no escapa nada: `bindTooltip`, `bindPopup` y `divIcon({html})` toman
 * una cadena y la interpretan como marcado. Los nombres de geocerca, las placas
 * y los VIN los elige un usuario, asi que interpolarlos sin escapar es un XSS
 * almacenado que se ejecuta en el navegador de todos los que abran el mapa.
 *
 * Antes de este modulo habia DOS copias distintas de `escapeHtml`, una inline en
 * `fleet/geofences/index.astro` (que si escapaba el apóstrofo) y otra privada en
 * `lib/magic-link.ts` (que no). Cuatro componentes segulian sin escapar: el mapa
 * de geocercas, el de vehiculos, el de telemetria y el calculador del catalogo.
 */

/** Escapa `& < > " '` — suficiente para contenido de texto y para atributos. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
