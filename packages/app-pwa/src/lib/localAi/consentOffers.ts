/**
 * consentOffers.ts — UNA sola regla decide qué motores de IA local se ofrecen en la
 * tarjeta de consentimiento (la usan AuiInterface y DossierChat).
 *
 * - Oferta Gemini Nano: la Prompt API aún tiene que descargar (`downloadable` o
 *   `downloading`) y el usuario todavía no autorizó `prompt-api:gemini-nano`. Una API
 *   ya lista (`available`) no necesita oferta: se usa sola.
 * - Oferta WebLLM: hay WebGPU utilizable y NO hay un modelo WebLLM autorizado y
 *   cargado (sin consentimiento, o autorizado pero con el motor sin cargar).
 *
 * La tarjeta se muestra cuando hay al menos una oferta (`hasConsentOffer`) y
 * LocalAiConsent solo pinta las opciones ofrecidas. Función pura: el estado entra
 * por parámetros para poder probarla sin navegador.
 */
import { LOCAL_MODELS } from './config';
import { PROMPT_API_CONSENT_MODEL_ID } from './consent';

/** Estados de la Prompt API que aún exigen descargar Gemini Nano. */
const NANO_DOWNLOAD_STATES: ReadonlySet<string> = new Set(['downloadable', 'downloading']);

export interface ConsentOfferState {
  /** Estado crudo de `LanguageModel.availability()` (`undefined` si no hay Prompt API). */
  promptApiAvailability: string | undefined;
  /** Hay WebGPU utilizable en este navegador (`navigator.gpu.requestAdapter`). */
  webgpuUsable: boolean;
  /** Modelo WebLLM autorizado en el almacén de consentimiento (`undefined` si no hay). */
  authorisedModelId: string | undefined;
  /** El usuario ya autorizó la descarga de Gemini Nano (entrada `promptApi`). */
  promptApiConsented?: boolean;
  /** Modelo WebLLM ya cargado en esta pestaña (`undefined` si ninguno). */
  loadedWebllmModelId: string | undefined;
}

export interface ConsentOffers {
  nano: boolean;
  webllm: boolean;
}

/** ¿El consentimiento autoriza un modelo WebLLM del catálogo (no la Prompt API)? */
function isAuthorisedWebllmModel(modelId: string | undefined): modelId is string {
  return (
    typeof modelId === 'string' &&
    modelId !== PROMPT_API_CONSENT_MODEL_ID &&
    LOCAL_MODELS.some((model) => model.id === modelId)
  );
}

export function consentOffers(state: ConsentOfferState): ConsentOffers {
  // Compatibilidad: sin el flag por motor, un `authorisedModelId` con el id de Nano
  // (formato anterior de ranura única) cuenta como Nano consentida.
  const nanoConsented =
    state.promptApiConsented ?? state.authorisedModelId === PROMPT_API_CONSENT_MODEL_ID;
  const nano = NANO_DOWNLOAD_STATES.has(state.promptApiAvailability ?? '') && !nanoConsented;
  const webllmLoaded =
    isAuthorisedWebllmModel(state.authorisedModelId) &&
    state.loadedWebllmModelId === state.authorisedModelId;
  const webllm = state.webgpuUsable && !webllmLoaded;
  return { nano, webllm };
}

/** La tarjeta de consentimiento se muestra cuando hay al menos una oferta. */
export function hasConsentOffer(offers: ConsentOffers): boolean {
  return offers.nano || offers.webllm;
}
