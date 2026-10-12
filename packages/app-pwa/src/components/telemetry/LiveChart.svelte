<script lang="ts">
  import { escapeHtml } from '../../lib/html.js';
  import '../../styles/leaflet-taller.css';
  import { onMount, onDestroy } from 'svelte';
  import * as Y from 'yjs';
  // La replica P2P va por el puerto edge-mesh (red `datos`, sala del tenant), cargado en
  // onMount: edge-mesh (peerjs, noble...) es solo de navegador y no debe entrar al SSR/Worker.
  import type { MeshSync } from './meshYjsSync';
  import { TelemetryIngestManager, type OBD2TelemetryRecord } from '../../lib/telemetry.js';

  export let vin: string | undefined = undefined;

  let doc: Y.Doc;
  let mesh: MeshSync | null = null;
  let unsubPeers: (() => void) | null = null;
  let destroyed = false;
  let manager: TelemetryIngestManager;

  let records: OBD2TelemetryRecord[] = [];
  let availableVins: string[] = [];
  let selectedVin: string = vin || 'ALL';

  let speedChartCanvas: HTMLCanvasElement;
  let engineChartCanvas: HTMLCanvasElement;
  let fuelChartCanvas: HTMLCanvasElement;
  let mapContainer: HTMLDivElement;

  let speedChart: any = null;
  let engineChart: any = null;
  let fuelChart: any = null;
  let mapInstance: any = null;
  let mapMarkers: any[] = [];
  let leafletLib: any = null;
  let chartJsLib: any = null;

  let isConnected: boolean = false;
  let peerCount: number = 0;
  /** La malla cifrada no arranco (sin clave de sala o sin red): solo datos locales. */
  let meshUnavailable: boolean = false;

  $: filteredRecords = selectedVin === 'ALL'
    ? records
    : records.filter(r => r.vin === selectedVin);

  $: latestRecord = filteredRecords.length > 0 ? filteredRecords[filteredRecords.length - 1] : null;

  $: activeTroubleCodes = Array.from(
    new Set(filteredRecords.flatMap(r => r.troubleCodes || []))
  );

  function updateVinsList() {
    const vins = Array.from(new Set(records.map(r => r.vin)));
    availableVins = vins;
    if (vin && vins.includes(vin)) {
      selectedVin = vin;
    }
  }

  // Canvas no resuelve var(--x): se leen los tokens --swal-* al dibujar y se
  // reaplican en swal:themechange.
  function token(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function withAlpha(color: string, pct: number): string {
    return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
  }

  function applyChartTheme() {
    if (typeof document === 'undefined') return;
    const text = token('--swal-text-muted');
    const grid = token('--swal-line-grid');
    const accent = token('--swal-accent');
    const warning = token('--swal-warning');
    const success = token('--swal-success');
    const info = token('--swal-text-secondary');

    const style = (chart: any, colors: Array<{ line: string; fill?: string }>) => {
      if (!chart) return;
      colors.forEach((c, i) => {
        const ds = chart.data.datasets[i];
        if (!ds) return;
        ds.borderColor = c.line;
        if (c.fill) ds.backgroundColor = c.fill;
      });
      const o = chart.options;
      o.color = text;
      o.plugins = { ...(o.plugins || {}), legend: { labels: { color: text } } };
      Object.values(o.scales || {}).forEach((sc: any) => {
        sc.ticks = { ...(sc.ticks || {}), color: text };
        sc.grid = { ...(sc.grid || {}), color: grid };
      });
      chart.update('none');
    };

    style(speedChart, [{ line: info, fill: withAlpha(info, 12) }]);
    style(engineChart, [{ line: accent }, { line: warning }]);
    style(fuelChart, [{ line: success, fill: withAlpha(success, 12) }]);
  }

  function onThemeChange() {
    applyChartTheme();
  }

  async function initChartsAndMap() {
    if (typeof window === 'undefined') return;

    try {
      // Dynamic imports for Chart.js and Leaflet to support SSR
      chartJsLib = await import('chart.js/auto');
      const Chart = chartJsLib.default || chartJsLib.Chart;

      leafletLib = await import('leaflet');
      // Import Leaflet CSS dynamically
      await import('leaflet/dist/leaflet.css');

      if (speedChartCanvas && !speedChart) {
        speedChart = new Chart(speedChartCanvas, {
          type: 'line',
          data: {
            labels: [],
            datasets: [
              {
                label: 'Velocidad (km/h)',
                data: [],
                borderColor: token('--swal-text-secondary'),
                backgroundColor: withAlpha(token('--swal-text-secondary'), 12),
                tension: 0.3,
                fill: true,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: { beginAtZero: true, max: 180 },
            },
          },
        });
      }

      if (engineChartCanvas && !engineChart) {
        engineChart = new Chart(engineChartCanvas, {
          type: 'line',
          data: {
            labels: [],
            datasets: [
              {
                label: 'RPM',
                data: [],
                borderColor: token('--swal-accent'),
                yAxisID: 'yRPM',
                tension: 0.3,
              },
              {
                label: 'Refrigerante (°C)',
                data: [],
                borderColor: token('--swal-warning'),
                yAxisID: 'yTemp',
                tension: 0.3,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              yRPM: { type: 'linear', position: 'left', beginAtZero: true, max: 7000 },
              yTemp: { type: 'linear', position: 'right', beginAtZero: true, max: 130 },
            },
          },
        });
      }

      if (fuelChartCanvas && !fuelChart) {
        fuelChart = new Chart(fuelChartCanvas, {
          type: 'line',
          data: {
            labels: [],
            datasets: [
              {
                label: 'Nivel de combustible (%)',
                data: [],
                borderColor: token('--swal-success'),
                backgroundColor: withAlpha(token('--swal-success'), 12),
                tension: 0.2,
                fill: true,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              y: { beginAtZero: true, max: 100 },
            },
          },
        });
      }

      if (mapContainer && !mapInstance && leafletLib) {
        const L = leafletLib.default || leafletLib;
        mapInstance = L.map(mapContainer).setView([4.6097, -74.0817], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(mapInstance);
      }

      applyChartTheme();
      renderVisuals();
    } catch (e) {
      console.error('Failed to initialize charts/map:', e);
    }
  }

  function renderVisuals() {
    const list = filteredRecords.slice(-30);
    const timeLabels = list.map(r => new Date(r.timestamp).toLocaleTimeString());

    if (speedChart) {
      speedChart.data.labels = timeLabels;
      speedChart.data.datasets[0].data = list.map(r => r.speed);
      speedChart.update('none');
    }

    if (engineChart) {
      engineChart.data.labels = timeLabels;
      engineChart.data.datasets[0].data = list.map(r => r.rpm);
      engineChart.data.datasets[1].data = list.map(r => r.coolantTemp);
      engineChart.update('none');
    }

    if (fuelChart) {
      fuelChart.data.labels = timeLabels;
      fuelChart.data.datasets[0].data = list.map(r => r.fuelLevel);
      fuelChart.update('none');
    }

    if (mapInstance && leafletLib) {
      const L = leafletLib.default || leafletLib;

      // Clear existing markers
      mapMarkers.forEach(m => m.remove());
      mapMarkers = [];

      const validLocations = list.filter(r => r.latitude !== 0 || r.longitude !== 0);
      validLocations.forEach(r => {
        const marker = L.marker([r.latitude, r.longitude]).addTo(mapInstance);
        marker.bindPopup(
          `<b>${escapeHtml(r.vin)}</b><br/>Velocidad: ${escapeHtml(r.speed)} km/h<br/>Odómetro: ${escapeHtml(r.odometer || 0)} km`,
        );
        mapMarkers.push(marker);
      });

      if (validLocations.length > 0) {
        const lastLoc = validLocations[validLocations.length - 1];
        mapInstance.panTo([lastLoc.latitude, lastLoc.longitude]);
      }
    }
  }

  $: {
    if (filteredRecords) {
      renderVisuals();
    }
  }

  async function startMesh() {
    try {
      const [{ getMeshPort }, { attachDocToMesh }] = await Promise.all([
        import('../../mesh/node'),
        import('./meshYjsSync'),
      ]);
      const port = await getMeshPort();
      // La sala y la clave las entrega el servidor (solo con sesion, solo del tenant de la sesion):
      // el componente ya no recibe ni usa el instanceId. Sin clave lanza y la grafica sigue en local.
      const sync = await attachDocToMesh(doc, port);
      if (destroyed) {
        await sync.destroy();
        return;
      }
      mesh = sync;
      isConnected = true;
      peerCount = sync.peers();
      unsubPeers = sync.onPeers((n) => {
        peerCount = n;
      });
    } catch (e) {
      meshUnavailable = true;
      console.warn('Mesh de telemetria no disponible: se queda en modo local (sin sala sin cifrar)', e);
    }
  }

  onMount(async () => {
    doc = new Y.Doc();
    manager = new TelemetryIngestManager(doc);

    if (typeof window !== 'undefined') {
      (window as any).telemetryDoc = doc;
      (window as any).telemetryManager = manager;

      window.addEventListener('ingest-obd2-record', (e: any) => {
        if (e.detail && manager) {
          manager.ingestOBD2Data(e.detail);
        }
      });
    }

    // La replica arranca en segundo plano: abrir el nodo (identidad, IndexedDB, broker) tarda y
    // no debe retrasar los charts. Si falla (sin red, sin broker) la vista sigue en "Malla local".
    void startMesh();

    const yStream = doc.getArray<OBD2TelemetryRecord>('telemetry_stream');
    yStream.observe(() => {
      records = manager.getAllRecords();
      updateVinsList();
    });

    records = manager.getAllRecords();
    updateVinsList();

    document.addEventListener('swal:themechange', onThemeChange);
    initChartsAndMap();
  });

  onDestroy(() => {
    if (typeof document !== 'undefined') document.removeEventListener('swal:themechange', onThemeChange);
    destroyed = true;
    unsubPeers?.();
    if (mesh) void mesh.destroy();
    if (speedChart) speedChart.destroy();
    if (engineChart) engineChart.destroy();
    if (fuelChart) fuelChart.destroy();
    if (mapInstance) mapInstance.remove();
  });

  function handleIngestSample() {
    if (!manager) return;
    const testVin = selectedVin !== 'ALL' ? selectedVin : 'VIN-DEMO-99';
    manager.ingestOBD2Data({
      vin: testVin,
      timestamp: Date.now(),
      speed: Math.floor(Math.random() * 40) + 50,
      rpm: Math.floor(Math.random() * 1500) + 2000,
      coolantTemp: Math.floor(Math.random() * 15) + 85,
      fuelLevel: Math.floor(Math.random() * 20) + 60,
      latitude: 4.6097 + (Math.random() - 0.5) * 0.05,
      longitude: -74.0817 + (Math.random() - 0.5) * 0.05,
      troubleCodes: Math.random() > 0.7 ? ['P0420'] : [],
      odometer: 105200 + records.length * 5,
    });
  }
</script>

<div class="livechart-container space-y-6 p-4 bg-background text-foreground rounded-xl shadow-lg border border-border">
  <!-- Top Bar / Header -->
  <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-border">
    <div>
      <h2 class="text-2xl font-extrabold tracking-tight">Telemetría en vivo</h2>
      <p class="text-sm text-muted-foreground">Ingesta OBD2 en tiempo real y sincronización P2P entre dispositivos</p>
    </div>

    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-border bg-muted/40">
        <span class="w-2.5 h-2.5 rounded-full {isConnected ? 'animate-pulse' : ''}" style="background: {isConnected ? 'var(--swal-success)' : 'var(--swal-warning)'}"></span>
        <span data-testid="peer-status">{isConnected ? `Malla activa (${peerCount} ${peerCount === 1 ? 'par' : 'pares'})` : meshUnavailable ? 'Malla no disponible (solo local)' : 'Malla local'}</span>
      </div>

      <button
        data-testid="ingest-sample-btn"
        class="px-3 py-1.5 text-xs font-semibold rounded bg-primary text-primary-foreground hover:opacity-90 transition-all shadow"
        on:click={handleIngestSample}
      >
        Ingerir muestra OBD2
      </button>
    </div>
  </div>

  <!-- VIN Selector & Summary KPI Row -->
  <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
    <!-- VIN Selector -->
    <div class="p-3 rounded-lg border border-border bg-card">
      <label for="vin-select" class="block text-xs font-medium text-muted-foreground mb-1">Vehículo (VIN)</label>
      <select
        id="vin-select"
        data-testid="vin-selector"
        bind:value={selectedVin}
        class="w-full text-sm bg-background border border-input rounded p-1.5 focus:ring-1 focus:ring-primary outline-none"
      >
        <option value="ALL">Todos los vehículos ({records.length} registros)</option>
        {#each availableVins as v}
          <option value={v}>{v}</option>
        {/each}
      </select>
    </div>

    <!-- Odometer Metric -->
    <div class="p-3 rounded-lg border border-border bg-card flex flex-col justify-between">
      <span class="text-xs font-medium text-muted-foreground">Odómetro</span>
      <div class="flex items-baseline gap-1 mt-1">
        <span data-testid="odometer-value" class="text-2xl font-bold font-mono tracking-tight">
          {latestRecord ? (latestRecord.odometer || 0).toLocaleString() : '0'}
        </span>
        <span class="text-xs text-muted-foreground">km</span>
      </div>
    </div>

    <!-- Latest Speed Metric -->
    <div class="p-3 rounded-lg border border-border bg-card flex flex-col justify-between">
      <span class="text-xs font-medium text-muted-foreground">Velocidad actual</span>
      <div class="flex items-baseline gap-1 mt-1">
        <span data-testid="current-speed" class="text-2xl font-bold font-mono tracking-tight text-primary">
          {latestRecord ? latestRecord.speed : 0}
        </span>
        <span class="text-xs text-muted-foreground">km/h</span>
      </div>
    </div>

    <!-- Engine Status Metric -->
    <div class="p-3 rounded-lg border border-border bg-card flex flex-col justify-between">
      <span class="text-xs font-medium text-muted-foreground">Refrigerante y RPM</span>
      <div class="flex items-baseline justify-between mt-1">
        <span class="text-sm font-semibold">{latestRecord ? latestRecord.rpm : 0} <span class="text-xs font-normal text-muted-foreground">RPM</span></span>
        <span class="text-sm font-semibold">{latestRecord ? latestRecord.coolantTemp : 0}°C</span>
      </div>
    </div>
  </div>

  <!-- 2x2 Grid: Speed Chart, Engine Chart, Fuel Chart / Trouble Codes, Leaflet Map -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- Speed Line Chart -->
    <div class="p-4 rounded-xl border border-border bg-card shadow-sm flex flex-col h-72">
      <h3 class="text-sm font-bold mb-2">Velocidad (km/h)</h3>
      <div class="flex-1 relative">
        <canvas bind:this={speedChartCanvas}></canvas>
      </div>
    </div>

    <!-- Engine RPM & Coolant Chart -->
    <div class="p-4 rounded-xl border border-border bg-card shadow-sm flex flex-col h-72">
      <h3 class="text-sm font-bold mb-2">Motor (RPM y temperatura)</h3>
      <div class="flex-1 relative">
        <canvas bind:this={engineChartCanvas}></canvas>
      </div>
    </div>

    <!-- Leaflet Map Panel -->
    <div class="p-4 rounded-xl border border-border bg-card shadow-sm flex flex-col h-80">
      <h3 class="text-sm font-bold mb-2">Ubicación de los vehículos en vivo</h3>
      <div bind:this={mapContainer} data-testid="telemetry-map" class="flex-1 rounded-lg border border-border overflow-hidden z-0"></div>
    </div>

    <!-- Fuel Level Chart & Trouble Codes Panel -->
    <div class="grid gap-4 min-w-0 lg:grid-rows-2 lg:h-80">
      <!-- Fuel Chart -->
      <div class="p-3 rounded-xl border border-border bg-card shadow-sm flex flex-col min-w-0 overflow-hidden h-56 lg:h-auto">
        <h3 class="text-xs font-bold mb-1">Nivel del tanque (%)</h3>
        <div class="flex-1 relative">
          <canvas bind:this={fuelChartCanvas}></canvas>
        </div>
      </div>

      <!-- Trouble Codes Panel -->
      <div class="p-3 rounded-xl border border-border bg-card shadow-sm flex flex-col min-w-0 overflow-y-auto min-h-24">
        <h3 class="text-xs font-bold mb-2 flex items-center gap-1.5">
          <span>Códigos de falla (DTC)</span>
          {#if activeTroubleCodes.length > 0}
            <span class="px-1.5 py-0.5 text-[10px] bg-destructive/20 text-destructive font-semibold rounded-full">
              {activeTroubleCodes.length} activos
            </span>
          {/if}
        </h3>

        <div data-testid="trouble-codes-list" class="flex flex-wrap gap-2">
          {#each activeTroubleCodes as code}
            <span data-testid="trouble-code-item" class="px-2 py-1 text-xs font-mono font-bold bg-destructive text-destructive-foreground rounded shadow-sm">
              ⚠️ {code}
            </span>
          {:else}
            <div class="text-xs text-muted-foreground py-2 italic">
              No hay códigos de falla activos.
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>
