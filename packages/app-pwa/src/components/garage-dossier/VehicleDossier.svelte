<script lang="ts">
/**
 * VehicleDossier — Expediente de un vehiculo: todo lo que hay que saber de el en un sitio.
 *
 * Pestanas (con ancla en la URL, #resumen, #ficha, ...):
 *   Resumen     estado general, lo urgente y acceso al 3D.
 *   Ficha       medidas, llantas, motor (catalogo) y las notas tecnicas del dueno.
 *   Mecanica    salud de cada pieza, plan de mantenimiento y historial.
 *   Manuales    PDF del vehiculo, para leer aqui y para que el asistente los cite.
 *   Asistente   chat de IA con el contexto del vehiculo.
 *
 * Los datos llegan del servidor ya resueltos (pages/fleet/garage/expediente/[id].astro); este
 * componente solo pinta y hace las escrituras propias del expediente (notas y manuales).
 */
import { onMount } from 'svelte';
import type { ManualInfo, VehicleNotes } from '../../garage/assistant/store';
import type { TechNote } from '../../garage/assistant/prompt';
import type { GarageVehicle, HistoryEvent, PartState } from '../../garage/contracts';
import { formatCOP, formatKm } from '../garage/formatters';
import DossierChat from './DossierChat.svelte';
import DossierManuals from './DossierManuals.svelte';

interface CatalogInfo {
  make: string;
  model: string;
  typeLabel: string;
  engineCC: number;
  powerHP: number;
  fuelType: string;
  payloadKg?: number;
  revisionPeriodKm: number;
  oilChangeKm: number;
  commonParts: { name: string; category: string; lifeKm: number; avgCostCOP: number }[];
}

interface Props {
  vehicle: GarageVehicle;
  history: HistoryEvent[];
  catalog: CatalogInfo | null;
  typeLabel: string;
  manuals: ManualInfo[];
  notes: VehicleNotes;
  canEdit: boolean;
  canUpload: boolean;
}

const { vehicle, history, catalog, typeLabel, manuals: initialManuals, notes: initialNotes, canEdit, canUpload }: Props = $props();

type Tab = 'resumen' | 'ficha' | 'mecanica' | 'manuales' | 'asistente';
const TABS: { id: Tab; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'ficha', label: 'Ficha técnica' },
  { id: 'mecanica', label: 'Mecánica' },
  { id: 'manuales', label: 'Manuales' },
  { id: 'asistente', label: 'Asistente IA' },
];

let tab = $state<Tab>('resumen');
let manuals = $state<ManualInfo[]>(initialManuals);
let notes = $state<TechNote[]>(initialNotes.techNotes.length ? initialNotes.techNotes.map((n) => ({ ...n })) : []);
let notesText = $state(initialNotes.techNotesText);
let savingNotes = $state(false);
let notesMsg = $state<{ tone: 'ok' | 'error'; text: string } | null>(null);

