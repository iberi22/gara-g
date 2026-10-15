<script lang="ts">
/**
 * AuiInterface — AUI local (D-aui): la composición de tableros corre en el navegador.
 *
 * Sin cobros ni cuentas: la generación usa la IA local (Chrome Prompt API
 * o WebGPU) y, si el navegador no la tiene, se muestra un aviso en español explicando qué
 * hace falta. La spec del modelo se valida siempre en lib/aui.ts (whitelist AuiSpec v1).
 */
import { untrack } from 'svelte';
import { toast } from '../lib/toast';
import { generateAui, type AuiSpec } from '../lib/aui';
import { MARKET } from '../lib/market';
import { detectLocalAi, type AiTier } from '../lib/localAi/capabilities';
import AuiRenderer from './AuiRenderer.svelte';

interface Props {
  initialPrompt?: string;
}

const { initialPrompt = '' }: Props = $props();

let promptText = $state<string>(initialPrompt);
let loading = $state<boolean>(false);
let currentSpec = $state<AuiSpec | null>(null);
/** Mensaje de fallo visible (role="alert"): un fallo NUNCA se pinta como si fuera un resultado. */
let errorMsg = $state<string>('');
/** El lienzo muestra un ejemplo local: datos inventados, no reales. */
let isSample = $state<boolean>(false);
let tier = $state<AiTier>('rules');
let modelMeta = $state<{ model: string; via: string } | null>(null);

const PRESET_PROMPTS = [
  'Generar panel de Mantenimiento Preventivo y Alertas de Taller',
  'Monitor en tiempo real de Telemetría Crítica y Códigos OBD2',
  'Resumen de Disponibilidad de Flota y Conductores Asignados',
  'Auditoría de Consumo de Combustible y Kilometraje Mensual',
];

$effect(() => {
  if (typeof window !== 'undefined') {
    untrack(() => {
      detectLocalAi().then((detected) => (tier = detected));
      if (!currentSpec && !errorMsg) loadDefaultSpec();
    });
  }
});

function loadDefaultSpec() {
  currentSpec = {
    version: 1,
    copy: {
      title: 'AUI Agentic Workspace · Flota GARA-G',
      subtitle: 'Vista de ejemplo de composición dinámica (contrato AuiSpec v1)',
    },
    components: [
      {
        id: 'card-live-kpi',
        type: 'Card',
        props: {
          title: 'Eficiencia Global de Flota',
          content: `94.2% de unidades operativas en ruta con consumo promedio de 2.8 ${MARKET.efficiencyUnit}.`,
        },
      },
      {
        id: 'badge-status-ok',
        type: 'StatusBadge',
        props: {
          label: 'Red P2P Activa (Yjs + D1 Sync)',
          status: 'success',
        },
      },
      {
        id: 'table-flota-summary',
        type: 'Table',
        props: {
          headers: ['Vehículo', 'Conductor', 'Estado', 'Último Checkpoint'],
          rows: [
            ['FL-01 (Toyota Hilux)', 'Rodrigo Ejemplo Muñoz', 'En Ruta', MARKET.demoCheckpoints[0]],
            ['FL-02 (Chevrolet NPR)', 'Patricio Ejemplo Rojas', 'En Ruta', MARKET.demoCheckpoints[1]],
            ['FL-03 (Kenworth T800)', 'Jorge Ramírez', 'Taller Programado', MARKET.demoCheckpoints[2]],
          ],
        },
      },
      {
        id: 'btn-export-vault',
        type: 'Button',
        props: {
          label: 'Firmar y Almacenar Estado en Bóveda R2',
        },
      },
    ],
  };
  isSample = true;
  modelMeta = { model: 'ejemplo-local', via: 'local-ejemplo' };
}

