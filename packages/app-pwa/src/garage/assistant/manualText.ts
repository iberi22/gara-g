/**
 * manualText.ts — Texto de los manuales del vehiculo para el asistente.
 *
 * Los PDF que sube el usuario se convierten a markdown con Workers AI (`toMarkdown`), que
 * marca cada pagina con "### Page N". Aqui se parte ese markdown en fragmentos citables
 * (manual + pagina) y se eligen los mas relevantes para la pregunta con un puntaje tipo
 * BM25. No hay embeddings a proposito: el plan gratuito de Workers AI se mide en
 * "neuronas" por dia y una busqueda lexica sobre un manual de 300 paginas cuesta cero;
 * para preguntas de taller ("torque eje trasero", "holgura de valvulas") las palabras
 * exactas del manual son justo lo que hay que encontrar.
 */

export interface ManualChunk {
  /** Titulo del manual (nombre del archivo sin extension). */
  manual: string;
  /** Pagina del PDF (1..n); 0 si el markdown no traia marcas de pagina. */
  page: number;
  text: string;
}

/** Tamano maximo de un fragmento: una pagina densa de manual se parte en varios. */
export const CHUNK_CHARS = 1600;

/** Palabras que no ayudan a encontrar nada en un manual. */
const STOPWORDS = new Set(
  (
    'de la el los las un una unos unas y o u a en con por para del al se que es son su sus lo le les ' +
    'como mas pero si no ya muy cada cual cuales cuando donde este esta estos estas ese esa eso hay ' +
    'tiene tengo mi mis me te tu tus yo nos the of and to in for is on with be by as at or an'
  ).split(' '),
);

/** Minusculas, sin tildes y sin puntuacion (conserva numeros y decimales). */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.,/\s-]/g, ' ')
    .replace(/(?<![0-9])[.,]|[.,](?![0-9])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens utiles de un texto: sin stopwords, con un sufijo plural recortado. */
export function tokensOf(text: string): string[] {
  return foldText(text)
    .split(' ')
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map((t) => (t.length > 4 && t.endsWith('es') ? t.slice(0, -2) : t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
}

function splitLong(text: string): string[] {
  if (text.length <= CHUNK_CHARS) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > CHUNK_CHARS) {
    // Corta en el ultimo fin de parrafo o de linea antes del limite, para no partir una tabla.
    let cut = rest.lastIndexOf('\n\n', CHUNK_CHARS);
    if (cut < CHUNK_CHARS * 0.5) cut = rest.lastIndexOf('\n', CHUNK_CHARS);
    if (cut < CHUNK_CHARS * 0.5) cut = CHUNK_CHARS;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

/**
 * Parte el markdown de un manual en fragmentos con su pagina. Ignora el bloque de
 * metadatos que agrega toMarkdown y las paginas vacias.
 */
export function chunkManual(markdown: string, manual: string): ManualChunk[] {
  const body = markdown.includes('## Contents') ? markdown.slice(markdown.indexOf('## Contents') + 11) : markdown;
  const parts = body.split(/^###\s+Page\s+(\d+)\s*$/m);
  const chunks: ManualChunk[] = [];
  if (parts.length === 1) {
    for (const t of splitLong(body.trim())) if (t) chunks.push({ manual, page: 0, text: t });
    return chunks;
  }
  // parts = [antes, n1, texto1, n2, texto2, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const page = Number(parts[i]);
    const text = (parts[i + 1] ?? '').trim();
    if (!text) continue;
    for (const t of splitLong(text)) chunks.push({ manual, page, text: t });
  }
  return chunks;
}

/**
 * Los `k` fragmentos mas relevantes para la pregunta (BM25 con k1 = 1.2, b = 0.75).
 * Devuelve [] si ningun fragmento comparte un termino con la pregunta: mejor no citar
 * nada que citar una pagina al azar.
 */
export function retrieve(chunks: ManualChunk[], query: string, k = 5): ManualChunk[] {
  const q = [...new Set(tokensOf(query))];
  if (q.length === 0 || chunks.length === 0) return [];
  const docs = chunks.map((c) => tokensOf(c.text));
  const avg = docs.reduce((a, d) => a + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const scored = docs.map((d, i) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * d.length) / avg));
    }
    return { i, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => chunks[s.i]);
}

/** Nombre legible de un manual a partir del archivo: "manual-servicio_fz.pdf" → "manual servicio fz". */
export function manualTitle(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/^\d{10,}-/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}
