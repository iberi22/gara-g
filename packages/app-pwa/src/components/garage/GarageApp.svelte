<script lang="ts">
/**
 * GarageApp.svelte — Componente raíz del HUD 3D de GARA-G.
 *
 * Pulido responsive (ronda 4):
 *   - Escritorio/laptop (1280x720, 1366x768, 1600x900): todo visible sin scroll vertical,
 *     escenario 3D con alto mínimo >= 55% del viewport, columnas laterales más estrechas con clamp,
 *     titular con font-size fluido sin truncar, datos sin elipsis ("SALUD", "ODÓM.", "PRÓXIMO"),
 *     monitoreo y fila de estado sin solaparse, dock siempre visible y notificador compacto
 *     en la esquina superior derecha del escenario 3D.
 *   - Móvil (390x844): escenario 3D arriba (alto >= 45svh), debajo titular y datos compactos,
 *     fila de estado con scroll horizontal, tarjeta de acabado colapsable, franja de monitoreo
 *     desplazable, dock fijo abajo y notificador como banda inferior sobre el dock.
 *   - Aislamiento total de Three.js en SSR y sincronización de estado reactivo con Svelte 5 runes.
 */
import { onMount } from 'svelte';
import type {
  DimensionAnchors,
  GarageVehicle,
  HistoryEvent,
  MonitoringState,
  PaintFinish,
  PartSlotId,
  ScreenPoint,
  StageTheme,
  ViewMode,
} from '../../garage/contracts';
import { installGarageBridge, postToNative } from '../../garage/telemetry/bridge';
import BlueprintBackdrop from './BlueprintBackdrop.svelte';
import BottomDock, { type ActivePanel } from './BottomDock.svelte';
import Canvas3D from './Canvas3D.svelte';
import DimensionOverlay from './DimensionOverlay.svelte';
import DrawerContainer from './DrawerContainer.svelte';
import HudNotifier from './HudNotifier.svelte';
import MonitoringStrip from './MonitoringStrip.svelte';
import PanelForum from './PanelForum.svelte';
import PanelHistory from './PanelHistory.svelte';
import PanelShop from './PanelShop.svelte';
import PanelState from './PanelState.svelte';
import PanelUpcoming from './PanelUpcoming.svelte';
import PanelWiki from './PanelWiki.svelte';
import PartCallouts, { type CalloutTarget } from './PartCallouts.svelte';
import SpecCards from './SpecCards.svelte';
import StatusFactRow from './StatusFactRow.svelte';
import VehicleIdentity from './VehicleIdentity.svelte';
import { garageApi } from './api';
import { getClientMode } from '../../lib/appMode';
import GuestBlockedPanel from './GuestBlockedPanel.svelte';
import GuestDialogs, { type GuestDialogKind } from './GuestDialogs.svelte';
import GuestToolbar from './GuestToolbar.svelte';
import { buildCallouts } from './callouts';
import { garageView } from './garagePrefs';
import { localPrefsStore, prefsStore as cloudPrefsStore } from '../../lib/prefs.client';
// En modo local las preferencias no van al servidor (/api/prefs exige sesion).
const prefsStore = getClientMode() === 'guest' ? localPrefsStore : cloudPrefsStore;
import { selectUrgentCommitments } from './commitments';
import { formatKm } from './formatters';
import { DEFAULT_THEME, loadStoredTheme, oppositeTheme, saveStoredTheme } from './hudTheme';
import { buildPaintSpec, loadStoredPaint, saveStoredPaint } from './paint';
import { formatFleetCounter, wrapVehicleIndex } from './selector';
import { buildStatusFacts } from './statusRow';
import { telemetryManager } from './telemetry';
import { isWebViewMode } from './webview';

// --- Estado de la flota -----------------------------------------------------
// Arranca VACIA: mientras la API responde se ve el esqueleto de carga. El mock y la cache
// solo entran si la API falla, nunca antes, para que no haya un carrusel a medias.
let vehicles = $state<GarageVehicle[]>([]);
let isLoadingFleet = $state(true);
let currentIndex = $state(0);
let direction = $state<1 | -1>(1);
let isOffline = $state(false);

// --- Modo invitado: datos en IndexedDB, sin red; lo que pide cuenta se explica en vez de fallar ---
const guest = getClientMode() === 'guest';
let guestDialog = $state<GuestDialogKind | null>(null);

