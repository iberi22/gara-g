/**
 * text.ts — Normalizacion y limites del texto que escribe la gente en el foro/wiki.
 *
 * El foro y la wiki guardan TEXTO PLANO a proposito: el motor de plantillas y el
 * WebView los pintan con `escapeHtml` (src/lib/html.ts). Lo que llega aqui viene
 * de una API publica, asi que antes de tocar la base de datos se limpia:
 *
 *   1. Se quitan los caracteres de control (ANSI escapes, NUL, BOM, los
 *      separadores de ancho cero). Sin esto un titulo puede romper la maqueta del
 *      HUD o inyectar secuencias en la consola del navegador. Se conservan el
 *      salto de linea y el tabulador porque forman parte del texto.
 *   2. Se normalizan los saltos de linea a LF (el cliente puede mandar CRLF) y se
 *      colapsan 3+ lineas vacias en una sola: sin esto, un cuerpo de 5000
 *      caracteres puede ser 4000 lineas en blanco.
 *   3. Se aplica el limite del campo. Limitar ANTES de guardar es lo que evita
 *      que D1 crezca sin control; truncar en silencio no, porque el usuario creeria
 *      que se guardo todo: se rechaza con 400 y se le dice cuanto mando de mas.
 *
 * El HTML nunca se guarda. Si alguien pega `<script>`, queda como texto y la UI lo
 * escapa. Por eso no hay un "sanitizador" que quita etiquetas: quitar solo daria la
 * falsa impresion de que el resto es seguro de ver.
 *
 * Los rangos de caracteres van en hexadecimal numerico y no como escapes dentro de
 * una regex: un `\x00` literal en el fuente es un byte de control en el archivo, y
 * un editor o un formateador puede comerselo sin avisar.
 */

/** Campo -> limites en caracteres. */
export const TEXT_LIMITS = {
  /** Titulo de un hilo: 4 caracteres es el minimo util ("RDT"). */
  title: { min: 4, max: 120 },
  /** Cuerpo de un hilo o de una respuesta. */
  body: { min: 1, max: 5000 },
  /** Cuerpo de una seccion de wiki: es un documento, no un comentario. */
  wikiSection: { min: 1, max: 20000 },
  /** Etiquetas de un hilo. */
  tags: { max: 5, maxLength: 24 },
} as const;

/**
 * ESC (0x1b) y BEL (0x07): anclas de las secuencias de escape de terminal.
 *
 * En NUMERO, no como cadena: el escaner compara `charCodeAt(i)`, y un `ESC` de un
 * caracter comparado con `charCodeAt` daria "siempre distinto" sin avisar, que es
 * justo el fallo que hacia que `stripAnsi` no quitara nada. Para `indexOf` (que si
 * quiere cadena) se derivan abajo.
 */
const ESC_CODE = 0x1b;
const BEL = String.fromCharCode(0x07);
const ST = `${String.fromCharCode(ESC_CODE)}\\`;
/** Final de CSI que es una letra: A-Z y a-z. La "m" del SGR se trata aparte. */
function esLetra(cod: number): boolean {
  return (cod >= 0x41 && cod <= 0x5a) || (cod >= 0x61 && cod <= 0x7a);
}

/**
 * Rangos de control que se eliminan: C0 salvo TAB (0x09), LF (0x0a) y CR (0x0d),
 * mas C1 (0x7f-0x9f) y el caracter de reemplazo U+FFFD.
 */
const CONTROL_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x9f],
  [0xfffd, 0xfffd],
];

/**
 * Quita secuencias de escape de terminal (ECMA-48) del texto.
 *
 * Es un escaner, no una expresion regular, por dos motivos que se probaron en la
 * version con regex:
 *   1. `biome` prohibe caracteres de control dentro de una regex
 *      (`noControlCharactersInRegex`), y las cuatro ramas que hacen falta los
 *      necesitan. Con rangos numericos el patron se vuelve ilegible de todos modos.
 *   2. Una regex con cuatro alternativas y `[^\x07\x1b]*` para las cadenas OSC
 *      retrocede mucho con texto largo, y esto se ejecuta en CADA mensaje escrito.
 *
 * Cubre las tres formas que llegan al pegar texto: CSI ("ESC [ 3 1 m", colores),
 * OSC ("ESC ] 0 ; titulo BEL") y escapes de una pieza ("ESC 7" = guardar cursor).
 * El ANCLA es ESC (0x1b), que nunca aparece en texto legitimo, asi que se puede ser
 * generoso sin riesgo de comerse una palabra. Quitar SOLO el ESC dejaria colgando el
 * "[31m" del color, que es justo lo que hay que quitar.
 */