const unit = $derived(vehicle.usageUnit);
const isMachine = $derived(vehicle.spec.family === 'machinery');
const title = $derived([vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.name);

onMount(() => {
  const fromHash = window.location.hash.slice(1) as Tab;
  if (TABS.some((t) => t.id === fromHash)) tab = fromHash;
});

function go(t: Tab): void {
  tab = t;
  window.history.replaceState(null, '', `#${t}`);
}

const urgent = $derived(vehicle.commitments.filter((c) => c.status !== 'done' && c.urgency !== 'planned').slice(0, 6));
const nextChange = $derived(vehicle.commitments.find((c) => c.status !== 'done'));

function remainingText(c: { remainingKm?: number; remainingDays?: number }): string {
  if (c.remainingKm !== undefined) return c.remainingKm < 0 ? `vencido hace ${formatKm(-c.remainingKm, unit)}` : `faltan ${formatKm(c.remainingKm, unit)}`;
  if (c.remainingDays !== undefined) return c.remainingDays < 0 ? `vencido hace ${-c.remainingDays} días` : `faltan ${c.remainingDays} días`;
  return 'sin fecha';
}

const toneOf = (p: PartState): string => (p.status === 'overdue' || p.status === 'critical' ? 'critical' : p.status === 'warn' ? 'warn' : p.status === 'ok' ? 'ok' : 'neutral');

/**
 * Un repuesto que cubre dos ranuras (las dos orugas, los dos frenos delanteros) es UNA
 * pieza para el dueno: se lista una vez.
 */
function uniqueByLabel(parts: PartState[]): PartState[] {
  const seen = new Set<string>();
  return parts.filter((p) => {
    const key = `${p.label}|${p.healthPct}|${p.nextDueKm}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const knownParts = $derived(uniqueByLabel([...vehicle.parts].filter((p) => p.healthPct !== null).sort((a, b) => (a.healthPct ?? 0) - (b.healthPct ?? 0))));
// Solo los repuestos del catalogo sin historial: las ranuras sin repuesto no aportan nada aqui.
const unknownParts = $derived(uniqueByLabel(vehicle.parts.filter((p) => p.healthPct === null && p.lifeKm !== undefined)));
const events = $derived([...history].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30));

const dims = $derived(vehicle.spec.dims);
const fichaRows = $derived.by(() => {
  const rows: [string, string][] = [
    ['Tipo', typeLabel],
    ['Marca y modelo', title],
  ];
  if (vehicle.year) rows.push(['Año', String(vehicle.year)]);
  if (vehicle.plate) rows.push(['Placa', vehicle.plate]);
  if (vehicle.vin) rows.push([isMachine ? 'Serie' : 'VIN', vehicle.vin]);
  rows.push([isMachine ? 'Horómetro' : 'Odómetro', formatKm(vehicle.odometerKm, unit)]);
  if (catalog) {
    rows.push(['Motor', `${catalog.engineCC.toLocaleString('es-CO')} cc · ${catalog.powerHP} hp · ${catalog.fuelType}`]);
    if (catalog.payloadKg) rows.push(['Carga útil', `${catalog.payloadKg.toLocaleString('es-CO')} kg`]);
    rows.push(['Revisión general', `cada ${formatKm(catalog.revisionPeriodKm, unit)}`]);
    rows.push(['Cambio de aceite', `cada ${formatKm(catalog.oilChangeKm, unit)}`]);
  }
  rows.push(['Largo × ancho × alto', `${dims.lengthMm.toLocaleString('es-CO')} × ${dims.widthMm.toLocaleString('es-CO')} × ${dims.heightMm.toLocaleString('es-CO')} mm`]);
  rows.push([isMachine && (vehicle.spec.body === 'excavator' || vehicle.spec.body === 'dozer') ? 'Oruga en el suelo' : 'Entre ejes', `${dims.wheelbaseMm.toLocaleString('es-CO')} mm`]);
  if (dims.seatHeightMm) rows.push(['Altura de sillín', `${dims.seatHeightMm.toLocaleString('es-CO')} mm`]);
  if (!isMachine || (vehicle.spec.tireFront.rimIn > 0 && vehicle.spec.body !== 'roller')) {
    const t = (x: typeof vehicle.spec.tireFront) => `${x.widthMm}/${x.aspectPct}R${x.rimIn}`;
    rows.push(['Llantas', `${t(vehicle.spec.tireFront)} / ${t(vehicle.spec.tireRear)}`]);
  }
  return rows;
});

/** Plan de mantenimiento del catalogo con el estado real de cada repuesto. */
const plan = $derived.by(() => {
  if (!catalog) return [];
  return catalog.commonParts.map((cp) => {
    const state = vehicle.parts.find((p) => p.label === cp.name);
    return { ...cp, state };
  });
});

function addNote(): void {
  notes = [...notes, { label: '', value: '' }];
}

function removeNote(i: number): void {
  notes = notes.filter((_, k) => k !== i);
}

async function saveNotes(): Promise<void> {
  savingNotes = true;
  notesMsg = null;
  try {
    const res = await fetch(`/api/garage/notes/${encodeURIComponent(vehicle.id)}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ techNotes: notes, techNotesText: notesText }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; techNotes?: TechNote[] };
    if (res.ok) {
      notes = data.techNotes ?? notes;
      notesMsg = { tone: 'ok', text: 'Notas guardadas. El asistente ya las usa.' };
    } else {
      notesMsg = { tone: 'error', text: data.error ?? `No se pudieron guardar (${res.status}).` };
    }
  } catch {
    notesMsg = { tone: 'error', text: 'Sin conexión: no se guardaron las notas.' };
  } finally {
    savingNotes = false;
  }
}

