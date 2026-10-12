<script lang="ts">
/**
 * MonitoringStrip.svelte — Franja de telemetria y diagnostico en vivo.
 *
 * Muestra el estado de enlace APK / OBD-II (EN LINEA / SIN SENAL), velocidad, RPM,
 * refrigerante, voltaje de bateria y codigos DTC. Se apoya en los tokens `--g3-*` del
 * contenedor del HUD, asi que cambia sola con el tema claro/oscuro. En movil es una tira
 * con scroll horizontal.
 */
import type { MonitoringState } from '../../garage/contracts';
import { GUEST_BLOCKED_PATH } from '../../lib/appMode';
import { formatTimeAgo } from './formatters';

interface Props {
  monitoring: MonitoringState | null;
  isOffline?: boolean;
  /** Modo invitado: la telemetria en vivo es del servidor, no hay peticiones ni datos. */
  guest?: boolean;
}

const { monitoring, isOffline = false, guest = false }: Props = $props();

const isConnected = $derived(monitoring?.connected ?? false);
const latest = $derived(monitoring?.latest);
const hasSamples = $derived(Boolean(latest));
const isDemo = $derived(isOffline && hasSamples);
const lastSeenText = $derived(formatTimeAgo(monitoring?.lastSeen));
const dtcCount = $derived(latest?.dtc?.length ?? 0);
</script>

<aside class="monitoring-strip-root" aria-label="Telemetría y diagnóstico en vivo">
  {#if guest}
    <div class="link-item disconnected" data-testid="guest-monitoring">
      <span class="status-bulb" aria-hidden="true"></span>
      <span class="link-label">TELEMETRÍA</span>
      <span class="link-text">Disponible con cuenta</span>
    </div>
    <a class="guest-link" href={GUEST_BLOCKED_PATH}>Ver más</a>
  {:else}
  <div class="link-item {isDemo ? 'demo' : isConnected ? 'connected' : 'disconnected'}">
    <span class="status-bulb" aria-hidden="true"></span>
    <span class="link-label">
      {isDemo ? 'DEMO' : !hasSamples ? 'SIN SEÑAL' : latest?.source === 'obd2' ? 'OBD-II' : 'APK'}
    </span>
    <span class="link-text">
      {isDemo
        ? 'DATOS DEMO (OFFLINE)'
        : !hasSamples
          ? 'Sin señal'
          : isConnected
            ? 'EN LÍNEA'
            : `Última señal ${lastSeenText}`}
    </span>
  </div>

  <div class="telemetry-metrics">
    <div class="metric-cell">
      <span class="m-title">VEL</span>
      <span class="m-val">{latest?.speedKmh !== undefined ? latest.speedKmh : '—'}</span>
      <span class="m-unit">km/h</span>
    </div>
    <div class="metric-cell">
      <span class="m-title">RPM</span>
      <span class="m-val">{latest?.rpm !== undefined ? latest.rpm : '—'}</span>
    </div>
    <div class="metric-cell">
      <span class="m-title">TEMP</span>
      <span class="m-val {latest?.coolantC !== undefined && latest.coolantC > 102 ? 'warn' : ''}">
        {latest?.coolantC !== undefined ? `${latest.coolantC}°C` : '—'}
      </span>
    </div>
    <div class="metric-cell">
      <span class="m-title">BAT</span>
      <span class="m-val {latest?.batteryV !== undefined && latest.batteryV < 12.0 ? 'warn' : ''}">
        {latest?.batteryV !== undefined ? `${latest.batteryV.toFixed(1)}V` : '—'}
      </span>
    </div>
    <div class="metric-cell dtc {hasSamples && dtcCount > 0 ? 'has-errors' : ''}">
      <span class="m-title">DTC</span>
      <span class="m-val">{hasSamples ? dtcCount : '—'}</span>
    </div>
  </div>
  {/if}
</aside>

<style>
  .guest-link {
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--swal-accent-text);
    text-decoration: underline;
    text-underline-offset: 3px;
    white-space: nowrap;
  }
  .guest-link:focus-visible {
    outline: 2px solid var(--swal-accent);
    outline-offset: 2px;
  }

  .monitoring-strip-root {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.22rem 0.55rem;
    background: var(--g3-strip-bg);
    border: 1px solid var(--g3-line);
    pointer-events: auto;
    min-width: 0;
    flex: none;
  }

  .link-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .status-bulb {
    width: 6px;
    height: 6px;
    flex: none;
  }
  .link-item.connected {
    color: var(--g3-ink);
  }
  .link-item.connected .status-bulb {
    background: var(--swal-success);
  }
  .link-item.disconnected {
    color: var(--g3-ink-muted);
  }
  .link-item.disconnected .status-bulb {
    background: var(--swal-border-strong);
  }
  .link-item.demo {
    color: var(--swal-accent-text);
  }
  .link-item.demo .status-bulb {
    background: var(--g3-orange);
  }
  .link-label {
    background: var(--g3-icon-bg);
    padding: 0.1rem 0.3rem;
    font-size: 0.6rem;
  }
  .link-label.demo {
    color: var(--swal-accent-text);
    border: 1px solid var(--g3-orange);
  }
  .link-text {
    font-size: 0.62rem;
    color: var(--g3-ink-muted);
    white-space: nowrap;
  }

  .telemetry-metrics {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    overflow-x: auto;
    scrollbar-width: none;
    min-width: 0;
  }
  .telemetry-metrics::-webkit-scrollbar {
    display: none;
  }

  .metric-cell {
    display: flex;
    align-items: baseline;
    gap: 0.2rem;
    white-space: nowrap;
  }
  .m-title {
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--g3-ink-muted);
  }
  .m-val {
    font-family: var(--g-font-mono);
    font-weight: 700;
    color: var(--g3-ink);
  }
  .m-val.warn {
    color: var(--swal-warning);
  }
  .m-unit {
    font-size: 0.58rem;
    color: var(--g3-ink-muted);
  }
  .metric-cell.dtc.has-errors .m-val {
    color: var(--swal-danger);
    border: 1px solid var(--swal-danger);
    padding: 0 0.25rem;
  }

  @media (max-width: 767px) {
    .link-text {
      display: none;
    }
  }
</style>