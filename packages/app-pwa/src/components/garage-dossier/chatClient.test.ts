import { describe, expect, it } from 'vitest';
import { loadManualChunks, pickExcerpts, finalizeAssistantTurn, type ChatTurn } from './chatClient';

const MD = '## Contents\n### Page 12\nKit de arrastre: cadena 428H, pinon de 14 dientes y corona de 43.\n\n### Page 13\nTorque de la tuerca de la corona: 32 N·m.\n';

describe('chatClient', () => {
  it('carga el texto de los manuales indexados una sola vez', async () => {
    let calls = 0;
    const fetcher = (async (url: string) => {
      calls++;
      expect(url).toBe('/r2/t1/vehicle/v1/manual/1-Manual%20FZ.pdf.md');
      return new Response(MD);
    }) as unknown as typeof fetch;
    const manuals = [{ name: 'Manual FZ.pdf', textKey: 't1/vehicle/v1/manual/1-Manual FZ.pdf.md' }, { name: 'sin indexar.pdf' }];
    const a = await loadManualChunks(manuals, fetcher);
    const b = await loadManualChunks(manuals, fetcher);
    expect(a.map((c) => c.page)).toEqual([12, 13]);
    expect(b).toEqual(a);
    expect(calls).toBe(1);
  });

  it('usa la pregunta anterior para una de seguimiento', async () => {
    const fetcher = (async () => new Response(MD)) as unknown as typeof fetch;
    const chunks = await loadManualChunks([{ name: 'M.pdf', textKey: 'x/otro.md' }], fetcher);
    const turns: ChatTurn[] = [
      { role: 'user', content: 'Que referencia de cadena usa el kit de arrastre?' },
      { role: 'assistant', content: '428H' },
      { role: 'user', content: 'y el torque de la corona?' },
    ];
    const pages = pickExcerpts(chunks, turns, 2).map((c) => c.page);
    expect(pages[0]).toBe(13);
    expect(pages).toContain(12);
  });

  describe('finalizeAssistantTurn', () => {
    it('mantiene la respuesta parcial si el contenido no esta vacio', () => {
      const result = finalizeAssistantTurn('Respuesta parcial...', true);
      expect(result).toEqual({ content: 'Respuesta parcial...', error: false });

      const resultNoAbort = finalizeAssistantTurn('Otra respuesta', false);
      expect(resultNoAbort).toEqual({ content: 'Otra respuesta', error: false });
    });

    it('devuelve mensaje de cancelacion si el contenido esta vacio y fue abortado', () => {
      const result = finalizeAssistantTurn('', true);
      expect(result).toEqual({ content: 'Detuviste la respuesta.', error: false });
    });

    it('devuelve mensaje de error si el contenido esta vacio y no fue abortado', () => {
      const result = finalizeAssistantTurn('', false);
      expect(result).toEqual({ content: 'No se pudo responder con la IA local.', error: true });
    });

    it('considera como vacio un contenido que solo tiene espacios en blanco', () => {
      const resultAborted = finalizeAssistantTurn('   \n  ', true);
      expect(resultAborted).toEqual({ content: 'Detuviste la respuesta.', error: false });

      const resultNotAborted = finalizeAssistantTurn('   \t  ', false);
      expect(resultNotAborted).toEqual({ content: 'No se pudo responder con la IA local.', error: true });
    });
  });
});
