<script lang="ts">
  import { vault, checkExpiry, type DocumentRecord, type DocumentKind, type DocumentStatus } from '../../lib/document.js';

  interface Props {
    instanceId?: string;
    r2Binding?: unknown;
    initialDocuments?: DocumentRecord[];
    /** Vehiculos del tenant de la sesion (id + placa) para elegir en vez de pegar el id. */
    vehicles?: { id: string; label: string }[];
  }

  let { instanceId = 'default', r2Binding = undefined, initialDocuments = [], vehicles = [] }: Props = $props();

  // Svelte 5 Runes state
  let documents = $state<DocumentRecord[]>(initialDocuments);
  let vehicleId = $state('');
  let driverId = $state('');
  let kind = $state<DocumentKind>('insurance');
  let expiryDate = $state('');
  let isUploading = $state(false);
  let selectedFile = $state<File | null>(null);
  let uploadError = $state<string | null>(null);

  const vehicleLabel = (id: string) => vehicles.find((v) => v.id === id)?.label ?? id;

  // Derived rune
  let documentCount = $derived(documents.length);

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      selectedFile = input.files[0];
    }
  }

  async function handleUpload(e: SubmitEvent) {
    e.preventDefault();
    if (!selectedFile) {
      uploadError = 'Elige un archivo para subir';
      return;
    }

    uploadError = null;
    isUploading = true;

    try {
      const docRecord = await vault(
        {
          instanceId,
          vehicleId,
          driverId,
          kind,
          file: selectedFile,
          fileName: selectedFile.name,
          expiry: expiryDate ? new Date(expiryDate) : undefined,
        },
        { r2Binding }
      );

      documents = [docRecord, ...documents];
      selectedFile = null;
      expiryDate = '';
      // Reset input element if available
      const form = e.target as HTMLFormElement;
      form.reset();
    } catch (err: any) {
      uploadError = err?.message || 'No se pudo guardar el documento';
    } finally {
      isUploading = false;
    }
  }

  // Etiqueta visible del estado; el valor guardado no cambia.
  const STATUS_LABELS: Record<string, string> = { active: 'Vigente', valid: 'Vigente', expiring: 'Por vencer', expired: 'Vencido' };
  function statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  function getStatusClass(status: DocumentStatus): string {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'expiring':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'expired':
        return 'bg-red-100 text-red-800 border-red-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  }
</script>

<!-- DocumentVault.svelte -->
<div class="document-vault-container space-y-6 p-4 border rounded-lg bg-card shadow-sm">
  <div class="flex justify-between items-center border-b pb-4">
    <div>
      <h2 class="text-xl font-bold tracking-tight">Almacén de documentos</h2>
      <p class="text-sm text-muted-foreground">
        Documentos guardados: {documentCount}
      </p>
    </div>
  </div>

  <!-- Upload Widget -->
  <form onsubmit={handleUpload} class="upload-widget p-4 border rounded-md bg-muted/30 space-y-4">
    <h3 class="text-md font-semibold">Guardar un documento nuevo</h3>

    {#if uploadError}
      <div class="p-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded">
        {uploadError}
      </div>
    {/if}

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label for="vehicleId" class="block text-xs font-medium text-muted-foreground mb-1">Vehículo</label>
        <select
          id="vehicleId"
          bind:value={vehicleId}
          required
          class="w-full px-3 py-1.5 text-sm border rounded bg-background"
        >
          <option value="" disabled>Elige un vehículo</option>
          {#each vehicles as v (v.id)}
            <option value={v.id}>{v.label}</option>
          {/each}
        </select>
      </div>

      <div>
        <label for="driverId" class="block text-xs font-medium text-muted-foreground mb-1">ID del conductor (opcional)</label>
        <input
          id="driverId"
          type="text"
          bind:value={driverId}
          class="w-full px-3 py-1.5 text-sm border rounded bg-background"
        />
      </div>

      <div>
        <label for="kind" class="block text-xs font-medium text-muted-foreground mb-1">Tipo de documento</label>
        <select id="kind" bind:value={kind} class="w-full px-3 py-1.5 text-sm border rounded bg-background">
          <option value="insurance">Póliza de seguro</option>
          <option value="license">Licencia de conducción</option>
          <option value="inspection">Revisión del vehículo</option>
          <option value="registration">Tarjeta de propiedad</option>
          <option value="other">Otro</option>
        </select>
      </div>

      <div>
        <label for="expiry" class="block text-xs font-medium text-muted-foreground mb-1">Fecha de vencimiento</label>
        <input
          id="expiry"
          type="date"
          bind:value={expiryDate}
          class="w-full px-3 py-1.5 text-sm border rounded bg-background"
        />
      </div>
    </div>

    <div>
      <label for="docFile" class="block text-xs font-medium text-muted-foreground mb-1">Archivo del documento</label>
      <input
        id="docFile"
        type="file"
        onchange={handleFileChange}
        required
        class="w-full text-xs text-muted-foreground file:mr-4 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:opacity-90"
      />
    </div>

    <div class="pt-2">
      <button
        type="submit"
        disabled={isUploading}
        class="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {isUploading ? 'Cifrando y guardando…' : 'Cifrar y guardar documento'}
      </button>
    </div>
  </form>

  <!-- Lista de documentos guardados -->
  <div class="vaulted-list">
    <h3 class="text-md font-semibold mb-3">Documentos guardados</h3>

    <div class="overflow-x-auto" role="region" aria-label="Documentos del almacén" tabindex="0">
      <table class="w-full border-collapse text-left text-sm">
        <thead>
          <tr class="border-b bg-muted/50">
            <th class="p-2">Vehículo</th>
            <th class="p-2">Conductor</th>
            <th class="p-2">Tipo</th>
            <th class="p-2">Huella SHA-256</th>
            <th class="p-2">Clave R2</th>
            <th class="p-2">Vence</th>
            <th class="p-2">Estado</th>
          </tr>
        </thead>
        <tbody>
          {#each documents as doc (doc.id)}
            <tr class="border-b hover:bg-muted/20">
              <td class="p-2 font-mono text-xs">{vehicleLabel(doc.vehicleId)}</td>
              <td class="p-2 text-xs">{doc.driverId || '—'}</td>
              <td class="p-2 capitalize">{doc.kind}</td>
              <td class="p-2 font-mono text-xs max-w-[120px] truncate" title={doc.fileHash}>
                {doc.fileHash.substring(0, 10)}...
              </td>
              <td class="p-2 font-mono text-xs max-w-[150px] truncate" title={doc.r2Key}>
                {doc.r2Key}
              </td>
              <td class="p-2 text-xs">
                {doc.expiry ? new Date(doc.expiry).toLocaleDateString() : 'Sin vencimiento'}
              </td>
              <td class="p-2">
                <span class="px-2 py-0.5 text-xs border rounded-full font-medium capitalize {getStatusClass(doc.status)}">
                  {statusLabel(doc.status)}
                </span>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="7" class="p-4 text-center text-muted-foreground text-sm">
                No hay documentos guardados.
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>
