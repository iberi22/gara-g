<script lang="ts">
  import { onMount } from 'svelte';
  import { getLockSnapshot, subscribeLockChanges, unlock } from '../../lib/local/deviceLock';
  import type { LockState } from '../../lib/local/deviceLock';
  import { VaultError } from '@swal/vault/web';

  /**
   * Puerta de bloqueo global. Bloquea mientras NO sepa que el dispositivo está
   * libre: durante la carga inicial (loading), con el sobre en 'locked' o
   * 'transition', y con 'error' (sobre ilegible: fail-closed, sin formulario).
   * Mientras bloquea marca como `inert` cada contenedor de la app
   * (`.fleet-shell` y `[data-lock-gate-target]`), así no hay foco ni clics.
   */
  const GATE_TARGETS = '.fleet-shell, [data-lock-gate-target]';

  let state = $state<LockState>('off');
  let loading = $state(true);
  let hasPasskey = $state(false);
  let pin = $state('');
  let pinInput = $state<HTMLInputElement | null>(null);
  let gateEl = $state<HTMLElement | null>(null);
  let errorMsg = $state<string | null>(null);
  let unlocking = $state(false);

  const blocking = $derived(loading || state === 'locked' || state === 'transition' || state === 'error');
  const showForm = $derived(!loading && (state === 'locked' || state === 'transition'));

  async function refresh() {
    try {
      const snap = await getLockSnapshot();
      state = snap.state;
      hasPasskey = snap.hasPasskey;
    } catch (err) {
      console.error(err);
      state = 'error';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void refresh();
    // Otra pestaña puede bloquear o desactivar la protección: releer el sobre.
    return subscribeLockChanges(() => void refresh());
  });

  async function handleUnlock(m: 'pin' | 'passkey') {
    errorMsg = null;
    unlocking = true;
    try {
      await unlock(m, m === 'pin' ? pin : undefined);
      state = 'unlocked';
    } catch (err: unknown) {
      if (err instanceof VaultError) {
        errorMsg = err.message;
      } else if (err instanceof Error) {
        errorMsg = err.message;
      } else {
        errorMsg = 'Error desconocido al desbloquear';
      }
    } finally {
      unlocking = false;
      pin = '';
    }
  }

  function submitPin(e: Event) {
    e.preventDefault();
    handleUnlock('pin');
  }

  $effect(() => {
    const isBlocking = blocking;
    const targets = Array.from(document.querySelectorAll<HTMLElement>(GATE_TARGETS)).filter(
      (t) => !(gateEl && t.contains(gateEl))
    );
    for (const t of targets) {
      if (isBlocking) t.setAttribute('inert', '');
      else t.removeAttribute('inert');
    }
    return () => {
      for (const t of targets) t.removeAttribute('inert');
    };
  });

  // Foco inicial en el PIN cada vez que aparece el formulario.
  $effect(() => {
    if (pinInput) pinInput.focus();
  });
</script>

{#if blocking}
  <div
    class="lock-gate-overlay"
    data-testid="lock-gate"
    data-state={loading ? 'loading' : state}
    role="dialog"
    aria-modal="true"
    aria-labelledby="lock-gate-title"
    aria-describedby={state === 'error' || errorMsg ? 'lock-gate-error' : state === 'transition' ? 'lock-gate-desc' : undefined}
    bind:this={gateEl}
  >
    <div class="swal-card-frame">
      <div class="swal-card-inner inner lock-gate-inner">
        <h2 class="swal-kicker" id="lock-gate-title">
          <span class="swal-tick" aria-hidden="true"></span>
          {#if loading}
            Comprobando protección
          {:else if state === 'error'}
            Protección no disponible
          {:else}
            Dispositivo bloqueado
          {/if}
        </h2>

        {#if loading}
          <p class="hint" role="status">Comprobando la protección de este dispositivo…</p>
        {:else if state === 'error'}
          <p class="error-msg" role="alert" id="lock-gate-error">
            No se puede leer la protección de este dispositivo, así que la app permanece cerrada para proteger tus datos. Recarga la página; si el problema continúa, contacta con soporte.
          </p>
          <div class="btns">
            <button type="button" class="btn on" onclick={() => location.reload()}>Recargar</button>
          </div>
        {:else}
          {#if state === 'transition'}
            <p class="hint" id="lock-gate-desc">Una modificación anterior de la protección fue interrumpida. Desbloquea el dispositivo para terminarla.</p>
          {/if}

          <form onsubmit={submitPin} class="st">
            <label class="sr-only" for="lock-gate-pin">PIN de 6 dígitos</label>
            <input
              id="lock-gate-pin"
              type="password"
              inputmode="numeric"
              pattern={'[0-9]{6}'}
              maxlength="6"
              bind:this={pinInput}
              bind:value={pin}
              placeholder="PIN de 6 dígitos"
              class="input-pin"
              disabled={unlocking}
              required
              autocomplete="current-password"
              aria-invalid={errorMsg ? 'true' : 'false'}
              aria-describedby={errorMsg ? 'lock-gate-error' : undefined}
            />

            {#if errorMsg}
              <p class="error-msg" role="alert" id="lock-gate-error">{errorMsg}</p>
            {/if}

            <div class="btns">
              <button type="submit" class="btn" class:on={true} disabled={unlocking || pin.length !== 6}>
                {unlocking ? 'Desbloqueando...' : 'Desbloquear'}
              </button>
              {#if hasPasskey && state !== 'transition'}
                <button type="button" class="btn" disabled={unlocking} onclick={() => handleUnlock('passkey')}>
                  Usar passkey
                </button>
              {/if}
            </div>
          </form>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .lock-gate-overlay {
    position: fixed;
    inset: 0;
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--swal-surface);
    color: var(--swal-text);
  }

  .lock-gate-inner {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 2rem;
    max-width: 400px;
    width: 100%;
  }

  .st { display: flex; flex-direction: column; gap: 1rem; }
  .hint { margin: 0; font-size: 0.8125rem; color: var(--swal-text-muted); }
  .error-msg { margin: 0; font-size: 0.875rem; color: var(--swal-error, #ff4d4f); font-weight: 600; }

  .input-pin {
    width: 100%;
    min-height: 44px;
    padding: 0 1rem;
    font: inherit;
    font-size: 1.25rem;
    letter-spacing: 0.5em;
    text-align: center;
    color: var(--swal-text);
    background: var(--swal-surface);
    border: 1px solid var(--swal-border-strong);
  }
  .input-pin:focus-visible {
    outline: 2px solid var(--swal-text);
    outline-offset: 2px;
  }

  .btns {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .btn {
    min-height: 44px;
    padding: 0 1rem;
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;
    color: var(--swal-text);
    background: var(--swal-surface);
    border: 1px solid var(--swal-border-strong);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
  }
  .btn:hover:not(:disabled) { background: var(--swal-surface-hover); }
  .btn.on { background: var(--swal-accent); border-color: var(--swal-accent); color: var(--swal-accent-contrast); font-weight: 600; }
  .btn:focus-visible { outline: 2px solid var(--swal-text); outline-offset: 2px; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
