<script lang="ts">
import { isGameUiEnabled } from '../lib/interfaceManager';
import { toast } from '../lib/toast';

interface Props {
  initialGameEnabled?: boolean;
}

const { initialGameEnabled }: Props = $props();

let isAllowed = $state<boolean>(initialGameEnabled ?? true);
let selectedVehicleIndex = $state<number>(0);
// Color de acento del garaje (token del tema, no un literal): ocupa el lugar del antiguo "neon".
const ACCENT_OPTIONS = [
  { id: 'accent', css: 'var(--swal-accent)', title: 'Naranja señal' },
  { id: 'ink', css: 'var(--swal-text)', title: 'Tinta' },
  { id: 'ok', css: 'var(--swal-success)', title: 'Verde operativo' },
] as const;
let accentId = $state<string>('accent');
const underglowColor = $derived(ACCENT_OPTIONS.find((o) => o.id === accentId)?.css ?? 'var(--swal-accent)');
let isHeadlightsOn = $state<boolean>(true);
let revLevel = $state<number>(1800); // RPM
let isRevving = $state<boolean>(false);

interface GameCar {
  id: string;
  name: string;
  plate: string;
  type: string;
  year: number;
  status: 'active' | 'maintenance' | 'idle';
  hp: number;
  topSpeed: number; // km/h
  accel: number; // 0-100 s
  efficiency: number; // km/gal
  health: number; // %
  vin: string;
  color: string;
}

let vehicles = $state<GameCar[]>([
  {
    id: 'veh-01',
    name: 'Toyota Hilux 2.8 D-4D',
    plate: 'GARA-001',
    type: 'Pick-up 4x4',
    year: 2024,
    status: 'active',
    hp: 204,
    topSpeed: 180,
    accel: 10.2,
    efficiency: 34.5,
    health: 98,
    vin: '8AJBA3CD4P1002341',
    color: 'accent',
  },
  {
    id: 'veh-02',
    name: 'Kenworth T800 Heavy Hauler',
    plate: 'GARA-002',
    type: 'Tractocamión',
    year: 2023,
    status: 'active',
    hp: 450,
    topSpeed: 135,
    accel: 18.5,
    efficiency: 9.8,
    health: 91,
    vin: '1XKDDB9X1PJ492102',
    color: 'ink',
  },
  {
    id: 'veh-03',
    name: 'Chevrolet NPR Turbo Diésel',
    plate: 'GARA-003',
    type: 'Camión Reparto',
    year: 2024,
    status: 'active',
    hp: 190,
    topSpeed: 145,
    accel: 14.0,
    efficiency: 22.0,
    health: 95,
    vin: '9CKNNR75MRE109244',
    color: 'ok',
  },
  {
    id: 'veh-04',
    name: 'Renault Master Furgón L3H2',
    plate: 'GARA-004',
    type: 'Van Carga',
    year: 2022,
    status: 'maintenance',
    hp: 136,
    topSpeed: 155,
    accel: 12.8,
    efficiency: 32.0,
    health: 78,
    vin: 'VF1MADF4560129481',
    color: 'warn',
  },
]);

const currentCar = $derived(vehicles[selectedVehicleIndex] ?? vehicles[0]);

$effect(() => {
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    const qOverride = url.searchParams.get('game_enabled');
    isAllowed = isGameUiEnabled(undefined, qOverride);

    // Fetch real vehicles if available from API
    fetch('/api/fleet/vehicle')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data) && data.length > 0) {
          const mapped: GameCar[] = data.map((v: any, idx: number) => ({
            id: v.id ?? `v-${idx}`,
            name: `${v.make ?? 'Vehículo'} ${v.model ?? ''}`.trim() || 'Unidad de Flota',
            plate: v.plate ?? `GARA-${idx + 10}`,
            type: v.type ?? 'Flota',
            year: Number(v.year) || 2023,
            status: v.status === 'in_workshop' || v.status === 'maintenance' ? 'maintenance' : 'active',
            hp: v.type === 'Tractomula' || v.type === 'Pesado' ? 420 : 180 + (idx % 3) * 20,
            topSpeed: v.type === 'Tractomula' ? 130 : 170 + (idx % 2) * 10,
            accel: v.type === 'Tractomula' ? 19.0 : 11.0,
            efficiency: v.type === 'Tractomula' ? 9.5 : 31.0,
            health: v.status === 'in_workshop' ? 74 : 96,
            vin: v.vin ?? `VIN998822${idx}`,
            color: idx % 3 === 0 ? 'accent' : idx % 3 === 1 ? 'ink' : 'ok',
          }));
          vehicles = mapped;
        }
      })
      .catch(() => {
        // Safe offline fallback: keep seeded vehicles
      });
  }
});