function stripAnsi(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; ) {
    if (s.charCodeAt(i) !== ESC_CODE) {
      out += s[i];
      i++;
      continue;
    }
    // ESC [ ... final   |   ESC ] ... BEL|ST   |   ESC <1-2 caracteres>
    const clase = s[i + 1];
    if (clase === '[') {
      let j = i + 2;
      // Parametros: numeros, ';' y '?', mas los intermedios 0x20-0x2f.
      while (j < s.length && s.charCodeAt(j) >= 0x20 && s.charCodeAt(j) <= 0x3f) j++;
      const fin = j < s.length ? s.charCodeAt(j) : -1;
      const completa = fin >= 0x40 && fin <= 0x7e;
      // Se conserva la letra cuando el byte final es una letra CON texto detras:
      // "ESC [ a" cierra la secuencia segun ECMA-48, pero perder una letra del
      // mensaje del usuario es peor que mostrar un caracter de mas. Salvo "m" (SGR,
      // colores), que si es una secuencia de verdad y no tiene texto que proteger.
      // Lo mismo con la secuencia truncada: sin byte final se come tambien los
      // parametros, o el "[12" queda colgando, que es justo el residuo que este
      // escaner existe para quitar.
      const protegeTexto = esLetra(fin) && fin !== 0x6d && j + 1 < s.length;
      i = completa && !protegeTexto ? j + 1 : j;
    } else if (clase === ']') {
      // Cadena OSC: hasta BEL o hasta ST (ESC \). Se corta en cualquiera de los dos.
      const bel = s.indexOf(BEL, i + 2);
      const st = s.indexOf(ST, i + 2);
      const fin = [bel, st].filter((p) => p >= 0).sort((a, b) => a - b)[0] ?? -1;
      i = fin < 0 ? s.length : fin + (st >= 0 && st === fin ? 2 : 1);
    } else {
      // ESC seguido de 0x20-0x2f (uno o dos caracteres: ESC 7, ESC ( B).
      i += 2;
      if (clase && clase >= ' ' && clase <= '/' && s[i] && s[i] >= ' ' && s[i] <= '/') i++;
    }
  }
  return out;
}

/** Invisibles que no son de control: U+200B (espacio de ancho cero), U+200C/U+200D
 * (ZWNJ/ZWJ de los alfabetos Indic), U+2060 (word joiner) y U+FEFF (BOM). No
 * ocupan ancho pero rompen la comparacion de cadenas y el ancho de columna. */
const INVISIBLE_POINTS = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

function isControl(cp: number): boolean {
  return CONTROL_RANGES.some(([from, to]) => cp >= from && cp <= to);
}

/** Quita invisibles y de control del texto, dejando saltos de linea y tabuladores. */
export function normalizeText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // CR y CRLF pasan a LF ANTES del bucle. Si cada CR se convirtiera en LF al vuelo,
  // un "\r\n" del cliente (CRLF de Windows) se volverian DOS saltos de linea.
  const sinCR = raw.replace(/\r\n?/g, '\n');
  // Las secuencias ANSI se quitan ANTES del bucle de caracteres de control, porque
  // ESC (0x1b) es un caracter de control: si el bucle corriera primero, se llevaria
  // solo el ESC y dejaria el "[31m" colgando, que es justo lo que se quiere quitar.
  const sinANSI = stripAnsi(sinCR);
  let s = '';
  for (const ch of sinANSI) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isControl(cp) || INVISIBLE_POINTS.has(cp)) continue;
    s += ch;
  }
  // Colapsa espacios y tabuladores horizontales; los saltos de linea se conservan.
  s = s.replace(/[^\S\n]+/g, ' ');
  // Colapsa 3+ lineas vacias (2+ saltos seguidos) en una sola.
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** Resultado de validar un campo; si `ok` es false, `error` va al 400 en espanol. */
export type TextCheck = { ok: true; value: string } | { ok: false; error: string };

/** Cuenta en puntos de codigo, no en unidades UTF-16 (un emoji vale 1, no 2). */
function lengthOf(value: string): number {
  return [...value].length;
}

function checkRange(value: string, field: string, min: number, max: number): TextCheck {
  const n = lengthOf(value);
  if (n < min) return { ok: false, error: `${field}: minimo ${min} caracteres (recibidos ${n})` };
  if (n > max) return { ok: false, error: `${field}: maximo ${max} caracteres (recibidos ${n})` };
  return { ok: true, value };
}

export function cleanTitle(raw: unknown): TextCheck {
  const value = normalizeText(raw);
  if (!value) return { ok: false, error: 'titulo: no puede quedar vacio' };
  return checkRange(value, 'titulo', TEXT_LIMITS.title.min, TEXT_LIMITS.title.max);
}

export function cleanBody(raw: unknown): TextCheck {
  const value = normalizeText(raw);
  if (!value) return { ok: false, error: 'cuerpo: no puede quedar vacio' };
  return checkRange(value, 'cuerpo', TEXT_LIMITS.body.min, TEXT_LIMITS.body.max);
}

export function cleanWikiSection(raw: unknown): TextCheck {
  const value = normalizeText(raw);
  if (!value) return { ok: false, error: 'seccion: no puede quedar vacia' };
  return checkRange(value, 'seccion', TEXT_LIMITS.wikiSection.min, TEXT_LIMITS.wikiSection.max);
}

/**
 * Slug de una etiqueta: minusculas, sin tildes, solo `[a-z0-9-]`, ≤ 24 caracteres.
 *
 * Las etiquetas se pintan como chips y se comparan en el cliente, asi que van
 * como slug y no como texto libre: "Frenos", "frenos" y "FRENOS " son la misma
 * etiqueta. Una etiqueta que al normalizar queda vacia se descarta (no es error:
 * el usuario puso un emoji, no una palabra).
 */
export function slugifyTag(raw: unknown): string {
  const s = normalizeText(raw)
    .toLowerCase()
    .normalize('NFD')
    // Las marcas diacriticas (marcas de acentuacion) son la causa comun del residuo.
    .replace(/\p{Mn}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, TEXT_LIMITS.tags.maxLength).replace(/-+$/, '');
}

/** Etiquetas de un hilo: normaliza, quita vacias, deduplica y corta a 5. */
export function cleanTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const slug = slugifyTag(item);
    if (slug && !out.includes(slug)) out.push(slug);
    if (out.length >= TEXT_LIMITS.tags.max) break;
  }
  return out;
}

/** Primera linea, recortada: para logs y para contextos donde el cuerpo no cabe. */
export function previewLine(text: string, max = 120): string {
  const line = normalizeText(text).split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
