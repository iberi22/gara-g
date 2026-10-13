<!--
  LiveMap.svelte — Live Leaflet map & telemetry polling component with Svelte 5 runes for GARA-G.
  Polls /api/fleet/telemetry?recent=1 every 5s, updates markers + live table, and pauses on hidden tab.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createLivePoller, type TelemetryLiveRow } from '../../lib/livePoll.js';
  import { escapeHtml } from '../../lib/html.js';
  import { MARKET } from '../../lib/market.js';

  /** Etiqueta de la patente/placa y locale de las horas, del mercado activo. */
  const vehicleIdLabel = MARKET.vehicleIdLabel;
  const locale = MARKET.locale;
  import '../../styles/leaflet-taller.css';

  interface Props {
    initialRows?: TelemetryLiveRow[];
    filterVin?: string;
  }

  let { initialRows = [], filterVin = '' }: Props = $props();

  let rows = $state<TelemetryLiveRow[]>(initialRows);
  let isPolling = $state<boolean>(true);
  let lastRefreshed = $state<string>(new Date().toLocaleTimeString(locale));
  let selectedVin = $state<string>(filterVin);

  let mapElement: HTMLDivElement | null = $state(null);
  let mapInstance: any = $state(null);
  let leafletLib: any = $state(null);
  // Un marcador por VIN, reutilizado entre ciclos de polling: destruirlos y recrearlos cada
  // 5 s cerraba el popup abierto del usuario.
  let markersMap: Map<string, { marker: any; plate: string }> = new Map();
  // La vista se ajusta a los vehiculos solo la primera vez (y al cambiar el filtro de VIN);
  // despues el zoom y el encuadre son del usuario.
  let boundsApplied = false;
  // Mensaje del ultimo fallo de carga, o '' si el ultimo ciclo fue bien. Distingue
  // "fallo" de "vacio": sin esto un 500 se leia como "no hay posiciones".
  let loadError = $state<string>('');
  let lastFailedAt = $state<string>('');

  function buildApiUrl(): string {
    const params = new URLSearchParams();
    params.set('recent', '1');
    if (selectedVin) {
      params.set('vin', selectedVin);
    }
    return `/api/fleet/telemetry?${params.toString()}`;
  }

  let poller: ReturnType<typeof createLivePoller> | null = null;

  onMount(async () => {
    if (typeof window === 'undefined') return;

    try {
      const L = await import('leaflet');
      leafletLib = L;

      // CSS de Leaflet empaquetado (no del CDN): la PWA instalada debe pintar el mapa sin red.
      await import('leaflet/dist/leaflet.css');

      if (mapElement && !mapInstance) {
        mapInstance = L.map(mapElement, {
          // Centro del mercado (Antofagasta en Chile): la flota chilena todavia no emite
          // telemetria, asi que `fitBounds` no corre y el mapa se quedaba sobre Bogota.
          center: [MARKET.mapCenter.lat, MARKET.mapCenter.lng],
          zoom: MARKET.mapCenter.zoom,
          scrollWheelZoom: true,
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors',
        }).addTo(mapInstance);

        renderMarkersOnMap();
      }
    } catch (err) {
      console.error('Error initializing Leaflet in LiveMap:', err);
    }

    poller = createLivePoller({
      fetchUrl: buildApiUrl,
      intervalMs: 5000,
      onUpdate: (newRows) => {
        rows = newRows;
        isPolling = true;
        loadError = '';
        lastRefreshed = new Date().toLocaleTimeString(locale);
        renderMarkersOnMap();
      },
      onError: (err) => {
        console.warn('Live telemetry polling error:', err);
        isPolling = false;
        loadError = err instanceof Error ? err.message : String(err);
        lastFailedAt = new Date().toLocaleTimeString(locale);
      },
    });

    poller.start();
  });

  onDestroy(() => {
    if (poller) {
      poller.stop();
      poller = null;
    }
    if (mapInstance) {
      mapInstance.remove();
      mapInstance = null;
    }
  });

  function popupHtml(row: TelemetryLiveRow): string {
    return `
        <div class="lm-popup">
          <h4 class="lm-popup-title">
            ${escapeHtml(vehicleIdLabel)}: <strong>${escapeHtml(row.plate)}</strong>
          </h4>
          <p class="lm-popup-row"><strong>VIN:</strong> ${escapeHtml(row.vin)}</p>
          <p class="lm-popup-row"><strong>Velocidad:</strong> ${row.formattedSpeed}</p>
          <p class="lm-popup-row"><strong>RPM:</strong> ${row.formattedRpm}</p>
          <p class="lm-popup-row"><strong>Temp Motor:</strong> ${row.formattedTemp}</p>
          <p class="lm-popup-row"><strong>Combustible:</strong> ${row.formattedFuel}</p>
          <p class="lm-popup-note">Última pos: ${new Date(row.timestamp).toLocaleTimeString(locale)}</p>
        </div>
      `;
  }

  function markerIcon(plate: string) {
    return leafletLib.divIcon({
      className: 'vehicle-marker-icon',
      html: `
          <div class="lm-marker">
            🚗 ${escapeHtml(plate)}
          </div>
        `,
      iconSize: [60, 24],
      iconAnchor: [30, 12],
    });
  }

  function renderMarkersOnMap() {
    if (!mapInstance || !leafletLib) return;

    const bounds: [number, number][] = [];
    const seen = new Set<string>();

    rows.forEach((row) => {
      if (!row.latitude || !row.longitude) return;

      const latLng: [number, number] = [row.latitude, row.longitude];
      bounds.push(latLng);
      seen.add(row.vin);

      const existing = markersMap.get(row.vin);
      if (existing) {
        // Se mueve y se refresca el contenido en sitio: un popup abierto sigue abierto.
        existing.marker.setLatLng(latLng);
        existing.marker.setPopupContent(popupHtml(row));
        if (existing.plate !== row.plate) {
          existing.marker.setIcon(markerIcon(row.plate));
          existing.plate = row.plate;
        }
        return;
      }

      const marker = leafletLib.marker(latLng, { icon: markerIcon(row.plate) }).addTo(mapInstance);
      marker.bindPopup(popupHtml(row));
      markersMap.set(row.vin, { marker, plate: row.plate });
    });

    // Vehiculos que ya no vienen (filtro o baja): fuera del mapa.
    markersMap.forEach((entry, vin) => {
      if (seen.has(vin)) return;
      entry.marker.remove();
      markersMap.delete(vin);
    });

    if (bounds.length > 0 && !boundsApplied) {
      try {
        mapInstance.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
        boundsApplied = true;
      } catch (_) {}
    }
  }

  $effect(() => {
    if (mapInstance && leafletLib) {
      renderMarkersOnMap();
    }
  });

  function handleFilterChange() {
    // Otro conjunto de vehiculos: la proxima actualizacion vuelve a encuadrar.
    boundsApplied = false;
    if (poller) {
      poller.pollNow();
    }
  }
