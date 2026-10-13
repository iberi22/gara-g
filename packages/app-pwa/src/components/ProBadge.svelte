<script lang="ts">
  import type { SwalNodeStatus } from '../lib/nodeGate';
  import type { SocioBillingInfo } from '../lib/socioGate';
  import { isProEnabled } from '../lib/nodeGate';
  import { isSocioActivo } from '../lib/socioGate';
  // Nombre visible del tier de facturacion: domain.config.ts. "socio" es solo el nombre interno
  // del gate (socioGate.ts); la insignia ya no lo muestra.
  import { TIER_LABEL } from '../lib/domain.config';

  export let node: SwalNodeStatus | null = null;
  export let socioBilling: SocioBillingInfo | null = null;

  $: proActive = isProEnabled(node);
  $: socioActive = isSocioActivo(socioBilling);
</script>

<div class="pro-badge-container">
  {#if proActive}
    <span class="badge badge-pro" title="Active @swal/node within 60s heartbeat">
      <span class="dot active"></span>
      PRO NODO
    </span>
  {:else}
    <span class="badge badge-inactive" title="No active @swal/node heartbeat <= 60s">
      <span class="dot inactive"></span>
      NODO INACTIVO
    </span>
  {/if}

  {#if socioActive}
    <span class="badge badge-socio" title="Active Stripe infrastructure subscription (R2 Quota)">
      <span class="dot socio"></span>
      {TIER_LABEL} CLOUD
    </span>
  {:else}
    <span class="badge badge-nosocio" title="No active Stripe socio subscription">
      <span class="dot inactive"></span>
      {TIER_LABEL} INACTIVO
    </span>
  {/if}
</div>

<style>
  .pro-badge-container {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--g-font-sans);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.6rem;
    background-color: var(--swal-bg-surface);
    color: var(--swal-text-secondary);
    border: 1px solid var(--swal-border);
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
  }

  .dot.active {
    background-color: var(--swal-success);
  }

  .dot.socio {
    background-color: var(--swal-info);
  }

  .dot.inactive {
    background-color: var(--swal-text-muted);
  }
</style>
