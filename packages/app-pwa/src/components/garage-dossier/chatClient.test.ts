import { describe, expect, it } from 'vitest';
import { loadManualChunks, pickExcerpts, readAssistantStream, type ChatTurn } from './chatClient';

const MD = '## Contents\n### Page 12\nKit de arrastre: cadena 428H, pinon de 14 dientes y corona de 43.\n\n### Page 13\nTorque de la tuerca de la corona: 32 N·m.\n';

function sseResponse(events: unknown[], status = 200): Response {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(text, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

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

  it('lee el SSE: razonamiento, texto y fin', async () => {
    const seen: string[] = [];
    await readAssistantStream(sseResponse([{ thinking: true }, { t: 'Hola' }, { t: ' mundo' }, { done: true, model: 'm' }]), {
      onThinking: () => seen.push('think'),
      onText: (t) => seen.push(t),
      onDone: (m) => seen.push(`done:${m}`),
      onError: (e) => seen.push(`err:${e}`),
    });
    expect(seen).toEqual(['think', 'Hola', ' mundo', 'done:m']);
  });

  it('muestra el error del servidor y detecta un corte', async () => {
    const errs: string[] = [];
    const h = { onThinking() {}, onText() {}, onDone() {}, onError: (e: string) => errs.push(e) };
    await readAssistantStream(new Response(JSON.stringify({ error: 'Cuota agotada' }), { status: 503 }), h);
    await readAssistantStream(sseResponse([{ t: 'a medias' }]), h);
    expect(errs).toEqual(['Cuota agotada', 'La respuesta se corto antes de terminar.']);
  });
});