// --- Preferencias de interfaz (paneles y elementos del HUD que el usuario eligio) ----------
let prefs = $state(prefsStore.get());
const view = $derived(garageView(prefs));
/** Vista inicial y plano se aplican una sola vez tras la primera carga: el usuario manda despues. */
let prefsApplied = false;
let lastNotifiedId: string | null = null;

// --- Estado de UI y paneles -------------------------------------------------
let activePanel = $state<ActivePanel>(null);
let currentViewMode = $state<ViewMode>('beauty');
let selectedPartId = $state<PartSlotId | null>(null);
let notifierOpen = $state(false);
let vehicleHistory = $state<HistoryEvent[]>([]);
let monitoringState = $state<MonitoringState | null>(null);
let isWebView = $state(false);
let theme = $state<StageTheme>(DEFAULT_THEME);
let showBlueprint = $state(true);
let isCompact = $state(false);

// --- Estado de pintura (persistido por vehiculo) ---------------------------
let activeHex = $state('14171C');
let activeFinish = $state<PaintFinish>('gloss');

// --- Proyecciones que publica el lienzo ------------------------------------
let canvasSize = $state({ width: 0, height: 0 });
let dimensionAnchors = $state<DimensionAnchors | null>(null);
let slotPoints = $state<Record<string, ScreenPoint>>({});

// --- Derivados --------------------------------------------------------------
const currentVehicle = $derived(vehicles[currentIndex] ?? vehicles[0] ?? null);
const fleetCounterText = $derived(formatFleetCounter(currentIndex, vehicles.length));
const urgentCommitments = $derived(
  currentVehicle ? selectUrgentCommitments(currentVehicle.commitments ?? [], 3) : [],
);
const urgentCount = $derived(urgentCommitments.length);
const statusFacts = $derived(
  currentVehicle ? buildStatusFacts(currentVehicle, { monitoring: monitoringState, viewMode: currentViewMode }) : [],
);

/** Salud global ya formateada para la columna izquierda ("71 %"). */
const healthText = $derived.by(() => {
  const pct = currentVehicle?.overallHealthPct;
  if (pct === null || pct === undefined) return '—';
  return `${Math.round(pct)} %`;
});

const odometerText = $derived.by(() => {
  const km = currentVehicle?.odometerKm;
  if (km === null || km === undefined) return '—';
  return `${Math.round(km).toLocaleString('es-CO')} ${currentVehicle?.usageUnit ?? 'km'}`;
});

/** Proximo cambio: el compromiso pendiente mas cercano en km (o dias si no hay km). */
const nextChangeText = $derived.by(() => {
  const v = currentVehicle;
  if (!v) return '—';
  const pending = (v.commitments ?? []).filter((c) => c.status !== 'done');
  const withKm = pending.filter((c) => c.remainingKm !== undefined);
  const soon = withKm.sort((a, b) => (a.remainingKm ?? 0) - (b.remainingKm ?? 0))[0] ?? pending[0];
  if (!soon) return '—';
  if (soon.remainingKm !== undefined) {
    return soon.remainingKm < 0 ? `VENCIDO ${formatKm(Math.abs(soon.remainingKm), v.usageUnit)}` : formatKm(soon.remainingKm, v.usageUnit);
  }
  if (soon.remainingDays !== undefined) {
    return soon.remainingDays < 0 ? 'VENCIDO' : `${soon.remainingDays} DÍAS`;
  }
  return 'PENDIENTE';
});

/**
 * Las dos piezas mas urgentes para las llamadas flotantes: vencidas primero y, a igualdad, la
 * de menor salud. Cada llamada lleva la posicion en pantalla que publico el lienzo.
 */
const callouts = $derived.by<CalloutTarget[]>(() => {
  const v = currentVehicle;
  if (!v) return [];
  // El texto de las llamadas lo decide `buildCallouts` (modulo puro y probado): elige las dos
  // piezas mas urgentes y garantiza que no haya dos llamadas con el mismo texto, que era el
  // caso real con las pastillas de un mismo eje. Aqui solo se anade la posicion proyectada,
  // que depende del motor y por eso vive en el componente.
  return buildCallouts(v.parts ?? [], view.maxCallouts).map((c) => ({ ...c, point: slotPoints[c.slotId] ?? null }));
});

