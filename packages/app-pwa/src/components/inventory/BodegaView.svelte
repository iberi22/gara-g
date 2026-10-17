<script lang="ts">
  import { onMount } from 'svelte';
  import { getLocalAdapter } from '../../lib/local/indexedDbAdapter';
  import { openInventorySnapshot, buildInventorySnapshot, sealInventorySnapshot } from '../../lib/inventory/exportSnapshot';
  import type { InventorySnapshot } from '../../lib/inventory/exportSnapshot';
  import { isLowStock, filterRows, ageInDays } from '../../lib/inventory/bodegaView';
  import { LOCAL_INSTANCE_ID } from '../../lib/appMode';

  // Section 1: Mi inventario
  let localItems: any[] = $state([]);
  let loadingLocal = $state(true);

  // Section 2: Ver otra bodega
  let loadedSnapshot: InventorySnapshot | null = $state(null);
  let snapshotError: string | null = $state(null);
  let filterText = $state('');
  let askPassphrase = $state(false);
  let passphraseInput = $state('');
  let pendingFile: File | null = $state(null);
  let loadingFile = $state(false);

  // Section 3: Exportar
  let exportPassphrase = $state('');
  let exportPassphraseConfirm = $state('');
  let exportUnencrypted = $state(false);
  let exporting = $state(false);

  onMount(async () => {
    try {
      const adapter = getLocalAdapter();
      const items = await adapter.list('inventoryItem', LOCAL_INSTANCE_ID);
      localItems = items.filter((i: any) => !i.deletedAt && !i.deleted_at);
    } catch (e) {
      console.error(e);
    } finally {
      loadingLocal = false;
    }
  });

  async function handleFileSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    loadingFile = true;
    snapshotError = null;
    askPassphrase = false;
    pendingFile = null;
    passphraseInput = '';

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.format === 'swal-inventory-export-enc/v1') {
        pendingFile = file;
        askPassphrase = true;
        loadingFile = false;
        return;
      }

      loadedSnapshot = await openInventorySnapshot(data);
    } catch (e: any) {
      snapshotError = e.message || 'Error al leer el archivo';
    } finally {
      loadingFile = false;
      target.value = '';
    }
  }

  async function handlePassphraseSubmit() {
    if (!pendingFile || !passphraseInput) return;

    loadingFile = true;
    snapshotError = null;

    try {
      const text = await pendingFile.text();
      const data = JSON.parse(text);
      loadedSnapshot = await openInventorySnapshot(data, passphraseInput);
      askPassphrase = false;
      pendingFile = null;
      passphraseInput = '';
    } catch (e: any) {
      snapshotError = e.message || 'Contraseña incorrecta o archivo corrupto';
    } finally {
      loadingFile = false;
    }
  }

  function clearSnapshot() {
    loadedSnapshot = null;
    snapshotError = null;
    filterText = '';
  }

  async function exportMyInventory() {
    exporting = true;
    try {
      const adapter = getLocalAdapter();
      const snapshot = await buildInventorySnapshot(adapter, LOCAL_INSTANCE_ID);

      let blob: Blob;
      let filename = `inventario-${new Date().toISOString().split('T')[0]}`;

      if (exportUnencrypted) {
        blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
        filename += '.json';
      } else {
        if (exportPassphrase !== exportPassphraseConfirm || exportPassphrase.length < 8) {
          alert('Las contraseñas no coinciden o tienen menos de 8 caracteres');
          return;
        }
        const sealed = await sealInventorySnapshot(snapshot, exportPassphrase);
        blob = new Blob([JSON.stringify(sealed, null, 2)], { type: 'application/json' });
        filename += '.enc.json';
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      exportPassphrase = '';
      exportPassphraseConfirm = '';
    } catch (e) {
      console.error(e);
      alert('Error al exportar');
    } finally {
      exporting = false;
    }
  }

  let filteredRows = $derived(loadedSnapshot ? filterRows(loadedSnapshot.items, filterText) : []);
</script>

<div class="bk">
  <!-- Section 1: Mi inventario -->
  <section class="blk swal-card-frame">
    <div class="swal-card-inner inner">
      <h2 class="swal-kicker"><span class="swal-tick" aria-hidden="true"></span> Mi inventario (Solo lectura)</h2>
      {#if loadingLocal}
        <p>Cargando...</p>
      {:else if localItems.length === 0}
        <p>Tu inventario local está vacío. Próximamente podrás editarlo. Shelf puede leer el archivo exportado.</p>
      {:else}
        <p>Tienes {localItems.length} elementos en tu inventario local.</p>
        <p class="hint">Próximamente podrás editarlo desde aquí. Shelf puede leer el archivo exportado.</p>
      {/if}
    </div>
  </section>

  <!-- Section 2: Ver otra bodega -->
  <section class="blk swal-card-frame">
    <div class="swal-card-inner inner">
      <h2 class="swal-kicker"><span class="swal-tick" aria-hidden="true"></span> Ver otra bodega (Solo lectura)</h2>

      {#if loadedSnapshot}
        <div class="badge">
          Origen: <strong>{loadedSnapshot.source.appId}</strong> ({loadedSnapshot.source.instanceId})<br>
          Exportado hace {ageInDays(loadedSnapshot.source.exportedAt)} días ({loadedSnapshot.source.exportedAt.split('T')[0]})
        </div>

        <label class="field">
          <span>Filtrar</span>
          <input type="text" bind:value={filterText} placeholder="Buscar por nombre o SKU..." />
        </label>

        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>SKU</th>
                <th>Cantidad</th>
                <th>Ubicación</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredRows as item}
                <tr class:low-stock={isLowStock(item.quantity, item.minStock)}>
                  <td>{item.name}</td>
                  <td>{item.sku || '-'}</td>
                  <td>{item.quantity} {item.unit || ''}</td>
                  <td>
                    {#if item.locationId}
                      {loadedSnapshot.locations.find((l: any) => l.id === item.locationId)?.name || item.locationId}
                    {:else}
                      -
                    {/if}
                  </td>
                </tr>
              {/each}
              {#if filteredRows.length === 0}
                <tr>
                  <td colspan="4" class="empty-state">No hay resultados</td>
                </tr>
              {/if}
            </tbody>
          </table>
        </div>

        <div class="btns" style="margin-top: 1rem;">
          <button class="btn" onclick={clearSnapshot}>Cerrar archivo</button>
        </div>
      {:else if askPassphrase}
        <p>El archivo está cifrado.</p>
        <label class="field">
          <span>Contraseña de descifrado</span>
          <input type="password" bind:value={passphraseInput} onkeydown={(e) => e.key === 'Enter' && handlePassphraseSubmit()} />
        </label>
        {#if snapshotError}<p class="err">{snapshotError}</p>{/if}
        <div class="btns">
          <button class="btn on" onclick={handlePassphraseSubmit} disabled={loadingFile}>
            {loadingFile ? 'Descifrando...' : 'Descifrar'}
          </button>
          <button class="btn" onclick={() => { askPassphrase = false; pendingFile = null; snapshotError = null; }}>Cancelar</button>
        </div>
      {:else}
        <p>Carga un archivo de inventario exportado para verlo aquí. No se guardará nada.</p>
        <label class="btn file-btn">
          <span>{loadingFile ? 'Cargando...' : 'Seleccionar archivo'}</span>
          <input type="file" accept=".json" onchange={handleFileSelect} disabled={loadingFile} hidden />
        </label>
        {#if snapshotError}<p class="err">{snapshotError}</p>{/if}
      {/if}
    </div>
  </section>

  <!-- Section 3: Exportar -->
  <section class="blk swal-card-frame">
    <div class="swal-card-inner inner">
      <h2 class="swal-kicker"><span class="swal-tick" aria-hidden="true"></span> Exportar mi inventario</h2>
      <p class="hint">Exporta tu inventario local para verlo en otra bodega o en Shelf.</p>

      <label class="switch">
        <input type="checkbox" bind:checked={exportUnencrypted} />
        <span>Sin cifrar</span>
      </label>

      {#if exportUnencrypted}
        <p class="err">Advertencia: El archivo se exportará en texto plano. Cualquiera podrá leerlo.</p>
      {:else}
        <label class="field">
          <span>Contraseña (mínimo 8 caracteres)</span>
          <input type="password" bind:value={exportPassphrase} />
        </label>
        <label class="field">
          <span>Confirmar contraseña</span>
          <input type="password" bind:value={exportPassphraseConfirm} />
        </label>
      {/if}

      <div class="btns">
        <button
          class="btn on"
          onclick={exportMyInventory}
          disabled={exporting || (!exportUnencrypted && (exportPassphrase.length < 8 || exportPassphrase !== exportPassphraseConfirm))}
        >
          {exporting ? 'Exportando...' : 'Exportar archivo'}
        </button>
      </div>
    </div>
  </section>
</div>

<style>
  .bk { display: flex; flex-direction: column; gap: 1rem; max-width: 720px; color: var(--swal-text); }
  .inner { padding: 0.875rem 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .inner p { margin: 0; font-size: 0.9375rem; line-height: 1.5; }
  h2 { margin: 0; display: flex; align-items: center; gap: 0.5rem; font-weight: 500; }
  .hint { font-size: 0.8125rem !important; color: var(--swal-text-muted); }
  .err { margin: 0; padding: 0.75rem 1rem; background: var(--swal-danger-bg); color: var(--swal-danger); border: 1px solid var(--swal-danger-muted); font-size: 0.875rem; }
  .badge { background: var(--swal-bg-elevated); padding: 0.75rem; border: 1px solid var(--swal-border); font-size: 0.875rem; border-radius: var(--g-radius-md); }

  .btns { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .btn { min-height: 44px; padding: 0 1rem; font: inherit; font-size: 0.875rem; cursor: pointer; color: var(--swal-text); background: var(--swal-surface); border: 1px solid var(--swal-border-strong); display: inline-flex; align-items: center; }
  .btn:hover:not(:disabled) { background: var(--swal-surface-hover); }
  .btn.on { background: var(--swal-accent); border-color: var(--swal-accent); color: var(--swal-accent-contrast); font-weight: 600; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .field { display: flex; flex-direction: column; gap: 0.375rem; font-size: 0.875rem; }
  input[type='text'], input[type='password'] { min-height: 44px; padding: 0 0.75rem; font: inherit; color: var(--swal-text); background: var(--swal-bg-elevated); border: 1px solid var(--swal-border-strong); }

  .switch { display: flex; gap: 0.625rem; align-items: flex-start; font-size: 0.875rem; min-height: 44px; align-items: center; }
  .switch input { width: 1.25rem; height: 1.25rem; flex: none; accent-color: var(--swal-accent); }

  .table-container { overflow-x: auto; margin-top: 0.5rem; border: 1px solid var(--swal-border); }
  table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.875rem; }
  th, td { padding: 0.75rem 1rem; border-bottom: 1px solid var(--swal-border); }
  th { background: var(--swal-bg-elevated); font-weight: 600; }
  .low-stock td { color: var(--swal-danger); font-weight: 500; }
  .empty-state { text-align: center; color: var(--swal-text-muted); font-style: italic; }
</style>
