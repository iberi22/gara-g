// @vitest-environment jsdom
/**
 * consent.test.ts — El consentimiento persistido es la ÚNICA autorización del tier 2.
 *
 * Solo un `modelId` del catálogo real (`config.ts`) sobrevive al almacenamiento: un valor
 * manipulado a mano no autoriza ninguna descarga.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCAL_AI_CONSENT_KEY,
  PROMPT_API_CONSENT_MODEL_ID,
  authorisedModelId,
  clearConsent,
  hasPromptApiConsent,
  isKnownModelId,
  readConsent,
  saveConsent,
} from './consent';
import { DEFAULT_LOCAL_MODEL, LOW_MEMORY_LOCAL_MODEL } from './config';

afterEach(() => {
  localStorage.clear();
});

describe('consentimiento de IA local', () => {
  it('sin nada guardado no hay autorización', () => {
    expect(readConsent()).toBeUndefined();
    expect(authorisedModelId()).toBeUndefined();
  });

  it('guarda el modelo aceptado bajo el espacio de nombres de la app', () => {
    saveConsent(LOW_MEMORY_LOCAL_MODEL, 1234);
    const stored = localStorage.getItem(LOCAL_AI_CONSENT_KEY);
    expect(stored).toContain(LOW_MEMORY_LOCAL_MODEL);
    expect(readConsent()).toEqual({ modelId: LOW_MEMORY_LOCAL_MODEL, acceptedAt: 1234 });
    expect(authorisedModelId()).toBe(LOW_MEMORY_LOCAL_MODEL);
  });

  it('un id que no está en el catálogo no se persiste ni se acepta', () => {
    saveConsent('modelo-inventado');
    expect(localStorage.getItem(LOCAL_AI_CONSENT_KEY)).toBeNull();
    expect(isKnownModelId('modelo-inventado')).toBe(false);
    expect(isKnownModelId(DEFAULT_LOCAL_MODEL)).toBe(true);
  });

  it('un valor manipulado en el almacenamiento se ignora', () => {
    localStorage.setItem(LOCAL_AI_CONSENT_KEY, JSON.stringify({ modelId: 'malicioso' }));
    expect(readConsent()).toBeUndefined();
    localStorage.setItem(LOCAL_AI_CONSENT_KEY, 'no-es-json');
    expect(readConsent()).toBeUndefined();
  });

  it('clearConsent retira la autorización', () => {
    saveConsent(DEFAULT_LOCAL_MODEL);
    clearConsent();
    expect(readConsent()).toBeUndefined();
  });

  it('el id de la Prompt API consentida se persiste y autoriza la descarga de Nano', () => {
    saveConsent(PROMPT_API_CONSENT_MODEL_ID, 5678);
    expect(localStorage.getItem(LOCAL_AI_CONSENT_KEY)).toContain(PROMPT_API_CONSENT_MODEL_ID);
    expect(readConsent()).toEqual({ modelId: PROMPT_API_CONSENT_MODEL_ID, acceptedAt: 5678 });
    expect(isKnownModelId(PROMPT_API_CONSENT_MODEL_ID)).toBe(true);
    expect(hasPromptApiConsent()).toBe(true);
  });

  it('el modelo WebLLM no autoriza la Prompt API ni al revés', () => {
    expect(hasPromptApiConsent()).toBe(false);
    saveConsent(DEFAULT_LOCAL_MODEL);
    expect(hasPromptApiConsent()).toBe(false);
    expect(authorisedModelId()).toBe(DEFAULT_LOCAL_MODEL);
  });
});
