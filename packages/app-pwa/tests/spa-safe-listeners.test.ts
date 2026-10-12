/**
 * tests/spa-safe-listeners.test.ts — todo script que ata listeners se vuelve a
 * ejecutar en cada navegación del ClientRouter.
 *
 * El fallo que cubre: con el ClientRouter de Astro, `document` sobrevive a la
 * navegación pero los nodos se sustituyen. Un `<script>` normal (de módulo) se
 * ejecuta UNA vez; un `<script is:inline>` o con `define:vars` también, porque
 * el navegador no vuelve a parsearlo. Los listeners quedan apuntando a nodos
 * que ya no existen y la interacción muere en cuanto el usuario navega una vez.
 *
 * Casos reales que este test cierra:
 *   · FleetLayout.astro         — el hamburguesa dejaba de abrir el drawer.
 *   · geofences/index.astro     — `DOMContentLoaded` no se re-dispara, así que
 *                                 el toggle mapa/tabla quedaba sin conectar.
 *   · geofences/edit/[id].astro — ídem, y el mapa de edición salía vacío.
 *   · UploadWidget.astro        — el nombre del fichero no se actualizaba.
 *   · GenericTableAstro.astro   — buscador y Exportar CSV muertos (`define:vars`
 *                                 implica `is:inline`).
 *   · fleet/users/index.astro    — "Crear usuario" no enviaba nada. Este NO
 *                                 venia en el informe; lo encontro el test.
 *
 * Es un test de ESTRUCTURA: no arranca un navegador ni navega. Comprueba la
 * invariante que hace posible que la navegación interna funcione, no que
 * funcione. El comportamiento en navegador se cubre en tests/e2e.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function ficheros(dir = SRC, acc: string[] = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) ficheros(p, acc);
    else if (e.endsWith('.astro') || e.endsWith('.svelte')) acc.push(p);
  }
  return acc;
}

function rel(f: string) {
  return f.slice(SRC.length + 1);
}

/** Bloques <script> del fichero con su cuerpo. */
function scriptsDe(src: string): string[] {
  const cuerpos: string[] = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  for (const m of src.matchAll(re)) {
    const apertura = m[0].slice(0, m[0].indexOf('>') + 1);
    // Un <script src> no lleva codigo: lo carga el navegador como modulo.
    if (/\bsrc\s*=/.test(apertura)) continue;
    cuerpos.push(m[1]);
  }
  return cuerpos;
}

const ATA_LISTENER =
  /addEventListener\s*\(\s*['"](?:click|input|change|submit|keydown|keyup|mouseenter|focus)['"]/;

describe('los scripts con listeners se re-ejecutan en cada navegacion', () => {
  const todos = ficheros();

  it('ha encontrado ficheros que auditar', () => {
    expect(todos.length).toBeGreaterThan(10);
  });

  it('ningun script ata listeners sin re-ejecutarse en astro:page-load', () => {
    const culpables: string[] = [];
    for (const f of todos) {
      const src = readFileSync(f, 'utf8');
      scriptsDe(src).forEach((cuerpo, i) => {
        // Un MediaQueryList (`window.matchMedia(...)`) no es un nodo: sobrevive a la
        // navegacion igual que `document`, asi que su 'change' no cuenta (ThemeBootstrap).
        const sinMedia = cuerpo.replace(/\bmedia(?:Query)?\.addEventListener\s*\(\s*['"]change['"]/g, '');
        if (!ATA_LISTENER.test(sinMedia)) return;
        // Se acepta cualquiera de las dos vias: re-ejecutar en astro:page-load,
        // o un guard por elemento (`data-bound`) que hace idempotente el
        // registro. Lo segundo es lo que ya hace EntityForm.astro.
        const spaSafe = /astro:page-load/.test(cuerpo) || /data-bound/.test(cuerpo);
        if (!spaSafe) culpables.push(`${rel(f)} [script ${i + 1}]`);
      });
    }
    expect(culpables, 'scripts con listeners que no se re-vinculan').toEqual([]);
  });

  it('ningun script depende de DOMContentLoaded para su interaccion', () => {
    // `DOMContentLoaded` ocurre una vez por carga de documento. Con el
    // ClientRouter no vuelve a dispararse, asi que un listener atado ahi está
    // muerto en toda navegación posterior. Se permite mencionarlo SI el
    // listener va con `astro:page-load` al lado (el patrón de EntityForm.astro,
    // que conecta en ambos por si la app se sirve sin ViewTransitions).
    const culpables: string[] = [];
    for (const f of todos) {
      const src = readFileSync(f, 'utf8');
      for (const cuerpo of scriptsDe(src)) {
        const usaDOMContent = /DOMContentLoaded/.test(cuerpo);
        if (!usaDOMContent) continue;
        const tambienSPA = /astro:page-load/.test(cuerpo);
        if (!tambienSPA) culpables.push(rel(f));
      }
    }
    expect(culpables, 'scripts que dependen solo de DOMContentLoaded').toEqual([]);
  });

  it('los seis casos reales estan cubiertos uno por uno', () => {
    // Si alguien revierte el fix de uno de ellos, este caso lo dice por nombre.
    // Se busca la LLAMADA real, no la palabra: un comentario que menciona
    // `astro:page-load` explicando el problema no cuenta como estar arreglado.
    const esperados: [string, string][] = [
      [
        'layouts/FleetLayout.astro',
        /addEventListener\(\s*['"]astro:page-load['"]\s*,\s*initSidebar\s*\)/,
      ],
      [
        'pages/fleet/geofences/index.astro',
        /addEventListener\(\s*['"]astro:page-load['"]\s*,\s*setupToggle\s*\)/,
      ],
      [
        'pages/fleet/geofences/edit/[id].astro',
        /addEventListener\(\s*['"]astro:page-load['"]\s*,\s*initEditMap\s*\)/,
      ],
      [
        'components/UploadWidget.astro',
        /addEventListener\(\s*['"]astro:page-load['"]\s*,\s*initUploadLabels\s*\)/,
      ],
      [
        'components/GenericTableAstro.astro',
        /addEventListener\(\s*['"]astro:page-load['"]\s*,\s*initTable\s*\)/,
      ],
      [
        'pages/fleet/users/index.astro',
        /addEventListener\(\s*['"]astro:page-load['"]\s*,\s*bindCreateUser\s*\)/,
      ],
    ];
    for (const [fichero, patron] of esperados) {
      const src = readFileSync(join(SRC, fichero), 'utf8');
      expect(src, `${fichero} debe re-vincular en astro:page-load`).toMatch(patron);
    }
  });
});
