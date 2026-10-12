<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { createFleetStore } from '../lib/fleetStore.js';
  import type { Vehicle } from '../lib/yjsFleet.js';

  export let instanceId: string = 'default';
  export let fleetId: string = '';
  export let initialVehicle: Partial<Vehicle> | null = null;

  const dispatch = createEventDispatcher();
  const store = createFleetStore(instanceId);

  let id = initialVehicle?.id || `veh_${Math.random().toString(36).substr(2, 9)}`;
  let selectedFleetId = initialVehicle?.fleetId || fleetId;
  let vin = initialVehicle?.vin || '';
  let make = initialVehicle?.make || '';
  let model = initialVehicle?.model || '';
  let year = initialVehicle?.year || new Date().getFullYear();
  let status: 'active' | 'maintenance' | 'decommissioned' = initialVehicle?.status || 'active';
  let mileage = initialVehicle?.mileage || 0;

  function handleSubmit() {
    if (!vin || !make || !model || !selectedFleetId) {
      alert('Completa los campos obligatorios (VIN, marca, modelo, ID de flota)');
      return;
    }

    if (initialVehicle?.id) {
      store.updateVehicle(id, {
        fleetId: selectedFleetId,
        vin,
        make,
        model,
        year,
        status,
        mileage,
      });
    } else {
      store.addVehicle({
        id,
        fleetId: selectedFleetId,
        vin,
        make,
        model,
        year,
        status,
        mileage,
      });
    }

    dispatch('saved', { id });
  }
</script>

<form on:submit|preventDefault={handleSubmit} class="vehicle-form border p-4 rounded space-y-4 max-w-lg bg-card text-card-foreground">
  <h3 class="text-lg font-bold">{initialVehicle?.id ? 'Edit Vehicle' : 'Add Vehicle'}</h3>

  <div class="field flex flex-col space-y-1">
    <label for="fleetId" class="text-xs font-semibold">ID de flota *</label>
    <input
      id="fleetId"
      type="text"
      bind:value={selectedFleetId}
      required
      class="border p-2 rounded text-sm bg-background"
      placeholder="fleet_1"
    />
  </div>

  <div class="grid grid-cols-2 gap-4">
    <div class="field flex flex-col space-y-1">
      <label for="vin" class="text-xs font-semibold">VIN *</label>
      <input
        id="vin"
        type="text"
        bind:value={vin}
        required
        class="border p-2 rounded text-sm bg-background font-mono"
        placeholder="1HGCR2F83HA000000"
      />
    </div>

    <div class="field flex flex-col space-y-1">
      <label for="year" class="text-xs font-semibold">Year</label>
      <input
        id="year"
        type="number"
        bind:value={year}
        min="1900"
        max="2030"
        class="border p-2 rounded text-sm bg-background"
      />
    </div>
  </div>

  <div class="grid grid-cols-2 gap-4">
    <div class="field flex flex-col space-y-1">
      <label for="make" class="text-xs font-semibold">Make *</label>
      <input
        id="make"
        type="text"
        bind:value={make}
        required
        class="border p-2 rounded text-sm bg-background"
        placeholder="Tesla / Ford / Toyota"
      />
    </div>

    <div class="field flex flex-col space-y-1">
      <label for="model" class="text-xs font-semibold">Model *</label>
      <input
        id="model"
        type="text"
        bind:value={model}
        required
        class="border p-2 rounded text-sm bg-background"
        placeholder="Model 3 / F-150"
      />
    </div>
  </div>

  <div class="grid grid-cols-2 gap-4">
    <div class="field flex flex-col space-y-1">
      <label for="status" class="text-xs font-semibold">Status</label>
      <select id="status" bind:value={status} class="border p-2 rounded text-sm bg-background">
        <option value="active">Active</option>
        <option value="maintenance">Maintenance</option>
        <option value="decommissioned">Decommissioned</option>
      </select>
    </div>

    <div class="field flex flex-col space-y-1">
      <label for="mileage" class="text-xs font-semibold">Mileage</label>
      <input
        id="mileage"
        type="number"
        bind:value={mileage}
        min="0"
        class="border p-2 rounded text-sm bg-background"
      />
    </div>
  </div>

  <div class="flex justify-end space-x-2 pt-2">
    <button
      type="button"
      class="px-4 py-2 border rounded text-sm hover:bg-muted"
      on:click={() => dispatch('cancel')}
    >
      Cancel
    </button>
    <button
      type="submit"
      class="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-semibold hover:opacity-90"
    >
      Save Vehicle
    </button>
  </div>
</form>
