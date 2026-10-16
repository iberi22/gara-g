<script lang="ts">
/**
 * DossierChat — Asistente de IA del vehiculo (pestana "Asistente" del expediente).
 *
 * Busca en el navegador los fragmentos de los manuales indexados que responden la
 * pregunta y la responde con la IA local del navegador (lib/localAi): Prompt API, WebGPU
 * o reglas deterministas. No hay servidor de IA ni límites de uso. Las respuestas se renderizan
 * con markdown.ts, que escapa todo.
 */
import { onMount, tick } from 'svelte';
import type { VehicleFamily, GarageVehicle, HistoryEvent } from '../../garage/contracts';
import type { TechNote } from '../../garage/assistant/prompt';
import {
  clearTurns,
  loadManualChunks,
  loadTurns,
  pickExcerpts,
  saveTurns,
  type ChatTurn,
  type IndexedManual,
} from './chatClient';
import { localAiEnvironment, promptApiState } from '../../lib/localAi/capabilities';
import { authorisedModelId } from '../../lib/localAi/consent';
import { consentOffers, hasConsentOffer, type ConsentOffers } from '../../lib/localAi/consentOffers';
import { webllmModelId } from '../../lib/localAi/webllmEngine';
import { runLocalAssistant } from '../../garage/assistant/handler';
import LocalAiConsent from './LocalAiConsent.svelte';
import { renderMarkdown } from './markdown';
import type { ManualChunk } from '../../garage/assistant/manualText';

interface Props {
  vehicleId: string;
  vehicleName: string;
  family: VehicleFamily;
  manuals: IndexedManual[];
  vehicle: GarageVehicle;
  history: HistoryEvent[];
  notes?: TechNote[];
  notesText?: string;
}

const { vehicleId, vehicleName, family, manuals, vehicle, history, notes, notesText }: Props = $props();

let turns = $state<ChatTurn[]>([]);
let draft = $state('');
let busy = $state(false);
let thinking = $state(false);
let chunks = $state<ManualChunk[]>([]);
let loadingManuals = $state(false);
let scroller: HTMLDivElement | undefined = $state();
/** Tarjeta de consentimiento visible (nunca carga nada por sí sola). */
let showConsent = $state(false);
/** Hay motor cargado en esta pestaña: las consultas lo reutilizan. */
let modelActive = $state(false);
/** Qué motores se pueden ofrecer ahora mismo (regla única en `consentOffers`). */
let offers = $state<ConsentOffers>({ nano: false, webllm: false });
const needsConsent = $derived(hasConsentOffer(offers) && !modelActive);
let controller: AbortController | null = $state(null);

const SUGGESTIONS: Record<VehicleFamily, string[]> = {
  moto: [
    '¿Qué aceite usa y cada cuánto se cambia?',
    '¿Cuándo me toca cambiar el kit de arrastre?',
    '¿Cuál es el torque de la tuerca del eje trasero?',
    '¿Qué reviso antes de un viaje largo?',
  ],
  car: [
    '¿Qué mantenimiento me toca ahora?',
    '¿Qué aceite y cuántos litros lleva el motor?',
    '¿Cada cuánto se cambian las pastillas de freno?',
    '¿Qué presión llevan las llantas?',
  ],
  heavy: [
    '¿Qué servicio le toca a este camión?',
    '¿Cada cuánto cambio los filtros de combustible?',
    '¿Qué reviso en la inspección pre-operacional?',
    '¿Cuándo toca revisar las bandas de freno?',
  ],
  machinery: [
    '¿Qué servicio toca en las próximas horas?',
    '¿Cada cuánto se cambia el filtro hidráulico?',
    '¿Qué reviso en la inspección diaria antes de arrancar?',
    '¿Cómo sé si las orugas o el balde necesitan cambio?',
  ],
};

const indexedCount = $derived(manuals.filter((m) => m.textKey).length);

onMount(() => {
  turns = loadTurns(vehicleId);
  // Ofertas según la regla única (`consentOffers`): la Prompt API descargable se
  // ofrece aunque no haya WebGPU; la tarjeta solo carga si el usuario pulsa el
  // botón (nunca al montar).
  refreshOffers(undefined);
  void promptApiState().then((state) => refreshOffers(state));
  if (indexedCount > 0) {
    loadingManuals = true;
    void loadManualChunks(manuals).then((c) => {
      chunks = c;
      loadingManuals = false;
    });
  }
  void scrollDown();
});

