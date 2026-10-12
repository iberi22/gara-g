<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createAlertStore, unreadCount, acknowledge, type Alert } from '../../lib/alert.js';

  interface Props {
    instanceId?: string;
  }

  let { instanceId = 'default' }: Props = $props();

  const alertStore = createAlertStore(instanceId);

  let alerts = $state<Alert[]>([]);
  let selectedSeverity = $state<string>('all');
  let unsubscribe: (() => void) | null = null;

  const unreadAlertsCount = $derived(unreadCount(alerts));

  const filteredAlerts = $derived(
    selectedSeverity === 'all'
      ? alerts
      : alerts.filter((a) => a.severity === selectedSeverity)
  );

  function refresh() {
    alerts = alertStore.listAlerts();
  }

  onMount(() => {
    refresh();
    unsubscribe = alertStore.subscribe(() => {
      refresh();
    });
  });

  onDestroy(() => {
    if (unsubscribe) unsubscribe();
  });

  function handleAck(alert: Alert) {
    alertStore.acknowledgeAlert(alert.id);
    refresh();
  }

  function severityBadgeClass(severity: string): string {
    switch (severity) {
      case 'info':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'warn':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'critical':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'danger':
        return 'bg-red-100 text-red-800 border-red-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  }

  // Etiqueta visible de la severidad; el valor guardado (info/warn/...) no cambia.
  const SEVERITY_LABELS: Record<string, string> = {
    info: 'Info',
    warn: 'Aviso',
    critical: 'Crítica',
    danger: 'Peligro',
  };
  function severityLabel(severity: string): string {
    return SEVERITY_LABELS[severity] ?? severity;
  }

  function kindLabel(kind: string): string {
    return kind.replace('_', ' ').toUpperCase();
  }
</script>

<div class="alert-feed-container space-y-4 font-sans text-foreground">
  <div class="header flex flex-wrap justify-between items-center gap-2 p-4 bg-card border rounded-lg shadow-sm">
    <div class="flex items-center gap-3">
      <h2 class="text-xl font-bold tracking-tight">Alertas</h2>
      <span
        data-testid="unread-badge"
        class="unread-badge inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-600 text-white"
      >
        {unreadAlertsCount} sin leer
      </span>
    </div>

    <div class="filter-controls flex items-center gap-2 text-sm">
      <label for="severity-filter" class="text-muted-foreground font-medium">Severidad:</label>
      <select
        id="severity-filter"
        bind:value={selectedSeverity}
        class="px-2.5 py-1 border rounded bg-background text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <option value="all">Todas las severidades</option>
        <option value="info">Info</option>
        <option value="warn">Aviso</option>
        <option value="critical">Crítica</option>
        <option value="danger">Peligro</option>
      </select>
    </div>
  </div>

  <div class="feed-list space-y-2">
    {#each filteredAlerts as alert (alert.id)}
      <div
        data-testid="alert-item"
        class="alert-card flex flex-col md:flex-row md:items-center justify-between p-4 border rounded-lg bg-card shadow-sm hover:border-muted-foreground/30 transition-colors gap-3 {alert.acknowledged ? 'opacity-70 bg-muted/20' : ''}"
      >
        <div class="alert-info space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <span
              data-testid="severity-badge"
              class="severity-badge px-2 py-0.5 text-xs font-bold border rounded uppercase tracking-wider {severityBadgeClass(alert.severity)}"
            >
              {severityLabel(alert.severity)}
            </span>
            <span class="text-xs font-mono px-2 py-0.5 bg-muted rounded text-muted-foreground">
              {kindLabel(alert.kind)}
            </span>
            <span class="text-xs text-muted-foreground font-mono">
              Veh: {alert.vehicleId} | Flota: {alert.fleetId}
            </span>
          </div>
          <p class="alert-message text-sm font-medium text-foreground">{alert.message}</p>
          <div class="text-xs text-muted-foreground flex items-center gap-3">
            <span>Creada: {new Date(alert.createdAt).toLocaleTimeString()}</span>
            {#if alert.acknowledged}
              <span class="text-green-700 dark:text-green-400 font-semibold">
                ✓ Reconocida {alert.ackedAt ? `a las ${new Date(alert.ackedAt).toLocaleTimeString()}` : ''}
              </span>
            {/if}
          </div>
        </div>

        <div class="alert-actions flex items-center gap-2 self-end md:self-center">
          {#if !alert.acknowledged}
            <button
              data-testid="ack-btn"
              class="ack-button px-3 py-1.5 text-xs font-semibold text-white bg-primary hover:bg-primary/90 rounded shadow-sm transition-all focus:ring-2 focus:ring-primary/50"
              onclick={() => handleAck(alert)}
            >
              Reconocer
            </button>
          {:else}
            <span class="text-xs text-muted-foreground italic px-2 py-1">Reconocida</span>
          {/if}
        </div>
      </div>
    {:else}
      <div class="empty-state p-8 text-center border border-dashed rounded-lg text-muted-foreground">
        No hay alertas para el filtro de severidad: <span class="font-semibold">{selectedSeverity === 'all' ? 'todas' : severityLabel(selectedSeverity)}</span>.
      </div>
    {/each}
  </div>
</div>
