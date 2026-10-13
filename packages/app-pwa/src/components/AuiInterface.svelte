<script lang="ts">
import { untrack } from 'svelte';
import { isSocioUser, setDemoSocioStatus } from '../lib/interfaceManager';
import { toast } from '../lib/toast';
import type { AuiSpec } from '../lib/aui';
import { MARKET } from '../lib/market';
import AuiRenderer from './AuiRenderer.svelte';

interface Props {
  initialPrompt?: string;
}

const { initialPrompt = '' }: Props = $props();

let isSocio = $state<boolean>(false);
let promptText = $state<string>(initialPrompt);
let loading = $state<boolean>(false);
let currentSpec = $state<AuiSpec | null>(null);
/** Mensaje de fallo visible (role="alert"): un fallo NUNCA se pinta como si fuera un resultado. */
let errorMsg = $state<string>('');
/** El lienzo muestra el ejemplo determinístico local: datos inventados, no reales. */
let isSample = $state<boolean>(false);
let modelMeta = $state<{
  model: string;
  tokensUsed: number;
  cost: number;
  via: string;
} | null>(null);

const PRESET_PROMPTS = [
  'Generar panel de Mantenimiento Preventivo y Alertas de Taller',
  'Monitor en tiempo real de Telemetría Crítica y Códigos OBD2',
  'Resumen de Disponibilidad de Flota y Conductores Asignados',
  'Auditoría de Consumo de Combustible y Kilometraje Mensual',
];

$effect(() => {
  if (typeof window !== 'undefined') {
    isSocio = isSocioUser();
    // Ejemplo inicial (marcado como tal en el lienzo). untrack: solo una vez al montar;
    // si lo leyera como dependencia, vaciar el lienzo tras un fallo lo volveria a rellenar.
    untrack(() => {
      if (isSocio && !currentSpec && !errorMsg) loadDefaultSpec();
    });
  }
});

function toggleDemoSocio() {
  const next = !isSocio;
  setDemoSocioStatus(next);
  isSocio = next;
  toast.show(
    next
      ? 'Modo Socio (Demo) ACTIVADO: Acceso total al motor de inferencia AUI.'
      : 'Modo Socio (Demo) DESACTIVADO: Mostrando vista de planes y upsell.',
    {
      type: next ? 'success' : 'info',
      title: 'Estado de Cuenta',
    }
  );
  if (next && !currentSpec && !errorMsg) {
    loadDefaultSpec();
  }
}