/** Recalcula las ofertas con el estado crudo (Prompt API, WebGPU, consentimiento, motor). */
function refreshOffers(promptState: string | undefined): void {
  const gpu = localAiEnvironment().gpu;
  offers = consentOffers({
    promptApiAvailability: promptState,
    webgpuUsable: Boolean(gpu && typeof gpu.requestAdapter === 'function'),
    authorisedModelId: authorisedModelId(),
    loadedWebllmModelId: webllmModelId(),
  });
  modelActive = Boolean(webllmModelId());
  if (hasConsentOffer(offers) && !modelActive) showConsent = true;
}

async function scrollDown(): Promise<void> {
  await tick();
  scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
}

async function send(text?: string): Promise<void> {
  const question = (text ?? draft).trim();
  if (!question || busy) return;

  draft = '';
  const chatHistory: ChatTurn[] = [...turns.filter((t) => !t.error), { role: 'user', content: question }];
  const excerpts = pickExcerpts(chunks, chatHistory);
  chatHistory[chatHistory.length - 1].sources = excerpts.map((e) => ({ manual: e.manual, page: e.page }));
  turns = [...chatHistory, { role: 'assistant', content: '' }];
  busy = true;
  thinking = true;
  void scrollDown();

  const idx = turns.length - 1;
  const update = (patch: Partial<ChatTurn>) => {
    turns[idx] = { ...turns[idx], ...patch };
  };

  controller = new AbortController();
  // Sin `tier` forzado: `localChat` usa la Prompt API y, si falla, solo el motor WebGPU
  // YA cargado y autorizado. Nunca descarga aquí; el peor caso son las reglas.
  try {
    const result = await runLocalAssistant(
      chatHistory.map((t) => ({ role: t.role, content: t.content })),
      { vehicle, history, notes, notesText, manuals: manuals.map((m) => m.name), excerpts },
      {
        signal: controller.signal,
        onToken: (chunk) => {
          thinking = false;
          update({ content: turns[idx].content + chunk });
          void scrollDown();
        },
        // Un motor que falla a mitad descarta su parcial y la cadena sigue con el
        // siguiente: se limpia lo ya pintado para no mezclar respuestas.
        onReset: () => {
          update({ content: '' });
        },
      },
    );
    update({ model: result.model });
  } catch {
    update({ content: turns[idx].content || 'No se pudo responder con la IA local.', error: !turns[idx].content });
  } finally {
    controller = null;
    busy = false;
    thinking = false;
    saveTurns(vehicleId, turns);
    void scrollDown();
  }
}

function reset(): void {
  turns = [];
  clearTurns(vehicleId);
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void send();
  }
}
</script>

