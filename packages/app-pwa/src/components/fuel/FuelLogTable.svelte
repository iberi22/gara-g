<script lang="ts">
  import { DEFAULT_INSTANCE_ID } from '../../lib/domain.config';
  import { onMount } from 'svelte';
  import { listEntities, createEntity, deleteEntity } from '../../lib/domain';
  import { computeKmPerGallon, type FuelLogData, type FuelLogRecord } from '../../lib/fuelLog';
  import { toast } from '../../lib/toast';

  interface Props {
    instanceId?: string;
  }

  let { instanceId = DEFAULT_INSTANCE_ID }: Props = $props();

  let logs: FuelLogRecord[] = $state([]);
  let loading: boolean = $state(true);
  // Un fallo de carga NO es "no hay registros": se distingue y se puede reintentar.
  let loadError: string = $state('');
  // Envio en vuelo: bloquea el doble clic / doble Enter (si no, se crean dos registros).
  let saving: boolean = $state(false);
  let filterVehicleId: string = $state('');

  // New record form state
  let vehicleId: string = $state('');
  let driverId: string = $state('');
  let date: string = $state(new Date().toISOString().slice(0, 10));
  let km: number | '' = $state('');
  let gallons: number | '' = $state('');
  let cost: number | '' = $state('');
  let station: string = $state('');
  let formError: string = $state('');

  async function loadLogs() {
    loading = true;
    loadError = '';
    try {
      const raw = await listEntities<FuelLogData>('fuelLog', instanceId);
      logs = computeKmPerGallon(raw);
    } catch (err) {
      loadError = err instanceof Error && err.message ? err.message : 'error desconocido';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadLogs();
  });

  async function handleCreate(e: Event) {
    e.preventDefault();
    if (saving) return;
    formError = '';

    if (!vehicleId || !driverId || !date || km === '' || gallons === '' || cost === '') {
      formError = 'Por favor completa todos los campos requeridos.';
      return;
    }

    saving = true;
    try {
      await createEntity(
        'fuelLog',
        {
          vehicleId,
          driverId,
          date,
          km: Number(km),
          gallons: Number(gallons),
          cost: Number(cost),
          station: station || 'Estación General',
          kmPerGallon: 0,
        },
        instanceId
      );

      // Reset form fields
      vehicleId = '';
      driverId = '';
      date = new Date().toISOString().slice(0, 10);
      km = '';
      gallons = '';
      cost = '';
      station = '';

      await loadLogs();
    } catch {
      formError = 'Error al guardar la bitácora de combustible.';
    } finally {
      saving = false;
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este registro de combustible?')) return;
    try {
      await deleteEntity('fuelLog', id, instanceId);
      await loadLogs();
    } catch {
      toast.show('No se pudo eliminar el registro de combustible.', { type: 'error' });
    }
  }

  // Derived filtered & DESC sorted logs
  let filteredLogs = $derived(
    logs
      .filter((log) => {
        if (!filterVehicleId.trim()) return true;
        return (log.vehicleId || '').toLowerCase().includes(filterVehicleId.trim().toLowerCase());
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  );
</script>

<div class="fuel-container space-y-6">
  <div class="header flex justify-between items-center">
    <div>
      <h2 class="text-2xl font-bold text-[var(--swal-text)]">Bitácora de Combustible</h2>
      <p class="text-sm text-[var(--swal-text-muted)]">Control de consumos y rendimiento km/galón</p>
    </div>
  </div>

  <!-- Create Record Form -->
  <div class="bg-[var(--swal-surface)] border border-[var(--swal-border)] p-4 rounded-xl">
    <h2 class="text-lg font-semibold text-[var(--swal-accent-text)] mb-3">➕ Nuevo Registro de Carga</h2>
    {#if formError}
      <div role="alert" class="bg-[var(--swal-danger-bg)] border border-[var(--swal-danger)] text-[var(--swal-danger)] p-2 text-sm rounded mb-3">
        {formError}
      </div>
    {/if}
    <form onsubmit={handleCreate} class="grid grid-cols-1 md:grid-cols-4 gap-3">
      <div>
        <label for="vehicleId" class="block text-xs font-medium text-[var(--swal-text-muted)] mb-1">Vehículo ID *</label>
        <input
          id="vehicleId"
          type="text"
          data-testid="input-vehicleId"
          bind:value={vehicleId}
          placeholder="ej. V-101"
          class="w-full bg-[var(--swal-bg)] border border-[var(--swal-border)] rounded px-2.5 py-1.5 text-sm text-[var(--swal-text)]"
          required
        />
      </div>
      <div>
        <label for="driverId" class="block text-xs font-medium text-[var(--swal-text-muted)] mb-1">Conductor ID *</label>
        <input
          id="driverId"
          type="text"
          data-testid="input-driverId"
          bind:value={driverId}
          placeholder="ej. D-501"
          class="w-full bg-[var(--swal-bg)] border border-[var(--swal-border)] rounded px-2.5 py-1.5 text-sm text-[var(--swal-text)]"
          required
        />
      </div>
      <div>
        <label for="date" class="block text-xs font-medium text-[var(--swal-text-muted)] mb-1">Fecha *</label>
        <input
          id="date"
          type="date"
          data-testid="input-date"
          bind:value={date}
          class="w-full bg-[var(--swal-bg)] border border-[var(--swal-border)] rounded px-2.5 py-1.5 text-sm text-[var(--swal-text)]"
          required
        />
      </div>
      <div>
        <label for="km" class="block text-xs font-medium text-[var(--swal-text-muted)] mb-1">Kilometraje (km) *</label>
        <input
          id="km"
          type="number"
          data-testid="input-km"
          bind:value={km}
          placeholder="15000"
          class="w-full bg-[var(--swal-bg)] border border-[var(--swal-border)] rounded px-2.5 py-1.5 text-sm text-[var(--swal-text)]"
          required
        />
      </div>
      <div>
        <label for="gallons" class="block text-xs font-medium text-[var(--swal-text-muted)] mb-1">Galones *</label>
        <input
          id="gallons"
          type="number"
          step="0.01"
          data-testid="input-gallons"
          bind:value={gallons}
          placeholder="12.5"
          class="w-full bg-[var(--swal-bg)] border border-[var(--swal-border)] rounded px-2.5 py-1.5 text-sm text-[var(--swal-text)]"
          required
        />
      </div>
      <div>
        <label for="cost" class="block text-xs font-medium text-[var(--swal-text-muted)] mb-1">Costo Total ($) *</label>
        <input
          id="cost"
          type="number"
          data-testid="input-cost"
          bind:value={cost}
          placeholder="150000"
          class="w-full bg-[var(--swal-bg)] border border-[var(--swal-border)] rounded px-2.5 py-1.5 text-sm text-[var(--swal-text)]"
          required
        />
      </div>
      <div>
        <label for="station" class="block text-xs font-medium text-[var(--swal-text-muted)] mb-1">Estación</label>
        <input
          id="station"
          type="text"
          data-testid="input-station"
          bind:value={station}
          placeholder="Terpel Av. El Dorado"
          class="w-full bg-[var(--swal-bg)] border border-[var(--swal-border)] rounded px-2.5 py-1.5 text-sm text-[var(--swal-text)]"
        />
      </div>
      <div class="flex items-end">
        <button
          type="submit"
          data-testid="btn-submit-fuel"
          disabled={saving}
          aria-busy={saving}
          class="w-full bg-[var(--swal-accent)] hover:bg-[var(--swal-accent-hover)] text-[var(--swal-accent-contrast)] font-medium px-4 py-1.5 rounded text-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {saving ? 'Guardando…' : 'Guardar Carga'}
        </button>
      </div>
    </form>
  </div>

  <!-- Filter & Actions Bar -->
  <div class="flex flex-wrap items-center justify-between gap-4 bg-[var(--swal-bg-surface)] p-3 rounded-lg border border-[var(--swal-border)]">
    <div class="flex items-center gap-2">
      <label for="filterVehicleId" class="text-xs text-[var(--swal-text-muted)] font-medium">Filtrar por Vehículo:</label>
      <input
        id="filterVehicleId"
        type="text"
        data-testid="filter-vehicle-input"
        bind:value={filterVehicleId}
        placeholder="Buscar ID de vehículo..."
        class="bg-[var(--swal-surface)] border border-[var(--swal-border)] rounded px-3 py-1 text-sm text-[var(--swal-text)] focus:outline-none focus:border-[var(--swal-accent)]"
      />
    </div>
    <div class="text-xs text-[var(--swal-text-muted)]">
      Mostrando <span class="text-[var(--swal-accent-text)] font-bold">{filteredLogs.length}</span> registros
    </div>
  </div>

  <!-- Table Container -->
  <div class="bg-[var(--swal-surface)] border border-[var(--swal-border)] rounded-xl overflow-hidden shadow-lg" data-testid="fuel-table">
    <div class="overflow-x-auto" role="region" aria-label="Registros de combustible" tabindex="0">
      <table class="w-full text-left text-sm text-[var(--swal-text)]">
        <caption class="sr-only">Registros de combustible</caption>
        <thead class="bg-[var(--swal-bg-surface)] text-xs uppercase tracking-wider text-[var(--swal-text-muted)] border-b border-[var(--swal-border)]">
          <tr>
            <th scope="col" class="p-3">Vehículo ID</th>
            <th scope="col" class="p-3">Conductor ID</th>
            <th scope="col" class="p-3">Fecha</th>
            <th scope="col" class="p-3 text-right">Km</th>
            <th scope="col" class="p-3 text-right">Galones</th>
            <th scope="col" class="p-3 text-right">Costo</th>
            <th scope="col" class="p-3">Estación</th>
            <th scope="col" class="p-3 text-right text-[var(--swal-accent-text)] font-bold">Km/Galón</th>
            <th scope="col" class="p-3 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[var(--swal-border-light)]">
          {#if loading}
            <tr>
              <td colspan="9" class="p-6 text-center text-[var(--swal-text-muted)]">Cargando registros de combustible...</td>
            </tr>
          {:else if loadError}
            <tr>
              <td colspan="9" class="p-6 text-center text-[var(--swal-danger)]" role="alert" data-testid="fuel-load-error">
                No se pudieron cargar los registros de combustible ({loadError}).
                <button
                  type="button"
                  data-testid="btn-retry-fuel"
                  onclick={loadLogs}
                  class="ml-2 text-xs px-2 py-1 rounded border border-[var(--swal-danger)] text-[var(--swal-danger)] hover:bg-[var(--swal-danger-bg)]"
                >
                  Reintentar
                </button>
              </td>
            </tr>
          {:else if filteredLogs.length === 0}
            <tr>
              <td colspan="9" class="p-6 text-center text-[var(--swal-text-muted)]">No hay registros de combustible disponibles.</td>
            </tr>
          {:else}
            {#each filteredLogs as log (log.id)}
              <tr class="hover:bg-[var(--swal-hover-bg)] transition-colors" data-testid="fuel-row">
                <td class="p-3 font-mono text-[var(--swal-accent-text)] font-medium" data-testid="col-vehicleId">{log.vehicleId}</td>
                <td class="p-3 font-mono text-[var(--swal-text-muted)]">{log.driverId}</td>
                <td class="p-3 text-[var(--swal-text)]" data-testid="col-date">{log.date}</td>
                <td class="p-3 text-right font-mono">{log.km?.toLocaleString()} km</td>
                <td class="p-3 text-right font-mono">{log.gallons} gal</td>
                <td class="p-3 text-right font-mono">${log.cost?.toLocaleString()}</td>
                <td class="p-3 text-[var(--swal-text-muted)]">{log.station || '—'}</td>
                <td class="p-3 text-right font-mono text-[var(--swal-accent-text)] font-bold" data-testid="col-kmPerGallon">
                  {log.kmPerGallon > 0 ? log.kmPerGallon.toFixed(2) : '—'}
                </td>
                <td class="p-3 text-right">
                  <button
                    data-testid="btn-delete-fuel"
                    onclick={() => handleDelete(log.id)}
                    class="text-[var(--swal-danger)] hover:text-[var(--swal-danger)] text-xs px-2 py-1 rounded bg-[var(--swal-danger-bg)] border border-[var(--swal-danger)]"
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
