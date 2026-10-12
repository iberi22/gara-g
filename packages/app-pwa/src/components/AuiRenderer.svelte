<script lang="ts">
import { Badge, Button, Card, Input, Modal, Skeleton, StatusBadge, Table, Tabs } from '@swal/ui';
import { AUI_COMPONENTS, safeAuiTheme, type AuiSpec } from '../lib/aui';

const { spec }: { spec: AuiSpec } = $props();

// Mapa whitelisteado type -> componente Svelte real
const MAP: Record<string, any> = {
  Card,
  Button,
  Badge,
  Input,
  Table,
  Tabs,
  Modal,
  StatusBadge,
  Skeleton,
};

// Tema del agente: validado y limitado al lienzo AUI (ver safeAuiTheme en lib/aui.ts).
const theme = $derived(safeAuiTheme(spec.theme));

// Render helper: si el agente pide data.kind/query, aqui se haria fetch a Xavier/mesh (stub ahora)
// Para build verde dejamos data sin resolver — el componente recibe props tal cual
</script>

<div
  class="aui"
  style:--swal-accent={theme.accent}
  style:--swal-bg={theme.bg}
  style:--swal-radius={theme.radius}
>
  {#if spec.copy?.title}
    <h2 class="aui-title">{spec.copy.title}</h2>
    {#if spec.copy.subtitle}<p class="aui-sub">{spec.copy.subtitle}</p>{/if}
  {/if}

  <div class="aui-grid">
    {#each spec.components as c (c.id)}
      {@const isWhitelisted = AUI_COMPONENTS.includes(c.type as any) || Boolean(MAP[c.type])}
      {#if isWhitelisted}
        <div class="aui-cell" data-aui-id={c.id} data-aui-type={c.type}>
          {#if c.type === 'Card'}
            <div class="g-card aui-card">
              {#if (c.props as any).title}<h4 class="aui-card-title">{(c.props as any).title}</h4>{/if}
              {#if (c.props as any).content}<p class="aui-card-content">{(c.props as any).content}</p>{/if}
            </div>
          {:else if c.type === 'Button'}
            <button class="g-btn g-btn-cyan aui-btn" type="button">
              {(c.props as any).label ?? (c.props as any).children ?? 'Acción'}
            </button>
          {:else if c.type === 'Badge'}
            <span class="g-pill aui-badge">{(c.props as any).label ?? 'Badge'}</span>
          {:else if c.type === 'StatusBadge'}
            <span class="g-pill g-pill-green aui-status">{(c.props as any).label ?? (c.props as any).status ?? 'Activo'}</span>
          {:else if c.type === 'Input'}
            <input class="g-input aui-input" placeholder={(c.props as any).placeholder ?? ''} readonly />
          {:else if c.type === 'Table'}
            <div class="aui-table-wrap" role="region" aria-label="Tabla generada" tabindex="0">
              <table class="g-table aui-table">
                {#if (c.props as any).headers}
                  <thead>
                    <tr>
                      {#each (c.props as any).headers as h}
                        <th>{h}</th>
                      {/each}
                    </tr>
                  </thead>
                {/if}
                {#if (c.props as any).rows}
                  <tbody>
                    {#each (c.props as any).rows as r}
                      <tr>
                        {#each Array.isArray(r) ? r : Object.values(r) as cell}
                          <td>{cell}</td>
                        {/each}
                      </tr>
                    {/each}
                  </tbody>
                {/if}
              </table>
            </div>
          {:else if c.type === 'Skeleton'}
            <div class="aui-skeleton animate-pulse" style="height: 36px; background: var(--swal-surface-active); border-radius: var(--swal-radius);"></div>
          {:else}
            <div class="g-card aui-generic">
              <strong>{c.type}</strong>
              <pre>{JSON.stringify(c.props, null, 2)}</pre>
            </div>
          {/if}
        </div>
      {:else}
        <div class="aui-unknown">Componente no whitelisteado: {c.type}</div>
      {/if}
    {/each}
  </div>
  {#if spec.components.length === 0}
    <p class="aui-empty">AUI vacía — el agente no generó componentes. Solicita al modelo: "genera una Card con métricas de flota"</p>
  {/if}
</div>

<style>
  .aui { display: grid; gap: 1rem; }
  .aui-title { font-size: 1.2rem; font-weight: 800; color: var(--swal-text); }
  .aui-sub { color: var(--swal-text-secondary); margin: 0; }
  .aui-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 0.9rem; }
  .aui-cell { min-width: 0; }
  .aui-table-wrap { overflow-x: auto; }
  .aui-empty { color: var(--swal-text-muted); font-size: 0.9rem; }
  .aui-unknown { color: var(--swal-danger); font-size: 0.85rem; border: 1px dashed var(--swal-danger); padding: 0.5rem; border-radius: var(--swal-radius); }
</style>
