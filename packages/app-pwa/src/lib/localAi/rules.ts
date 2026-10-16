/**
 * rules.ts — Nivel 3: respuestas deterministas, en español, sin descarga ni GPU.
 *
 * Es la red de seguridad del asistente: si no hay Prompt API ni WebGPU (o el motor falla),
 * se responde con los fragmentos de manual que el navegador ya eligió, citados tal cual.
 * Nunca inventa: si no hay fragmentos, lo dice.
 */
import type { ManualChunk } from '../../garage/assistant/manualText';

/** Etiqueta que encabeza una respuesta hecha con fragmentos de manual. */
export const RULES_LABEL = 'Fragmentos del manual';

/** Respuesta cuando ningún fragmento del manual responde a la pregunta. */
export const RULES_NO_MATCH = 'No hay texto en tus manuales cargados que responda a esta pregunta.';

/**
 * Mensaje para la AUI cuando el navegador solo tiene reglas: generar una interfaz exige un
 * modelo real, y las reglas no lo son.
 */
export const RULES_NEEDS_LOCAL_AI =
  'La generación de la AUI necesita la IA local del navegador (Chrome Prompt API o WebGPU). Este navegador solo tiene las reglas deterministas.';

/** Identificador que se guarda como "modelo" cuando responde el nivel de reglas. */
export const RULES_MODEL = 'reglas-locales';

/**
 * Respuesta determinista del asistente: los fragmentos recibidos (ya elegidos por
 * `pickExcerpts`), con su cita y su texto literal. Sin fragmentos, no hay respuesta
 * inventada.
 */
export function rulesAnswer(question: string, excerpts: readonly ManualChunk[] = []): string {
  const found = excerpts.filter((e) => e.text.trim());
  if (!found.length) return RULES_NO_MATCH;
  const blocks = found.map((e) => `### [Manual: ${e.manual}, pag. ${e.page || 's/n'}]\n${e.text.trim()}`);
  const head = `${RULES_LABEL} para: "${question.trim()}"`;
  return [head, '', ...blocks].join('\n');
}
