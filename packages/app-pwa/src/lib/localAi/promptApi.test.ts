/**
 * promptApi.test.ts — Normalización de la Chrome Prompt API (tier 1).
 *
 * No hay Chrome en el runner: se prueban los adaptadores con dobles, que es justo lo que
 * el módulo abstrae (ReadableStream vs iterable, texto acumulado vs incrementos).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  chunksOf,
  createPromptSession,
  promptApiStream,
  type PromptApiSession,
} from './promptApi';

async function* fromArray(values: string[]): AsyncGenerator<string> {
  for (const v of values) yield v;
}

describe('createPromptSession', () => {
  it('sin LanguageModel lanza (la cadena lo convierte en reglas)', async () => {
    await expect(createPromptSession('sistema', { factory: undefined })).rejects.toThrow(/Prompt API/);
  });

  it('pasa el prompt de sistema a create', async () => {
    const calls: unknown[] = [];
    const factory = {
      create: async (options: unknown) => {
        calls.push(options);
        return { promptStreaming: () => fromArray(['ok']) } as PromptApiSession;
      },
    };
    await createPromptSession('SISTEMA', { factory });
    expect(calls).toHaveLength(1);
    expect((calls[0] as { initialPrompts?: unknown }).initialPrompts).toEqual([
      { role: 'system', content: 'SISTEMA' },
    ]);
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
  it('convierte el texto acumulado de Chrome viejo en incrementos', async () => {
    const session: PromptApiSession = {
      promptStreaming: () => fromArray(['Usa 10W', 'Usa 10W-40', 'Usa 10W-40 JASO MA2']),
    };
    const parts: string[] = [];
    for await (const chunk of promptApiStream(session, 'aceite')) parts.push(chunk);
    expect(parts.join('')).toBe('Usa 10W-40 JASO MA2');
    expect(parts[0]).toBe('Usa 10W');
  });

  it('deja pasar los incrementos de la versión nueva', async () => {
    const session: PromptApiSession = { promptStreaming: () => fromArray(['Usa ', '10W-40']) };
    const parts: string[] = [];
    for await (const chunk of promptApiStream(session, 'aceite')) parts.push(chunk);
    expect(parts).toEqual(['Usa ', '10W-40']);
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