// --- Ciclo de vida ----------------------------------------------------------
onMount(() => {
  isWebView = isWebViewMode();
  theme = loadStoredTheme();

  installGarageBridge();
  if (isWebView) postToNative('garage_ready', { version: 1 });

  const unsubscribeTelemetry = telemetryManager.subscribe((state) => {
    monitoringState = state;
  });

  // El alto disponible se mide al montar y se corrige en cada resize.
  measureAvailableHeight();
  window.addEventListener('resize', measureAvailableHeight);
  window.visualViewport?.addEventListener('resize', measureAvailableHeight);
  // Lo que hay encima del HUD (barra de FleetLayout, fuentes, avisos) puede acomodarse
  // DESPUES del montaje: si solo se midiera aqui, el alto quedaba corto y el dock salia
  // recortado en 1280x720. Se vuelve a medir cada vez que cambia el tamaño del documento.
  const layoutObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measureAvailableHeight()) : null;
  layoutObserver?.observe(document.body);

  // El breakpoint decide si las cotas se dibujan enteras o solo el LARGO (movil).
  const query = window.matchMedia('(max-width: 767px)');
  isCompact = query.matches;
  const onQueryChange = (e: MediaQueryListEvent) => {
    isCompact = e.matches;
    // Al cruzar el breakpoint la barra de la pagina puede cambiar de alto: se vuelve a medir.
    measureAvailableHeight();
  };
  // onchange (y no addEventListener): mismo efecto dentro de onMount y no confunde a la
  // guardia de listeners SPA del repo, pensada para <script> de .astro.
  query.onchange = onQueryChange;

  const onGlobalThemeChange = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && detail.resolved) {
      theme = detail.resolved === 'dark' ? 'garage' : 'studio';
    }
  };
  document.addEventListener('swal:themechange', onGlobalThemeChange);

  const unsubscribePrefs = prefsStore.subscribe((p) => {
    prefs = p;
  });
  void prefsStore.load().then((p) => {
    prefs = p;
    if (prefsApplied) return;
    prefsApplied = true;
    const v = garageView(p);
    currentViewMode = v.initialViewMode;
    showBlueprint = v.blueprintStartOn;
  });

  void (async () => {
    await loadFleet();
    isLoadingFleet = false;
    requestAnimationFrame(measureAvailableHeight);
  })();

  return () => {
    document.removeEventListener('swal:themechange', onGlobalThemeChange);
    unsubscribeTelemetry();
    unsubscribePrefs();
    telemetryManager.destroy();
    query.onchange = null;
    layoutObserver?.disconnect();
    window.removeEventListener('resize', measureAvailableHeight);
    window.visualViewport?.removeEventListener('resize', measureAvailableHeight);
  };
});

/**
 * Carga la flota (nube: /api/garage/vehicles; invitado: IndexedDB). `selectId` coloca el
 * carrusel en ese vehiculo; sin el, respeta el `?v=<id>` de la URL (solo la primera vez) o
 * mantiene el vehiculo actual.
 */
async function loadFleet(selectId?: string): Promise<void> {
  const keepId = currentVehicle?.id;
  // Modo local, primera visita: la siembra ocurre ANTES de leer, asi el snapshot ya trae
  // el vehiculo de ejemplo y el garage no abre en "TU PARQUE ESTÁ VACÍO". Solo en invitado:
  // un tenant con sesion ve sus datos, nunca un ejemplo.
  if (guest) {
    const { ensureDemoVehicle } = await import('./guestGarage');
    await ensureDemoVehicle();
  }
  const res = await garageApi.getVehicles();
  // El cliente ya degrada a cache o mock si la API fallo; `isOffline` lo dice.
  if (res.snapshot?.vehicles?.length) {
    vehicles = res.snapshot.vehicles;
    // ?v=<id>: el expediente y las listas de la flota abren el garage en ese vehiculo.
    const target = selectId ?? keepId ?? new URLSearchParams(window.location.search).get('v');
    const found = target ? vehicles.findIndex((v) => v.id === target) : -1;
    currentIndex = found >= 0 ? found : Math.min(currentIndex, vehicles.length - 1);
  } else if (guest) {
    // Sin vehiculos locales: estado vacio (nunca el mock ni la cache de la nube).
    vehicles = [];
    currentIndex = 0;
  }
  isOffline = res.isOffline;
}

/** Tras guardar un dialogo del modo invitado: recarga la flota desde IndexedDB. */
async function handleGuestSaved(selectId?: string): Promise<void> {
  await loadFleet(selectId);
}

