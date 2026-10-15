/**
 * prefs-bootstrap.ts — texto del `<script is:inline>` que emite PrefsBootstrap.astro.
 *
 * Vive aparte para que haya UNA copia del texto: la plantilla lo inserta y
 * `src/lib/csp.ts` calcula su SHA-256 para la CSP. Si el script cambia, el hash se
 * recalcula en el build y sigue permitido; si estuviera duplicado, la copia y el hash
 * se desincronizarian y la CSP bloquearia el script (ver tests/csp-inline-hashes.test.ts).
 */
import { PREFS_STORAGE_KEY } from '../prefs.config';
import { prefsBootstrapScript } from '../swal-prefs/bootstrap';

export const PREFS_BOOTSTRAP_SCRIPT = prefsBootstrapScript({ storageKey: PREFS_STORAGE_KEY });

/**
 * Scripts inline generados por codigo (no viven en un fichero .js propio). Son parte de
 * la lista de hashes de la CSP, igual que los de `src/lib/inline/*.js`.
 */
export const GENERATED_INLINE_SCRIPTS: string[] = [PREFS_BOOTSTRAP_SCRIPT];