function handleRevStart() {
  isRevving = true;
  revLevel = 4600;
}

function handleRevEnd() {
  isRevving = false;
  revLevel = 1800;
}

function returnToAdmin() {
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    url.searchParams.set('ui', 'admin');
    window.location.href = url.toString();
  }
}
</script>

<div class="game-container">
  {#if !isAllowed}
    <!-- Fallback when Game UI is disabled via GAME_UI_ENABLED -->
    <div class="game-disabled" data-testid="game-disabled-fallback">
      <div class="disabled-icon">⚠️</div>
      <h3 class="disabled-title">Modo Garaje NFS Deshabilitado</h3>
      <p class="disabled-text">
        La interfaz de videojuego está desactivada actualmente en este entorno mediante la bandera <code>GAME_UI_ENABLED=false</code> o parámetro de configuración.
      </p>
      <div class="disabled-actions">
        <button
          type="button"
          class="g-btn g-btn-cyan btn-return"
          onclick={returnToAdmin}
        >
          Volver a Consola Administrativa
        </button>
      </div>
    </div>
  {:else}
    <!-- Active Game UI: Need for Speed Garage View -->
    <div class="game-garage" data-testid="game-garage-view">
      <!-- Garage Header / HUD Top -->
      <header class="hud-top">
        <div class="hud-brand">
          <span class="hud-brand-tag"><span class="swal-tick"></span> GARA-G PERFORMANCE</span>
          <h2 class="hud-brand-title">AUTONOMOUS GARAGE // SPEC-R</h2>
        </div>

        <div class="hud-controls">
          <div class="underglow-picker">
            <span class="picker-label">ACENTO:</span>
            {#each ACCENT_OPTIONS as o}
              <button
                type="button"
                class="neon-dot"
                style={`--c: ${o.css};`}
                class:selected={accentId === o.id}
                onclick={() => accentId = o.id}
                title={o.title}
                aria-label={`Acento ${o.title}`}
              ></button>
            {/each}
          </div>

          <button
            type="button"
            class="g-btn btn-headlights"
            class:is-on={isHeadlightsOn}
            onclick={() => isHeadlightsOn = !isHeadlightsOn}
          >
            {isHeadlightsOn ? 'LUCES: ON' : 'LUCES: OFF'}
          </button>
        </div>
      </header>

      <!-- Main Stage: 3D-ish Isometric Showroom Floor -->
      <div class="garage-stage swal-blueprint-bg" style={`--underglow: ${underglowColor};`}>
        <!-- Perspective Grid Floor -->
        <div class="grid-floor"></div>

        <!-- Marca de acento bajo el vehiculo -->
        <div class="underglow-light"></div>

        <!-- Vehicle 3D/SVG Model Rendering -->
        <div class="vehicle-stage" data-testid="vehicle-showcase">
          {#if isHeadlightsOn}
            <div class="headlight-beam left-beam"></div>
            <div class="headlight-beam right-beam"></div>
          {/if}

          <!-- Stylized Isometric Vehicle Vector Silhouette -->
          <svg class="car-svg" viewBox="0 0 500 240" fill="none" xmlns="http://www.w3.org/2000/svg" style={`--accent: ${underglowColor};`}>
            <!-- Sombra de apoyo -->
            <ellipse cx="250" cy="205" rx="190" ry="22" class="svg-shadow" />

            <!-- Chasis -->
            <path
              d="M70 180 L120 180 L140 195 L360 195 L380 180 L430 180 L440 160 L410 135 L330 115 L260 85 L170 85 L100 130 L60 150 Z"
              class="svg-body"
            />

            <!-- Cabina / parabrisas -->
            <polygon points="175,90 255,90 320,118 190,118" class="svg-glass" />
            <polygon points="130,122 185,122 185,95 115,130" class="svg-glass svg-glass-rear" />

            <!-- Ruedas -->
            <circle cx="140" cy="180" r="28" class="svg-tire" />
            <circle cx="140" cy="180" r="16" class="svg-rim" />
            <circle cx="140" cy="180" r="6" class="svg-hub" />

            <circle cx="360" cy="180" r="28" class="svg-tire" />
            <circle cx="360" cy="180" r="16" class="svg-rim" />
            <circle cx="360" cy="180" r="6" class="svg-hub" />

            <!-- Linea lateral de acento -->
            <line x1="172" y1="152" x2="330" y2="152" class="svg-trim" />

            <!-- Faro delantero -->
            <polygon points="58,150 78,144 76,156" class="svg-headlight" class:is-on={isHeadlightsOn} />

            <!-- Luz trasera -->
            <polygon points="435,160 442,160 438,172 432,172" class="svg-taillight" />

            <!-- Matricula sobre el chasis -->
            <text x="250" y="165" class="svg-plate" font-size="12" font-family="monospace" text-anchor="middle" letter-spacing="2">
              {currentCar.plate}
            </text>
          </svg>

          <!-- Floating Unit Hologram Tag -->
          <div class="hologram-tag">
            <span class="holo-plate">{currentCar.plate}</span>
            <span class="holo-model">{currentCar.name}</span>
          </div>
        </div>
      </div>

      <!-- Vehicle Selector Carousel -->
      <div class="vehicle-carousel" data-testid="garage-vehicle-selector">
        {#each vehicles as v, idx}
          <button
            type="button"
            class="carousel-card"
            class:selected={idx === selectedVehicleIndex}
            onclick={() => selectedVehicleIndex = idx}
          >
            <div class="card-plate">{v.plate}</div>
            <div class="card-name">{v.name}</div>
            <div class="card-meta">
              <span>{v.type}</span> · <span class="card-hp">{v.hp} HP</span>
            </div>
          </button>
        {/each}
      </div>

      <!-- Bottom Dashboard: Stats & Live Telemetry -->
      <div class="hud-stats-grid" data-testid="game-hud-stats">
        <!-- Vehicle Stat Card -->
        <div class="swal-card-frame stat-card" data-testid="car-stat-card"><div class="swal-card-inner stat-inner">
          <div class="stat-card-header">
            <h3 class="stat-card-title">FICHA TÉCNICA // SPEC</h3>
            <span class="status-badge status-{currentCar.status}">
              {currentCar.status === 'active' ? 'OPERATIVO' : 'EN TALLER'}
            </span>
          </div>

          <div class="specs-table">
            <div class="spec-row">
              <span class="spec-label">MODELO:</span>
              <span class="spec-val">{currentCar.name}</span>
            </div>
            <div class="spec-row">
              <span class="spec-label">VIN:</span>
              <span class="spec-val mono">{currentCar.vin}</span>
            </div>
            <div class="spec-row">
              <span class="spec-label">POTENCIA:</span>
              <span class="spec-val highlight">{currentCar.hp} HP @ 3600 RPM</span>
            </div>
            <div class="spec-row">
              <span class="spec-label">VEL. MÁXIMA:</span>
              <span class="spec-val">{currentCar.topSpeed} km/h</span>
            </div>
            <div class="spec-row">
              <span class="spec-label">ACELERACIÓN (0-100):</span>
              <span class="spec-val">{currentCar.accel}s</span>
            </div>
            <div class="spec-row">
              <span class="spec-label">EFICIENCIA COMB.:</span>
              <span class="spec-val">{currentCar.efficiency} km/gal</span>
            </div>
          </div>
        </div></div>

        <!-- Live Telemetry HUD Gauge Panel -->
        <div class="swal-card-frame hud-telemetry" data-testid="car-hud-telemetry"><div class="swal-card-inner stat-inner">
          <div class="stat-card-header">
            <h3 class="stat-card-title">TELEMETRÍA OBD2 // LIVE HUD</h3>
            <span class="telemetry-live-dot"></span>
          </div>

          <div class="hud-dials">
            <!-- Tachometer / RPM Dial -->
            <div class="dial-card">
              <div class="dial-value" class:revving={isRevving}>
                {revLevel} <span class="dial-unit">RPM</span>
              </div>
              <div class="gauge-bar-wrap">
                <div
                  class="gauge-bar-fill"
                  style={`width: ${Math.min(100, (revLevel / 5000) * 100)}%; background: ${revLevel > 4000 ? 'var(--swal-danger)' : 'var(--swal-accent)'};`}
                ></div>
              </div>
              <div class="dial-label">TAQUÍMETRO MOTOR</div>
              <button
                type="button"
                class="rev-btn"
                onmousedown={handleRevStart}
                onmouseup={handleRevEnd}
                ontouchstart={handleRevStart}
                ontouchend={handleRevEnd}
              >
                MANTENER PARA ACELERAR (REV)
              </button>
            </div>

            <!-- Speedometer -->
            <div class="dial-card">
              <div class="dial-value">
                {isRevving ? '84' : '0'} <span class="dial-unit">KM/H</span>
              </div>
              <div class="gauge-bar-wrap">
                <div
                  class="gauge-bar-fill"
                  style={`width: ${isRevving ? '45%' : '0%'}; background: var(--swal-success);`}
                ></div>
              </div>
              <div class="dial-label">VELOCÍMETRO GPS</div>
              <span class="dial-sub">ENGRANAJE: {isRevving ? '3RA' : 'PARK (P)'}</span>
            </div>

            <!-- Diagnostic Health Gauge -->
            <div class="dial-card">
              <div class="dial-value" style="color: var(--swal-success);">
                {currentCar.health}% <span class="dial-unit">HEALTH</span>
              </div>
              <div class="gauge-bar-wrap">
                <div
                  class="gauge-bar-fill"
                  style={`width: ${currentCar.health}%; background: var(--swal-success);`}
                ></div>
              </div>
              <div class="dial-label">SALUD DIAGNÓSTICO</div>
              <span class="dial-sub">0 CÓDIGOS DTC ACTIVOS</span>
            </div>
          </div>
        </div></div>
      </div>
    </div>
  {/if}
</div>

<style>
  .game-container {
    width: 100%;
    margin-bottom: 2rem;
    font-family: var(--swal-font-mono);
    color: var(--swal-text);
  }

  /* Disabled state */
  .game-disabled {
    padding: 3rem 1.5rem;
    text-align: center;
    background: var(--swal-surface);
    border: 1px dashed var(--swal-danger);
  }

  .disabled-icon {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
  }

  .disabled-title {
    font-size: 1.3rem;
    color: var(--swal-danger);
    margin: 0 0 0.5rem 0;
  }

  .disabled-text {
    max-width: 480px;
    margin: 0 auto 1.5rem auto;
    font-size: 0.85rem;
    color: var(--swal-text-muted);
    line-height: 1.5;
  }

  .btn-return {
    padding: 0.5rem 1rem;
    background: var(--swal-accent);
    color: var(--swal-accent-contrast);
    border: 1px solid var(--swal-accent);
    font-weight: 700;
    cursor: pointer;
  }

  /* Active Garage */
  .game-garage {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .hud-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 1rem;
    padding: 0.75rem 1.25rem;
    background: var(--swal-surface);
    border: 1px solid var(--swal-border);
  }

  .hud-brand-tag {
    font-size: 0.65rem;
    color: var(--swal-text-muted);
    letter-spacing: 0.14em;
  }

  .hud-brand-title {
    font-size: 1.1rem;
    font-weight: 800;
    color: var(--swal-text);
    margin: 0;
    letter-spacing: 0.05em;
  }

  .hud-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .underglow-picker {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .picker-label {
    font-size: 0.7rem;
    color: var(--swal-text-muted);
  }

  .neon-dot {
    width: 16px;
    height: 16px;
    border-radius: 0;
    background: var(--c);
    border: 1px solid var(--swal-border-strong);
    cursor: pointer;
  }
  .neon-dot.selected {
    outline: 2px solid var(--swal-text);
    outline-offset: 2px;
  }

  .btn-headlights {
    padding: 0.35rem 0.75rem;
    font-size: 0.75rem;
    background: var(--swal-surface);
    border: 1px solid var(--swal-border-strong);
    color: var(--swal-text-secondary);
    cursor: pointer;
  }
  .btn-headlights.is-on {
    background: var(--swal-accent);
    border-color: var(--swal-accent);
    color: var(--swal-accent-contrast);
  }

  /* Stage */
  .garage-stage {
    position: relative;
    height: 320px;
    border: 1px solid var(--swal-border);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .grid-floor {
    position: absolute;
    inset: 0;
    top: 50%;
    background-image:
      linear-gradient(var(--swal-line-blueprint) 1px, transparent 1px),
      linear-gradient(90deg, var(--swal-line-blueprint) 1px, transparent 1px);
    background-size: 36px 36px;
    transform: perspective(300px) rotateX(65deg);
    transform-origin: 50% 0%;
    opacity: 0.7;
    pointer-events: none;
  }

  /* Marca plana de acento bajo el vehiculo (sin brillo). */
  .underglow-light {
    position: absolute;
    width: 300px;
    height: 4px;
    bottom: 58px;
    background: var(--underglow);
    pointer-events: none;
  }

  .vehicle-stage {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .car-svg {
    width: 440px;
    max-width: 90vw;
    height: auto;
  }

  .svg-shadow { fill: var(--swal-text); opacity: 0.12; }
  .svg-body { fill: var(--swal-surface); stroke: var(--swal-text); stroke-width: 2; }
  .svg-glass { fill: var(--swal-surface-active); stroke: var(--swal-text-muted); stroke-width: 1.5; }
  .svg-glass-rear { stroke-width: 1; }
  .svg-tire { fill: var(--swal-ink-graphite); stroke: var(--swal-border-strong); stroke-width: 4; }
  .svg-rim { fill: var(--swal-surface); stroke: var(--accent); stroke-width: 2; }
  .svg-hub { fill: var(--swal-border-strong); }
  .svg-trim { stroke: var(--accent); stroke-width: 3; }
  .svg-headlight { fill: var(--swal-border-strong); stroke: var(--swal-text); stroke-width: 1; }
  .svg-headlight.is-on { fill: var(--swal-accent); }
  .svg-taillight { fill: var(--swal-danger); }
  .svg-plate { fill: var(--swal-text-muted); }

  /* Haz de luz plano, sin desenfoque. */
  .headlight-beam {
    position: absolute;
    top: 120px;
    left: -230px;
    width: 280px;
    height: 50px;
    background: var(--swal-accent-muted);
    clip-path: polygon(100% 35%, 0% 0%, 0% 100%, 100% 65%);
    pointer-events: none;
  }

  .hologram-tag {
    margin-top: -10px;
    background: var(--swal-surface);
    border: 1px solid var(--underglow);
    padding: 0.25rem 0.75rem;
    text-align: center;
  }

  .holo-plate {
    font-weight: 800;
    color: var(--swal-text);
    font-size: 0.85rem;
    margin-right: 0.5rem;
  }

  .holo-model {
    font-size: 0.75rem;
    color: var(--swal-text-secondary);
  }

  /* Carousel */
  .vehicle-carousel {
    display: flex;
    gap: 0.75rem;
    overflow-x: auto;
    padding: 0.5rem 0;
  }

  .carousel-card {
    flex: 0 0 190px;
    background: var(--swal-surface);
    color: var(--swal-text);
    border: 1px solid var(--swal-border);
    padding: 0.75rem;
    text-align: left;
    cursor: pointer;
    transition: background 150ms ease, border-color 150ms ease;
  }
  .carousel-card:hover {
    border-color: var(--swal-border-strong);
    background: var(--swal-surface-hover);
  }
  .carousel-card.selected {
    border-color: var(--swal-accent);
    border-left-width: 4px;
    background: var(--swal-active-bg);
  }

  .card-plate {
    font-weight: 700;
    font-size: 0.8rem;
    color: var(--swal-text);
  }

  .card-name {
    font-size: 0.75rem;
    color: var(--swal-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin: 0.15rem 0;
  }

  .card-meta {
    font-size: 0.68rem;
    color: var(--swal-text-muted);
  }

  .card-hp {
    color: var(--swal-accent-text);
    font-weight: 600;
  }

  /* HUD stats */
  .hud-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
    gap: 1.25rem;
  }

  .stat-inner {
    padding: 1rem;
  }

  .stat-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--swal-border);
    padding-bottom: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .stat-card-title {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--swal-text);
    margin: 0;
    letter-spacing: 0.05em;
  }

  .status-badge {
    font-size: 0.65rem;
    font-weight: 700;
    padding: 2px 6px;
  }
  .status-badge.status-active {
    background: var(--swal-success-muted);
    color: var(--swal-success);
    border: 1px solid var(--swal-success);
  }
  .status-badge.status-maintenance {
    background: var(--swal-warning-muted);
    color: var(--swal-warning);
    border: 1px solid var(--swal-warning);
  }

  .specs-table {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .spec-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.78rem;
    padding: 0.2rem 0;
  }

  .spec-label {
    color: var(--swal-text-muted);
  }

  .spec-val {
    color: var(--swal-text);
    font-weight: 600;
  }
  .spec-val.highlight {
    color: var(--swal-accent-text);
  }
  .spec-val.mono {
    font-size: 0.72rem;
  }

  /* Telemetry Dials */
  .hud-dials {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(130px, 100%), 1fr));
    gap: 0.75rem;
  }

  .dial-card {
    background: var(--swal-bg-surface);
    border: 1px solid var(--swal-border);
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .dial-value {
    font-size: 1.3rem;
    font-weight: 800;
    color: var(--swal-text);
    transition: color 150ms ease;
  }
  .dial-value.revving {
    color: var(--swal-danger);
  }

  .dial-unit {
    font-size: 0.65rem;
    color: var(--swal-text-muted);
  }

  .gauge-bar-wrap {
    width: 100%;
    height: 6px;
    background: var(--swal-surface-active);
    border: 1px solid var(--swal-border);
    overflow: hidden;
    margin: 0.4rem 0;
  }

  .gauge-bar-fill {
    height: 100%;
    transition: width 150ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .dial-label {
    font-size: 0.65rem;
    color: var(--swal-text-secondary);
    font-weight: 600;
  }

  .dial-sub {
    font-size: 0.6rem;
    color: var(--swal-text-muted);
    margin-top: 0.2rem;
  }

  .rev-btn {
    margin-top: 0.5rem;
    width: 100%;
    padding: 0.35rem 0.2rem;
    font-size: 0.6rem;
    font-weight: 800;
    background: var(--swal-danger-bg);
    border: 1px solid var(--swal-danger);
    color: var(--swal-danger);
    cursor: pointer;
    user-select: none;
  }
  .rev-btn:active {
    background: var(--swal-danger);
    color: var(--swal-on-danger);
  }

  .telemetry-live-dot {
    width: 8px;
    height: 8px;
    background: var(--swal-success);
    animation: blink 1.2s infinite;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
</style>
