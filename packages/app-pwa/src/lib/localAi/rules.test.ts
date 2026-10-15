/**
 * rules.test.ts — Nivel 3: salidas deterministas, en español y sin inventar nada.
 */
import { describe, expect, it } from 'vitest';
import type { ManualChunk } from '../../garage/assistant/manualText';
import { RULES_LABEL, RULES_NEEDS_LOCAL_AI, RULES_NO_MATCH, RULES_MODEL, rulesAnswer } from './rules';

const excerpts: ManualChunk[] = [
  { manual: 'Manual FZ', page: 42, text: 'Pares de apriete: tuerca del eje trasero 90 N·m.' },
  { manual: 'Manual FZ', page: 43, text: 'Cadena de transmision: holgura de 20 a 30 mm.' },
];

describe('rulesAnswer', () => {
  it('cita los fragmentos recibidos, con su texto literal y la etiqueta', () => {
    const answer = rulesAnswer('¿Cuál es el torque del eje trasero?', [excerpts[0]]);
    expect(answer).toContain(RULES_LABEL);
    expect(answer).toContain('[Manual: Manual FZ, pag. 42]');
    expect(answer).toContain('Pares de apriete: tuerca del eje trasero 90 N·m.');
  });

  it('sin fragmentos dice que no hay texto en los manuales, sin inventar', () => {
    expect(rulesAnswer('¿Cuál es la presión del turbo?', [])).toBe(RULES_NO_MATCH);
  });

  it('descarta fragmentos vacios y entonces tampoco inventa', () => {
    expect(rulesAnswer('algo', [{ manual: 'M', page: 1, text: '   ' }])).toBe(RULES_NO_MATCH);
  });

  it('es determinista: la misma entrada da la misma salida', () => {
    const a = rulesAnswer('torque', excerpts);
    const b = rulesAnswer('torque', excerpts);
    expect(a).toBe(b);
  });

  it('una pagina 0 se muestra como "s/n"', () => {
    const answer = rulesAnswer('algo', [{ manual: 'M', page: 0, text: 'dato' }]);
    expect(answer).toContain('pag. s/n');
  });

  it('el aviso de AUI habla del navegador y no nombra ningun plan', () => {
    expect(RULES_NEEDS_LOCAL_AI).toContain('IA local');
    expect(RULES_NEEDS_LOCAL_AI).toContain('navegador');
    expect(RULES_MODEL).toBe('reglas-locales');
  });
});
