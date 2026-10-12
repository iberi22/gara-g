/**
 * tests/html-escape-single-source.test.ts — una sola funcion de escape, y todo
 * sink de HTML con datos de usuario la usa.
 *
 * Contexto: `lib/html.ts` nacio al unificar DOS copias distintas de
 * `escapeHtml` (una inline en `fleet/geofences/index.astro` que si escapaba el
 * apostrofo, otra privada en `lib/magic-link.ts` que no) y al cerrar cuatro
 * interpolaciones sin escapar en los mapas. Este test fija las dos cosas para
 * que no vuelvan: que no reaparezcan copias, y que los sinks sigan escapando.
 *
 * Es un test de ESTRUCTURA: recorre ficheros y compara texto. No pretende
 * demostrar nada sobre autorizacion ni sobre el render; lo que fija es una
 * invariante de codigo. El comportamiento del escape en si esta en
 * `map-tooltip-xss.test.ts`, que monta el resultado en un DOM de verdad.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const CANONICO = join(SRC, 'lib/html.ts');

/**
 * Interpolaciones dentro de un template literal que se pasa a un sink. Se
 * busca `${...}` sin escapar: si el valor ya pasa por escapeHtml, el nombre del
 * helper aparece justo despues de `${`.
 */
const INTERPOLACION = /\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;

function ficheros(dir = SRC, exts = ['.svelte', '.astro', '.ts'], acc: string[] = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) ficheros(p, exts, acc);
    else if (exts.some((x) => e.endsWith(x))) acc.push(p);
  }
  return acc;
}

function rel(f: string) {
  return f.slice(SRC.length + 1);
}

/**
 * Interpolaciones que NO necesitan escape, cada una con su motivo:
 *
 *   · `color`                  -> `colorForType()` devuelve solo literales hex
 *                                  de un switch cerrado ('#f59e0b', '#ef4444',
 *                                  ...). No sale del tipo de la geocerca.
 *   · `gf.alertOnEnter ? … : …` -> los dos lados son emojis literales en el
 *                                  propio codigo. La condicion es un booleano.
 *   · `row.formatted*`         -> `livePoll.ts:93-96` las construye con
 *                                  `${speed} km/h` y `toLocaleString('es-CO')`:
 *                                  son numeros formateados, nunca texto libre.
 *   · `new Date(…).to…()`      -> la hora de un timestamp ISO.
 *   · `record.speed`, `.rpm`   -> `OBD2Simulator` genera estos numeros; no
 *     `.coolantTemp`, …           hay texto libre. Y si lo hubiera, sus tipos
 *                                  son number, no string.
 */
