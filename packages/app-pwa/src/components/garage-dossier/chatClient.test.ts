import { describe, expect, it } from 'vitest';
import { loadManualChunks, pickExcerpts, type ChatTurn } from './chatClient';

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
});