// --- Reactividad ------------------------------------------------------------

// Si el panel abierto se desactiva en los ajustes, se cierra.
$effect(() => {
  if (activePanel !== null && !view.dockPanels.includes(activePanel)) activePanel = null;
});

// Al cambiar de vehiculo: historial, telemetria, pintura guardada y notificador.
$effect(() => {
  const v = currentVehicle;
  if (!v) return;
  telemetryManager.start(v.vin ?? v.id);
  void garageApi
    .getVehicleDetail(v.id)
    .then((detail) => {
      if (currentVehicle?.id === v.id) vehicleHistory = detail.history;
    })
    .catch(() => {
      if (currentVehicle?.id === v.id) vehicleHistory = [];
    });
  applyStoredPaint(v);
  // El aviso solo salta al CAMBIAR de vehiculo, no cada vez que se recarga el mismo (guardar un dialogo).
  if (lastNotifiedId !== v.id) notifierOpen = true;
  lastNotifiedId = v.id;
});

/**
 * El lienzo publica su geometria (para las cotas) y los puntos de cada pieza (para las
 * llamadas). Se recibe aqui para que el resto del HUD no hable con three.
 */
function handleProjection(next: {
  anchors: DimensionAnchors | null;
  slotPoints: Record<string, ScreenPoint>;
  width: number;
  height: number;
}): void {
  dimensionAnchors = next.anchors;
  slotPoints = next.slotPoints;
  canvasSize = { width: next.width, height: next.height };
}

/** Aplica la pintura guardada de un vehiculo (color y acabado) al estado del HUD. */
function applyStoredPaint(v: GarageVehicle): void {
  const stored = loadStoredPaint(v.id);
  const baseHex = (v.spec.paint.baseColor ?? '#14171c').replace('#', '').toUpperCase();
  activeHex = stored?.hex ?? baseHex;
  activeFinish = stored?.finish ?? v.spec.paint.finish;
}

/** Elige color/acabado, lo guarda por vehiculo y lo pide al motor. */
function handlePickPaint(hex: string, finish: PaintFinish): void {
  activeHex = hex;
  activeFinish = finish;
  const v = currentVehicle;
  if (!v) return;
  saveStoredPaint(v.id, hex, finish);
  canvasRef?.setPaint(buildPaintSpec(v.spec.paint, hex, finish));
}

function handleToggleTheme(): void {
  theme = oppositeTheme(theme);
  saveStoredTheme(theme);
}

function handlePrevVehicle() {
  const res = wrapVehicleIndex(currentIndex, vehicles.length, -1);
  direction = -1;
  currentIndex = res.nextIndex;
  selectedPartId = null;
}

function handleNextVehicle() {
  const res = wrapVehicleIndex(currentIndex, vehicles.length, 1);
  direction = 1;
  currentIndex = res.nextIndex;
  selectedPartId = null;
}

function handlePartSelectedIn3D(slotId: PartSlotId | null) {
  selectedPartId = slotId;
  if (slotId) activePanel = 'state';
}

function handleSelectCallout(slotId: string) {
  selectedPartId = slotId;
  activePanel = 'state';
}

function getPanelTitle(panel: ActivePanel): string {
  switch (panel) {
    case 'state': return 'Estado y Salud de Piezas';
    case 'history': return 'Historial y Mantenimientos';
    case 'upcoming': return 'Próximos Compromisos';
    case 'wiki': return 'Wiki y Especificaciones';
    case 'forum': return 'Foro de la Comunidad';
    case 'shop': return 'Shop y Repuestos';
    default: return '';
  }
}

/** Referencia al lienzo para las acciones que el motor expone (pintura y tema). */
let canvasRef = $state<ReturnType<typeof Canvas3D> | null>(null);
/** Referencia al contenedor raiz, para medir cuanto alto hay disponible. */
let rootEl = $state<HTMLElement | null>(null);
/**
 * Alto util de la hoja (px). Se MIDE en vez de calcularlo con un offset fijo de la barra de
 * FleetLayout: esa barra cambia de alto segun el breakpoint y la ventana, y un `calc` con un
 * numero fijo dejaba el HUD 9 px mas alto que la pantalla, con la franja de telemetria
 * cortada. Con el valor medido el HUD ocupa exactamente lo que queda.
 */
let availableHeight = $state(0);

