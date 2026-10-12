<script lang="ts">
interface Props {
  icon?: string;
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  testId?: string;
}

const {
  icon = '📦',
  title,
  description = 'No se encontraron registros para esta sección.',
  actionLabel,
  actionHref,
  onAction,
  testId = 'empty-state',
}: Props = $props();
</script>

<div class="empty-state g-card" data-testid={testId}>
  <div class="empty-icon" aria-hidden="true">{icon}</div>
  <h3 class="empty-title">{title}</h3>
  {#if description}
    <p class="empty-desc">{description}</p>
  {/if}
  {#if actionLabel}
    <div class="empty-actions">
      {#if actionHref}
        <a href={actionHref} class="g-btn g-btn-cyan empty-btn" data-testid={`${testId}-btn`}>
          {actionLabel}
        </a>
      {:else if onAction}
        <button type="button" class="g-btn g-btn-cyan empty-btn" onclick={onAction} data-testid={`${testId}-btn`}>
          {actionLabel}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 3rem 1.5rem;
    background: var(--swal-bg-elevated);
    border: 1px dashed var(--swal-border-strong);
    border-radius: var(--swal-radius-lg);
    margin: 1.5rem 0;
  }

  .empty-icon {
    font-size: 2.5rem;
    margin-bottom: 0.75rem;
    color: var(--swal-text-faint);
  }

  .empty-title {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--swal-text);
    margin: 0 0 0.4rem 0;
  }

  .empty-desc {
    font-size: 0.85rem;
    color: var(--swal-text-muted);
    max-width: 420px;
    margin: 0 0 1.25rem 0;
    line-height: 1.4;
  }

  .empty-actions {
    display: flex;
    gap: 0.75rem;
  }

  .empty-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: var(--swal-accent);
    border: 1px solid var(--swal-accent);
    color: var(--swal-accent-contrast);
    border-radius: var(--swal-radius-sm);
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    text-decoration: none;
    transition: all 150ms ease;
  }

  .empty-btn:hover {
    background: var(--swal-accent-hover);
    color: var(--swal-accent-contrast);
    text-decoration: none;
  }
</style>