async function handleGenerate(customPrompt?: string) {
  if (loading) return;
  const p = (customPrompt ?? promptText).trim();
  if (!p) {
    toast.show('Por favor ingresa un pedido para generar la interfaz.', { type: 'warning' });
    return;
  }

  promptText = p;
  loading = true;
  errorMsg = '';

  try {
    const res = await generateAui(p);
    if (!res.spec) {
      currentSpec = null;
      modelMeta = null;
      isSample = false;
      errorMsg = res.error ?? 'No se pudo generar la interfaz con la IA local.';
      return;
    }
    currentSpec = res.spec;
    isSample = false;
    modelMeta = { model: res.model ?? 'modelo local', via: res.via };
    toast.show('Interfaz generada con la IA local.', { type: 'success', title: 'AUI generada' });
  } catch (err) {
    console.warn('[AuiInterface] Fallo la inferencia local:', err);
    currentSpec = null;
    modelMeta = null;
    isSample = false;
    errorMsg = 'No se pudo generar la interfaz. Inténtalo de nuevo.';
  } finally {
    loading = false;
  }
}
</script>

<section class="aui-container" data-testid="aui-interface-view">
  <header class="aui-header g-card">
    <div class="aui-header-left">
      <div>
        <h2 class="aui-heading">AUI · Agentic User Interface</h2>
        <p class="aui-subheading">
          Composición dinámica de tableros con la IA local de tu navegador. No pide cuenta ni
          conexión, y la app funciona igual sin ella.
        </p>
      </div>
    </div>
  </header>

  {#if tier === 'rules'}
    <div class="aui-local-ai" role="status" data-testid="aui-local-ai-note">
      Este navegador no tiene IA local disponible. La AUI puede componer tableros con Chrome
      Prompt API (Gemini Nano) o con WebGPU; mientras tanto se muestra un ejemplo local.
    </div>
  {/if}

  {#if errorMsg}
    <div class="aui-alert" role="alert" data-testid="aui-error">{errorMsg}</div>
  {/if}

  <div class="aui-workspace" data-testid="aui-workspace">
    <div class="prompt-bar g-card">
      <label for="aui-prompt-input" class="prompt-label">
        ¿Qué interfaz o reporte necesitas que el agente componga para tu flota?
      </label>
      <div class="prompt-input-group">
        <input
          id="aui-prompt-input"
          type="text"
          class="g-input prompt-input"
          placeholder="Ej: Generar tabla de vehículos en taller con costos estimados..."
          bind:value={promptText}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (loading) return;
              handleGenerate();
            }
          }}
          data-testid="aui-prompt-input"
        />
        <button
          type="button"
          class="g-btn g-btn-cyan prompt-submit"
          disabled={loading}
          onclick={() => handleGenerate()}
          data-testid="aui-submit-btn"
        >
          {#if loading}
            <span>Generando...</span>
          {:else}
            <span>Generar AUI</span>
          {/if}
        </button>
      </div>

      <div class="preset-pills">
        <span class="preset-label">Sugerencias rápidas:</span>
        {#each PRESET_PROMPTS as preset (preset)}
          <button
            type="button"
            class="preset-pill"
            data-testid="aui-preset-prompt"
            disabled={loading}
            onclick={() => handleGenerate(preset)}
          >
            {preset}
          </button>
        {/each}
      </div>
    </div>

    {#if modelMeta}
      <div class="telemetry-bar">
        <span class="telemetry-chip"><strong>Modelo:</strong> {modelMeta.model}</span>
        <span class="telemetry-chip"><strong>Vía:</strong> {modelMeta.via}</span>
      </div>
    {/if}

    <div class="rendered-canvas g-card" data-testid="aui-rendered-content" aria-busy={loading}>
      {#if isSample && currentSpec}
        <p class="aui-sample-note" role="status" data-testid="aui-sample-note">
          Ejemplo local: datos no reales.
        </p>
      {/if}
      {#if currentSpec}
        <AuiRenderer spec={currentSpec} />
      {:else if !errorMsg}
        <p class="aui-canvas-empty">Escribe un pedido o elige una sugerencia para generar una interfaz.</p>
      {/if}
    </div>
  </div>
</section>

<style>
  .aui-container {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    width: 100%;
    margin-bottom: 2rem;
  }

  .aui-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
    padding: 1.25rem 1.5rem;
    background: var(--swal-surface);
    border: 1px solid var(--swal-border);
    border-left: 3px solid var(--swal-accent);
    border-radius: var(--swal-radius);
  }

  .aui-header-left {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .aui-heading {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--swal-text);
    margin: 0 0 0.25rem 0;
  }

  .aui-subheading {
    font-size: 0.85rem;
    color: var(--swal-text-muted);
    margin: 0;
  }

  .aui-local-ai {
    padding: 0.75rem 1rem;
    background: var(--swal-warning-muted);
    border: 1px solid var(--swal-warning);
    border-radius: var(--swal-radius);
    color: var(--swal-text);
    font-size: 0.85rem;
  }

  .aui-alert {
    padding: 0.75rem 1rem;
    background: var(--swal-danger-muted);
    border: 1px solid var(--swal-danger);
    border-radius: var(--swal-radius);
    color: var(--swal-danger);
    font-size: 0.9rem;
  }

  .aui-sample-note {
    margin: 0 0 1rem 0;
    padding: 0.5rem 0.75rem;
    background: var(--swal-warning-muted);
    border: 1px solid var(--swal-warning);
    border-radius: var(--swal-radius);
    color: var(--swal-warning);
    font-size: 0.8rem;
  }

  .aui-canvas-empty {
    margin: 0;
    color: var(--swal-text-muted);
    font-size: 0.9rem;
  }

  .aui-workspace {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .prompt-bar {
    padding: 1.25rem;
    background: var(--swal-surface);
    border: 1px solid var(--swal-border);
    border-radius: var(--swal-radius);
  }

  .prompt-label {
    display: block;
    font-family: var(--swal-font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--swal-text-secondary);
    margin-bottom: 0.6rem;
  }

  .prompt-input-group {
    display: flex;
    gap: 0.5rem;
  }

  .prompt-input {
    flex: 1;
    background: var(--swal-bg-elevated);
    border: 1px solid var(--swal-border-light);
    border-radius: var(--swal-radius);
    padding: 0.75rem 1rem;
    color: var(--swal-text);
    font-size: 0.9rem;
  }
  .prompt-input::placeholder {
    color: var(--swal-text-muted);
  }
  .prompt-input:focus {
    outline: none;
    border-color: var(--swal-accent);
  }
  .prompt-input:focus-visible {
    outline: 2px solid var(--swal-accent);
    outline-offset: 1px;
  }

  .prompt-submit {
    padding: 0.75rem 1.5rem;
    font-weight: 600;
    border-radius: var(--swal-radius);
    background: var(--swal-accent);
    color: var(--swal-accent-contrast);
    cursor: pointer;
    border: 1px solid var(--swal-accent);
  }
  .prompt-submit:hover:not(:disabled) {
    background: var(--swal-accent-hover);
  }
  .prompt-submit:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .preset-pills {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.85rem;
  }

  .preset-label {
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--swal-text-muted);
    font-family: var(--swal-font-mono);
  }

  .preset-pill {
    background: var(--swal-bg-surface);
    border: 1px solid var(--swal-border);
    color: var(--swal-text-secondary);
    font-size: 0.75rem;
    padding: 0.25rem 0.65rem;
    border-radius: var(--swal-radius);
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease;
  }
  .preset-pill:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .preset-pill:hover:not(:disabled) {
    background: var(--swal-active-bg);
    border-color: var(--swal-accent);
    color: var(--swal-accent-text);
  }

  .telemetry-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    padding: 0.4rem 0.75rem;
    background: var(--swal-bg-surface);
    border-radius: var(--swal-radius);
    border: 1px solid var(--swal-border);
    font-family: var(--swal-font-mono);
    font-size: 0.75rem;
    color: var(--swal-text-muted);
  }

  .telemetry-chip strong {
    color: var(--swal-text-secondary);
  }

  .rendered-canvas {
    padding: 1.5rem;
    background: var(--swal-bg-surface);
    border: 1px solid var(--swal-border);
    border-radius: var(--swal-radius);
    min-height: 250px;
  }

  @media (max-width: 640px) {
    .prompt-input-group {
      flex-direction: column;
    }
    .prompt-submit {
      width: 100%;
    }
  }
</style>