const INTERPOLACIONES_SEGURAS = [
  /^color$/,
  /alertOn(Enter|Exit)\s*\?/,
  /^row\.formatted(Speed|Rpm|Temp|Fuel)$/,
  /^new Date\(/,
  /^record\.(speed|rpm|coolantTemp|fuelLevel|latitude|longitude|timestamp)/,
];

/** Sinks que interpretan su argumento como marcado, no como texto. */
const sinSink = /\b(?:bindTooltip|bindPopup)\s*\(|\bdivIcon\s*\(\s*\{|\.innerHTML\s*=/;

describe('el escape de HTML tiene una sola fuente', () => {
  it('lib/html.ts es el unico que define escapeHtml', () => {
    const definiciones: string[] = [];
    for (const f of ficheros()) {
      const src = readFileSync(f, 'utf8');
      if (/(?:function\s+escapeHtml|const\s+escapeHtml\s*=|escapeHtml\s*=\s*\()/m.test(src)) {
        definiciones.push(rel(f));
      }
    }
    expect(definiciones.sort(), 'solo lib/html.ts debe definir escapeHtml').toEqual([
      'lib/html.ts',
    ]);
  });

  it('la copia canonica escapa los cinco caracteres, incluido el apostrofe', () => {
    const src = readFileSync(CANONICO, 'utf8');
    for (const [nombre, patron] of [
      ['&', /&amp;/],
      ['<', /&lt;/],
      ['>', /&gt;/],
      ['"', /&quot;/],
      ["'", /&#39;/],
    ] as const) {
      expect(src, `falta el escape de ${nombre}`).toMatch(patron);
    }
  });
});

describe('los sinks que reciben datos de usuario los escapan', () => {
  /**
   * Devuelve las interpolaciones SIN escapar de todos los template literals que
   * se pasan a un sink de HTML.
   *
   * El truco esta en emparejar el sink con la CADENA que se le pasa, no con los
   * 400 caracteres siguientes: en `GeofenceMap.svelte` el sink es
   * `layer.bindTooltip(tooltipContent)` y la cadena se construyo treinta lineas
   * antes, en `const tooltipContent = \`...\``. Mirar solo el entorno del sink se
   * lo salta entero.
   *
   * Asi que se hace al reves: se localiza cada asignacion a un template literal
   * cuyo contenido acabe en un sink, y se comprueba ese literal.
   */
  function interpolacionesSinEscapar(src: string): string[] {
    const malas: string[] = [];

    // 1) Todo template literal, con una o varias lineas.
    const literales = [...src.matchAll(/`([^`]*)`/g)];

    // Un literal es peligroso si llega a un sink. Hay dos formas de llegar:
    //
    //   a) por un identificador: `const x = \`…\`` … `sink(x)`. Entre el fin
    //      del literal y el sink solo hay codigo sin otro literal de por medio.
    //   b) en linea: `sink(\`…\`)` — el literal es el propio argumento.
    //   c) dentro de un objeto: `{ html: \`…\` }` que se pasa a `divIcon({…})`.
    const VER_HASTA = 120;

    for (const lit of literales) {
      const [literalCompleto, cuerpo] = lit;
      const fin = lit.index + literalCompleto.length;

      // (b) el literal va justo detras de un sink, sin nada en medio.
      const antes = src.slice(Math.max(0, lit.index - VER_HASTA), lit.index);
      const enLinea = /(?:bindTooltip|bindPopup)\s*\(\s*$/.test(antes);

      // (a) o (c) tras el literal, hasta el sink, sin cruzar otro literal.
      const despues = src.slice(fin, fin + VER_HASTA);
      const siguiente = despues.search(/`/);
      const hastaSiguienteLiteral = siguiente === -1 ? despues : despues.slice(0, siguiente);
      const porVariable = sinSink.test(hastaSiguienteLiteral);

      // (c) el literal es un valor de propiedad y el sink se abre despues.
      const propiedadHtml = /html\s*:\s*$/.test(antes) && sinSink.test(hastaSiguienteLiteral);

      // (c-bis) el literal es el valor de `html:` dentro de un objeto. Aqui el
      // sink se ABRE ANTES del literal, no despues: `divIcon({ …, html: `…` })`.
      // Mirar solo lo que viene despues se lo salta entero, asi que esta forma
      // mira tambien hacia atras, hasta el ultimo `{` o `,`.
      const objetoAbiertoAntes = /(?:divIcon|setIcon|addTo)\s*\(\s*\{[^}]*$/.test(antes);
      const sinkAbiertoAntes = objetoAbiertoAntes && sinSink.test(antes);

      if (!enLinea && !porVariable && !propiedadHtml && !sinkAbiertoAntes) continue;

      const sink =
        enLinea || sinkAbiertoAntes
          ? nombreSink(antes)
          : nombreSink(hastaSiguienteLiteral || despues);

      for (const it of cuerpo.matchAll(/\$\{([^{}]*)\}/g)) {
        const expr = it[1].trim();
        if (expr === '') continue;
        // Valores que por construccion no pueden contener marcado. No son
        // excepciones por conveniencia: cada una se puede demostrar.
        if (INTERPOLACIONES_SEGURAS.some((p) => p.test(expr))) continue;
        if (!/escapeHtml|escapeAttr/.test(expr)) {
          malas.push(`${sink}: \${${expr.slice(0, 60)}}`);
        }
      }
    }
    return malas;
  }

  function nombreSink(despues: string): string {
    if (/bindTooltip|bindPopup/.test(despues)) return 'bindTooltip/bindPopup';
    if (/divIcon/.test(despues)) return 'divIcon';
    return 'innerHTML';
  }

  it('ninguna interpolacion que va a un sink queda sin escapar', () => {
    const malas: string[] = [];
    for (const f of ficheros()) {
      // catalog.astro: sus datos son VEHICLE_CATALOG, estatico del repo, y lo
      // que interpola son numeros ya formateados. No es entrada de usuario.
      if (rel(f) === 'pages/fleet/catalog.astro') continue;
      for (const mala of interpolacionesSinEscapar(readFileSync(f, 'utf8'))) {
        malas.push(`${rel(f)} -> ${mala}`);
      }
    }
    expect(malas, 'interpolaciones sin escapar hacia un sink de HTML').toEqual([]);
  });

  it('los tres mapas que aceptan nombres de usuario los escapan', () => {
    // GeofenceMap (nombre de geocerca), LiveMap (placa y VIN), LiveChart (VIN).
    for (const rel_ of [
      'components/geofence/GeofenceMap.svelte',
      'components/tracking/LiveMap.svelte',
      'components/telemetry/LiveChart.svelte',
    ]) {
      const src = readFileSync(join(SRC, rel_), 'utf8');
      expect(src, `${rel_} debe importar escapeHtml`).toMatch(/import\s*\{[^}]*escapeHtml/);
    }
  });
});
