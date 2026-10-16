// @vitest-environment jsdom
/**
 * consent.test.ts — El consentimiento persistido es la autorización de cada motor.
 *
 * El almacén guarda UNA entrada por motor (`webllm`, `promptApi`): guardar una no toca
 * la otra. Solo un `modelId` del catálogo real (`config.ts`) sobrevive en `webllm`; un
 * valor manipulado a mano no autoriza ninguna descarga. Los valores antiguos de ranura
 * única migran a su motor y los ids desconocidos se descartan.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCAL_AI_CONSENT_KEY,
  PROMPT_API_CONSENT_MODEL_ID,
  authorisedModelId,
  clearConsent,
  hasPromptApiConsent,
  isKnownModelId,
  promptApiConsent,
  readConsent,
  saveConsent,
  savePromptApiConsent,
  saveWebllmConsent,
  webllmConsent,
} from './consent';
import { DEFAULT_LOCAL_MODEL, LOW_MEMORY_LOCAL_MODEL } from './config';

afterEach(() => {
  localStorage.clear();
});

describe('consentimiento de IA local por motor', () => {
  it('sin nada guardado no hay autorización', () => {
    expect(webllmConsent()).toBeUndefined();
    expect(promptApiConsent()).toBeUndefined();
    expect(readConsent()).toBeUndefined();
    expect(authorisedModelId()).toBeUndefined();
    expect(hasPromptApiConsent()).toBe(false);
  });

  it('guarda el modelo WebLLM aceptado bajo el espacio de nombres de la app', () => {
    saveWebllmConsent(LOW_MEMORY_LOCAL_MODEL, 1234);
    const stored = localStorage.getItem(LOCAL_AI_CONSENT_KEY);
    expect(stored).toContain(LOW_MEMORY_LOCAL_MODEL);
    expect(webllmConsent()).toEqual({ modelId: LOW_MEMORY_LOCAL_MODEL, acceptedAt: 1234 });
    expect(readConsent()).toEqual({ modelId: LOW_MEMORY_LOCAL_MODEL, acceptedAt: 1234 });
    expect(authorisedModelId()).toBe(LOW_MEMORY_LOCAL_MODEL);
    // La entrada de Nano no se toca.
    expect(hasPromptApiConsent()).toBe(false);
  });

  it('guardar un motor no borra el otro', () => {
    saveWebllmConsent(DEFAULT_LOCAL_MODEL, 111);
    savePromptApiConsent(222);
    expect(webllmConsent()).toEqual({ modelId: DEFAULT_LOCAL_MODEL, acceptedAt: 111 });
    expect(promptApiConsent()).toEqual({ acceptedAt: 222 });
    expect(hasPromptApiConsent()).toBe(true);
    expect(authorisedModelId()).toBe(DEFAULT_LOCAL_MODEL);
    // Y al revés: guardar WebLLM después no borra Nano.
    saveWebllmConsent(LOW_MEMORY_LOCAL_MODEL, 333);
    expect(hasPromptApiConsent()).toBe(true);
    expect(authorisedModelId()).toBe(LOW_MEMORY_LOCAL_MODEL);
  });

  it('un id que no está en el catálogo no se persiste en webllm', () => {
    saveWebllmConsent('modelo-inventado');
    expect(localStorage.getItem(LOCAL_AI_CONSENT_KEY)).toBeNull();
    expect(isKnownModelId('modelo-inventado')).toBe(false);
    expect(isKnownModelId(DEFAULT_LOCAL_MODEL)).toBe(true);
  });

  it('un valor manipulado en el almacenamiento se ignora', () => {
    localStorage.setItem(LOCAL_AI_CONSENT_KEY, JSON.stringify({ modelId: 'malicioso' }));
    expect(webllmConsent()).toBeUndefined();
    expect(readConsent()).toBeUndefined();
    localStorage.setItem(LOCAL_AI_CONSENT_KEY, 'no-es-json');
    expect(webllmConsent()).toBeUndefined();
    expect(readConsent()).toBeUndefined();
    localStorage.setItem(
      LOCAL_AI_CONSENT_KEY,
      JSON.stringify({ webllm: { modelId: 'malicioso', at: 1 } }),
    );
    expect(webllmConsent()).toBeUndefined();
    expect(authorisedModelId()).toBeUndefined();
  });

  it('clearConsent retira la autorización del motor indicado y conserva la otra', () => {
    saveWebllmConsent(DEFAULT_LOCAL_MODEL);
    savePromptApiConsent();
    clearConsent('webllm');
    expect(webllmConsent()).toBeUndefined();
    expect(authorisedModelId()).toBeUndefined();
    expect(hasPromptApiConsent()).toBe(true);
    clearConsent('promptApi');
    expect(hasPromptApiConsent()).toBe(false);
    expect(localStorage.getItem(LOCAL_AI_CONSENT_KEY)).toBeNull();
  });

  it('clearConsent sin motor retira las dos entradas', () => {
    saveWebllmConsent(DEFAULT_LOCAL_MODEL);
    savePromptApiConsent();
    clearConsent();
    expect(webllmConsent()).toBeUndefined();
    expect(hasPromptApiConsent()).toBe(false);
  });

  it('el consentimiento de Nano vive en su propia entrada', () => {
    savePromptApiConsent(5678);
    expect(localStorage.getItem(LOCAL_AI_CONSENT_KEY)).toContain('promptApi');
    expect(promptApiConsent()).toEqual({ acceptedAt: 5678 });
    expect(isKnownModelId(PROMPT_API_CONSENT_MODEL_ID)).toBe(true);
    expect(hasPromptApiConsent()).toBe(true);
    // Nano no autoriza WebLLM ni al revés.
    expect(webllmConsent()).toBeUndefined();
    expect(authorisedModelId()).toBeUndefined();
  });

  it('saveConsent encamina cada id a su motor', () => {
    saveConsent(PROMPT_API_CONSENT_MODEL_ID, 5678);
    expect(hasPromptApiConsent()).toBe(true);
    expect(authorisedModelId()).toBeUndefined();
    saveConsent(DEFAULT_LOCAL_MODEL);
    expect(authorisedModelId()).toBe(DEFAULT_LOCAL_MODEL);
    expect(hasPromptApiConsent()).toBe(true);
    saveConsent('modelo-inventado');
    expect(authorisedModelId()).toBe(DEFAULT_LOCAL_MODEL);
  });

  it('migra el formato anterior de ranura única a su motor', () => {
    localStorage.setItem(
      LOCAL_AI_CONSENT_KEY,
      JSON.stringify({ modelId: DEFAULT_LOCAL_MODEL, acceptedAt: 42 }),
    );
    expect(webllmConsent()).toEqual({ modelId: DEFAULT_LOCAL_MODEL, acceptedAt: 42 });
    expect(hasPromptApiConsent()).toBe(false);

    localStorage.setItem(
      LOCAL_AI_CONSENT_KEY,
      JSON.stringify({ modelId: PROMPT_API_CONSENT_MODEL_ID, acceptedAt: 43 }),
    );
    expect(hasPromptApiConsent()).toBe(true);
    expect(promptApiConsent()).toEqual({ acceptedAt: 43 });
    expect(webllmConsent()).toBeUndefined();
  });

  it('la migración descarta los ids desconocidos', () => {
    localStorage.setItem(
      LOCAL_AI_CONSENT_KEY,
      JSON.stringify({ modelId: 'modelo-inventado', acceptedAt: 1 }),
    );
    expect(webllmConsent()).toBeUndefined();
    expect(hasPromptApiConsent()).toBe(false);
    expect(readConsent()).toBeUndefined();
    expect(authorisedModelId()).toBeUndefined();
  });
});
