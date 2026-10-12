<script lang="ts">
/**
 * GuestToolbar.svelte — Acciones del garage en modo invitado, sin salir del HUD.
 * Fila con scroll horizontal en movil. Solo abre dialogos; guardar lo hace GuestDialogs.
 */
import type { GuestDialogKind } from './GuestDialogs.svelte';
import { CHILE_DEMO_FLEET_PATH } from '../../lib/demoChile';

interface Props {
  hasVehicle: boolean;
  usageUnit: 'km' | 'h';
  onopen: (kind: GuestDialogKind) => void;
}

const { hasVehicle, usageUnit, onopen }: Props = $props();
</script>

<div class="gt-root" role="toolbar" aria-label="Acciones del garage local" data-testid="guest-toolbar">
  <button type="button" class="gt-btn gt-primary" data-testid="guest-add" onclick={() => onopen('add')}>+ Vehículo</button>
  {#if hasVehicle}
    <button type="button" class="gt-btn" data-testid="guest-usage" onclick={() => onopen('usage')}>{usageUnit === 'h' ? 'Horómetro' : 'Kilometraje'}</button>
    <button type="button" class="gt-btn" data-testid="guest-maintenance" onclick={() => onopen('maintenance')}>Mantenimiento</button>
    <button type="button" class="gt-btn" data-testid="guest-edit" onclick={() => onopen('edit')}>Editar</button>
    <button type="button" class="gt-btn gt-danger" data-testid="guest-delete" onclick={() => onopen('delete')}>Eliminar</button>
  {/if}
  <!-- Flota demo de solo lectura (datos ficticios): enseña lo que hace una cuenta de empresa. -->
  <a class="gt-btn gt-link" href={CHILE_DEMO_FLEET_PATH} data-testid="guest-demo-fleet">Ver flota demo</a>
</div>

<style>
  .gt-root {
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    padding: 0.1rem 0;
    scrollbar-width: thin;
  }
  .gt-btn {
    flex: none;
    min-height: 32px;
    padding: 0.3rem 0.7rem;
    font-family: var(--swal-font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    background: var(--swal-surface);
    color: var(--swal-text);
    border: 1px solid var(--swal-border-strong);
    cursor: pointer;
  }
  .gt-link {
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }
  .gt-btn:hover {
    border-color: var(--swal-accent);
  }
  .gt-btn:focus-visible {
    outline: 2px solid var(--swal-accent);
    outline-offset: 2px;
  }
  .gt-primary {
    background: var(--swal-accent);
    color: var(--swal-accent-contrast);
    border-color: var(--swal-accent);
  }
  .gt-danger {
    color: var(--swal-danger);
  }
</style>
