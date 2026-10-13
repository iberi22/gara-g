<script lang="ts">
  import { DEFAULT_INSTANCE_ID } from '../../lib/domain.config';
  import { onMount, tick } from 'svelte';
  import { YjsFleetManager, type Fleet, type Vehicle } from '../../lib/yjsFleet.js';
  import { MARKET } from '../../lib/market';

  let { instanceId = DEFAULT_INSTANCE_ID }: { instanceId?: string } = $props();

  let manager = $state<YjsFleetManager | null>(null);
  let fleets = $state<Fleet[]>([]);
  let vehicles = $state<Vehicle[]>([]);

  // Estado de carga: hasta que IndexedDB responde no se sabe si hay flotas, asi que ni "vacio"
  // ni tabla: o carga, o fallo (con reintento), o datos.
  let loaded = $state(false);
  let loadError = $state('');

  // Modal / Form state
  let showModal = $state(false);
  let editingFleetId = $state<string | null>(null);
  let formName = $state('');
  let formOrg = $state('');
  let formRegion = $state('');
  let formTags = $state('');
  let dialogEl = $state<HTMLDivElement | null>(null);
  // Quien tenia el foco al abrir el modal: ahi vuelve al cerrarlo.
  let opener: HTMLElement | null = null;

  function refresh() {
    if (!manager) return;
    fleets = manager.listFleets();
    vehicles = manager.listVehicles();
  }

  function loadFleets(mgr: YjsFleetManager) {
    loaded = false;
    loadError = '';
    return mgr
      .initIndexedDB()
      .then(() => {
        refresh();
        loaded = true;
      })
      .catch((err: unknown) => {
        loadError = err instanceof Error && err.message ? err.message : 'IndexedDB no respondio';
        loaded = true;
      });
  }

  function retryLoad() {
    if (manager) loadFleets(manager);
  }

  onMount(() => {
    const mgr = new YjsFleetManager(instanceId);
    manager = mgr;
    loadFleets(mgr);

    const unsubscribe = mgr.subscribe(() => {
      refresh();
    });

    return () => {
      unsubscribe();
    };
  });

  function getVehicleCount(fleetId: string): number {
    return vehicles.filter((v) => v.fleetId === fleetId).length;
  }

  async function openModal() {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    showModal = true;
    await tick();
    // El foco entra al dialogo: al primer campo (o al propio dialogo si no hubiera).
    (dialogEl?.querySelector<HTMLElement>('input, select, textarea') ?? dialogEl)?.focus();
  }

  function openCreateModal() {
    editingFleetId = null;
    formName = '';
    formOrg = '';
    formRegion = '';
    formTags = '';
    openModal();
  }

  function openEditModal(fleet: Fleet) {
    editingFleetId = fleet.id;
    formName = fleet.name;
    formOrg = fleet.organizationId;
    formRegion = fleet.region;
    formTags = Array.isArray(fleet.tags) ? fleet.tags.join(', ') : '';
    openModal();
  }

  async function closeModal() {
    showModal = false;
    editingFleetId = null;
    await tick();
    // El foco vuelve al disparador; si la fila ya no existe, al boton de crear.
    const target = opener && opener.isConnected ? opener : document.querySelector<HTMLElement>('[data-testid="new-fleet-btn"]');
    target?.focus();
    opener = null;
  }

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function onDialogKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeModal();
      return;
    }
    if (e.key !== 'Tab' || !dialogEl) return;
    // Trampa de foco: Tab / Shift+Tab ciclan dentro del dialogo.
    const items = Array.from(dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogEl)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (active && !dialogEl.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!manager) return;

    const tagsArray = formTags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (editingFleetId) {
      manager.updateFleet(editingFleetId, {
        name: formName,
        organizationId: formOrg,
        region: formRegion,
        tags: tagsArray,
      });
    } else {
      const newId = `fleet_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      manager.createFleet({
        id: newId,
        name: formName,
        organizationId: formOrg,
        region: formRegion,
        tags: tagsArray,
      });
    }

    closeModal();
    refresh();
  }

  function handleDelete(fleet: Fleet) {
    if (!manager) return;
    // Borrar una flota deja sin flota a sus vehiculos: se pregunta diciendo cuantos.
    const n = getVehicleCount(fleet.id);
    const aviso = n > 0 ? ` ${n} vehículo${n !== 1 ? 's' : ''} se quedará${n !== 1 ? 'n' : ''} sin flota.` : '';
    if (!confirm(`¿Eliminar la flota "${fleet.name}"?${aviso}`)) return;
    manager.deleteFleet(fleet.id);
    refresh();
  }
</script>

<div class="fleet-table-wrapper">
  <div class="table-header">
    <div class="header-info">
      <h2 class="header-title">Flotas</h2>
      <span class="header-subtitle">{fleets.length} flota{fleets.length !== 1 ? 's' : ''} registrada{fleets.length !== 1 ? 's' : ''}</span>
    </div>
    <button class="btn btn-primary" data-testid="new-fleet-btn" onclick={openCreateModal}>
      + Nueva flota
    </button>
  </div>

  {#if showModal}
    <div class="modal-overlay" onclick={closeModal} role="presentation">
      <div
        class="modal-content"
        bind:this={dialogEl}
        onclick={(e) => e.stopPropagation()}
        onkeydown={onDialogKeydown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fleet-modal-title"
        tabindex="-1"
      >
        <h3 class="modal-title" id="fleet-modal-title">{editingFleetId ? 'Editar flota' : 'Nueva flota'}</h3>
        <form onsubmit={handleSubmit} class="fleet-form">
          <div class="form-group">
            <label for="fleet-name" class="form-label">Nombre de la flota</label>
            <input
              id="fleet-name"
              name="name"
              type="text"
              class="form-input"
              placeholder="p. ej. Flota Norte"
              bind:value={formName}
              required
            />
          </div>

          <div class="form-group">
            <label for="fleet-org" class="form-label">ID de organización</label>
            <input
              id="fleet-org"
              name="organizationId"
              type="text"
              class="form-input"
              placeholder="p. ej. org-1"
              bind:value={formOrg}
              required
            />
          </div>

          <div class="form-group">
            <label for="fleet-region" class="form-label">Región</label>
            <input
              id="fleet-region"
              name="region"
              type="text"
              class="form-input"
              placeholder={MARKET.cityPlaceholder}
              bind:value={formRegion}
              required
            />
          </div>

          <div class="form-group">
            <label for="fleet-tags" class="form-label">Etiquetas (separadas por comas)</label>
            <input
              id="fleet-tags"
              name="tags"
              type="text"
              class="form-input"
              placeholder="p. ej. eléctricos, reparto"
              bind:value={formTags}
            />
          </div>

          <div class="form-actions">
            <button type="button" class="btn btn-secondary" onclick={closeModal}>Cancelar</button>
            <button type="submit" class="btn btn-primary">Guardar flota</button>
          </div>
        </form>
      </div>
    </div>
  {/if}

  <div class="table-container" role="region" aria-label="Flotas registradas" tabindex="0">
    <table class="fleet-table">
      <caption class="sr-only">Flotas registradas</caption>
      <thead>
        <tr>
          <th scope="col">Nombre</th>
          <th scope="col">ID de organización</th>
          <th scope="col">Región</th>
          <th scope="col">Etiquetas</th>
          <th scope="col">Vehículos</th>
          <th scope="col" class="actions-head">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {#each fleets as fleet (fleet.id)}
          <tr>
            <td class="font-bold">{fleet.name}</td>
            <td class="font-mono">{fleet.organizationId}</td>
            <td>{fleet.region}</td>
            <td>
              {#if fleet.tags && fleet.tags.length > 0}
                <div class="tags-container">
                  {#each fleet.tags as tag}
                    <span class="tag-badge">{tag}</span>
                  {/each}
                </div>
              {:else}
                <span class="muted-text">—</span>
              {/if}
            </td>
            <td>
              <span class="count-badge">{getVehicleCount(fleet.id)}</span>
            </td>
            <td class="actions-cell">
              <div class="actions-group">
                <button class="btn btn-sm btn-outline" aria-label={`Editar ${fleet.name}`} onclick={() => openEditModal(fleet)}>
                  Editar
                </button>
                <button class="btn btn-sm btn-danger" aria-label={`Eliminar ${fleet.name}`} onclick={() => handleDelete(fleet)}>
                  Eliminar
                </button>
              </div>
            </td>
          </tr>
        {:else}
          {#if !loaded}
            <tr>
              <td colspan="6" class="empty-state" data-testid="fleet-loading">Cargando flotas…</td>
            </tr>
          {:else if loadError}
            <tr>
              <td colspan="6" class="empty-state error-state" role="alert" data-testid="fleet-load-error">
                No se pudieron cargar las flotas ({loadError}).
                <button class="btn btn-sm btn-outline" type="button" onclick={retryLoad}>Reintentar</button>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="6" class="empty-state">
                No hay flotas. Pulsa «+ Nueva flota» para crear una.
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .fleet-table-wrapper {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
    color: var(--swal-text);
  }

  .table-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .header-title {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 0;
    color: var(--swal-text);
  }

  .header-subtitle {
    font-size: 0.75rem;
    color: var(--swal-text-muted);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem 1rem;
    border-radius: var(--swal-radius-sm);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.15s ease-in-out;
  }

  .btn-primary {
    background-color: var(--swal-accent);
    color: var(--swal-accent-contrast);
    border-color: var(--swal-accent);
    clip-path: polygon(var(--swal-chamfer-sm) 0, 100% 0, 100% calc(100% - var(--swal-chamfer-sm)), calc(100% - var(--swal-chamfer-sm)) 100%, 0 100%, 0 var(--swal-chamfer-sm));
  }
  .btn-primary:hover {
    background-color: var(--swal-accent-hover);
  }

  .btn-secondary {
    background-color: transparent;
    color: var(--swal-text);
    border-color: var(--swal-border);
  }
  .btn-secondary:hover {
    background-color: var(--swal-hover-bg);
  }

  .btn-sm {
    padding: 0.25rem 0.625rem;
    font-size: 0.75rem;
  }

  .btn-outline {
    background-color: transparent;
    color: var(--swal-text);
    border-color: var(--swal-border);
  }
  .btn-outline:hover {
    background-color: var(--swal-hover-bg);
  }

  .btn-danger {
    background-color: transparent;
    color: var(--swal-danger);
    border-color: var(--swal-danger);
  }
  .btn-danger:hover {
    background-color: var(--swal-danger-bg);
  }

  .table-container {
    width: 100%;
    overflow-x: auto;
    border: 1px solid var(--swal-border);
    border-radius: var(--swal-radius-lg);
    background-color: var(--swal-surface);
  }

  .fleet-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 0.875rem;
  }

  .fleet-table th,
  .fleet-table td {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--swal-border-light);
  }

  .fleet-table th {
    background-color: var(--swal-bg-surface);
    color: var(--swal-text-faint);
    font-weight: 500;
    font-family: var(--swal-font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }

  .fleet-table tr:last-child td {
    border-bottom: none;
  }

  .fleet-table tr:hover td {
    background-color: var(--swal-hover-bg);
  }

  .font-bold {
    font-weight: 600;
  }

  .font-mono {
    font-family: var(--swal-font-mono);
    font-size: 0.8125rem;
  }

  .actions-head,
  .actions-cell {
    text-align: right;
  }

  /* El flex va en un div interior: en el <td> rompia el modelo de tabla. */
  .actions-group {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .error-state {
    color: var(--swal-danger);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .tags-container {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .tag-badge {
    background-color: var(--swal-hover-bg);
    color: var(--swal-text-secondary);
    border: 1px solid var(--swal-border);
    padding: 0.125rem 0.375rem;
    border-radius: var(--swal-radius-sm);
    font-size: 0.7rem;
    font-weight: 500;
  }

  .count-badge {
    background-color: var(--swal-hover-bg);
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .muted-text {
    color: var(--swal-text-muted);
  }

  .empty-state {
    text-align: center;
    padding: 2rem 1rem;
    color: var(--swal-text-muted);
  }

  /* Modal styling */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background-color: var(--swal-overlay);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 1rem;
  }

  .modal-content {
    background-color: var(--swal-bg-elevated);
    border: 1px solid var(--swal-border);
    border-radius: var(--swal-radius-lg);
    width: 100%;
    max-width: 28rem;
    padding: 1.5rem;
    box-shadow: var(--swal-shadow-lg);
  }

  .modal-title {
    margin: 0 0 1.25rem 0;
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--swal-text);
  }

  .fleet-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .form-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--swal-text-muted);
    text-transform: uppercase;
  }

  .form-input {
    background-color: var(--swal-surface);
    border: 1px solid var(--swal-border);
    border-radius: var(--swal-radius-sm);
    padding: 0.5rem 0.75rem;
    color: var(--swal-text);
    font-size: 0.875rem;
  }
  .form-input:focus {
    outline: none;
    border-color: var(--swal-accent);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }
</style>