const SUGGESTED_NOTES: Record<string, string[]> = {
  moto: ['Torque tuerca eje trasero', 'Holgura de la cadena', 'Capacidad de aceite', 'Presión llanta delantera', 'Presión llanta trasera', 'Bujía (referencia)'],
  car: ['Capacidad de aceite', 'Referencia filtro de aceite', 'Presión de llantas', 'Torque de rueda'],
  heavy: ['Capacidad de aceite', 'Referencia filtro de combustible', 'Presión de llantas', 'Torque de tuercas de rueda'],
  machinery: ['Capacidad tanque hidráulico', 'Referencia filtro hidráulico', 'Tensión de la oruga', 'Intervalo de engrase'],
};
</script>

<div class="dossier">
  <header class="head">
    <div class="crumbs">
      <a href="/fleet/garage">Garage</a> <span aria-hidden="true">/</span> <span>Expediente</span>
    </div>
    <div class="title-row">
      <div>
        <p class="kicker">{typeLabel}{vehicle.year ? ` · ${vehicle.year}` : ''}{vehicle.plate ? ` · ${vehicle.plate}` : ''}</p>
        <h1>{vehicle.name}</h1>
      </div>
      <a class="btn-3d" href={`/fleet/garage?v=${encodeURIComponent(vehicle.id)}`}>Ver en 3D →</a>
    </div>
    <div class="stats">
      <div class="stat">
        <span class="label">Salud</span>
        <span class="value">{vehicle.overallHealthPct === null ? '—' : `${Math.round(vehicle.overallHealthPct)} %`}</span>
      </div>
      <div class="stat">
        <span class="label">{isMachine ? 'Horómetro' : 'Odómetro'}</span>
        <span class="value">{formatKm(vehicle.odometerKm, unit)}</span>
      </div>
      <div class="stat">
        <span class="label">Próximo</span>
        <span class="value small">{nextChange ? `${nextChange.title} · ${remainingText(nextChange)}` : '—'}</span>
      </div>
      <div class="stat">
        <span class="label">Manuales</span>
        <span class="value">{manuals.length}</span>
      </div>
    </div>
    <nav class="tabs" aria-label="Secciones del expediente">
      {#each TABS as t (t.id)}
        <button type="button" class:active={tab === t.id} aria-current={tab === t.id ? 'page' : undefined} onclick={() => go(t.id)}>
          {t.label}
        </button>
      {/each}
    </nav>
  </header>

  <main class="body">
    {#if tab === 'resumen'}
      <section class="grid2">
        <div class="card">
          <h2>Lo urgente</h2>
          {#if urgent.length === 0}
            <p class="muted">Nada vencido ni próximo a vencer. 👍</p>
          {:else}
            <ul class="rows">
              {#each urgent as c (c.id)}
                <li class={c.urgency}>
                  <span class="dot" aria-hidden="true"></span>
                  <span class="grow">{c.title}</span>
                  <span class="muted">{remainingText(c)}</span>
                  {#if c.estCostCOP}<span class="cost">{formatCOP(c.estCostCOP)}</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        <div class="card">
          <h2>Pregúntale al asistente</h2>
          <p class="muted">Conoce la ficha, el estado de cada pieza, el historial, tus notas y los manuales que cargues de este vehículo.</p>
          <button type="button" class="btn" onclick={() => go('asistente')}>Abrir el asistente</button>
          <button type="button" class="btn ghost" onclick={() => go('manuales')}>Cargar un manual</button>
        </div>
        <div class="card wide">
          <h2>Piezas que más se acercan al cambio</h2>
          {#if knownParts.length === 0}
            <p class="muted">Sin datos de piezas todavía: registra mantenimientos {isMachine ? 'con el horómetro' : 'con el kilometraje'} para estimarlas.</p>
          {:else}
            <ul class="bars">
              {#each knownParts.slice(0, 6) as p (p.slotId)}
                <li>
                  <span class="grow">{p.label}</span>
                  <span class="bar {toneOf(p)}"><span style:width={`${Math.max(2, p.healthPct ?? 0)}%`}></span></span>
                  <span class="pct">{Math.round(p.healthPct ?? 0)} %</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </section>
    {:else if tab === 'ficha'}
      <section class="grid2">
        <div class="card">
          <h2>Ficha técnica</h2>
          <table class="kv">
            <tbody>
              {#each fichaRows as [k, v] (k)}
                <tr><th>{k}</th><td>{v}</td></tr>
              {/each}
            </tbody>
          </table>
          {#if !catalog}
            <p class="muted small">Este modelo no está en el catálogo de GARA-G: anota abajo los datos de tu manual y el asistente los usará.</p>
          {/if}
        </div>
        <div class="card">
          <h2>Mis notas técnicas</h2>
          <p class="muted">Torques, capacidades, referencias de repuestos, observaciones. Lo que anotes aquí el asistente lo trata como dato del vehículo.</p>
          <div class="notes">
            {#each notes as n, i (i)}
              <div class="note-row">
                <input aria-label="Dato" placeholder="Dato (ej. Torque eje trasero)" bind:value={n.label} maxlength="80" disabled={!canEdit} />
                <input aria-label="Valor" placeholder="Valor (ej. 90 N·m)" bind:value={n.value} maxlength="240" disabled={!canEdit} />
                {#if canEdit}<button type="button" class="x" aria-label="Quitar dato" onclick={() => removeNote(i)}>×</button>{/if}
              </div>
            {/each}
          </div>
          {#if canEdit}
            <div class="note-actions">
              <button type="button" class="btn ghost" onclick={addNote}>+ Agregar dato</button>
              {#if notes.length === 0}
                <span class="muted small">Sugerencias:</span>
                {#each SUGGESTED_NOTES[vehicle.spec.family] ?? [] as s (s)}
                  <button type="button" class="chip" onclick={() => (notes = [...notes, { label: s, value: '' }])}>{s}</button>
                {/each}
              {/if}
            </div>
          {/if}
          <label class="free">
            <span>Observaciones</span>
            <textarea bind:value={notesText} rows="5" maxlength="8000" disabled={!canEdit} placeholder="Ej.: le cambié la cadena por una 428H reforzada; el piñón es de 14 dientes."></textarea>
          </label>
          {#if canEdit}
            <button type="button" class="btn" disabled={savingNotes} onclick={saveNotes}>{savingNotes ? 'Guardando…' : 'Guardar notas'}</button>
          {/if}
          {#if notesMsg}<p class="msg {notesMsg.tone}" role="status">{notesMsg.text}</p>{/if}
        </div>
      </section>
    {:else if tab === 'mecanica'}
      <section class="grid2">
        <div class="card">
          <h2>Estado de piezas</h2>
          {#if knownParts.length === 0}
            <p class="muted">Sin datos todavía.</p>
          {:else}
            <ul class="bars">
              {#each knownParts as p (p.slotId)}
                <li>
                  <span class="grow">
                    {p.label}
                    <small class="muted">{formatKm(p.kmSinceService, unit)} de uso · cambio a {formatKm(p.nextDueKm, unit)}</small>
                  </span>
                  <span class="bar {toneOf(p)}"><span style:width={`${Math.max(2, p.healthPct ?? 0)}%`}></span></span>
                  <span class="pct">{Math.round(p.healthPct ?? 0)} %</span>
                </li>
              {/each}
            </ul>
          {/if}
          {#if unknownParts.length}
            <p class="muted small">Sin dato: {unknownParts.map((p) => p.label).join(', ')}.</p>
          {/if}
        </div>
        <div class="card">
          <h2>Plan de mantenimiento</h2>
          {#if plan.length === 0}
            <p class="muted">Este modelo no está en el catálogo. Anota los intervalos de tu manual en la ficha técnica y pregúntale al asistente.</p>
          {:else}
            <table class="plan">
              <thead><tr><th>Repuesto</th><th>Cada</th><th>Costo aprox.</th></tr></thead>
              <tbody>
                {#each plan as row (row.name)}
                  <tr>
                    <td>{row.name}</td>
                    <td>{formatKm(row.lifeKm, unit)}</td>
                    <td>{formatCOP(row.avgCostCOP)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
          <a class="btn ghost" href="/fleet/maintenance">Registrar un mantenimiento</a>
        </div>
        <div class="card wide">
          <h2>Historial</h2>
          {#if events.length === 0}
            <p class="muted">Sin registros todavía.</p>
          {:else}
            <ol class="timeline">
              {#each events as e (e.id)}
                <li class={e.kind}>
                  <span class="when">{e.at.slice(0, 10)}</span>
                  <span class="grow">{e.title}{#if e.detail}<small class="muted"> · {e.detail}</small>{/if}</span>
                  {#if e.km !== undefined}<span class="muted">{formatKm(e.km, unit)}</span>{/if}
                  {#if e.costCOP}<span class="cost">{formatCOP(e.costCOP)}</span>{/if}
                </li>
              {/each}
            </ol>
          {/if}
        </div>
      </section>
    {:else if tab === 'manuales'}
      <DossierManuals vehicleId={vehicle.id} manuals={manuals} {canUpload} onchange={(m) => (manuals = m)} />
    {:else if tab === 'asistente'}
      {#key manuals.map((m) => m.textKey).join('|')}
        <DossierChat vehicleId={vehicle.id} vehicleName={title} family={vehicle.spec.family} manuals={manuals} />
      {/key}
    {/if}
  </main>
</div>

<style>
  /* Tokens del tema activo de @swal/ui (taller / taller-dark): el expediente sigue al
     selector Claro/Oscuro/Sistema sin reglas propias por tema. */
  .dossier {
    --d-accent: var(--swal-accent);
    --d-accent-text: var(--swal-accent-text);
    --d-ink: var(--swal-text);
    --d-muted: var(--swal-text-muted);
    --d-line: var(--swal-border);
    --d-card: var(--swal-surface);
    --d-sheet: var(--swal-bg-surface);
    --d-ok: var(--swal-success);
    --d-warn: var(--swal-warning);
    --d-critical: var(--swal-danger);
    color: var(--d-ink);
    background: var(--d-sheet);
    min-height: 100%;
    padding: 18px clamp(12px, 3vw, 32px) 40px;
    font-size: 14px;
  }
  .crumbs {
    font-size: 12px;
    color: var(--d-muted);
  }
  .crumbs a {
    color: var(--d-muted);
  }
  .title-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .kicker {
    margin: 0;
    font-family: var(--g-font-mono, 'JetBrains Mono', monospace);
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--d-accent-text);
  }
  h1 {
    margin: 2px 0 0;
    font-size: clamp(24px, 4vw, 34px);
    line-height: 1.1;
  }
  .btn-3d {
    padding: 10px 14px;
    background: var(--d-ink);
    color: var(--d-card);
    text-decoration: none;
    font-weight: 700;
    clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    margin-top: 16px;
    background: var(--d-line);
    border: 1px solid var(--d-line);
  }
  .stat {
    background: var(--d-card);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--d-muted);
  }
  .value {
    font-size: 20px;
    font-weight: 700;
  }
  .value.small {
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tabs {
    display: flex;
    gap: 4px;
    margin-top: 16px;
    border-bottom: 2px solid var(--d-line);
    overflow-x: auto;
  }
  .tabs button {
    border: 0;
    background: transparent;
    color: var(--d-muted);
    font: inherit;
    font-weight: 600;
    padding: 10px 14px;
    cursor: pointer;
    border-bottom: 3px solid transparent;
    margin-bottom: -2px;
    white-space: nowrap;
  }
  .tabs button.active {
    color: var(--d-ink);
    border-bottom-color: var(--d-accent);
  }
  .body {
    margin-top: 16px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
  .card {
    background: var(--d-card);
    border: 1px solid var(--d-line);
    padding: 16px;
    clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .card.wide {
    grid-column: 1 / -1;
  }
  h2 {
    margin: 0;
    font-size: 16px;
  }
  .muted {
    color: var(--d-muted);
    margin: 0;
  }
  .small {
    font-size: 12px;
  }
  .rows,
  .bars,
  .timeline {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rows li,
  .timeline li {
    display: flex;
    gap: 10px;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .grow small {
    display: block;
  }
  .dot {
    width: 8px;
    height: 8px;
    background: var(--d-warn);
    flex: none;
    align-self: center;
  }
  .overdue .dot {
    background: var(--d-critical);
  }
  .cost {
    font-weight: 600;
  }
  .bars li {
    display: grid;
    grid-template-columns: 1fr 120px 44px;
    gap: 10px;
    align-items: center;
  }
  .bar {
    height: 8px;
    background: var(--d-sheet);
    border: 1px solid var(--d-line);
    position: relative;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--d-ok);
  }
  .bar.warn span {
    background: var(--d-warn);
  }
  .bar.critical span {
    background: var(--d-critical);
  }
  .pct {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .kv,
  .plan {
    width: 100%;
    border-collapse: collapse;
  }
  .kv th,
  .kv td,
  .plan th,
  .plan td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--d-line);
    vertical-align: top;
  }
  .kv th {
    width: 42%;
    color: var(--d-muted);
    font-weight: 500;
  }
  .plan th {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--d-muted);
  }
  .btn {
    align-self: flex-start;
    border: 0;
    background: var(--d-accent);
    color: var(--swal-accent-contrast);
    font: inherit;
    font-weight: 700;
    padding: 9px 14px;
    cursor: pointer;
    text-decoration: none;
  }
  .btn.ghost {
    background: transparent;
    color: var(--d-ink);
    border: 1px solid var(--d-line);
  }
  .btn:disabled {
    opacity: 0.5;
  }
  .notes {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .note-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 6px;
  }
  .note-row input,
  textarea {
    font: inherit;
    padding: 8px 10px;
    border: 1px solid var(--d-line);
    background: var(--d-sheet);
    color: var(--d-ink);
    min-width: 0;
  }
  .x {
    border: 1px solid var(--d-line);
    background: transparent;
    color: var(--d-muted);
    width: 32px;
    cursor: pointer;
    font-size: 16px;
  }
  .note-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .chip {
    border: 1px solid var(--d-line);
    background: var(--d-sheet);
    color: var(--d-ink);
    font: inherit;
    font-size: 12px;
    padding: 4px 8px;
    cursor: pointer;
  }
  .free {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .free span {
    font-size: 12px;
    color: var(--d-muted);
  }
  .msg {
    margin: 0;
    padding: 8px 10px;
    font-size: 13px;
    border-left: 3px solid var(--d-ok);
  }
  .msg.error {
    border-left-color: var(--d-critical);
  }
  .when {
    font-family: var(--g-font-mono, 'JetBrains Mono', monospace);
    font-size: 12px;
    color: var(--d-muted);
  }
  @media (max-width: 860px) {
    .grid2 {
      grid-template-columns: 1fr;
    }
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .bars li {
      grid-template-columns: 1fr 80px 40px;
    }
  }
</style>
