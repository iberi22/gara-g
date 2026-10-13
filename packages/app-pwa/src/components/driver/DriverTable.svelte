<script lang="ts">
  import { DEFAULT_INSTANCE_ID } from '../../lib/domain.config';
  import { onMount } from 'svelte';
  import {
    createEntity,
    listEntities,
    updateEntity,
    deleteEntity,
    type DomainRecord,
  } from '../../lib/domain.js';
  import { computeDriverStatus, formatDriverId, type DriverData } from '../../lib/driver.js';
  import { MARKET } from '../../lib/market.js';

  export let instanceId: string = DEFAULT_INSTANCE_ID;

  type DriverRecord = DomainRecord<DriverData>;

  let drivers: DriverRecord[] = [];
  let statusFilter: string = 'all';
  let showForm: boolean = false;
  let isEditing: boolean = false;
  let editingId: string | null = null;
  let assignVehicleDriverId: string | null = null;
  let newVehicleIdInput: string = '';
  // Mensaje visible del formulario y envio en vuelo (bloquea el doble envio).
  let formError: string = '';
  let saving: boolean = false;

  let formData: DriverData = {
    name: '',
    cedula: '',
    licenseCategory: MARKET.truckLicenseClass,
    licenseExpiry: new Date(Date.now() + 365 * 86400 * 1000).toISOString().slice(0, 10),
    phone: '',
    status: 'active',
    fleetId: 'fleet-default',
    vehicleId: '',
  };

  async function loadDrivers() {
    try {
      const records = await listEntities('driver', instanceId);
      drivers = records as DriverRecord[];
    } catch (e) {
      console.error('Error loading drivers:', e);
    }
  }

  onMount(() => {
    loadDrivers();
  });

  function resetForm() {
    formData = {
      name: '',
      cedula: '',
      licenseCategory: MARKET.truckLicenseClass,
      licenseExpiry: new Date(Date.now() + 365 * 86400 * 1000).toISOString().slice(0, 10),
      phone: '',
      status: 'active',
      fleetId: 'fleet-default',
      vehicleId: '',
    };
    isEditing = false;
    editingId = null;
    showForm = false;
    formError = '';
  }

  function openCreateForm() {
    resetForm();
    showForm = true;
  }

  function openEditForm(driver: DriverRecord) {
    formData = {
      name: driver.name || '',
      cedula: driver.cedula || '',
      licenseCategory: driver.licenseCategory || MARKET.truckLicenseClass,
      licenseExpiry: driver.licenseExpiry || '',
      phone: driver.phone || '',
      status: driver.status || 'active',
      fleetId: driver.fleetId || '',
      vehicleId: driver.vehicleId || '',
    };
    editingId = driver.id;
    isEditing = true;
    showForm = true;
  }

  async function handleSubmit() {
    if (saving) return;
    if (!formData.name?.trim() || !formData.cedula?.trim()) {
      formError = `Completa el nombre y ${MARKET.driverIdLabel === 'RUT' ? 'el RUT' : 'la cédula'} del conductor.`;
      return;
    }
    formError = '';
    saving = true;
    try {
      if (isEditing && editingId) {
        await updateEntity('driver', editingId, formData as unknown as Record<string, unknown>, instanceId);
      } else {
        await createEntity('driver', formData as unknown as Record<string, unknown>, instanceId);
      }

      resetForm();
      await loadDrivers();
    } catch {
      formError = 'No se pudo guardar el conductor. Inténtalo de nuevo.';
    } finally {
      saving = false;
    }
  }

  async function handleSuspend(driver: DriverRecord) {
    if (!confirm(`¿Suspender al conductor ${driver.name}?`)) return;
    const driverId = driver.id;
    await updateEntity('driver', driverId, { status: 'suspended' }, instanceId);
    await loadDrivers();
  }

  function startAssignVehicle(driver: DriverRecord) {
    assignVehicleDriverId = driver.id;
    newVehicleIdInput = driver.vehicleId || '';
  }

  async function saveVehicleAssignment(driverId: string) {
    await updateEntity('driver', driverId, { vehicleId: newVehicleIdInput }, instanceId);
    assignVehicleDriverId = null;
    newVehicleIdInput = '';
    await loadDrivers();
  }

  async function handleDelete(driver: DriverRecord) {
    if (!confirm(`¿Eliminar al conductor ${driver.name}? Esta acción no se puede deshacer.`)) return;
    const driverId = driver.id;
    await deleteEntity('driver', driverId, instanceId);
    await loadDrivers();
  }

  $: filteredDrivers = drivers.filter((d) => {
    const computedStatus = computeDriverStatus(d);
    if (statusFilter === 'all') return true;
    return computedStatus === statusFilter;
  });
</script>

