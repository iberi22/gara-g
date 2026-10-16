/**
 * promptApi.test.ts — Normalización de la Chrome Prompt API (tier 1).
 *
 * No hay Chrome en el runner: se prueban los adaptadores con dobles (ReadableStream vs
 * iterable) y el CONTRATO de streaming de la versión soportada: cada trozo es un delta, no
 * el texto acumulado. La heurística de prefijos perdía texto (["a","a","b"] → "ab").
 */
import { describe, expect, it, vi } from 'vitest';
import {
  chunksOf,
  createPromptSession,
  promptApiStream,
  type PromptApiSession,
  type PromptInitialMessage,
} from './promptApi';

async function* fromArray(values: string[]): AsyncGenerator<string> {
  for (const v of values) yield v;
}

describe('createPromptSession', () => {
  it('sin LanguageModel lanza (la cadena lo convierte en reglas)', async () => {
    await expect(createPromptSession([], { factory: undefined })).rejects.toThrow(/Prompt API/);
  });

  it('pasa la conversación completa en initialPrompts', async () => {
    const calls: unknown[] = [];
    const factory = {
      create: async (options: unknown) => {
        calls.push(options);
        return { promptStreaming: () => fromArray(['ok']) } as PromptApiSession;
      },
    };
    const conversation: PromptInitialMessage[] = [
      { role: 'system', content: 'SISTEMA' },
      { role: 'user', content: '¿Qué aceite?' },
      { role: 'assistant', content: '10W-40' },
    ];
    await createPromptSession(conversation, { factory });
    expect(calls).toHaveLength(1);
    expect((calls[0] as { initialPrompts?: unknown }).initialPrompts).toEqual(conversation);
  });

  it('propaga la señal de cancelación a create', async () => {
    const signal = new AbortController().signal;
    const create = vi.fn(async () => ({ promptStreaming: () => fromArray(['x']) }));
    await createPromptSession([{ role: 'system', content: 's' }], { factory: { create }, signal });
    expect(create).toHaveBeenCalledWith({ initialPrompts: [{ role: 'system', content: 's' }], signal });
  });
});

describe('chunksOf', () => {
  it('lee un iterable async de strings', async () => {
    const out: string[] = [];
    for await (const chunk of chunksOf(fromArray(['a', 'b']))) out.push(chunk);
    expect(out).toEqual(['a', 'b']);
  });

  it('lee un ReadableStream de bytes', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hola'));
        controller.close();
      },
    });
    const out: string[] = [];
    for await (const chunk of chunksOf(stream)) out.push(chunk);
    expect(out.join('')).toBe('hola');
  });

  it('un valor nulo no aporta nada', async () => {
    const out: string[] = [];
    for await (const chunk of chunksOf(undefined)) out.push(chunk);
    expect(out).toEqual([]);
  });
});

describe('promptApiStream', () => {
  it('deja pasar los deltas tal cual (incluidos los repetidos)', async () => {
    const session: PromptApiSession = { promptStreaming: () => fromArray(['Usa ', '10W-40']) };
    const parts: string[] = [];
    for await (const chunk of promptApiStream(session, 'aceite')) parts.push(chunk);
    expect(parts).toEqual(['Usa ', '10W-40']);
    expect(parts.join('')).toBe('Usa 10W-40');
  });

  it('regresión: ["a","a","b"] produce "aab", no "ab"', async () => {
    const session: PromptApiSession = { promptStreaming: () => fromArray(['a', 'a', 'b']) };
    const parts: string[] = [];
    for await (const chunk of promptApiStream(session, 'x')) parts.push(chunk);
    expect(parts).toEqual(['a', 'a', 'b']);
    expect(parts.join('')).toBe('aab');
  });

  it('un delta que repite el texto entero no se colapsa (son incrementos)', async () => {
    // Si un navegador devolviera texto acumulado ("a", "ab"), el delta real sería "b"; el
    // llamador concatena, no reconstruye prefijos, así que no hay pérdida silenciosa.
    const session: PromptApiSession = { promptStreaming: () => fromArray(['a', 'ab']) };
    const parts: string[] = [];
    for await (const chunk of promptApiStream(session, 'x')) parts.push(chunk);
    expect(parts.join('')).toBe('aab');
  });

  it('propaga la señal de cancelación a promptStreaming', async () => {
    const signal = new AbortController().signal;
    const promptStreaming = vi.fn(() => fromArray(['x']));
    const session: PromptApiSession = { promptStreaming };
    for await (const _chunk of promptApiStream(session, 'hola', signal)) {
      /* consume */
    }
    expect(promptStreaming).toHaveBeenCalledWith('hola', { signal });
  });
});
