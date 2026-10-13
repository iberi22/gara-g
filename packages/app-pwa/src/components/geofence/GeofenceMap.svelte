<!--
  GeofenceMap.svelte — Leaflet Map component with Svelte 5 runes for GARA-G.
  Renders Leaflet polygons (L.polygon), tooltips, color-coding by GeofenceType,
  and a form to create/edit geofences.

  El mapa es una ayuda visual: todo lo que se hace con un clic en un poligono (editar) y lo
  que no se podia hacer nunca (borrar) tiene su equivalente textual en la lista de debajo,
  con botones "Editar <nombre>" / "Eliminar <nombre>" operables con teclado y lector de pantalla.
  Crear, editar y borrar persisten en /api/fleet/geofence (geofenceApi.ts).
-->
<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { geofenceTypeLabel } from '../../lib/alertLabels';
  import { escapeHtml } from '../../lib/html.js';
  // Centro del mapa, punto de prueba y poligono de ejemplo: del mercado activo (Antofagasta
  // en Chile). Antes eran constantes de Bogota en las tres cosas.
  import { demoPolygon, MARKET } from '../../lib/market.js';
  import '../../styles/leaflet-taller.css';
  import {
    pointInPolygon,
    createGeofence,
    parsePolygonString,
    formatPolygonString,
    type Geofence,
    type GeofenceType,
    type GeofencePoint,
  } from '../../lib/geofence.js';
  import {
    createGeofenceRemote,
    updateGeofenceRemote,
    deleteGeofenceRemote,
    type GeofenceInput,
  } from './geofenceApi.js';

  interface Props {
    instanceId?: string;
    fleetId?: string;
    geofences?: Geofence[];
    onGeofenceChange?: (geofences: Geofence[]) => void;
  }

  let {
    instanceId = 'default',
    fleetId = 'fleet-default',
    geofences = $bindable([]),
    onGeofenceChange,
  }: Props = $props();

  let mapElement: HTMLDivElement | null = $state(null);
  let mapInstance: any = $state(null);
  let leafletLib: any = $state(null);
  let polygonLayersMap: Map<string, any> = new Map();

  const defaultPolygon = demoPolygon(MARKET);
  /** Baricentro del poligono de ejemplo: el punto de prueba arranca DENTRO del poligono. */
  const defaultPoints = defaultPolygon.split(' ').map((p) => p.split(',').map(Number));
  const defaultTestLat = defaultPoints.reduce((a, p) => a + p[0] / defaultPoints.length, 0);
  const defaultTestLng = defaultPoints.reduce((a, p) => a + p[1] / defaultPoints.length, 0);

  // Form state using Svelte 5 runes
  let formName = $state('');
  let formType = $state<GeofenceType>('workzone');
  let formPolygonStr = $state(defaultPolygon);
  let formAlertOnEnter = $state(true);
  let formAlertOnExit = $state(true);
  let editingId = $state<string | null>(null);
  let saving = $state(false);
  // Mensajes para lector de pantalla: `status` anuncia lo hecho, `formError` un fallo.
  let status = $state('');
  let formError = $state('');
  let nameInput: HTMLInputElement | null = $state(null);
  let listHeading: HTMLHeadingElement | null = $state(null);

  // Test point verification state
  let testLat = $state(defaultTestLat);
  let testLng = $state(defaultTestLng);
  let testResult = $state<string | null>(null);

  // Clase CSS por tipo (src/styles/leaflet-taller.css): el color sale de un token --swal-*,
  // asi el polígono y su rotulo siguen al tema claro/oscuro sin repintar la capa.
  function classForType(type: GeofenceType): string {
    switch (type) {
      case 'workzone':
      case 'restricted':
      case 'depot':
      case 'port':
      case 'service':
      case 'client':
        return `geo-t-${type}`;
      case 'custom':
      default:
        return 'geo-t-custom';
    }
  }

  onMount(async () => {
    if (typeof window === 'undefined') return;

    try {
      // Dynamic import of Leaflet for SSR safety
      const L = await import('leaflet');
      leafletLib = L;

      // CSS de Leaflet empaquetado (no del CDN): la PWA instalada debe pintar el mapa sin red.
      await import('leaflet/dist/leaflet.css');

      if (mapElement && !mapInstance) {
        mapInstance = L.map(mapElement, {
          center: [MARKET.mapCenter.lat, MARKET.mapCenter.lng],
          zoom: MARKET.mapCenter.zoom,
          scrollWheelZoom: true,
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors',
        }).addTo(mapInstance);

        renderPolygonsOnMap();
      }
    } catch (err) {
      console.error('Failed to initialize Leaflet in GeofenceMap:', err);
    }
  });

  onDestroy(() => {
    if (mapInstance) {
      mapInstance.remove();
      mapInstance = null;
    }
  });

  function renderPolygonsOnMap() {
    if (!mapInstance || !leafletLib) return;

    // Clear existing layers
    polygonLayersMap.forEach((layer) => layer.remove());
    polygonLayersMap.clear();

    const bounds: [number, number][] = [];

    geofences.forEach((gf) => {
      if (!gf.vertices || gf.vertices.length < 3) return;

      const typeClass = classForType(gf.type);
      const layer = leafletLib.polygon(gf.vertices, {
        className: `geo-t ${typeClass}`,
        weight: 3,
        fillOpacity: 0.3,
      }).addTo(mapInstance);

      const tooltipContent = `
        <div class="geofence-tooltip">
          <strong>${escapeHtml(gf.name)}</strong><br/>
          <span class="geo-type ${escapeHtml(typeClass)}">${escapeHtml(geofenceTypeLabel(gf.type))}</span><br/>
          <small>Enter: ${gf.alertOnEnter ? '🔔' : '❌'} | Exit: ${gf.alertOnExit ? '🚪' : '❌'}</small>
        </div>
      `;

      layer.bindTooltip(tooltipContent, { permanent: false, sticky: true });
      layer.bindPopup(tooltipContent);

      layer.on('click', () => startEdit(gf));

      polygonLayersMap.set(gf.id, layer);
      gf.vertices.forEach((pt) => bounds.push(pt));
    });

    if (bounds.length > 0) {
      try {
        mapInstance.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
      } catch (_) {}
    }
  }

  // Reactive effect to re-render when geofences change
  $effect(() => {
    if (mapInstance && leafletLib) {
      renderPolygonsOnMap();
    }
  });

  // Rellena el formulario con una geocerca: lo usan el clic en el poligono y el boton "Editar".
  function startEdit(gf: Geofence, moveFocus = false) {
    editingId = gf.id;
    formName = gf.name;
    formType = gf.type;
    formPolygonStr = formatPolygonString(gf.vertices);
    formAlertOnEnter = gf.alertOnEnter;
    formAlertOnExit = gf.alertOnExit;
    formError = '';
    status = `Editando la geocerca ${gf.name}.`;
    // Con teclado el foco debe seguir al formulario; con el raton no se roba.
    if (moveFocus) void tick().then(() => nameInput?.focus());
  }

  async function handleSaveGeofence(e: Event) {
    e.preventDefault();
    if (saving) return;
    formError = '';
    const parsedVertices = parsePolygonString(formPolygonStr);
    if (parsedVertices.length < 3) {
      formError = 'Se requieren al menos 3 coordenadas válidas para formar un polígono.';
      return;
    }

    const wasEditing = editingId;
    const input: GeofenceInput = {
      fleetId,
      name: formName.trim() || `Geocerca ${geofences.length + 1}`,
      type: formType,
      vertices: parsedVertices,
      alertOnEnter: formAlertOnEnter,
      alertOnExit: formAlertOnExit,
    };

    saving = true;
    try {
      // La lista solo cambia cuando el servidor lo confirma: un guardado "local" que
      // desaparece al recargar es peor que un error visible.
      if (wasEditing) {
        const saved = await updateGeofenceRemote(wasEditing, input, instanceId);
        geofences = geofences.map((gf) => (gf.id === wasEditing ? { ...gf, ...saved, id: wasEditing } : gf));
      } else {
        geofences = [...geofences, await createGeofenceRemote(input, instanceId)];
      }
    } catch (err) {
      formError = err instanceof Error ? err.message : 'No se pudo guardar la geocerca.';
      return;
    } finally {
      saving = false;
    }

    status = `Geocerca ${input.name} ${wasEditing ? 'actualizada' : 'creada'}.`;
    resetForm();
    if (onGeofenceChange) onGeofenceChange(geofences);
  }

  function resetForm() {
    editingId = null;
    formName = '';
    formType = 'workzone';
    formPolygonStr = defaultPolygon;
    formAlertOnEnter = true;
    formAlertOnExit = true;
    formError = '';
  }

  async function handleDeleteGeofence(id: string) {
    const gf = geofences.find((g) => g.id === id);
    if (!gf) return;
    // Borrar es irreversible: se pide confirmacion (confirm() nativo, accesible por teclado).
    if (!confirm(`¿Eliminar la geocerca "${gf.name}"? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteGeofenceRemote(id, instanceId);
    } catch (err) {
      status = err instanceof Error ? err.message : 'No se pudo eliminar la geocerca.';
      return;
    }
    geofences = geofences.filter((g) => g.id !== id);
    if (editingId === id) resetForm();
    status = `Geocerca ${gf.name} eliminada.`;
    if (onGeofenceChange) onGeofenceChange(geofences);
    // El boton enfocado desaparece: el foco pasa al titulo de la lista, no se pierde en <body>.
    void tick().then(() => listHeading?.focus());
  }

  function verifyTestPoint() {
    const pt: GeofencePoint = [Number(testLat), Number(testLng)];
    const matching = geofences.filter((gf) => pointInPolygon(pt, gf.vertices));

    if (matching.length > 0) {
      testResult = `El punto está DENTRO de: ${matching.map((m) => m.name).join(', ')}`;
    } else {
      testResult = 'El punto está FUERA de todas las geocercas.';
    }
  }
</script>

<!-- GeofenceMap Component UI -->
<div class="geofence-map-container space-y-4" data-testid="geofence-map-component">
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
    <!-- Map Canvas Area -->
    <div class="md:col-span-2 border rounded-lg overflow-hidden shadow-sm bg-background">
      <div
        bind:this={mapElement}
        id="geofence-map"
        class="h-[450px] w-full"
        data-testid="geofence-map"
        role="region"
        aria-label="Mapa de geocercas, ayuda visual. Para editar o eliminar usa la lista de geocercas."
      ></div>
    </div>

    <!-- Interactive Geofence Editor Form -->
    <div class="p-4 border rounded-lg shadow-sm bg-card space-y-4">
      <h3 class="text-lg font-bold">
        {editingId ? 'Editar Geocerca' : 'Crear Nueva Geocerca'}
      </h3>

      <form onsubmit={handleSaveGeofence} class="space-y-3" aria-busy={saving}>
        {#if formError}
          <p role="alert" class="geo-error" data-testid="geofence-form-error">{formError}</p>
        {/if}
        <div>
          <label for="geo-name" class="block text-xs font-medium mb-1">Nombre</label>
          <input
            id="geo-name"
            bind:this={nameInput}
            type="text"
            bind:value={formName}
            placeholder="Zona de Trabajo A"
            required
            class="w-full px-2 py-1 text-sm border rounded bg-background"
          />
        </div>

        <div>
          <label for="geo-type" class="block text-xs font-medium mb-1">Tipo</label>
          <select
            id="geo-type"
            bind:value={formType}
            class="w-full px-2 py-1 text-sm border rounded bg-background"
          >
            <option value="workzone">Zona de trabajo</option>
            <option value="restricted">Restringida (Restricted)</option>
            <option value="depot">Depósito (Depot)</option>
            <option value="port">Puerto (Port)</option>
            <option value="service">Servicio (Service)</option>
            <option value="client">Cliente (Client)</option>
            <option value="custom">Personalizada (Custom)</option>
          </select>
        </div>

        <div>
          <label for="geo-polygon" class="block text-xs font-medium mb-1">
            Vértices (Polígono lat,lng)
          </label>
          <textarea
            id="geo-polygon"
            bind:value={formPolygonStr}
            rows={3}
            placeholder={defaultPolygon}
            required
            class="w-full px-2 py-1 text-xs font-mono border rounded bg-background"
          ></textarea>
        </div>

        <div class="flex items-center space-x-4 text-xs">
          <label class="flex items-center space-x-1 cursor-pointer">
            <input type="checkbox" bind:checked={formAlertOnEnter} />
            <span>Alertar al Entrar</span>
          </label>
          <label class="flex items-center space-x-1 cursor-pointer">
            <input type="checkbox" bind:checked={formAlertOnExit} />
            <span>Alertar al Salir</span>
          </label>
        </div>

        <div class="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={saving}
            class="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 font-medium"
          >
            {editingId ? 'Actualizar' : 'Guardar Polígono'}
          </button>
          {#if editingId}
            <button
              type="button"
              onclick={resetForm}
              class="px-3 py-1 text-xs border rounded hover:bg-muted"
            >
              Cancelar
            </button>
          {/if}
        </div>
      </form>

      <!-- Point-in-Polygon Testing Widget -->
      <div class="border-t pt-3 mt-4 space-y-2">
        <h4 class="text-xs font-semibold text-muted-foreground">Probar si un punto está dentro</h4>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <input type="number" step="any" bind:value={testLat} placeholder="Latitud" class="px-2 py-1 border rounded" />
          <input type="number" step="any" bind:value={testLng} placeholder="Longitud" class="px-2 py-1 border rounded" />
        </div>
        <button
          type="button"
          onclick={verifyTestPoint}
          class="w-full py-1 text-xs bg-secondary text-secondary-foreground rounded hover:opacity-90"
        >
          Verificar Ubicación
        </button>
        {#if testResult}
          <p class="text-xs font-mono p-2 bg-muted rounded mt-1" data-testid="point-in-polygon-result">{testResult}</p>
        {/if}
      </div>
    </div>
  </div>

  <!-- Lista de geocercas: el equivalente textual del mapa (editar y eliminar sin raton) -->
  <section class="p-4 border rounded-lg shadow-sm bg-card space-y-3" aria-labelledby="geo-list-title">
    <h3 id="geo-list-title" bind:this={listHeading} tabindex="-1" class="text-lg font-bold">
      Geocercas ({geofences.length})
    </h3>
    {#if geofences.length === 0}
      <p class="text-xs text-muted-foreground" data-testid="geofence-list-empty">
        Aún no hay geocercas. Crea la primera con el formulario.
      </p>
    {:else}
      <ul class="geo-list" data-testid="geofence-list">
        {#each geofences as gf (gf.id)}
          <li class="geo-item" data-testid="geofence-item">
            <span class="geo-item-name">
              <strong>{gf.name}</strong>
              <span class="geo-type {classForType(gf.type)}">{geofenceTypeLabel(gf.type)}</span>
              <span class="text-xs text-muted-foreground">{gf.vertices.length} vértices</span>
            </span>
            <span class="geo-item-actions">
              <button
                type="button"
                class="px-3 py-1 text-xs border rounded"
                aria-label={`Editar ${gf.name}`}
                onclick={() => startEdit(gf, true)}
              >
                Editar
              </button>
              <button
                type="button"
                class="px-3 py-1 text-xs border rounded geo-danger"
                aria-label={`Eliminar ${gf.name}`}
                onclick={() => handleDeleteGeofence(gf.id)}
              >
                Eliminar
              </button>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Anuncios para lector de pantalla (creada, eliminada, editando...) -->
  <p class="geo-sr-only" role="status" aria-live="polite" data-testid="geofence-status">{status}</p>
</div>

<style>
  /* Las clases utilitarias del marcado (bg-card, border…) no tienen definicion en esta app
     (Tailwind va sin preflight ni tokens de shadcn): el panel y los campos se pintan aqui
     con los tokens del tema para que se lean igual en claro y oscuro. */
  .geofence-map-container { color: var(--swal-text); }
  .geofence-map-container :global(.border) { border: 1px solid var(--swal-border); }
  .geofence-map-container :global(.border-t) { border-top: 1px solid var(--swal-border); }
  .geofence-map-container :global(.bg-card) { background: var(--swal-surface); }
  .geofence-map-container :global(.bg-background) { background: var(--swal-bg-surface); }
  .geofence-map-container :global(.bg-muted) { background: var(--swal-surface-active); }
  .geofence-map-container :global(.text-muted-foreground) { color: var(--swal-text-muted); }
  .geofence-map-container :global(.rounded),
  .geofence-map-container :global(.rounded-lg) { border-radius: 0; }
  .geofence-map-container :global(input:not([type="checkbox"])),
  .geofence-map-container :global(select),
  .geofence-map-container :global(textarea) {
    background: var(--swal-bg-elevated);
    color: var(--swal-text);
    border: 1px solid var(--swal-border-strong);
    border-radius: 0;
  }
  .geofence-map-container :global(button[type="submit"]) {
    background: var(--swal-accent);
    color: var(--swal-accent-contrast);
    border: 1px solid var(--swal-accent);
  }
  .geofence-map-container :global(button:not([type="submit"])) {
    background: var(--swal-surface);
    color: var(--swal-text);
    border: 1px solid var(--swal-border-strong);
  }
  .geofence-map-container :global(button) { cursor: pointer; border-radius: 0; }

  .geo-error {
    margin: 0;
    padding: 0.4rem 0.5rem;
    font-size: 0.75rem;
    color: var(--swal-danger);
    border: 1px solid var(--swal-danger);
  }
  .geo-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  .geo-item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--swal-border);
    background: var(--swal-bg-surface);
  }
  .geo-item-name { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; min-width: 0; }
  .geo-item-actions { display: flex; gap: 0.5rem; }
  .geofence-map-container :global(button.geo-danger) {
    color: var(--swal-danger);
    border-color: var(--swal-danger);
  }
  .geofence-map-container :global(button:focus-visible),
  .geofence-map-container :global(#geo-list-title:focus-visible) {
    outline: 2px solid var(--swal-accent);
    outline-offset: 2px;
  }
  .geo-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