function measureAvailableHeight(): void {
  if (typeof window === 'undefined' || !rootEl) return;
  const top = rootEl.getBoundingClientRect().top;
  const h = window.innerHeight - top;
  if (h > 0 && Math.abs(h - availableHeight) > 0.5) availableHeight = h;
}
</script>

<main
  bind:this={rootEl}
  class="garage-app-root {isWebView ? 'webview-mode' : ''}"
  data-g3-theme={theme}
  data-testid="garage-game-hud"
  style:height={availableHeight > 0 ? `${availableHeight}px` : undefined}
>
  <div class="stage-grid">
    <!-- Fondo tecnico global: cuadricula de la hoja -->
    <svg class="sheet-backdrop" aria-hidden="true">
      <defs>
        <pattern id="g3-sheet-grid" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M 48 0 L 0 0 0 48" fill="none" stroke="var(--swal-line-grid)" stroke-width="0.6" />
        </pattern>
        <pattern id="g3-sheet-major" width="240" height="240" patternUnits="userSpaceOnUse">
          <rect width="240" height="240" fill="url(#g3-sheet-grid)" />
          <path d="M 240 0 L 0 0 0 240" fill="none" stroke="var(--swal-border-light)" stroke-width="0.9" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#g3-sheet-major)" opacity="0.5" />
    </svg>

    <!-- Cabecera superior -->
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <div class="brand-text">
          <span class="brand-name">GARA-G</span>
          <span class="brand-sub">GARAGE // CONFIGURADOR</span>
        </div>
      </div>
      <div class="header-actions">
        {#if isOffline}
          <span class="offline-badge">SIN CONEXIÓN</span>
        {/if}
        <button
          type="button"
          class="header-btn"
          onclick={handleToggleTheme}
          aria-label="Cambiar tema del escenario"
          title={theme === 'studio' ? 'Cambiar a garaje oscuro' : 'Cambiar a taller claro'}
        >
          {oppositeTheme(theme) === 'garage' ? 'GARAJE' : 'TALLER'}
        </button>
        {#if view.showBlueprintAvailable}
        <button
          type="button"
          class="header-btn"
          onclick={() => (showBlueprint = !showBlueprint)}
          aria-label="Mostrar u ocultar el plano tecnico"
          title="Mostrar u ocultar el plano tecnico"
          aria-pressed={showBlueprint}
        >
          BP: {showBlueprint ? 'ON' : 'OFF'}
        </button>
        {/if}
        {#if view.showNotifier}
        <button
          type="button"
          class="header-btn bell {urgentCount > 0 ? 'has-urgent' : ''}"
          onclick={() => (notifierOpen = true)}
          aria-label="Abrir notificaciones ({urgentCount} compromisos urgentes)"
        >
          AVISOS{#if urgentCount > 0}<span class="bell-badge">{urgentCount}</span>{/if}
        </button>
        {/if}
        <a class="header-btn" href="/fleet/ajustes" aria-label="Ajustar paneles del Garage" title="Elegir qué paneles y elementos se muestran">AJUSTAR PANELES</a>
      </div>
    </header>

    <div class="content">
      <!-- COLUMNA IZQUIERDA: identidad, datos y acabado -->
      <div class="col-left">
        {#if currentVehicle}
          <VehicleIdentity
            vehicle={currentVehicle}
            {activeHex}
            finish={activeFinish}
            onpickpaint={handlePickPaint}
            {odometerText}
            {nextChangeText}
            {healthText}
          />
        {/if}
      </div>

      <!-- CENTRO: escenario 3D + plano + cotas + llamadas -->
      <section class="col-center" aria-label="Escenario del vehículo">
        <div class="stage-viewport">
          {#if currentVehicle && view.showBlueprintAvailable}
            <BlueprintBackdrop spec={currentVehicle.spec} visible={showBlueprint} />
          {/if}

          <Canvas3D
            bind:this={canvasRef}
            vehicle={currentVehicle}
            viewMode={currentViewMode}
            {selectedPartId}
            {direction}
            {theme}
            onprojection={handleProjection}
            onselectpart={handlePartSelectedIn3D}
            onprev={handlePrevVehicle}
            onnext={handleNextVehicle}
          />

          {#if currentVehicle}
            {#if view.showDimensions}
              <DimensionOverlay
                dims={currentVehicle.spec.dims}
                anchors={dimensionAnchors}
                width={canvasSize.width}
                height={canvasSize.height}
                compact={isCompact}
              />
            {/if}
            {#if view.showCallouts}
              <PartCallouts targets={callouts} onselect={handleSelectCallout} />
            {/if}
          {/if}

          <!-- Notificador de escritorio: esquina superior derecha del escenario -->
          {#if !isCompact && view.showNotifier}
            <HudNotifier
              commitments={urgentCommitments}
              unit={currentVehicle?.usageUnit}
              open={notifierOpen}
              variant="desktop"
              onclose={() => (notifierOpen = false)}
              onselectcommitment={() => {
                activePanel = 'upcoming';
                notifierOpen = false;
              }}
            />
          {/if}

          <!-- Esqueleto de carga: nunca un carrusel a medias -->
          {#if isLoadingFleet}
            <div class="loading-skeleton" role="status" aria-live="polite">
              <div class="skeleton-block sk-title"></div>
              <div class="skeleton-block sk-line"></div>
              <div class="skeleton-block sk-line short"></div>
              <span class="skeleton-note">Cargando tu parque…</span>
            </div>
          {:else if !currentVehicle}
            <div class="empty-fleet">
              <p class="empty-title">TU PARQUE ESTÁ VACÍO</p>
              <p class="empty-sub">Agrega un vehículo para ver su ficha, su plano y su salud.</p>
              {#if guest}
                <button type="button" class="empty-cta" data-testid="guest-add-first" onclick={() => (guestDialog = 'add')}>Agregar mi primer vehículo</button>
              {:else}
                <a class="empty-cta" href="/fleet/vehicles">+ Agregar vehículo</a>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Fila de estado -->
        {#if currentVehicle}
          <StatusFactRow
            facts={statusFacts}
            fleetCounter={fleetCounterText}
            vehicleName={currentVehicle.name}
            viewMode={currentViewMode}
            onprev={handlePrevVehicle}
            onnext={handleNextVehicle}
            onsetviewmode={(mode) => (currentViewMode = mode)}
          />
        {/if}

        {#if guest && currentVehicle}
          <GuestToolbar
            hasVehicle={true}
            usageUnit={currentVehicle.usageUnit}
            onopen={(kind) => (guestDialog = kind)}
          />
        {/if}

        <!-- Dock de paneles -->
        <BottomDock
          {activePanel}
          panels={view.dockPanels}
          onselectpanel={(panel) => (activePanel = panel)}
        />
      </section>

      <!-- COLUMNA DERECHA: tarjetas de ficha -->
      <div class="col-right">
        {#if currentVehicle && view.showSpecCards}
          <SpecCards
            vehicle={currentVehicle}
            monitoring={monitoringState}
            onopenpanel={(panel) => (activePanel = panel)}
          />
        {/if}
      </div>

      <!-- Franja de telemetria en movil (desplaza dentro del contenido) -->
      {#if currentVehicle && isCompact && view.showMonitoring}
        <div class="mobile-monitoring">
          <MonitoringStrip monitoring={monitoringState} {isOffline} {guest} />
        </div>
      {/if}
    </div>

    <!-- Franja de telemetria en escritorio (fija al pie de la cuadricula) -->
    {#if currentVehicle && !isCompact && view.showMonitoring}
      <MonitoringStrip monitoring={monitoringState} {isOffline} {guest} />
    {/if}
  </div>

  <!-- Notificador movil: banda inferior sobre el dock -->
  {#if isCompact && view.showNotifier}
    <HudNotifier
      commitments={urgentCommitments}
      unit={currentVehicle?.usageUnit}
      open={notifierOpen}
      variant="mobile"
      onclose={() => (notifierOpen = false)}
      onselectcommitment={() => {
        activePanel = 'upcoming';
        notifierOpen = false;
      }}
    />
  {/if}

  <!-- Cajón / hoja inferior para los 6 paneles -->
  {#if currentVehicle}
    <DrawerContainer
      open={activePanel !== null}
      title={getPanelTitle(activePanel)}
      badge={activePanel === 'state' ? `${currentVehicle.parts.length} piezas` : undefined}
      onclose={() => (activePanel = null)}
    >
      {#if activePanel === 'state'}
        <PanelState
          parts={currentVehicle.parts}
          {selectedPartId}
          {currentViewMode}
          onfocuspart={(slotId) => (selectedPartId = slotId)}
          onsetviewmode={(mode) => (currentViewMode = mode)}
          unit={currentVehicle.usageUnit}
        />
      {:else if activePanel === 'history'}
        <PanelHistory events={vehicleHistory} unit={currentVehicle.usageUnit} />
      {:else if activePanel === 'upcoming'}
        <PanelUpcoming commitments={currentVehicle.commitments} unit={currentVehicle.usageUnit} />
      {:else if guest && (activePanel === 'wiki' || activePanel === 'forum' || activePanel === 'shop')}
        <GuestBlockedPanel what={activePanel === 'wiki' ? 'La wiki' : activePanel === 'forum' ? 'El foro' : 'La tienda'} />
      {:else if activePanel === 'wiki'}
        <PanelWiki versionKey={currentVehicle.version.key} />
      {:else if activePanel === 'forum'}
        <PanelForum versionKey={currentVehicle.version.key} />
      {:else if activePanel === 'shop'}
        <PanelShop vehicleId={currentVehicle.id} />
      {/if}
    </DrawerContainer>
  {/if}

  {#if guest && guestDialog}
    <GuestDialogs
      kind={guestDialog}
      vehicle={currentVehicle}
      onclose={() => (guestDialog = null)}
      onsaved={handleGuestSaved}
    />
  {/if}
</main>

<style>
  :global(:root) {
    --g-font-mono: 'JetBrains Mono', monospace;
    --g-font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  }

  /* Tokens del tema claro de configurador (valores por defecto). */
  .garage-app-root {
    --g3-orange: var(--swal-accent);
    --g3-ink: var(--swal-text);
    --g3-ink-graphite: var(--swal-ink-graphite);
    --g3-ink-soft: var(--swal-text-secondary);
    --g3-ink-muted: var(--swal-text-muted);
    --g3-stamp-ink: var(--swal-text-faint);
    --g3-line: var(--swal-border);
    --g3-line-soft: var(--swal-line-grid);
    --g3-card: var(--swal-surface);
    --g3-strip-bg: var(--swal-bg-surface);
    --g3-sheet: var(--swal-bg);
    --g3-label-bg: var(--swal-surface);
    --g3-dim-ink: var(--swal-text-faint);
    --g3-dim-muted: var(--swal-text-muted);
    --g3-grid-minor: var(--swal-line-grid);
    --g3-grid-major: var(--swal-border-light);
    --g3-guide-ink: var(--swal-line-blueprint);
    --g3-datum-ink: var(--swal-border-strong);
    --g3-silhouette-ink: var(--swal-border-strong);
    --g3-fiducial-ink: var(--swal-border-strong);
    --g3-icon-bg: var(--swal-surface);
    --g3-chip-bg: var(--swal-bg-surface);
    --g3-arrow-bg: var(--swal-bg-surface);
    --g3-swatch-frame: var(--swal-border);
    --g3-canvas-bg: var(--swal-bg-surface);
    --g3-dock-bg: var(--swal-surface);

    position: relative;
    width: 100%;
    /* El alto lo fija `measureAvailableHeight()`; este 100% es solo el primer pintado. */
    height: 100%;
    /* Si en una pantalla baja no cabe todo, se hace scroll en vez de recortar el dock. */
    overflow-x: hidden;
    overflow-y: auto;
    background: var(--g3-sheet);
    color: var(--g3-ink);
    font-family: var(--g-font-sans);
    user-select: none;
    -webkit-user-select: none;
  }

  .garage-app-root.webview-mode {
    overscroll-behavior: none;
    padding-bottom: env(safe-area-inset-bottom, 12px);
  }

  .stage-grid {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 0.4rem 0.8rem 0.35rem;
    gap: 0.35rem;
    overflow: hidden;
  }

  .sheet-backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
  }

  /* Cabecera */
  .app-header {
    position: relative;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 0.35rem;
    border-bottom: 1px solid var(--g3-line);
    flex: none;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .brand-mark {
    width: 26px;
    height: 26px;
    background: var(--g3-ink);
    clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px);
    flex: none;
  }
  .brand-text {
    display: flex;
    flex-direction: column;
    line-height: 1;
  }
  .brand-name {
    font-weight: 800;
    font-size: 14px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--g3-ink);
    /* "GARA-G" no se parte en "GARA-" / "G" cuando la cabecera se estrecha. */
    white-space: nowrap;
  }
  .brand-sub {
    font-family: var(--g-font-mono);
    font-size: 8.5px;
    letter-spacing: 0.18em;
    color: var(--g3-ink-muted);
    margin-top: 0.2rem;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .offline-badge {
    font-family: var(--g-font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.12em;
    padding: 0.25rem 0.45rem;
    color: var(--g3-orange);
    border: 1px solid var(--g3-orange);
  }
  .header-btn {
    position: relative;
    display: inline-block;
    text-decoration: none;
    font-family: var(--g-font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 0.4rem 0.6rem;
    background: var(--g3-ink);
    color: var(--g3-sheet);
    border: none;
    cursor: pointer;
    clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
    transition: background-color 150ms ease;
  }
  .header-btn:hover {
    background: var(--g3-ink-graphite);
  }
  .bell.has-urgent {
    background: var(--g3-orange);
    /* Tinta sobre relleno naranja (6.7:1); el color base del boton daba 2.4:1. */
    color: var(--swal-accent-contrast);
  }
  .bell-badge {
    position: absolute;
    top: -5px;
    right: -5px;
    background: var(--g3-ink);
    color: var(--g3-sheet);
    font-size: 8px;
    min-width: 15px;
    height: 15px;
    display: grid;
    place-items: center;
    padding: 0 3px;
  }

  /* Rejilla central: 3 columnas en escritorio */
  .content {
    position: relative;
    z-index: 10;
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: clamp(180px, 17vw, 240px) minmax(0, 1fr) clamp(170px, 16vw, 230px);
    gap: clamp(0.4rem, 0.8vw, 0.75rem);
    align-items: stretch;
  }
  .col-left,
  .col-right {
    display: flex;
    flex-direction: column;
    gap: clamp(0.25rem, 0.5vh, 0.5rem);
    min-width: 0;
  }
  .col-center {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
    min-height: 0;
  }
  .stage-viewport {
    position: relative;
    flex: 1;
    min-height: clamp(380px, 55svh, 650px);
    background: var(--g3-canvas-bg);
    border: 1px solid var(--g3-line);
    overflow: hidden;
  }

  /* Esqueleto de carga */
  .loading-skeleton {
    position: absolute;
    inset: 0;
    z-index: 14;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    background: var(--g3-canvas-bg);
    pointer-events: auto;
  }
  .skeleton-block {
    background: linear-gradient(90deg, var(--g3-strip-bg), var(--g3-line-soft), var(--g3-strip-bg));
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
    border-radius: 2px;
  }
  .sk-title {
    width: 40%;
    height: 22px;
  }
  .sk-line {
    width: 55%;
    height: 10px;
  }
  .sk-line.short {
    width: 30%;
  }
  .skeleton-note {
    font-family: var(--g-font-mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--g3-ink-muted);
    margin-top: 0.4rem;
  }
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .empty-fleet {
    position: absolute;
    inset: 0;
    z-index: 14;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    background: var(--g3-canvas-bg);
  }
  .empty-title {
    margin: 0;
    font-size: 22px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--g3-ink);
  }
  .empty-sub {
    margin: 0;
    font-size: 11px;
    color: var(--g3-ink-muted);
  }

  /* Movil / tablet: disposicion adaptada con orden y dock fijo */
  @media (max-width: 1023px) {
    .stage-grid {
      padding: 0.35rem 0.5rem 0.3rem;
      gap: 0.35rem;
    }
    .brand-sub {
      display: none;
    }
    .content {
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      overflow-x: hidden;
      padding-bottom: calc(54px + env(safe-area-inset-bottom, 8px));
      gap: 0.45rem;
    }
    .col-center {
      display: contents;
    }
    .stage-viewport {
      order: 1;
      height: 48svh;
      min-height: 45svh;
      max-height: 52svh;
      flex: none;
      width: 100%;
    }
    .col-left {
      order: 2;
    }
    :global(.status-fact-row) {
      order: 3;
    }
    .col-right {
      order: 4;
    }
    .mobile-monitoring {
      order: 5;
    }
    :global(.bottom-dock-root) {
      order: 10;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton-block {
      animation: none;
    }
  }
  .empty-cta {
    display: inline-block;
    margin-top: 12px;
    padding: 8px 14px;
    background: var(--swal-accent);
    color: var(--swal-accent-contrast);
    font-weight: 700;
    text-decoration: none;
    pointer-events: auto;
  }
</style>