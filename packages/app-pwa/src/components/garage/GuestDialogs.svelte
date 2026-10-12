<script lang="ts">
/**
 * GuestDialogs.svelte — Formularios del garage en modo invitado: agregar vehiculo, actualizar
 * kilometraje u horometro, registrar mantenimiento, editar y eliminar. Todo se guarda en
 * IndexedDB (ver guestGarage.ts) y se resuelve sin salir del garage.
 *
 * El padre monta este componente solo mientras hay un dialogo abierto, asi cada apertura
 * arranca con el formulario limpio.
 */
import { tick } from 'svelte';
import type { GarageVehicle } from '../../garage/contracts';
import LocalDialog from './LocalDialog.svelte';
import {
  OTHER_MODEL_KEY,
  TYPE_OPTIONS,
  addLocalMaintenance,
  addLocalVehicle,
  catalogGroups,
  deleteLocalVehicle,
  findCatalogOption,
  resolveMaintenanceDraft,
  resolveUsage,
  resolveVehicleDraft,
  resolveVehicleEdit,
  setLocalUsage,
  updateLocalVehicle,
  usageLabel,
  type Errors,
} from './guestGarage';
import { usageUnitOfType } from '../../lib/vehicleCatalog';

export type GuestDialogKind = 'add' | 'usage' | 'maintenance' | 'edit' | 'delete';

interface Props {
  kind: GuestDialogKind;
  vehicle: GarageVehicle | null;
  onclose: () => void;
  /** Tras guardar: el padre recarga el snapshot (y se coloca en `selectId`, si viene). */
  onsaved: (selectId?: string) => void | Promise<void>;
}

const { kind, vehicle, onclose, onsaved }: Props = $props();

const groups = catalogGroups();
const today = new Date().toISOString().slice(0, 10);
const unitOfVehicle = vehicle?.usageUnit ?? 'km';
const MAINT_SUGGESTIONS = [
  'Cambio de aceite y filtro',
  'Filtro de aire',
  'Pastillas de freno',
  'Llantas (rotación o cambio)',
  'Batería',
  'Revisión general',
  'Correa de distribución',
  'Líquido refrigerante',
];

let errors = $state<Errors>({});
let formError = $state('');
let busy = $state(false);

// --- Agregar ---
let modelKey = $state('');
let make = $state('');
let model = $state('');
let type = $state('');
let plate = $state('');
let year = $state('');
let usage = $state('');
const addUnit = $derived(
  modelKey === OTHER_MODEL_KEY
    ? type
      ? usageUnitOfType(type)
      : 'km'
    : (findCatalogOption(modelKey)?.unit ?? 'km'),
);
const catalogYears = $derived(findCatalogOption(modelKey)?.years ?? []);

// --- Actualizar lectura ---
let newUsage = $state(vehicle?.odometerKm !== undefined ? String(Math.round(vehicle.odometerKm)) : '');

// --- Mantenimiento ---
let mType = $state('');
let mDate = $state(today);
let mReading = $state('');
let mCost = $state('');
let mWorkshop = $state('');
let mNotes = $state('');

// --- Editar ---
let ePlate = $state(vehicle?.plate ?? '');
let eMake = $state(vehicle?.make ?? '');
let eModel = $state(vehicle?.model ?? '');
let eYear = $state(vehicle?.year !== undefined ? String(vehicle.year) : '');

let formEl = $state<HTMLFormElement | null>(null);

const titles: Record<GuestDialogKind, string> = {
  add: 'Agregar vehículo',
  usage: 'Actualizar lectura',
  maintenance: 'Registrar mantenimiento',
  edit: 'Editar vehículo',
  delete: 'Eliminar vehículo',
};

