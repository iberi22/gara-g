<script lang="ts">
/**
 * DossierManuals — Manuales del vehiculo (PDF): subir, indexar para el asistente y leer.
 *
 * Subir usa el vault de documentos (/api/fleet/files con kind=manual). Despues de subir
 * se pide el indexado (/api/garage/manuals/:id), que extrae el texto con Workers AI para
 * que el asistente pueda citarlo por pagina.
 */
import type { ManualInfo } from '../../garage/assistant/store';

interface Props {
  vehicleId: string;
  manuals: ManualInfo[];
  canUpload: boolean;
  onchange?: (manuals: ManualInfo[]) => void;
}

const { vehicleId, manuals: initial, canUpload, onchange }: Props = $props();

let manuals = $state<ManualInfo[]>(initial);
let selected = $state<ManualInfo | null>(initial[0] ?? null);
let uploading = $state(false);
let indexing = $state<string | null>(null);
let message = $state<{ tone: 'ok' | 'error'; text: string } | null>(null);
let fileInput: HTMLInputElement | undefined = $state();

const MAX_MB = 40;

const fileUrl = (key: string, inline = true) =>
  `/r2/${key.split('/').map(encodeURIComponent).join('/')}${inline ? '?inline=1' : ''}`;

const sizeText = (bytes?: number) => (bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '');

async function refresh(): Promise<ManualInfo[]> {
  const res = await fetch(`/api/garage/manuals?vehicleId=${encodeURIComponent(vehicleId)}`, { credentials: 'same-origin' });
  if (!res.ok) return manuals;
  const data = (await res.json()) as { manuals?: ManualInfo[] };
  manuals = data.manuals ?? [];
  onchange?.(manuals);
  return manuals;
}

async function indexManual(m: ManualInfo): Promise<void> {
  indexing = m.id;
  message = null;
  try {
    const res = await fetch(`/api/garage/manuals/${encodeURIComponent(m.id)}`, { method: 'POST', credentials: 'same-origin' });
    const data = (await res.json().catch(() => ({}))) as { error?: string; pages?: number };
    message = res.ok
      ? { tone: 'ok', text: `Listo: el asistente ya puede citar ${data.pages ?? 0} páginas de “${m.name}”.` }
      : { tone: 'error', text: data.error ?? `No se pudo leer el manual (${res.status}).` };
  } catch {
    message = { tone: 'error', text: 'Sin conexión: no se pudo leer el manual.' };
  } finally {
    indexing = null;
    await refresh();
  }
}

async function upload(file: File): Promise<void> {
  message = null;
  if (file.type !== 'application/pdf') {
    message = { tone: 'error', text: 'El manual debe ser un PDF.' };
    return;
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    message = { tone: 'error', text: `El PDF pesa ${(file.size / 1024 / 1024).toFixed(1)} MB; el máximo es ${MAX_MB} MB.` };
    return;
  }
  uploading = true;
  try {
    const form = new FormData();
    form.set('file', file);
    form.set('entityType', 'vehicle');
    form.set('entityId', vehicleId);
    form.set('kind', 'manual');
    const res = await fetch('/api/fleet/files', { method: 'POST', body: form, credentials: 'same-origin' });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      message = { tone: 'error', text: data.error ?? `No se pudo subir (${res.status}).` };
      return;
    }
    const list = await refresh();
    const fresh = list.find((m) => !m.indexedAt && !m.indexError) ?? list[0];
    if (fresh) {
      selected = fresh;
      await indexManual(fresh);
    }
  } catch {
    message = { tone: 'error', text: 'Sin conexión: no se pudo subir el manual.' };
  } finally {
    uploading = false;
    if (fileInput) fileInput.value = '';
  }
}
</script>

