/**
 * consentOffers.test.ts — UNA sola regla decide qué motores ofrece la tarjeta.
 *
 * - Nano se ofrece con Prompt API `downloadable`/`downloading` y sin
 *   consentimiento de Gemini Nano.
 * - WebLLM se ofrece con WebGPU utilizable y sin modelo WebLLM autorizado y
 *   cargado (sin consentimiento, o autorizado pero con el motor sin cargar).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_MODEL } from './config';
import { PROMPT_API_CONSENT_MODEL_ID } from './consent';
import { consentOffers, hasConsentOffer, type ConsentOfferState } from './consentOffers';

const BASE: ConsentOfferState = {
  promptApiAvailability: undefined,
  webgpuUsable: false,
  authorisedModelId: undefined,
  loadedWebllmModelId: undefined,
};

describe('consentOffers · regla única de la tarjeta', () => {
  it('Nano consentida + Prompt API no disponible + WebGPU usable → solo WebLLM', () => {
    const offers = consentOffers({
      ...BASE,
      promptApiAvailability: 'unavailable',
      webgpuUsable: true,
      authorisedModelId: PROMPT_API_CONSENT_MODEL_ID,
      loadedWebllmModelId: undefined,
    });
    expect(offers).toEqual({ nano: false, webllm: true });
    expect(hasConsentOffer(offers)).toBe(true);
  });

  it('sin WebGPU + Prompt API downloadable → solo Nano', () => {
    const offers = consentOffers({ ...BASE, promptApiAvailability: 'downloadable' });
    expect(offers).toEqual({ nano: true, webllm: false });
    expect(hasConsentOffer(offers)).toBe(true);
  });

  it('Prompt API downloading sin consentimiento también ofrece Nano', () => {
    const offers = consentOffers({ ...BASE, promptApiAvailability: 'downloading' });
    expect(offers.nano).toBe(true);
  });

  it('todo disponible y autorizado/cargado → sin tarjeta', () => {
    const offers = consentOffers({
      ...BASE,
      promptApiAvailability: 'available',
      webgpuUsable: true,
      authorisedModelId: DEFAULT_LOCAL_MODEL,
      loadedWebllmModelId: DEFAULT_LOCAL_MODEL,
    });
    expect(offers).toEqual({ nano: false, webllm: false });
    expect(hasConsentOffer(offers)).toBe(false);
  });

  it('Prompt API available (sin descarga) → sin oferta de Nano', () => {
    const offers = consentOffers({ ...BASE, promptApiAvailability: 'available' });
    expect(offers.nano).toBe(false);
    expect(hasConsentOffer(offers)).toBe(false);
  });

  it('WebLLM autorizado pero motor sin cargar → se ofrece WebLLM', () => {
    const offers = consentOffers({
      ...BASE,
      webgpuUsable: true,
      authorisedModelId: DEFAULT_LOCAL_MODEL,
      loadedWebllmModelId: undefined,
    });
    expect(offers.webllm).toBe(true);
  });

  it('sin nada disponible → sin tarjeta', () => {
    const offers = consentOffers(BASE);
    expect(offers).toEqual({ nano: false, webllm: false });
    expect(hasConsentOffer(offers)).toBe(false);
  });
});