function focusFirstInvalid() {
  void tick().then(() => formEl?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

function fail(next: Errors) {
  errors = next;
  focusFirstInvalid();
}

async function run(work: () => Promise<string | undefined | void>) {
  busy = true;
  formError = '';
  try {
    const selectId = await work();
    await onsaved(selectId ?? undefined);
    onclose();
  } catch {
    formError = 'No se pudo guardar en este navegador. Revisa que no esté bloqueado el almacenamiento.';
  } finally {
    busy = false;
  }
}

function submitAdd(event: SubmitEvent) {
  event.preventDefault();
  const r = resolveVehicleDraft({ modelKey, make, model, type, plate, year, usage });
  if (!r.ok) return fail(r.errors);
  errors = {};
  void run(async () => (await addLocalVehicle(r.value)).id);
}

function submitUsage(event: SubmitEvent) {
  event.preventDefault();
  if (!vehicle) return;
  const r = resolveUsage(newUsage, unitOfVehicle);
  if (!r.ok) return fail(r.errors);
  errors = {};
  void run(async () => {
    await setLocalUsage(vehicle.id, unitOfVehicle, r.value.usage);
  });
}

function submitMaintenance(event: SubmitEvent) {
  event.preventDefault();
  if (!vehicle) return;
  const r = resolveMaintenanceDraft({ type: mType, date: mDate, reading: mReading, cost: mCost, workshop: mWorkshop, notes: mNotes });
  if (!r.ok) return fail(r.errors);
  errors = {};
  void run(async () => {
    await addLocalMaintenance(vehicle.id, unitOfVehicle, r.value, vehicle.odometerKm);
  });
}

function submitEdit(event: SubmitEvent) {
  event.preventDefault();
  if (!vehicle) return;
  const r = resolveVehicleEdit({ plate: ePlate, make: eMake, model: eModel, year: eYear }, unitOfVehicle);
  if (!r.ok) return fail(r.errors);
  errors = {};
  void run(async () => {
    await updateLocalVehicle(vehicle.id, r.value);
  });
}

function submitDelete(event: SubmitEvent) {
  event.preventDefault();
  if (!vehicle) return;
  void run(async () => {
    await deleteLocalVehicle(vehicle.id);
  });
}
</script>

<LocalDialog title={titles[kind]} kicker="MODO LOCAL" {onclose}>
  {#if kind === 'add'}
    <form bind:this={formEl} onsubmit={submitAdd} novalidate class="gf">
      <div class="gf-field">
        <label for="gd-model">Modelo</label>
        <select id="gd-model" bind:value={modelKey} aria-invalid={errors.modelKey ? 'true' : undefined} aria-describedby={errors.modelKey ? 'gd-model-err' : undefined}>
          <option value="" disabled>Elige un modelo…</option>
          {#each groups as g (g.make)}
            <optgroup label={g.make}>
              {#each g.options as o (o.key)}
                <option value={o.key}>{g.make} {o.label}</option>
              {/each}
            </optgroup>
          {/each}
          <option value={OTHER_MODEL_KEY}>Otro (escribir marca y modelo)</option>
        </select>
        {#if errors.modelKey}<p id="gd-model-err" class="gf-err" role="alert">{errors.modelKey}</p>{/if}
      </div>

      {#if modelKey === OTHER_MODEL_KEY}
        <div class="gf-row">
          <div class="gf-field">
            <label for="gd-make">Marca</label>
            <input id="gd-make" bind:value={make} autocomplete="off" aria-invalid={errors.make ? 'true' : undefined} aria-describedby={errors.make ? 'gd-make-err' : undefined} />
            {#if errors.make}<p id="gd-make-err" class="gf-err" role="alert">{errors.make}</p>{/if}
          </div>
          <div class="gf-field">
            <label for="gd-mdl">Modelo</label>
            <input id="gd-mdl" bind:value={model} autocomplete="off" aria-invalid={errors.model ? 'true' : undefined} aria-describedby={errors.model ? 'gd-mdl-err' : undefined} />
            {#if errors.model}<p id="gd-mdl-err" class="gf-err" role="alert">{errors.model}</p>{/if}
          </div>
        </div>
        <div class="gf-field">
          <label for="gd-type">Tipo de vehículo</label>
          <select id="gd-type" bind:value={type} aria-invalid={errors.type ? 'true' : undefined} aria-describedby={errors.type ? 'gd-type-err' : undefined}>
            <option value="" disabled>Elige el tipo…</option>
            {#each TYPE_OPTIONS as t (t.value)}
              <option value={t.value}>{t.label}</option>
            {/each}
          </select>
          {#if errors.type}<p id="gd-type-err" class="gf-err" role="alert">{errors.type}</p>{/if}
        </div>
      {/if}

      <div class="gf-row">
        <div class="gf-field">
          <label for="gd-plate">Placa{addUnit === 'h' ? ' (opcional)' : ''}</label>
          <input id="gd-plate" bind:value={plate} autocomplete="off" autocapitalize="characters" placeholder="ABC123" aria-invalid={errors.plate ? 'true' : undefined} aria-describedby={errors.plate ? 'gd-plate-err' : undefined} />
          {#if errors.plate}<p id="gd-plate-err" class="gf-err" role="alert">{errors.plate}</p>{/if}
        </div>
        <div class="gf-field">
          <label for="gd-year">Año</label>
          <input id="gd-year" bind:value={year} inputmode="numeric" list="gd-years" placeholder="2020" aria-invalid={errors.year ? 'true' : undefined} aria-describedby={errors.year ? 'gd-year-err' : undefined} />
          <datalist id="gd-years">
            {#each catalogYears as y (y)}<option value={y}></option>{/each}
          </datalist>
          {#if errors.year}<p id="gd-year-err" class="gf-err" role="alert">{errors.year}</p>{/if}
        </div>
      </div>

      <div class="gf-field">
        <label for="gd-usage">{usageLabel(addUnit)} actual</label>
        <input id="gd-usage" bind:value={usage} inputmode="decimal" placeholder="0" aria-invalid={errors.usage ? 'true' : undefined} aria-describedby={errors.usage ? 'gd-usage-err' : undefined} />
        {#if errors.usage}<p id="gd-usage-err" class="gf-err" role="alert">{errors.usage}</p>{/if}
      </div>

      {#if formError}<p class="gf-err" role="alert">{formError}</p>{/if}
      <div class="gf-actions">
        <button type="button" class="gf-btn" onclick={onclose}>Cancelar</button>
        <button type="submit" class="gf-btn gf-primary" disabled={busy}>Agregar al garage</button>
      </div>
    </form>
  {:else if kind === 'usage' && vehicle}
    <form bind:this={formEl} onsubmit={submitUsage} novalidate class="gf">
      <p class="gf-note">{vehicle.name}</p>
      <div class="gf-field">
        <label for="gd-newusage">{usageLabel(unitOfVehicle)} actual</label>
        <input id="gd-newusage" bind:value={newUsage} inputmode="decimal" aria-invalid={errors.usage ? 'true' : undefined} aria-describedby={errors.usage ? 'gd-newusage-err' : undefined} />
        {#if errors.usage}<p id="gd-newusage-err" class="gf-err" role="alert">{errors.usage}</p>{/if}
      </div>
      {#if formError}<p class="gf-err" role="alert">{formError}</p>{/if}
      <div class="gf-actions">
        <button type="button" class="gf-btn" onclick={onclose}>Cancelar</button>
        <button type="submit" class="gf-btn gf-primary" disabled={busy}>Guardar lectura</button>
      </div>
    </form>
  {:else if kind === 'maintenance' && vehicle}
    <form bind:this={formEl} onsubmit={submitMaintenance} novalidate class="gf">
      <p class="gf-note">{vehicle.name}</p>
      <div class="gf-field">
        <label for="gd-mtype">Qué se hizo</label>
        <input id="gd-mtype" bind:value={mType} list="gd-msug" autocomplete="off" placeholder="Cambio de aceite y filtro" aria-invalid={errors.type ? 'true' : undefined} aria-describedby={errors.type ? 'gd-mtype-err' : undefined} />
        <datalist id="gd-msug">
          {#each MAINT_SUGGESTIONS as s (s)}<option value={s}></option>{/each}
        </datalist>
        {#if errors.type}<p id="gd-mtype-err" class="gf-err" role="alert">{errors.type}</p>{/if}
      </div>
      <div class="gf-row">
        <div class="gf-field">
          <label for="gd-mdate">Fecha</label>
          <input id="gd-mdate" type="date" max={today} bind:value={mDate} aria-invalid={errors.date ? 'true' : undefined} aria-describedby={errors.date ? 'gd-mdate-err' : undefined} />
          {#if errors.date}<p id="gd-mdate-err" class="gf-err" role="alert">{errors.date}</p>{/if}
        </div>
        <div class="gf-field">
          <label for="gd-mreading">{usageLabel(unitOfVehicle)}</label>
          <input id="gd-mreading" bind:value={mReading} inputmode="decimal" placeholder={vehicle.odometerKm !== undefined ? String(Math.round(vehicle.odometerKm)) : ''} aria-invalid={errors.reading ? 'true' : undefined} aria-describedby="gd-mreading-help{errors.reading ? ' gd-mreading-err' : ''}" />
          {#if errors.reading}<p id="gd-mreading-err" class="gf-err" role="alert">{errors.reading}</p>{/if}
        </div>
      </div>
      <p id="gd-mreading-help" class="gf-help">Si lo dejas vacío usamos la lectura actual. Si es mayor, también la adelanta.</p>
      <div class="gf-row">
        <div class="gf-field">
          <label for="gd-mcost">Costo (COP)</label>
          <input id="gd-mcost" bind:value={mCost} inputmode="numeric" placeholder="0" aria-invalid={errors.cost ? 'true' : undefined} aria-describedby={errors.cost ? 'gd-mcost-err' : undefined} />
          {#if errors.cost}<p id="gd-mcost-err" class="gf-err" role="alert">{errors.cost}</p>{/if}
        </div>
        <div class="gf-field">
          <label for="gd-mworkshop">Taller (opcional)</label>
          <input id="gd-mworkshop" bind:value={mWorkshop} autocomplete="off" />
        </div>
      </div>
      <div class="gf-field">
        <label for="gd-mnotes">Notas (opcional)</label>
        <textarea id="gd-mnotes" rows="2" bind:value={mNotes}></textarea>
      </div>
      {#if formError}<p class="gf-err" role="alert">{formError}</p>{/if}
      <div class="gf-actions">
        <button type="button" class="gf-btn" onclick={onclose}>Cancelar</button>
        <button type="submit" class="gf-btn gf-primary" disabled={busy}>Registrar</button>
      </div>
    </form>
  {:else if kind === 'edit' && vehicle}
    <form bind:this={formEl} onsubmit={submitEdit} novalidate class="gf">
      <div class="gf-row">
        <div class="gf-field">
          <label for="gd-emake">Marca</label>
          <input id="gd-emake" bind:value={eMake} autocomplete="off" aria-invalid={errors.make ? 'true' : undefined} aria-describedby={errors.make ? 'gd-emake-err' : undefined} />
          {#if errors.make}<p id="gd-emake-err" class="gf-err" role="alert">{errors.make}</p>{/if}
        </div>
        <div class="gf-field">
          <label for="gd-emodel">Modelo</label>
          <input id="gd-emodel" bind:value={eModel} autocomplete="off" aria-invalid={errors.model ? 'true' : undefined} aria-describedby={errors.model ? 'gd-emodel-err' : undefined} />
          {#if errors.model}<p id="gd-emodel-err" class="gf-err" role="alert">{errors.model}</p>{/if}
        </div>
      </div>
      <div class="gf-row">
        <div class="gf-field">
          <label for="gd-eplate">Placa{unitOfVehicle === 'h' ? ' (opcional)' : ''}</label>
          <input id="gd-eplate" bind:value={ePlate} autocomplete="off" autocapitalize="characters" aria-invalid={errors.plate ? 'true' : undefined} aria-describedby={errors.plate ? 'gd-eplate-err' : undefined} />
          {#if errors.plate}<p id="gd-eplate-err" class="gf-err" role="alert">{errors.plate}</p>{/if}
        </div>
        <div class="gf-field">
          <label for="gd-eyear">Año</label>
          <input id="gd-eyear" bind:value={eYear} inputmode="numeric" aria-invalid={errors.year ? 'true' : undefined} aria-describedby={errors.year ? 'gd-eyear-err' : undefined} />
          {#if errors.year}<p id="gd-eyear-err" class="gf-err" role="alert">{errors.year}</p>{/if}
        </div>
      </div>
      {#if formError}<p class="gf-err" role="alert">{formError}</p>{/if}
      <div class="gf-actions">
        <button type="button" class="gf-btn" onclick={onclose}>Cancelar</button>
        <button type="submit" class="gf-btn gf-primary" disabled={busy}>Guardar cambios</button>
      </div>
    </form>
  {:else if kind === 'delete' && vehicle}
    <form onsubmit={submitDelete} class="gf">
      <p class="gf-note">
        Vas a eliminar <strong>{vehicle.name}</strong> con todo su historial de mantenimientos de este navegador. No se puede deshacer.
      </p>
      {#if formError}<p class="gf-err" role="alert">{formError}</p>{/if}
      <div class="gf-actions">
        <button type="button" class="gf-btn" onclick={onclose}>Cancelar</button>
        <button type="submit" class="gf-btn gf-danger" disabled={busy}>Eliminar vehículo</button>
      </div>
    </form>
  {/if}
</LocalDialog>

<style>
  .gf {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .gf-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.7rem;
  }
  @media (max-width: 420px) {
    .gf-row {
      grid-template-columns: 1fr;
    }
  }
  .gf-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  label {
    font-family: var(--swal-font-mono);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--swal-text-secondary);
  }
  input,
  select,
  textarea {
    width: 100%;
    box-sizing: border-box;
    background: var(--swal-bg-elevated);
    border: 1px solid var(--swal-border-strong);
    border-radius: var(--swal-radius-sm);
    color: var(--swal-text);
    padding: 0.55rem 0.6rem;
    font-family: inherit;
    font-size: 0.9rem;
  }
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--swal-accent);
    outline-offset: 1px;
    border-color: var(--swal-accent);
  }
  [aria-invalid='true'] {
    border-color: var(--swal-danger);
  }
  .gf-err {
    margin: 0;
    font-size: 0.76rem;
    color: var(--swal-danger);
  }
  .gf-note {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.45;
    color: var(--swal-text-secondary);
  }
  .gf-help {
    margin: -0.4rem 0 0;
    font-size: 0.72rem;
    color: var(--swal-text-muted);
  }
  .gf-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.2rem;
  }
  .gf-btn {
    padding: 0.55rem 0.95rem;
    min-height: 40px;
    font-family: var(--swal-font-mono);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: var(--swal-surface);
    color: var(--swal-text);
    border: 1px solid var(--swal-border-strong);
    cursor: pointer;
  }
  .gf-btn:hover:not(:disabled) {
    border-color: var(--swal-accent);
  }
  .gf-btn:focus-visible {
    outline: 2px solid var(--swal-accent);
    outline-offset: 2px;
  }
  .gf-btn:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .gf-primary {
    background: var(--swal-accent);
    color: var(--swal-accent-contrast);
    border-color: var(--swal-accent);
  }
  .gf-danger {
    background: var(--swal-danger);
    color: var(--swal-accent-contrast);
    border-color: var(--swal-danger);
  }
</style>