<section class="manuals" aria-label="Manuales">
  <div class="side">
    <header>
      <h2>Manuales</h2>
      <p class="muted">Manual del propietario, de servicio o de partes, en PDF (hasta {MAX_MB} MB). El asistente los lee por página.</p>
    </header>

    {#if canUpload}
      <label class="upload" class:busy={uploading}>
        <input
          bind:this={fileInput}
          type="file"
          accept="application/pdf"
          disabled={uploading}
          onchange={(e) => {
            const f = (e.currentTarget as HTMLInputElement).files?.[0];
            if (f) void upload(f);
          }}
        />
        <span>{uploading ? 'Subiendo…' : '+ Subir manual en PDF'}</span>
      </label>
    {/if}

    {#if message}
      <p class="msg {message.tone}" role="status">{message.text}</p>
    {/if}

    {#if manuals.length === 0}
      <p class="muted empty">Aún no hay manuales de este vehículo.</p>
    {:else}
      <ul class="list">
        {#each manuals as m (m.id)}
          <li class:active={selected?.id === m.id}>
            <button type="button" class="pick" onclick={() => (selected = m)}>
              <span class="name">{m.name}</span>
              <span class="meta">
                {sizeText(m.fileSize)}
                {#if m.textKey}· {m.pages ?? 0} págs. leídas{:else if m.indexError}· sin texto{:else}· sin leer{/if}
              </span>
            </button>
            {#if canUpload && !m.textKey}
              <button type="button" class="mini" disabled={indexing === m.id} onclick={() => indexManual(m)}>
                {indexing === m.id ? 'Leyendo…' : 'Leer para IA'}
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if manuals.some((m) => m.indexError)}
      <p class="muted small">
        Un PDF escaneado (fotos de páginas) no tiene texto que leer: el asistente no podrá citarlo, pero lo puedes consultar aquí.
      </p>
    {/if}
  </div>

  <div class="viewer">
    {#if selected}
      <div class="viewer-bar">
        <span class="name">{selected.name}</span>
        <a href={fileUrl(selected.fileKey)} target="_blank" rel="noopener">Abrir en otra pestaña ↗</a>
      </div>
      <iframe title={`Manual: ${selected.name}`} src={fileUrl(selected.fileKey)}></iframe>
    {:else}
      <div class="placeholder">Selecciona o sube un manual para leerlo aquí.</div>
    {/if}
  </div>
</section>

<style>
  .manuals {
    display: grid;
    grid-template-columns: minmax(240px, 320px) 1fr;
    gap: 16px;
    min-height: 600px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  .muted {
    color: var(--d-muted);
    font-size: 13px;
    margin: 4px 0 0;
  }
  .small {
    font-size: 12px;
  }
  .empty {
    margin-top: 14px;
  }
  .upload {
    display: block;
    margin-top: 14px;
    padding: 12px;
    text-align: center;
    border: 1px dashed var(--d-accent);
    color: var(--d-accent-text);
    font-weight: 700;
    cursor: pointer;
  }
  .upload.busy {
    opacity: 0.6;
    cursor: progress;
  }
  .upload input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .upload:focus-within {
    outline: 2px solid var(--d-accent);
  }
  .msg {
    margin: 10px 0 0;
    padding: 8px 10px;
    font-size: 13px;
    border-left: 3px solid;
  }
  .msg.ok {
    border-color: var(--d-ok);
    background: color-mix(in srgb, var(--d-ok) 10%, transparent);
  }
  .msg.error {
    border-color: var(--d-critical);
    background: color-mix(in srgb, var(--d-critical) 10%, transparent);
  }
  .list {
    list-style: none;
    margin: 14px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--d-line);
    background: var(--d-card);
  }
  .list li.active {
    border-color: var(--d-accent);
  }
  .pick {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 9px 10px;
    border: 0;
    background: transparent;
    color: var(--d-ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .meta {
    font-size: 11px;
    color: var(--d-muted);
  }
  .mini {
    margin-right: 8px;
    border: 1px solid var(--d-line);
    background: var(--d-sheet);
    color: var(--d-ink);
    font: inherit;
    font-size: 11px;
    padding: 4px 8px;
    cursor: pointer;
    white-space: nowrap;
  }
  .viewer {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--d-line);
    background: var(--d-sheet);
    min-height: 600px;
  }
  .viewer-bar {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--d-line);
    font-size: 13px;
  }
  .viewer-bar a {
    color: var(--d-accent-text);
    white-space: nowrap;
  }
  iframe {
    flex: 1;
    width: 100%;
    border: 0;
    min-height: 560px;
    background: #fff;
  }
  .placeholder {
    margin: auto;
    color: var(--d-muted);
    font-size: 14px;
    padding: 24px;
    text-align: center;
  }
  @media (max-width: 860px) {
    .manuals {
      grid-template-columns: 1fr;
    }
    .viewer,
    iframe {
      min-height: 70vh;
    }
  }
</style>