function loadDefaultSpec() {
  currentSpec = {
    version: 1,
    copy: {
      title: 'AUI Agentic Workspace · Flota GARA-G',
      subtitle: 'Componentes generados dinámicamente mediante contrato AuiSpec v1 (Edge + Cloudflare Workers AI)',
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
  modelMeta = {
    model: 'deterministic-aui-seed',
    tokensUsed: 85,
    cost: 0.00085,
    via: 'local-seed',
  };
}

async function handleGenerate(customPrompt?: string) {
  if (loading) return;
  const p = (customPrompt ?? promptText).trim();
  if (!p) {
    toast.show('Por favor ingresa un prompt para generar la interfaz.', { type: 'warning' });
    return;
  }

  promptText = p;
  loading = true;
  errorMsg = '';

  try {
    const res = await fetch('/api/ai/infer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: p,
        tierId: isSocio ? 'payg' : 'free',
      }),
    });

    if (res.status === 402) {
      toast.show('Inferencia AI requiere cuenta tipo Socio o PAYG.', {
        type: 'warning',
        title: 'Tier no autorizado',
      });
      isSocio = false;
      currentSpec = null;
      modelMeta = null;
      isSample = false;
      errorMsg = 'Inferencia AI requiere cuenta tipo Socio o PAYG.';
      return;
    }

    if (!res.ok) {
      throw new Error(`Error en inferencia HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.spec) {
      currentSpec = data.spec;
      isSample = false;
      modelMeta = {
        model: data.model ?? 'llama-3.1-70b-instruct',
        tokensUsed: data.tokensUsed ?? 120,
        cost: data.cost ?? 0.0012,
        via: data.via ?? 'cf-workers-ai',
      };
      toast.show('Interfaz generada con éxito por el agente AUI.', {
        type: 'success',
        title: 'AUI Generada',
      });
    } else {
      throw new Error('La respuesta no incluye una interfaz');
    }
  } catch (err) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      // Sin red (y solo ahi): el motor determinístico offline-first es legitimo, pero el
      // lienzo lo marca con un aviso visible: son datos de ejemplo, no una respuesta.
      console.warn('[AuiInterface] Sin conexion, ejemplo determinístico local:', err);
      loadDefaultSpec();
      if (currentSpec?.copy) {
        currentSpec.copy.subtitle = `Modo offline-first · Prompt: "${p}"`;
      }
      toast.show('Sin conexión: se muestra un ejemplo local, no datos reales.', {
        type: 'info',
        title: 'Sin conexión',
      });
    } else {
      // 5xx, red caida con el navegador "en linea", respuesta rota: es un fallo, no un resultado.
      console.warn('[AuiInterface] Fallo la inferencia remota:', err);
      currentSpec = null;
      modelMeta = null;
      isSample = false;
      errorMsg = 'No se pudo generar la interfaz. Inténtalo de nuevo.';
    }
  } finally {
    loading = false;
  }
}
</script>

<section class="aui-container" data-testid="aui-interface-view">
  <!-- Top Bar: Switcher socio demo & header -->
  <header class="aui-header g-card">
    <div class="aui-header-left">
      <span class="aui-badge-icon">🤖</span>
      <div>
        <h2 class="aui-heading">AUI Copilot · Agentic User Interface</h2>
        <p class="aui-subheading">
          Modelos generativos para composición dinámica de tableros de flota (SWAL/UI + Cloudflare Workers AI)
        </p>
      </div>
    </div>
    <div class="aui-header-right">
      <button
        type="button"
        class="g-btn demo-toggle-btn"
        data-testid="toggle-demo-socio"
        class:is-active={isSocio}
        onclick={toggleDemoSocio}
        aria-pressed={isSocio}
        title="Alternar simulación de cuenta Socio para pruebas"
      >
        <span class="dot-indicator" class:dot-on={isSocio}></span>
        <span>{isSocio ? 'Cuenta Socio: ACTIVA' : 'Cuenta Socio: DEMO OFF'}</span>
      </button>
    </div>
  </header>

  {#if errorMsg}
    <div class="aui-alert" role="alert" data-testid="aui-error">{errorMsg}</div>
  {/if}

  {#if !isSocio}
    <!-- Gated Upsell View for Non-Socio Users -->
    <div class="aui-upsell g-card" data-testid="aui-upsell-card">
      <div class="upsell-badge">ACCESO EXCLUSIVO TIER SOCIO</div>
      <h3 class="upsell-title">Potencia tu Flota con la Inteligencia Generativa AUI</h3>
      <p class="upsell-desc">
        La generación declarativa de interfaces y análisis predictivo mediante modelos de lenguaje (LLM) está reservada para cuentas tipo <strong>Socio / PAYG</strong>.
      </p>

      <div class="upsell-guarantee">
        <span class="shield-icon">🛡️</span>
        <span>
          <strong>CRUD Básico 100% Libre:</strong> La gestión de tus vehículos, conductores, combustible, geocercas y mantenimientos funciona siempre sin restricciones en la Consola Administrativa. El tier Socio <em>solo</em> gatea la inferencia AI en la nube.
        </span>
      </div>

      <div class="plans-grid">
        <div class="plan-card">
          <div class="plan-tier">Mesh-Only</div>
          <div class="plan-price">0$ <span class="period">/ siempre</span></div>
          <p class="plan-summary">P2P puro Yjs/IndexedDB sin nube. CRUD completo ilimitado de flota.</p>
          <ul class="plan-features">
            <li>✓ 100% Offline-first local</li>
            <li>✓ Sincronización malla P2P</li>
            <li>✗ Sin inferencia AI cloud</li>
          </ul>
        </div>

        <div class="plan-card featured">
          <div class="plan-pill">Recomendado</div>
          <div class="plan-tier">Socio PAYG</div>
          <div class="plan-price">5% <span class="period">pay-per-use</span></div>
          <p class="plan-summary">Infraestructura Cloudflare D1/R2 a costo real + 10% AI. 1 o 100 camiones mismo precio.</p>
          <ul class="plan-features">
            <li>✓ AUI Copilot completo</li>
            <li>✓ Cloudflare Workers AI LLaMA 3.1</li>
            <li>✓ Bóveda R2 cifrada</li>
            <li>✓ Telemetría OBD2 multisede</li>
          </ul>
          <button
            type="button"
            class="g-btn g-btn-cyan btn-upgrade"
            data-testid="cta-upgrade-socio"
            onclick={toggleDemoSocio}
          >
            Activar Tier Socio (Demo)
          </button>
        </div>
      </div>
    </div>
  {:else}
    <!-- Active Socio Workspace -->
    <div class="aui-workspace" data-testid="aui-workspace">
      <!-- Prompt Bar -->
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
              <span>Generar AUI ✦</span>
            {/if}
          </button>
        </div>

        <!-- Presets -->
        <div class="preset-pills">
          <span class="preset-label">Sugerencias rápidas:</span>
          {#each PRESET_PROMPTS as preset}
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

      <!-- Telemetry Info -->
      {#if modelMeta}
        <div class="telemetry-bar">
          <span class="telemetry-chip"><strong>Modelo:</strong> {modelMeta.model}</span>
          <span class="telemetry-chip"><strong>Vía:</strong> {modelMeta.via}</span>
          <span class="telemetry-chip"><strong>Tokens:</strong> {modelMeta.tokensUsed}</span>
          <span class="telemetry-chip"><strong>Costo Est.:</strong> ${modelMeta.cost.toFixed(5)}</span>
        </div>
      {/if}

      <!-- Rendered AUI Canvas -->
      <div class="rendered-canvas g-card" data-testid="aui-rendered-content" aria-busy={loading}>
        {#if isSample && currentSpec}
          <p class="aui-sample-note" role="status" data-testid="aui-sample-note">
            Ejemplo generado sin conexión: datos no reales.
          </p>
        {/if}
        {#if currentSpec}
          <AuiRenderer spec={currentSpec} />
        {:else if !errorMsg}
          <p class="aui-canvas-empty">Escribe un prompt o elige una sugerencia para generar una interfaz.</p>
        {/if}
      </div>
    </div>
  {/if}
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

  .aui-badge-icon {
    font-size: 2rem;
    line-height: 1;
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

  .demo-toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--swal-bg-surface);
    border: 1px solid var(--swal-border-light);
    color: var(--swal-text-secondary);
    font-size: 0.75rem;
    font-family: var(--swal-font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.5rem 0.85rem;
    border-radius: var(--swal-radius);
    cursor: pointer;
    transition: background 150ms ease, border-color 150ms ease;
  }

  .demo-toggle-btn:hover {
    background: var(--swal-surface-hover);
    border-color: var(--swal-border-strong);
  }

  .demo-toggle-btn.is-active {
    background: var(--swal-success-muted);
    border-color: var(--swal-success);
    color: var(--swal-success);
  }

  .dot-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--swal-text-faint);
  }

  .dot-indicator.dot-on {
    background: var(--swal-success);
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

  /* Upsell */
  .aui-upsell {
    padding: 2.5rem 2rem;
    text-align: center;
    background: var(--swal-surface);
    border: 1px solid var(--swal-border);
    border-radius: var(--swal-radius);
  }

  .upsell-badge {
    display: inline-block;
    background: var(--swal-accent-muted);
    color: var(--swal-accent-text);
    border: 1px solid var(--swal-accent);
    padding: 0.25rem 0.75rem;
    border-radius: var(--swal-radius);
    font-family: var(--swal-font-mono);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    margin-bottom: 1rem;
  }

  .upsell-title {
    font-size: 1.5rem;
    font-weight: 800;
    color: var(--swal-text);
    margin: 0 0 0.75rem 0;
  }

  .upsell-desc {
    max-width: 580px;
    margin: 0 auto 1.5rem auto;
    font-size: 0.95rem;
    color: var(--swal-text-secondary);
    line-height: 1.5;
  }

  .upsell-guarantee {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    background: var(--swal-success-muted);
    border: 1px solid var(--swal-success);
    border-radius: var(--swal-radius);
    padding: 0.75rem 1.25rem;
    max-width: 640px;
    font-size: 0.85rem;
    color: var(--swal-text);
    text-align: left;
    margin-bottom: 2.5rem;
  }

  .plans-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
    gap: 1.5rem;
    max-width: 720px;
    margin: 0 auto;
    text-align: left;
  }

  .plan-card {
    background: var(--swal-bg-surface);
    border: 1px solid var(--swal-border);
    border-radius: var(--swal-radius);
    padding: 1.5rem;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .plan-card.featured {
    border-color: var(--swal-accent);
    background: var(--swal-surface);
  }

  .plan-pill {
    position: absolute;
    top: -10px;
    right: 16px;
    background: var(--swal-accent);
    color: var(--swal-accent-contrast);
    font-family: var(--swal-font-mono);
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: var(--swal-radius);
  }

  .plan-tier {
    font-family: var(--swal-font-mono);
    font-size: 0.8rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    font-weight: 700;
    color: var(--swal-text);
  }

  .plan-price {
    font-size: 1.75rem;
    font-weight: 800;
    color: var(--swal-text);
    margin: 0.5rem 0;
  }

  .plan-price .period {
    font-size: 0.8rem;
    color: var(--swal-text-muted);
    font-weight: normal;
  }

  .plan-summary {
    font-size: 0.8rem;
    color: var(--swal-text-muted);
    line-height: 1.4;
    margin-bottom: 1rem;
  }

  .plan-features {
    list-style: none;
    padding: 0;
    margin: 0 0 1.5rem 0;
    font-size: 0.82rem;
    color: var(--swal-text-secondary);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    flex: 1;
  }

  .btn-upgrade {
    width: 100%;
    justify-content: center;
    padding: 0.6rem 1rem;
    font-weight: 600;
    background: var(--swal-accent);
    border: 1px solid var(--swal-accent);
    color: var(--swal-accent-contrast);
    border-radius: var(--swal-radius);
    cursor: pointer;
  }
  .btn-upgrade:hover {
    background: var(--swal-accent-hover);
    border-color: var(--swal-accent-hover);
  }

  /* Workspace */
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
