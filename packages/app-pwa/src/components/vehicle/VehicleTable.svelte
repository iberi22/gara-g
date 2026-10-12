<script lang="ts">
  import { DEFAULT_INSTANCE_ID } from '../../lib/domain.config';
  /**
   * VehicleTable.svelte — Svelte 5 runes tabla CRUD para vehicles (WAVE-11.02, issue #877).
   *
   * Patrón Svelte 5 runes (NO Svelte 4: NO export let, NO on:click).
   * Replica la estructura de DriverTable.svelte (W11.04) pero con entity
   * `vehicle` whitelisteada en `domain.config.ts` y validadores puros
   * (`validateVIN`, `validatePlate`, `validateVehicleFields`) desde
   * `src/lib/vehicle.ts`.
   *
   * Features:
   *   - columnas: plate / vin / make / model / year / fleetId / status badge / photoUrl thumbnail / acciones
   *   - form modal validado: VIN 17-char A-Z0-9 sin I/O/Q, plate Colombia/Mercosur/Chile,
   *     year 1900..next, make/model/fleetId obligatorios
   *   - filtro por fleetId (dropdown con fleets registrados en la MISMA instance)
   *   - data-testid en TODOS los botones/inputs/filas para e2e
   *
   * Importante: `client:only="svelte"` desde la página Astro — replica el patrón
   * W11.04 (drivers) y W11.01 (fleets) para evitar SSR workerd.
   *
   * Props (Svelte 5 runes):
   *   - instanceId: string — namespace para isolation (default: domainConfig.instanceId).
   */
  import { onMount } from 'svelte';
  import {
    createVehicle,
    listVehicles,
    updateVehicle,
    deleteVehicle,
    VEHICLE_STATUSES,
    validateVIN,
    validatePlate,
    normalizePlate,
    validateVehicleFields,
    type VehicleRecord,
    type VehicleFields,
    type VehicleStatus,
  } from '../../lib/vehicle.js';

  interface Props {
    instanceId?: string;
  }

  let { instanceId = DEFAULT_INSTANCE_ID }: Props = $props();

  // ── State (runes) ────────────────────────────────────────────────────────────
  let vehicles: VehicleRecord[] = $state([]);
  let loading = $state(true);
  let showForm = $state(false);
  let editingId: string | null = $state(null);
  let formError = $state('');
  let fleetFilter: string = $state('all'); // 'all' | fleetId

  // Form fields
  let formPlate = $state('');
  let formVin = $state('');
  let formMake = $state('');
  let formModel = $state('');
  let formYear = $state<number | ''>('');
  let formStatus: VehicleStatus = $state('active');
  let formFleetId = $state('');
  let formType = $state('');
  let formCapacity = $state<string>('');
  let formSoatExpiry = $state('');
  let formTecnoExpiry = $state('');
  let formPhotoUrl = $state('');

  // ── Derived ──────────────────────────────────────────────────────────────────
  let totalVehicles = $derived(vehicles.length);

  let distinctFleetIds: string[] = $derived.by(() => {
    const set = new Set<string>();
    for (const v of vehicles) {
      if (v.fleetId) set.add(v.fleetId);
    }
    return Array.from(set).sort();
  });

  let visibleVehicles: VehicleRecord[] = $derived.by(() => {
    if (fleetFilter === 'all') return vehicles;
    return vehicles.filter((v) => v.fleetId === fleetFilter);
  });

  let countByStatus: Record<VehicleStatus, number> = $derived.by(() => {
    const counts: Record<VehicleStatus, number> = {
      active: 0,
      maintenance: 0,
      decommissioned: 0,
    };
    for (const v of vehicles) counts[v.status] += 1;
    return counts;
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  async function refresh(): Promise<void> {
    vehicles = await listVehicles(instanceId);
    loading = false;
  }

  onMount(() => {
    refresh();
  });

  // ── Form helpers ────────────────────────────────────────────────────────────
  function resetForm(): void {
    formPlate = '';
    formVin = '';
    formMake = '';
    formModel = '';
    formYear = '';
    formStatus = 'active';
    formFleetId = '';
    formType = '';
    formCapacity = '';
    formSoatExpiry = '';
    formTecnoExpiry = '';
    formPhotoUrl = '';
    formError = '';
    editingId = null;
  }

  function openCreate(): void {
    resetForm();
    showForm = true;
  }

  function openEdit(v: VehicleRecord): void {
    editingId = v.id;
    formPlate = v.plate;
    formVin = v.vin;
    formMake = v.make;
    formModel = v.model;
    formYear = v.year;
    formStatus = v.status;
    formFleetId = v.fleetId;
    formType = v.type ?? '';
    formCapacity = v.capacity ?? '';
    formSoatExpiry = (v.soatExpiry ?? '').slice(0, 10);
    formTecnoExpiry = (v.tecnoExpiry ?? '').slice(0, 10);
    formPhotoUrl = v.photoUrl ?? '';
    formError = '';
    showForm = true;
  }

  function closeForm(): void {
    showForm = false;
    resetForm();
  }

  async function submitForm(ev: SubmitEvent): Promise<void> {
    ev.preventDefault();
    // Normalización + validación vía validateVehicleFields (single source of truth)
    const candidate: Partial<VehicleFields> = {
      plate: normalizePlate(formPlate),
      vin: formVin.trim().toUpperCase(),
      make: formMake.trim(),
      model: formModel.trim(),
      year: typeof formYear === 'number' ? formYear : Number(formYear),
      status: formStatus,
      fleetId: formFleetId.trim(),
      type: formType.trim() || undefined,
      capacity: formCapacity.trim() || undefined,
      soatExpiry: formSoatExpiry.trim() || undefined,
      tecnoExpiry: formTecnoExpiry.trim() || undefined,
      photoUrl: formPhotoUrl.trim() || undefined,
    };
    const result = validateVehicleFields(candidate);
    if (!result.ok) {
      formError = result.errors.join(' · ');
      return;
    }
    // cast: validateVehicleFields garantiza que los obligatorios están presentes
    const payload = candidate as VehicleFields;
    try {
      if (editingId) {
        await updateVehicle(editingId, payload, instanceId);
      } else {
        await createVehicle(payload, instanceId);
      }
      closeForm();
      await refresh();
    } catch (e) {
      formError = e instanceof Error ? e.message : String(e);
    }
  }

  async function handleDelete(v: VehicleRecord): Promise<void> {
    try {
      const ok = await deleteVehicle(v.id, instanceId);
      if (!ok) {
        formError = `No se pudo borrar el vehículo ${v.plate}`;
        return;
      }
      if (editingId === v.id) closeForm();
      await refresh();
    } catch (e) {
      formError = e instanceof Error ? e.message : String(e);
    }
  }

  // ── UI helpers ──────────────────────────────────────────────────────────────
  function badgeClass(s: VehicleStatus): string {
    switch (s) {
      case 'active':
        return 'badge badge-active';
      case 'maintenance':
        return 'badge badge-maintenance';
      case 'decommissioned':
        return 'badge badge-decommissioned';
    }
  }

  function formatDate(iso: string | undefined): string {
    if (!iso) return '—';
    return iso.slice(0, 10);
  }

  // Pre-validación inline para feedback visual del usuario (UX, no bloquea).
  function liveVinOk(): boolean {
    const v = formVin.trim().toUpperCase();
    if (!v) return true; // vacío no es "error" hasta submit
    return validateVIN(v);
  }
  function livePlateOk(): boolean {
    const v = normalizePlate(formPlate);
    if (!v) return true;
    return validatePlate(v);
  }
</script>

<div class="vehicle-table-root" data-testid="vehicle-table-root">
  <header class="vehicle-header">
    <div>
      <h2 class="vehicle-title">Vehículos</h2>
      <p class="vehicle-subtitle">
        {totalVehicles} vehículo{totalVehicles === 1 ? '' : 's'} ·
        activos {countByStatus.active} ·
        mantenimiento {countByStatus.maintenance} ·
        baja {countByStatus.decommissioned}
      </p>
    </div>
    <button
      type="button"
      class="btn-primary"
      data-testid="vehicle-new-button"
      onclick={openCreate}
    >
      + Nuevo vehículo
    </button>
  </header>

  <div class="filter-bar" data-testid="vehicle-filter-bar">
    <label class="filter-label" for="vehicle-fleet-filter-select">
      <span>Filtrar por flota:</span>
      <select
        id="vehicle-fleet-filter-select"
        data-testid="vehicle-filter-select"
        bind:value={fleetFilter}
      >
        <option value="all">Todas ({totalVehicles})</option>
        {#each distinctFleetIds as fid (fid)}
          <option value={fid}>
            {fid} ({vehicles.filter((v) => v.fleetId === fid).length})
          </option>
        {/each}
      </select>
    </label>
    {#if fleetFilter !== 'all'}
      <button
        type="button"
        class="btn-ghost btn-mini"
        data-testid="vehicle-filter-clear"
        onclick={() => (fleetFilter = 'all')}
      >
        Limpiar filtro
      </button>
    {/if}
  </div>

  {#if showForm}
    <form class="vehicle-form" data-testid="vehicle-form" onsubmit={submitForm}>
      <h3>{editingId ? 'Editar vehículo' : 'Crear vehículo'}</h3>
      {#if formError}
        <p class="form-error" data-testid="vehicle-form-error">{formError}</p>
      {/if}
      <div class="form-grid">
        <label for="vform-plate">
          <span>Placa <small>(Chile ABCD-12 · carro ABC123 · moto ABC12D · Mercosur ABC1D23)</small></span>
          <input
            id="vform-plate"
            type="text"
            data-testid="vehicle-form-plate"
            bind:value={formPlate}
            required
            placeholder="ABC-123"
            class:invalid={!livePlateOk()}
          />
        </label>
        <label for="vform-vin">
          <span>VIN <small>(17 chars A-Z0-9 sin I/O/Q)</small></span>
          <input
            id="vform-vin"
            type="text"
            data-testid="vehicle-form-vin"
            bind:value={formVin}
            required
            placeholder="1HGCR2F83HA000000"
            maxlength="17"
            class:invalid={!liveVinOk()}
          />
        </label>
        <label for="vform-make">
          <span>Marca</span>
          <input
            id="vform-make"
            type="text"
            data-testid="vehicle-form-make"
            bind:value={formMake}
            required
            placeholder="Tesla"
          />
        </label>
        <label for="vform-model">
          <span>Modelo</span>
          <input
            id="vform-model"
            type="text"
            data-testid="vehicle-form-model"
            bind:value={formModel}
            required
            placeholder="Model 3"
          />
        </label>
        <label for="vform-year">
          <span>Año</span>
          <input
            id="vform-year"
            type="number"
            data-testid="vehicle-form-year"
            bind:value={formYear}
            required
            min="1900"
            max={new Date().getFullYear() + 1}
            placeholder="2024"
          />
        </label>
        <label for="vform-status">
          <span>Status</span>
          <select id="vform-status" data-testid="vehicle-form-status" bind:value={formStatus}>
            {#each VEHICLE_STATUSES as s}
              <option value={s}>{s}</option>
            {/each}
          </select>
        </label>
        <label for="vform-fleet-id">
          <span>ID de flota</span>
          <input
            id="vform-fleet-id"
            type="text"
            data-testid="vehicle-form-fleet-id"
            bind:value={formFleetId}
            required
            placeholder="fleet_1"
          />
        </label>
        <label for="vform-type">
          <span>Tipo</span>
          <input
            id="vform-type"
            type="text"
            data-testid="vehicle-form-type"
            bind:value={formType}
            placeholder="sedan / truck / bus"
          />
        </label>
        <label for="vform-capacity">
          <span>Capacidad</span>
          <input
            id="vform-capacity"
            type="text"
            data-testid="vehicle-form-capacity"
            bind:value={formCapacity}
            maxlength="40"
            placeholder="5 Pax / 10 Ton"
          />
        </label>
        <label for="vform-soat">
          <span>Vencimiento SOAT</span>
          <input
            id="vform-soat"
            type="date"
            data-testid="vehicle-form-soat"
            bind:value={formSoatExpiry}
          />
        </label>
        <label for="vform-tecno">
          <span>Vencimiento Tecnomecánica</span>
          <input
            id="vform-tecno"
            type="date"
            data-testid="vehicle-form-tecno"
            bind:value={formTecnoExpiry}
          />
        </label>
        <label for="vform-photo" class="full-width">
          <span>URL foto</span>
          <input
            id="vform-photo"
            type="url"
            data-testid="vehicle-form-photo"
            bind:value={formPhotoUrl}
            placeholder="https://…/foto.jpg"
          />
        </label>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn-primary" data-testid="vehicle-form-submit">
          {editingId ? 'Guardar cambios' : 'Crear'}
        </button>
        <button type="button" class="btn-ghost" onclick={closeForm}>Cancelar</button>
      </div>
    </form>
  {/if}

  <div class="table-wrapper">
    <table class="vehicle-table" data-testid="vehicle-table">
      <thead>
        <tr>
          <th>Foto</th>
          <th>Placa</th>
          <th>VIN</th>
          <th>Marca</th>
          <th>Modelo</th>
          <th>Año</th>
          <th>Fleet</th>
          <th>Status</th>
          <th class="actions">Acciones</th>
        </tr>
      </thead>
      <tbody data-testid="vehicle-tbody">
        {#if loading}
          <tr>
            <td colspan="9" class="empty-row">Cargando…</td>
          </tr>
        {:else if visibleVehicles.length === 0}
          <tr>
            <td colspan="9" class="empty-row" data-testid="vehicle-empty">
              {#if fleetFilter === 'all'}
                No hay vehículos registrados. Crea el primero con "+ Nuevo vehículo".
              {:else}
                No hay vehículos en la flota "{fleetFilter}".
              {/if}
            </td>
          </tr>
        {:else}
          {#each visibleVehicles as v (v.id)}
            <tr data-testid="vehicle-row" data-vehicle-id={v.id} data-fleet-id={v.fleetId}>
              <td class="photo-cell">
                {#if v.photoUrl}
                  <img
                    src={v.photoUrl}
                    alt={`Foto ${v.plate}`}
                    class="photo-thumb"
                    data-testid="vehicle-photo-thumb"
                    loading="lazy"
                    onerror={(ev) => {
                      const img = ev.currentTarget as HTMLImageElement;
                      img.style.display = 'none';
                    }}
                  />
                {:else}
                  <span class="photo-placeholder" data-testid="vehicle-photo-placeholder">—</span>
                {/if}
              </td>
              <td class="plate-cell">{v.plate}</td>
              <td class="vin-cell"><code>{v.vin}</code></td>
              <td>{v.make}</td>
              <td>{v.model}</td>
              <td>{v.year}</td>
              <td>{v.fleetId || '—'}</td>
              <td>
                <span
                  class={badgeClass(v.status)}
                  data-testid="vehicle-status-badge"
                  data-status={v.status}
                >
                  {v.status}
                </span>
                {#if v.soatExpiry}
                  <small class="meta">SOAT {formatDate(v.soatExpiry)}</small>
                {/if}
                {#if v.tecnoExpiry}
                  <small class="meta">Tecno {formatDate(v.tecnoExpiry)}</small>
                {/if}
              </td>
              <td class="actions">
                <button
                  type="button"
                  class="btn-ghost btn-mini"
                  data-testid="vehicle-edit-button"
                  aria-label={`Editar vehículo ${v.plate}`}
                  onclick={() => openEdit(v)}
                >
                  Editar
                </button>
                <button
                  type="button"
                  class="btn-danger"
                  data-testid="vehicle-delete-button"
                  aria-label={`Borrar vehículo ${v.plate}`}
                  onclick={() => handleDelete(v)}
                >
                  Borrar
                </button>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>

<style>
  .vehicle-table-root {
    background: var(--swal-surface);
    border: 1px solid var(--swal-border);
    border-radius: var(--swal-radius-lg);
    padding: 1.25rem;
    color: var(--swal-text);
    font-family: var(--swal-font);
  }
  .vehicle-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .vehicle-title {
    font-size: 1.25rem;
    margin: 0;
    color: var(--swal-text);
  }
  .vehicle-subtitle {
    margin: 0.25rem 0 0;
    color: var(--swal-text-secondary);
    font-size: var(--swal-font-size-sm);
  }
  .filter-bar {
    margin-bottom: 1rem;
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .filter-label {
    display: inline-flex;
    gap: 0.5rem;
    align-items: center;
    color: var(--swal-text-secondary);
    font-size: var(--swal-font-size-sm);
  }
  .filter-label select,
  .vehicle-form select,
  .vehicle-form input {
    background: var(--swal-void);
    color: var(--swal-text);
    border: 1px solid var(--swal-border-light);
    border-radius: var(--swal-radius-sm);
    padding: 0.5rem 0.75rem;
    font-family: var(--swal-font);
  }
  .vehicle-form input.invalid {
    border-color: var(--swal-danger, #ef4444);
    outline: 1px solid var(--swal-danger, #ef4444);
  }
  .table-wrapper {
    overflow-x: auto;
    border: 1px solid var(--swal-border);
    border-radius: var(--swal-radius);
  }
  .vehicle-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--swal-font-size-sm);
  }
  .vehicle-table thead th {
    background: var(--swal-elevated-850, #151e2e);
    color: var(--swal-text-secondary);
    text-align: left;
    padding: 0.75rem 1rem;
    font-weight: 600;
    border-bottom: 1px solid var(--swal-border);
    white-space: nowrap;
  }
  .vehicle-table tbody td {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--swal-border);
    vertical-align: middle;
  }
  .vehicle-table tbody tr:hover {
    background: var(--swal-surface-hover);
  }
  .plate-cell {
    font-family: var(--swal-font-mono, monospace);
    font-weight: 600;
    color: var(--swal-text);
  }
  .vin-cell code {
    font-family: var(--swal-font-mono, monospace);
    font-size: var(--swal-font-size-xs, 0.75rem);
    color: var(--swal-text-secondary);
  }
  .photo-cell {
    width: 64px;
  }
  .photo-thumb {
    width: 48px;
    height: 48px;
    object-fit: cover;
    border-radius: var(--swal-radius-sm, 4px);
    border: 1px solid var(--swal-border-light);
    display: block;
  }
  .photo-placeholder {
    display: inline-block;
    width: 48px;
    height: 48px;
    line-height: 48px;
    text-align: center;
    color: var(--swal-text-muted);
    background: var(--swal-void, #0a0a0a);
    border: 1px dashed var(--swal-border-light);
    border-radius: var(--swal-radius-sm, 4px);
    font-size: var(--swal-font-size-xs, 0.75rem);
  }
  .meta {
    display: block;
    color: var(--swal-text-muted);
    font-size: var(--swal-font-size-xs, 0.7rem);
    margin-top: 0.15rem;
  }
  .actions {
    text-align: right;
    white-space: nowrap;
  }
  .empty-row {
    text-align: center;
    color: var(--swal-text-muted);
    padding: 2rem 1rem !important;
  }
  .badge {
    display: inline-block;
    padding: 0.15rem 0.6rem;
    border-radius: 9999px;
    font-size: var(--swal-font-size-xs);
    font-family: var(--swal-font-mono);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .badge-active {
    background: rgba(34, 197, 94, 0.15);
    color: rgb(74, 222, 128);
    border: 1px solid rgba(34, 197, 94, 0.4);
  }
  .badge-maintenance {
    background: rgba(234, 179, 8, 0.15);
    color: rgb(250, 204, 21);
    border: 1px solid rgba(234, 179, 8, 0.4);
  }
  .badge-decommissioned {
    background: rgba(239, 68, 68, 0.12);
    color: rgb(248, 113, 113);
    border: 1px solid rgba(239, 68, 68, 0.4);
  }
  .btn-primary,
  .btn-ghost,
  .btn-danger {
    border: 1px solid var(--swal-border-light);
    border-radius: var(--swal-radius-sm);
    padding: 0.4rem 0.85rem;
    font-size: var(--swal-font-size-sm);
    cursor: pointer;
    transition: filter 120ms ease;
  }
  .btn-mini {
    padding: 0.25rem 0.55rem;
    font-size: var(--swal-font-size-xs);
  }
  .btn-primary {
    background: var(--swal-accent);
    color: var(--swal-text-inverse);
    border-color: var(--swal-accent);
  }
  .btn-primary:hover {
    filter: brightness(1.08);
  }
  .btn-ghost {
    background: transparent;
    color: var(--swal-text);
  }
  .btn-ghost:hover {
    background: var(--swal-surface-hover);
  }
  .btn-danger {
    background: transparent;
    color: var(--swal-danger);
    border-color: rgba(239, 68, 68, 0.4);
  }
  .btn-danger:hover {
    background: rgba(239, 68, 68, 0.12);
  }
  .vehicle-form {
    background: var(--swal-elevated);
    border: 1px solid var(--swal-border-light);
    border-radius: var(--swal-radius);
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
    display: grid;
    gap: 0.75rem;
  }
  .vehicle-form h3 {
    margin: 0;
    color: var(--swal-text);
    font-size: 1rem;
  }
  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.75rem;
  }
  .vehicle-form label {
    display: grid;
    gap: 0.25rem;
    color: var(--swal-text-secondary);
    font-size: var(--swal-font-size-sm);
  }
  .vehicle-form label.full-width {
    grid-column: 1 / -1;
  }
  .vehicle-form small {
    color: var(--swal-text-muted);
    font-size: 0.7rem;
    margin-left: 0.25rem;
  }
  .vehicle-form input:focus,
  .vehicle-form select:focus {
    outline: 1px solid var(--swal-accent);
    border-color: var(--swal-accent);
  }
  .form-actions {
    display: flex;
    gap: 0.5rem;
  }
  .form-error {
    color: var(--swal-danger);
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.4);
    border-radius: var(--swal-radius-sm);
    padding: 0.5rem 0.75rem;
    margin: 0;
    font-size: var(--swal-font-size-sm);
  }
</style>