<div class="space-y-6">
  <!-- Controls bar: Filter & Add button -->
  <div class="flex flex-wrap items-center justify-between gap-4 bg-[var(--g-bg-surface)] p-4 rounded-[var(--g-radius-lg)] border border-[var(--g-border-subtle)]">
    <div class="flex items-center gap-3">
      <label for="status-filter-select" class="text-xs font-semibold text-[var(--g-text-muted)] uppercase tracking-wider">
        Filtrar por Estado:
      </label>
      <select
        id="status-filter-select"
        data-testid="status-filter"
        bind:value={statusFilter}
        class="g-select px-3 py-1.5 text-sm bg-[var(--g-bg-elevated)] border border-[var(--g-border-subtle)] rounded-[var(--g-radius-md)] text-[var(--g-text-primary)]"
      >
        <option value="all">Todos ({drivers.length})</option>
        <option value="active">Activos</option>
        <option value="on_leave">En Licencia</option>
        <option value="suspended">Suspendidos</option>
        <option value="expired">Licencia Vencida</option>
      </select>
    </div>

    <button
      data-testid="add-driver-btn"
      on:click={openCreateForm}
      class="g-btn g-btn-primary flex items-center gap-2"
    >
      <span>+</span> Nuevo Conductor
    </button>
  </div>

  <!-- Inline Form Modal / Panel -->
  {#if showForm}
    <div
      data-testid="driver-form"
      class="p-6 bg-[var(--g-bg-surface)] border border-[var(--g-border-accent-strong)] rounded-[var(--g-radius-xl)] space-y-4"
    >
      <div class="flex justify-between items-center border-b border-[var(--g-border-subtle)] pb-3">
        <h3 class="text-lg font-bold text-[var(--g-text-primary)]">
          {isEditing ? 'Editar Conductor' : 'Nuevo Conductor'}
        </h3>
        <button
          type="button"
          data-testid="cancel-driver-btn"
          on:click={resetForm}
          class="text-[var(--g-text-muted)] hover:text-[var(--g-text-primary)] text-sm"
        >
          ✕ Cancelar
        </button>
      </div>

      {#if formError}
        <p role="alert" data-testid="driver-form-error" class="text-sm text-[var(--g-accent-red)]">{formError}</p>
      {/if}

      <form on:submit|preventDefault={handleSubmit} class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label class="g-label" for="driver-input-name">Nombre Completo *</label>
          <input
            id="driver-input-name"
            type="text"
            data-testid="input-name"
            required
            bind:value={formData.name}
            placeholder="Ej: Carlos Mendoza"
            class="g-input mt-1"
          />
        </div>

        <div>
          <label class="g-label" for="driver-input-cedula">{MARKET.driverIdLabel} / Documento *</label>
          <input
            id="driver-input-cedula"
            type="text"
            data-testid="input-cedula"
            required
            bind:value={formData.cedula}
            placeholder={MARKET.driverIdPlaceholder}
            class="g-input mt-1"
          />
          <p class="text-xs text-[var(--g-text-muted)] mt-1">{MARKET.driverIdHelp}</p>
        </div>

        <div>
          <label class="g-label" for="driver-input-licenseCategory">Categoría Licencia</label>
          <select
            id="driver-input-licenseCategory"
            data-testid="input-licenseCategory"
            bind:value={formData.licenseCategory}
            class="g-select mt-1"
          >
            {#each MARKET.licenseClasses as cls (cls.value)}
              <option value={cls.value}>{cls.label}</option>
            {/each}
          </select>
        </div>

        <div>
          <label class="g-label" for="driver-input-licenseExpiry">Vencimiento Licencia</label>
          <input
            id="driver-input-licenseExpiry"
            type="date"
            data-testid="input-licenseExpiry"
            bind:value={formData.licenseExpiry}
            class="g-input mt-1"
          />
        </div>

        <div>
          <label class="g-label" for="driver-input-phone">Teléfono / Celular</label>
          <input
            id="driver-input-phone"
            type="text"
            data-testid="input-phone"
            bind:value={formData.phone}
            placeholder="+56 9 0000 0000"
            class="g-input mt-1"
          />
        </div>

        <div>
          <label class="g-label" for="driver-input-status">Estado Operativo</label>
          <select
            id="driver-input-status"
            data-testid="input-status"
            bind:value={formData.status}
            class="g-select mt-1"
          >
            <option value="active">Activo</option>
            <option value="on_leave">En Licencia</option>
            <option value="suspended">Suspendido</option>
          </select>
        </div>

        <div>
          <label class="g-label" for="driver-input-fleetId">ID Flota</label>
          <input
            id="driver-input-fleetId"
            type="text"
            data-testid="input-fleetId"
            bind:value={formData.fleetId}
            placeholder="fleet-north"
            class="g-input mt-1"
          />
        </div>

        <div>
          <label class="g-label" for="driver-input-vehicleId">Vehículo Asignado (ID)</label>
          <input
            id="driver-input-vehicleId"
            type="text"
            data-testid="input-vehicleId"
            bind:value={formData.vehicleId}
            placeholder="veh-101"
            class="g-input mt-1"
          />
        </div>

        <div class="col-span-full flex justify-end gap-3 pt-3 border-t border-[var(--g-border-subtle)]">
          <button
            type="button"
            on:click={resetForm}
            class="g-btn"
          >
            Cancelar
          </button>
          <button
            type="submit"
            data-testid="submit-driver-btn"
            disabled={saving}
            class="g-btn g-btn-primary"
          >
            {isEditing ? 'Guardar Cambios' : 'Registrar Conductor'}
          </button>
        </div>
      </form>
    </div>
  {/if}

  <!-- Drivers Table -->
  <div class="g-table-wrap">
    <div class="g-table-scroll" role="region" aria-label="Conductores registrados" tabindex="0">
      <table class="g-table">
        <caption class="sr-only">Conductores registrados</caption>
        <thead>
          <tr>
            <th scope="col">Nombre</th>
            <th scope="col">{MARKET.driverIdLabel}</th>
            <th scope="col">Licencia</th>
            <th scope="col">Vencimiento</th>
            <th scope="col">Teléfono</th>
            <th scope="col">Estado</th>
            <th scope="col">Flota</th>
            <th scope="col">Vehículo</th>
            <th scope="col" class="text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {#each filteredDrivers as driver (driver.id)}
            {@const computedStatus = computeDriverStatus(driver)}
            <tr data-testid="driver-row" class="hover:bg-[var(--g-bg-surface)]">
              <td class="font-semibold" data-testid="driver-name">{driver.name}</td>
              <td class="g-mono text-xs">{formatDriverId(driver.cedula, MARKET)}</td>
              <td>
                <span class="g-pill g-pill-muted">{driver.licenseCategory || 'N/A'}</span>
              </td>
              <td class="g-mono text-xs">
                {driver.licenseExpiry || 'N/A'}
              </td>
              <td class="text-xs">{driver.phone || 'N/A'}</td>
              <td>
                <span
                  data-testid="driver-status"
                  class="g-pill {computedStatus === 'active'
                    ? 'g-pill'
                    : computedStatus === 'expired' || computedStatus === 'suspended'
                      ? 'g-pill-red'
                      : 'g-pill-yellow'}"
                >
                  {computedStatus === 'active'
                    ? 'Activo'
                    : computedStatus === 'expired'
                      ? 'Licencia Vencida'
                      : computedStatus === 'suspended'
                        ? 'Suspendido'
                        : 'En Licencia'}
                </span>
              </td>
              <td class="g-mono text-xs">{driver.fleetId || 'Sin asignación'}</td>
              <td class="g-mono text-xs">
                {#if assignVehicleDriverId === driver.id}
                  <div class="flex items-center gap-1">
                    <input
                      type="text"
                      bind:value={newVehicleIdInput}
                      aria-label={`ID del vehículo de ${driver.name}`}
                      placeholder="ID vehículo"
                      class="g-input py-0.5 px-1.5 text-xs w-28"
                    />
                    <button
                      type="button"
                      on:click={() => saveVehicleAssignment(driver.id)}
                      aria-label={`Guardar vehículo de ${driver.name}`}
                      class="text-xs text-[var(--g-accent-green)] hover:underline"
                    >
                      <span aria-hidden="true">✓</span>
                    </button>
                    <button
                      type="button"
                      on:click={() => (assignVehicleDriverId = null)}
                      aria-label={`Cancelar asignación de ${driver.name}`}
                      class="text-xs text-[var(--g-text-muted)] hover:underline"
                    >
                      <span aria-hidden="true">✕</span>
                    </button>
                  </div>
                {:else}
                  <span class="inline-flex items-center gap-2">
                    {driver.vehicleId || 'Sin vehículo'}
                    <button
                      type="button"
                      data-testid="assign-vehicle-btn"
                      on:click={() => startAssignVehicle(driver)}
                      title="Asignar / Cambiar vehículo"
                      aria-label={`Asignar vehículo a ${driver.name}`}
                      class="text-xs text-[var(--g-accent-cyan)] hover:underline"
                    >
                      <span aria-hidden="true">✏️</span>
                    </button>
                  </span>
                {/if}
              </td>
              <td class="text-right whitespace-nowrap">
                <div class="inline-flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="edit-driver-btn"
                    on:click={() => openEditForm(driver)}
                    class="g-btn text-xs py-1 px-2"
                  >
                    Editar
                  </button>

                  {#if driver.status !== 'suspended'}
                    <button
                      type="button"
                      data-testid="suspend-driver-btn"
                      on:click={() => handleSuspend(driver)}
                      class="g-btn text-xs py-1 px-2 text-[var(--g-accent-orange)] border-[var(--g-accent-orange)]/30 hover:bg-[var(--g-accent-orange)]/10"
                    >
                      Suspender
                    </button>
                  {/if}

                  <button
                    type="button"
                    data-testid="delete-driver-btn"
                    on:click={() => handleDelete(driver)}
                    class="g-btn text-xs py-1 px-2 text-[var(--g-accent-red)] border-[var(--g-accent-red)]/30 hover:bg-[var(--g-accent-red)]/10"
                  >
                    Eliminar
                  </button>
                </div>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="9" class="p-8 text-center text-[var(--g-text-muted)]">
                No se encontraron conductores en esta vista. Haga clic en <strong class="text-[var(--g-text-primary)]">+ Nuevo Conductor</strong> para registrar uno.
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>