</script>

<div class="live-tracking-container space-y-4" data-testid="tracking-live">
  <!-- Controls / Filter bar -->
  <div class="flex flex-wrap items-center justify-between gap-3 p-3 bg-card border rounded-lg shadow-sm">
    <div class="flex items-center gap-2">
      <span class="live-dot" class:pulsing={isPolling} class:live-dot-off={!isPolling}></span>
      {#if isPolling}
        <span class="text-xs font-semibold live-ok" role="status">
          Tracking en vivo (polling 5s)
        </span>
        <span class="text-xs text-muted-foreground font-mono">
          Refrescado: {lastRefreshed}
        </span>
      {:else}
        <span class="text-xs font-semibold live-off" role="status" data-testid="tracking-degraded">
          Sin conexión desde {lastFailedAt}
        </span>
        <span class="text-xs text-muted-foreground font-mono">
          Últimos datos: {lastRefreshed}
        </span>
        <button type="button" class="px-2 py-1 text-xs border rounded bg-muted" onclick={() => poller?.pollNow()}>
          Reintentar
        </button>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      <label for="vin-filter" class="text-xs font-medium text-muted-foreground">Filtrar VIN:</label>
      <input
        id="vin-filter"
        type="text"
        bind:value={selectedVin}
        oninput={handleFilterChange}
        placeholder="Ej: VIN100..."
        class="px-2 py-1 text-xs border rounded bg-background w-36 font-mono"
        data-testid="vin-filter-input"
      />
      {#if selectedVin}
        <button
          type="button"
          onclick={() => { selectedVin = ''; handleFilterChange(); }}
          class="px-2 py-1 text-xs border rounded bg-muted hover:bg-accent"
        >
          Limpiar
        </button>
      {/if}
    </div>
  </div>

  <!-- Map element -->
  <div class="border rounded-lg overflow-hidden shadow-sm bg-background">
    <div
      bind:this={mapElement}
      id="tracking-leaflet-map"
      class="h-[480px] w-full"
      data-testid="tracking-map"
    ></div>
  </div>

  <!-- Live telemetry table representation -->
  <div class="border rounded-lg overflow-x-auto bg-card p-4 shadow-sm" role="region" aria-label="Vehículos monitoreados" tabindex="0">
    <h3 class="text-sm font-bold mb-3 text-foreground flex items-center justify-between">
      <span>Vehículos Monitoreados ({rows.length})</span>
      <span class="text-xs font-normal text-muted-foreground">Actualización automática activada</span>
    </h3>

    <table class="w-full text-left border-collapse text-xs">
      <thead>
        <tr class="border-b bg-muted/50 text-muted-foreground">
          <th class="p-2 font-medium">{vehicleIdLabel}</th>
          <th class="p-2 font-medium">VIN</th>
          <th class="p-2 font-medium">Velocidad</th>
          <th class="p-2 font-medium">RPM</th>
          <th class="p-2 font-medium">Temp. Motor</th>
          <th class="p-2 font-medium">Combustible</th>
          <th class="p-2 font-medium">Lat / Lng</th>
          <th class="p-2 font-medium">Última actualización</th>
        </tr>
      </thead>
      <tbody>
        {#if rows.length > 0}
          {#each rows as row (row.vin)}
            <tr class="border-b hover:bg-muted/30 transition-colors">
              <td class="p-2 font-bold live-ok">{row.plate}</td>
              <td class="p-2 font-mono text-muted-foreground">{row.vin}</td>
              <td class="p-2 font-semibold">{row.formattedSpeed}</td>
              <td class="p-2">{row.formattedRpm}</td>
              <td class="p-2">{row.formattedTemp}</td>
              <td class="p-2">{row.formattedFuel}</td>
              <td class="p-2 font-mono text-muted-foreground">
                {row.formattedLat}, {row.formattedLng}
              </td>
              <td class="p-2 text-muted-foreground">
                {new Date(row.timestamp).toLocaleTimeString(locale)}
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>

    <!-- Estado vacio fuera de la tabla: dentro, el scroll horizontal lo recortaba en 360 px. -->
    {#if rows.length === 0 && loadError}
      <p class="p-4 text-center text-xs live-off" role="alert" data-testid="tracking-load-error">
        No se pudo cargar la telemetría ({loadError}). No significa que la flota esté vacía.
      </p>
    {:else if rows.length === 0}
      <p class="p-4 text-center text-xs text-muted-foreground">
        No se encontraron posiciones recientes de telemetría.
      </p>
    {/if}
  </div>
</div>

<style>
  .live-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--swal-success);
  }
  .live-ok { color: var(--swal-success); }
  .live-off { color: var(--swal-danger); }
  .live-dot-off { background: var(--swal-danger); }
  :global(.lm-marker) {
    background: var(--swal-accent);
    color: var(--swal-accent-contrast);
    font-weight: 700;
    font-size: 11px;
    padding: 2px 6px;
    border: 1px solid var(--swal-text);
    white-space: nowrap;
  }
  :global(.lm-popup) { font-family: var(--swal-font); color: var(--swal-text); min-width: 180px; }
  :global(.lm-popup-title) {
    margin: 0 0 4px 0;
    font-size: 14px;
    color: var(--swal-accent-text);
    border-bottom: 1px solid var(--swal-border);
    padding-bottom: 4px;
  }
  :global(.lm-popup-row) { margin: 2px 0; font-size: 12px; }
  :global(.lm-popup-note) { margin: 4px 0 0 0; font-size: 10px; color: var(--swal-text-muted); }
  .pulsing {
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.9); }
  }
</style>
