/**
 * text.test.ts — Normalizacion y limites del texto de la comunidad.
 *
 * Lo que se comprueba aqui es lo que evita que un texto pegado desde otro sitio
 * (con ANSI escapes, BOM, 300 lineas en blanco o 10 000 caracteres) acabe en la
 * instancia compartida y luego en el HUD de todos.
 */
import { describe, expect, it } from 'vitest';
import {
  TEXT_LIMITS,
  cleanBody,
  cleanTags,
  cleanTitle,
  cleanWikiSection,
  normalizeText,
  previewLine,
  slugifyTag,
} from './text';

describe('normalizeText', () => {
  it('recorta los bordes y unifica espacios', () => {
    expect(normalizeText('   hola    mundo   ')).toBe('hola mundo');
  });

  it('quita caracteres de control pero conserva el salto de linea', () => {
    const conControl = `linea 1${String.fromCharCode(0)}con NUL${String.fromCharCode(7)}y BEL`;
    expect(normalizeText(conControl)).toBe('linea 1con NULy BEL');
    expect(normalizeText('uno\ndos')).toBe('uno\ndos');
  });

  it('quita una secuencia de escape ANSI completa', () => {
    // ESC [ 3 1 m = rojo; ESC [ 0 m = reset. Se construye con fromCharCode porque
    // escribir el ESC literal en el fuente mete un byte de control en el archivo.
    const esc = String.fromCharCode(0x1b);
    expect(normalizeText(`${esc}[31mOJO${esc}[0m`)).toBe('OJO');
    // Tambien el caso de escapes de una pieza: ESC 7 = guardar cursor, ESC c = reset.
    expect(normalizeText(`antes${esc}7despues`)).toBe('antesdespues');
    expect(normalizeText(`antes${esc}cdespues`)).toBe('antesdespues');
  });

  it('quita cadenas OSC (ESC ] ... BEL), que son las que cortan a media linea', () => {
    const esc = String.fromCharCode(0x1b);
    const bel = String.fromCharCode(0x07);
    // Titulo de ventana de terminal: "ESC ] 0 ; mi titulo BEL".
    expect(normalizeText(`antes${esc}]0;mi titulo${bel}despues`)).toBe('antesdespues');
    // Cerrada por ST (ESC \) en vez de por BEL.
    expect(normalizeText(`antes${esc}]0;x${esc}\\despues`)).toBe('antesdespues');
    // Sin cierre: se come el resto (no se puede saber donde acaba).
    expect(normalizeText(`antes${esc}]0;colgado`)).toBe('antes');
  });

  it('quita secuencias truncadas sin comerse el texto valido de despues', () => {
    const esc = String.fromCharCode(0x1b);
    // CSI con parametros y sin byte final ("ESC [ 1 2" a media escribir): se come la
    // secuencia ENTERA. Quedarse solo con el ESC dejaria el "[12" colgando, que es
    // el residuo que este escaner existe para quitar.
    expect(normalizeText(`${esc}[12`)).toBe('');
    // Con parametros, la palabra detras se conserva entera.
    expect(normalizeText(`${esc}[12aviso`)).toBe('aviso');
    // Sin parametros, una letra es el byte final segun ECMA-48 ("ESC [ a" cierra la
    // secuencia). Aun asi se conserva: perder la letra BORRA texto del usuario, y
    // dejar un caracter de mas es el error mas barato. Con el ESC y el "[" fuera.
    expect(normalizeText(`${esc}[aviso`)).toBe('aviso');
    expect(normalizeText(`antes${esc}[`)).toBe('antes');
    // Un "[" suelto sin ESC no es una secuencia: el texto vale entero.
    expect(normalizeText('antes[')).toBe('antes[');
  });

  it('NO toca texto que parece un escape pero no lo es', () => {
    // El corchete solo, sin ESC delante, es texto legitimo y se conserva.
    expect(normalizeText('arreglo [0] y lista [1m]')).toBe('arreglo [0] y lista [1m]');
    expect(normalizeText('antes[')).toBe('antes[');
  });

  it('el texto sin escapes sale identico', () => {
    const normal = 'Cambie el aceite a los 4000 km (5W-30).\nSegunda linea.';
    expect(normalizeText(normal)).toBe(normal);
  });

  it('quita invisibles de ancho cero y el BOM', () => {
    expect(normalizeText('a\u200bb\u2060c\ufeffd')).toBe('abcd');
  });

  it('normaliza CRLF y CR a LF', () => {
    expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('colapsa 3 o mas lineas vacias en una sola', () => {
    expect(normalizeText('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('devuelve cadena vacia si no es texto', () => {
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(42)).toBe('');
  });
});

describe('limites por campo', () => {
  it('titulo: rechaza menos de 4 caracteres', () => {
    const r = cleanTitle('RDT');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/minimo 4/);
  });

  it('titulo: acepta 120 y rechaza 121', () => {
    expect(cleanTitle('a'.repeat(120)).ok).toBe(true);
    expect(cleanTitle('a'.repeat(121)).ok).toBe(false);
  });

  it('cuerpo: acepta 1 caracter y rechaza 5001', () => {
    expect(cleanBody('x').ok).toBe(true);
    expect(cleanBody('x'.repeat(TEXT_LIMITS.body.max)).ok).toBe(true);
    expect(cleanBody('x'.repeat(TEXT_LIMITS.body.max + 1)).ok).toBe(false);
  });

  it('seccion de wiki: acepta 20000 y rechaza 20001', () => {
    expect(cleanWikiSection('x'.repeat(TEXT_LIMITS.wikiSection.max)).ok).toBe(true);
    expect(cleanWikiSection('x'.repeat(TEXT_LIMITS.wikiSection.max + 1)).ok).toBe(false);
  });

  it('cuerpo vacio tras normalizar es error, no un string de cero', () => {
    // Un cuerpo que era solo espacios de ancho cero no es un cuerpo.
    const r = cleanBody('\u200b   \n\u200b');
    expect(r.ok).toBe(false);
  });

  it('cuenta en caracteres, no en bytes: un emoji vale 1', () => {
    const tres = '\u{1F600}\u{1F600}\u{1F600}';
    // En UTF-16 son 6 unidades; en puntos de codigo son 3.
    expect(tres.length).toBe(6);
    const r = cleanBody(tres.repeat(500));
    expect(r.ok).toBe(true);
  });

  it('el HTML se conserva como texto plano (lo escapa la UI, no el servidor)', () => {
    const r = cleanBody('<script>alert(1)</script>');
    expect(r.ok).toBe(true);
    // No se guarda HTML sanitizado: se guarda tal cual, la UI lo escapa.
    if (r.ok) expect(r.value).toBe('<script>alert(1)</script>');
  });
});

describe('etiquetas', () => {
  it('se convierte en slug sin tildes ni mayusculas', () => {
    // Se prueban tildes, signos y un emoji: lo que de verdad llega al pegar desde un
    // documento. Los CJK tambien deben caer (no tienen equivalente en el slug).
    expect(slugifyTag('  Aceites y lubrication  ')).toBe('aceites-y-lubrication');
    expect(slugifyTag('Filtros y 发现 lubricacion')).toBe('filtros-y-lubricacion');
    expect(slugifyTag('FRENOS')).toBe('frenos');
    expect(slugifyTag('Revisión periódica')).toBe('revision-periodica');
    expect(slugifyTag('\u{1F600}-feat')).toBe('feat');
  });

  it('corta a 24 caracteres sin dejar guion colgante', () => {
    const slug = slugifyTag('a'.repeat(40));
    expect(slug.length).toBeLessThanOrEqual(TEXT_LIMITS.tags.maxLength);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('deduplica y corta a 5 etiquetas', () => {
    const tags = cleanTags([
      'frenos',
      'FRENOS ',
      'llantas',
      'aceite',
      'filtro',
      'bujias',
      'cadena',
    ]);
    expect(tags).toEqual(['frenos', 'llantas', 'aceite', 'filtro', 'bujias']);
    expect(tags.length).toBeLessThanOrEqual(TEXT_LIMITS.tags.max);
  });

  it('descarta lo que no deja slug (emoji suelto) sin fallar', () => {
    expect(cleanTags(['\u{1F600}', 'frenos'])).toEqual(['frenos']);
  });

  it('si no es un array, no hay etiquetas', () => {
    expect(cleanTags('frenos')).toEqual([]);
    expect(cleanTags(undefined)).toEqual([]);
  });
});

describe('previewLine', () => {
  it('se queda con la primera linea y recorta', () => {
    expect(previewLine('titulo\ncuerpo largo')).toBe('titulo');
    expect(previewLine('x'.repeat(200), 10)).toHaveLength(10);
  });
});
