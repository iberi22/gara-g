/**
 * csp.ts — la CSP de GARA-G en un solo sitio, para el build y para los tests.
 *
 * Lo importa `astro.config.mjs` (contexto Node del build) y los tests. NUNCA se importa
 * desde codigo de navegador ni del Worker: usa `node:crypto` y `node:fs`. Las directivas
 * son las mismas que usa el respaldo del middleware (src/lib/securityHeaders.ts, que si
 * corre en el Worker): se importan de alli para que no puedan discrepar.
 *
 * --- Por que con `security.csp` de Astro y hashes, y no calculando la CSP por pagina ---
 *
 * Fi'ze (hosteler-ia) usa `security.csp`: Astro hashea lo que genera el framework y el
 * proyecto aporta los hashes de sus `<script is:inline>` desde constantes. GARA-G tiene
 * ademas el ClientRouter de Astro en TODAS las paginas, y eso manda: en cada navegacion
 * interna el router re-crea y re-ejecuta los scripts de la pagina nueva DENTRO del
 * documento actual (astro/dist/transitions/router.js). La CSP que gobierna es la del
 * documento inicial, asi que la lista de hashes tiene que ser GLOBAL (los scripts de
 * todas las paginas) o la navegacion interna se queda a medias.
 *
 * `security.csp.scriptDirective.hashes` es exactamente eso: una lista estatica que Astro
 * emite en la politica de TODAS las paginas. Por eso los scripts inline de la app estan
 * escritos con `set:html={...}` sobre un fichero de `src/lib/inline/` (texto constante) y
 * no con `define:vars`, que interpola datos de la request dentro del propio script y hace
 * el hash imposible: los datos que antes viajaban interpolados van en un
 * `<script type="application/json">`, que el navegador no ejecuta y al que `script-src`
 * no aplica. Ver GenericTableAstro.astro y catalog.astro.
 *
 * tests/csp-inline-hashes.test.ts recalcula el SHA-256 de cada fichero de
 * `src/lib/inline/` y exige que este en esta lista, asi que un script inline que se anada
 * sin su hash rompe la suite antes de que lo rompa la CSP en produccion.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { GENERATED_INLINE_SCRIPTS } from './inline/prefs-bootstrap';
import {
  CLOUDFLARE_INSIGHTS_BEACON_ORIGIN,
  CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN,
  cspDirectives,
  signalOriginsFrom,
} from './securityHeaders';

const INLINE_DIR = fileURLToPath(new URL('./inline/', import.meta.url));

/** Ruta en el repositorio de los scripts inline (para mensajes de error y tests). */
export const INLINE_SCRIPT_DIR = 'packages/app-pwa/src/lib/inline';

/** Hash de un script/estilo inline, en el formato que pide CSP3. */
export function sha256(text: string): string {
  return `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;
}

/**
 * Scripts inline que viven en `src/lib/inline/`. Se leen del disco: es el MISMO contenido
 * byte a byte que emite la plantilla (`?raw` devuelve el fichero tal cual). Ordenados por
 * nombre para que la lista de hashes sea reproducible.
 */
export function inlineScriptTexts(): { file: string; text: string }[] {
  return readdirSync(INLINE_DIR)
    .filter((name) => name.endsWith('.js'))
    .sort()
    .map((file) => ({ file, text: readFileSync(INLINE_DIR + file, 'utf8') }));
}

/** Hashes de TODOS los scripts inline de la app: la lista global de `script-src`. */
export function scriptHashes(): string[] {
  return [
    ...inlineScriptTexts().map(({ text }) => sha256(text)),
    ...GENERATED_INLINE_SCRIPTS.map((text) => sha256(text)),
  ];
}

/** `PUBLIC_MESH_SIGNAL_URL` del build: mismo valor que ve el codigo (src/mesh/node.ts). */
export const MESH_SIGNAL_URL = process.env.PUBLIC_MESH_SIGNAL_URL;

/** Config que consume `security.csp` de Astro (ver astro.config.mjs). */
export function cspConfig(signalUrl: string | undefined = MESH_SIGNAL_URL) {
  return {
    algorithm: 'SHA-256' as const,
    directives: cspDirectives(signalUrl),
    scriptDirective: {
      hashes: scriptHashes(),
      // Cloudflare Web Analytics (inyectado en el edge): el beacon carga de
      // static.cloudflareinsights.com. `resources` SOBREESCRIBE las fuentes por defecto
      // de Astro, asi que hay que repetir `'self'` o se pierde (ver la doc de
      // security.csp.scriptDirective.resources). Sin comodines ni 'unsafe-inline'.
      resources: ["'self'", CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN],
    },
    styleDirective: {
      // Los `style="..."` (los usa el shell y varias paginas) los gobierna
      // `style-src-attr`, que cae a `style-src` cuando no se declara: con hashes en
      // `style-src` y sin `'unsafe-inline'` quedarian bloqueados y el layout perderia el
      // fondo. Se permite solo en el ambito de atributo.
      resources: [{ resource: "'unsafe-inline'", kind: 'attribute' as const }],
    },
  };
}

export {
  CLOUDFLARE_INSIGHTS_BEACON_ORIGIN,
  CLOUDFLARE_INSIGHTS_SCRIPT_ORIGIN,
  cspDirectives,
  signalOriginsFrom,
};