<section class="chat" aria-label="Asistente de IA">
  {#if showConsent && needsConsent}
    <LocalAiConsent
      offerNano={offers.nano}
      offerWebllm={offers.webllm}
      onAccept={() => {
        modelActive = true;
        showConsent = false;
      }}
      onCancel={() => {
        showConsent = false;
      }}
    />
  {:else if needsConsent}
    <button type="button" class="ghost consent-open" onclick={() => (showConsent = true)}>
      Activar IA local
    </button>
  {/if}
  <header class="chat-head">
    <div>
      <h2>Asistente de {vehicleName}</h2>
      <p class="muted">
        Responde con la ficha, el estado de piezas, el historial y tus notas.
        {#if indexedCount > 0}
          Busca en {indexedCount} {indexedCount === 1 ? 'manual' : 'manuales'}{loadingManuals ? ' (cargando…)' : ` · ${chunks.length} fragmentos`}.
        {:else}
          Carga un manual en PDF en la pestaña Manuales para que lo cite.
        {/if}
      </p>
    </div>
    {#if turns.length}
      <button type="button" class="ghost" onclick={reset}>Nueva conversación</button>
    {/if}
  </header>

  <div class="log" bind:this={scroller} aria-live="polite">
    {#if turns.length === 0}
      <div class="empty">
        <p>Pregunta lo que quieras saber de tu vehículo. Algunas ideas:</p>
        <div class="chips">
          {#each SUGGESTIONS[family] as s (s)}
            <button type="button" class="chip" onclick={() => send(s)}>{s}</button>
          {/each}
        </div>
      </div>
    {/if}

    {#each turns as turn, i (i)}
      <article class="turn {turn.role}" class:error={turn.error}>
        {#if turn.role === 'user'}
          <p class="bubble">{turn.content}</p>
          {#if turn.sources?.length}
            <p class="sources">Buscó en: {turn.sources.map((s) => `${s.manual} p. ${s.page || 's/n'}`).join(' · ')}</p>
          {/if}
        {:else}
          <div class="answer">
            {#if !turn.content && busy && i === turns.length - 1}
              <span class="typing">{thinking ? 'Revisando los datos…' : 'Escribiendo…'}</span>
            {:else}
              <!-- eslint-disable-next-line svelte/no-at-html-tags — renderMarkdown escapa todo el texto -->
              {@html renderMarkdown(turn.content)}
            {/if}
          </div>
        {/if}
      </article>
    {/each}
  </div>

  <form
    class="composer"
    onsubmit={(e) => {
      e.preventDefault();
      void send();
    }}
  >
    <textarea
      bind:value={draft}
      onkeydown={onKey}
      rows="2"
      maxlength="2000"
      placeholder="Escribe tu pregunta… (Enter envía, Shift+Enter nueva línea)"
      aria-label="Pregunta para el asistente"
      disabled={busy}
    ></textarea>
    <button type="submit" class="send" disabled={busy || !draft.trim()}>{busy ? '…' : 'Preguntar'}</button>
    {#if busy}
      <button type="button" class="ghost" onclick={() => controller?.abort()}>Detener</button>
    {/if}
  </form>
  <p class="disclaimer">
    El asistente puede equivocarse. Para frenos, dirección e hidráulica, confirma los valores en el manual oficial o con tu técnico.
  </p>
</section>

<style>
  .chat {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 560px;
  }
  .chat-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  .muted {
    margin: 4px 0 0;
    color: var(--d-muted);
    font-size: 13px;
  }
  .log {
    flex: 1;
    min-height: 320px;
    max-height: 62vh;
    overflow-y: auto;
    padding: 12px;
    background: var(--d-sheet);
    border: 1px solid var(--d-line);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .empty p {
    margin: 0 0 10px;
    color: var(--d-muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    border: 1px solid var(--d-line);
    background: var(--d-card);
    color: var(--d-ink);
    padding: 8px 12px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    text-align: left;
  }
  .chip:hover {
    border-color: var(--d-accent);
  }
  .turn.user {
    align-self: flex-end;
    max-width: min(80%, 640px);
  }
  .bubble {
    margin: 0;
    padding: 10px 14px;
    background: var(--d-ink);
    color: var(--d-card);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .sources {
    margin: 4px 0 0;
    font-size: 11px;
    color: var(--d-muted);
    text-align: right;
  }
  .turn.assistant {
    align-self: flex-start;
    max-width: min(92%, 760px);
  }
  .answer {
    padding: 12px 14px;
    background: var(--d-card);
    border: 1px solid var(--d-line);
    border-left: 3px solid var(--d-accent);
    line-height: 1.5;
    font-size: 14px;
    overflow-x: auto;
  }
  .turn.error .answer {
    border-left-color: var(--d-critical);
    color: var(--d-critical);
  }
  .answer :global(p) {
    margin: 0 0 8px;
  }
  .answer :global(h4) {
    margin: 10px 0 6px;
    font-size: 14px;
  }
  .answer :global(ul),
  .answer :global(ol) {
    margin: 0 0 8px;
    padding-left: 20px;
  }
  .answer :global(table) {
    border-collapse: collapse;
    margin: 6px 0 10px;
    font-size: 13px;
  }
  .answer :global(th),
  .answer :global(td) {
    border: 1px solid var(--d-line);
    padding: 4px 8px;
    text-align: left;
  }
  .answer :global(code) {
    background: var(--d-sheet);
    padding: 0 4px;
  }
  .answer :global(.cite) {
    display: inline-block;
    padding: 0 6px;
    margin: 0 2px;
    font-size: 11px;
    background: color-mix(in srgb, var(--d-accent) 14%, transparent);
    color: var(--d-ink);
    border: 1px solid color-mix(in srgb, var(--d-accent) 45%, transparent);
  }
  .typing {
    color: var(--d-muted);
    font-style: italic;
  }
  .composer {
    display: flex;
    gap: 8px;
  }
  textarea {
    flex: 1;
    resize: vertical;
    min-height: 48px;
    padding: 10px 12px;
    font: inherit;
    font-size: 14px;
    border: 1px solid var(--d-line);
    background: var(--d-card);
    color: var(--d-ink);
  }
  textarea:focus {
    outline: 2px solid var(--d-accent);
    outline-offset: -1px;
  }
  .send {
    padding: 0 18px;
    border: 0;
    background: var(--d-accent);
    color: var(--swal-accent-contrast);
    font-weight: 700;
    cursor: pointer;
  }
  .send:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .ghost {
    border: 1px solid var(--d-line);
    background: transparent;
    color: var(--d-ink);
    padding: 6px 10px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .consent-open {
    align-self: flex-start;
  }
  .disclaimer {
    margin: 0;
    font-size: 11px;
    color: var(--d-muted);
  }
  @media (max-width: 640px) {
    .composer {
      flex-direction: column;
    }
    .send {
      padding: 12px;
    }
    .log {
      max-height: 55vh;
    }
  }
</style>
