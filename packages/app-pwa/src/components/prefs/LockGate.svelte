<script lang="ts">
  import { onMount } from 'svelte';
  import { getLockState, getMethod, unlock } from '../../lib/local/deviceLock';
  import type { LockState } from '../../lib/local/deviceLock';
  import { VaultError } from '@swal/vault/web';

  let state = $state<LockState>('off');
  let pin = $state('');
  let pinInput = $state<HTMLInputElement | null>(null);
  let method = $state<'pin' | 'passkey' | null>(null);
  let errorMsg = $state<string | null>(null);
  let loading = $state(true);
  let unlocking = $state(false);

  onMount(() => {
    getLockState().then((s) => {
      state = s;
      method = getMethod() as 'pin' | 'passkey' | null;
      loading = false;
    }).catch((err) => {
      console.error(err);
      loading = false;
    });
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
    const isBlocking = !loading && (state === 'locked' || state === 'transition');
    const shell = document.querySelector('.fleet-shell');
    if (isBlocking) {
      if (pinInput) pinInput.focus();
      shell?.setAttribute('inert', '');
    } else {
      shell?.removeAttribute('inert');
    }
    return () => shell?.removeAttribute('inert');
  });
</script>

{#if !loading && (state === 'locked' || state === 'transition')}
  <div class="lock-gate-overlay" data-testid="lock-gate" role="dialog" aria-modal="true" aria-labelledby="lock-gate-title">
    <div class="swal-card-frame">
      <div class="swal-card-inner inner lock-gate-inner">
        <h2 class="swal-kicker" id="lock-gate-title">
          <span class="swal-tick" aria-hidden="true"></span>
          Dispositivo bloqueado
        </h2>

        {#if state === 'transition'}
          <p class="hint">Una modificación anterior de la protección fue interrumpida. Desbloquea el dispositivo para terminarla.</p>
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
          />

          {#if errorMsg}
            <p class="error-msg" role="alert">{errorMsg}</p>
          {/if}

          <div class="btns">
            <button type="submit" class="btn" class:on={true} disabled={unlocking || pin.length !== 6}>
              {unlocking ? 'Desbloqueando...' : 'Desbloquear'}
            </button>
            {#if method === 'passkey' && state !== 'transition'}
              <button type="button" class="btn" disabled={unlocking} onclick={() => handleUnlock('passkey')}>
                Usar passkey
              </button>
            {/if}
          </div>
        </form>
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
