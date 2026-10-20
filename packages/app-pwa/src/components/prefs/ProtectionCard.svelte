<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    getLockState,
    getMethod,
    enableProtection,
    unlock,
    lock,
    disableProtection,
    changePin
  } from '../../lib/local/deviceLock';

  let state = $state<'loading' | 'off' | 'locked' | 'unlocked' | 'transition' | 'error'>('loading');
  let currentMethod = $state<'pin' | 'passkey' | null>(null);
  let errorMsg = $state('');
  let successMsg = $state('');
  // Mientras una acción está en curso (PBKDF2, aviso de passkey…) los botones se deshabilitan.
  let busy = $state(false);

  // State for enabling protection
  let pinInput = $state('');
  let recoveryCode = $state('');
  let recoveryBox = $state<HTMLElement | null>(null);

  // State for change PIN
  let oldPinInput = $state('');
  let newPinInput = $state('');

  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    try {
      await action();
    } finally {
      busy = false;
    }
  }

  async function loadState() {
    try {
      state = await getLockState();
      currentMethod = getMethod();
    } catch (err: any) {
      errorMsg = err.message || 'Error cargando estado';
      state = 'error';
    }
    // El código de recuperación solo se muestra justo tras activar la protección.
    if (state !== 'unlocked') recoveryCode = '';
  }

  onMount(() => {
    loadState();
  });

  function handleEnable(method: 'pin' | 'passkey') {
    return run(async () => {
      errorMsg = '';
      successMsg = '';
      recoveryCode = '';
      if (!/^\d{6}$/.test(pinInput)) {
        errorMsg = 'PIN debe tener exactamente 6 dígitos';
        return;
      }
      try {
        recoveryCode = await enableProtection(method, pinInput);
        pinInput = '';
        await loadState();
        await tick();
        recoveryBox?.focus();
      } catch (err: any) {
        errorMsg = err.message || String(err);
      }
    });
  }

  function handleLock() {
    return run(async () => {
      errorMsg = '';
      successMsg = '';
      recoveryCode = '';
      try {
        lock();
        await loadState();
      } catch (err: any) {
        errorMsg = err.message || String(err);
      }
    });
  }

  function handleUnlock() {
    return run(async () => {
      errorMsg = '';
      successMsg = '';
      // if we are locked, currentMethod is null, so always require pin and pass 'pin'
      if (state === 'locked' || currentMethod === 'pin') {
        if (!/^\d{6}$/.test(pinInput)) {
          errorMsg = 'PIN debe tener exactamente 6 dígitos';
          return;
        }
      }
      try {
        await unlock(currentMethod || 'pin', pinInput);
        pinInput = '';
        await loadState();
      } catch (err: any) {
        errorMsg = err.message || String(err);
      }
    });
  }

  function handleDisable() {
    return run(async () => {
      errorMsg = '';
      successMsg = '';
      recoveryCode = '';
      try {
        await disableProtection();
        await loadState();
      } catch (err: any) {
        errorMsg = err.message || String(err);
      }
    });
  }

  function handleChangePin() {
    return run(async () => {
      errorMsg = '';
      successMsg = '';
      if (!/^\d{6}$/.test(oldPinInput) || !/^\d{6}$/.test(newPinInput)) {
        errorMsg = 'Ambos PINs deben tener exactamente 6 dígitos';
        return;
      }
      try {
        await changePin(oldPinInput, newPinInput);
        oldPinInput = '';
        newPinInput = '';
        await loadState();
        successMsg = 'PIN cambiado correctamente';
      } catch (err: any) {
        errorMsg = err.message || String(err);
      }
    });
  }

  function dismissRecoveryCode() {
    recoveryCode = '';
    successMsg = '';
  }

  async function copyCode() {
    if (recoveryCode) {
      try {
        await navigator.clipboard.writeText(recoveryCode);
        successMsg = 'Código copiado';
      } catch (err) {
        errorMsg = 'No se pudo copiar';
      }
    }
  }
</script>

<section class="blk swal-card-frame" data-testid="protection-card">
  <div class="swal-card-inner inner">
    <h2 class="swal-kicker">
      <span class="swal-tick" aria-hidden="true"></span> Protección del dispositivo
    </h2>

    {#if errorMsg}
      <p class="error-msg" role="alert">{errorMsg}</p>
    {/if}
    {#if successMsg}
      <p class="success-msg" role="status">{successMsg}</p>
    {/if}
    {#if busy}
      <p class="hint" role="status">Procesando…</p>
    {/if}

    {#if state === 'loading'}
      <p class="hint">Cargando...</p>
    {/if}

    {#if recoveryCode && state === 'unlocked'}
      <!-- tabindex=-1: el foco se mueve aquí al aparecer para que el código se anuncie. -->
      <div class="recovery-box" role="group" aria-labelledby="recovery-title" tabindex="-1" bind:this={recoveryBox}>
        <p class="hint" id="recovery-title"><strong>Guarda este código de recuperación.</strong> Si olvidas el PIN, este código es la única forma de desbloquear en este dispositivo.</p>
        <code class="code-block">{recoveryCode}</code>
        <div class="btns">
          <button type="button" class="btn" onclick={copyCode} disabled={busy}>Copiar código</button>
          <button type="button" class="btn" onclick={dismissRecoveryCode} disabled={busy}>Ya lo guardé</button>
        </div>
      </div>
    {/if}

    {#if state === 'off'}
      <p class="hint">Tus datos están guardados en texto plano en este navegador. Activa la protección con un PIN de 6 dígitos.</p>

      <div class="input-group">
        <label for="pin-enable">PIN de 6 dígitos (respaldo obligatorio):</label>
        <input
          id="pin-enable"
          type="password"
          inputmode="numeric"
          maxlength="6"
          autocomplete="off"
          disabled={busy}
          bind:value={pinInput}
        />
      </div>
      <div class="btns">
        <button type="button" class="btn" onclick={() => handleEnable('pin')} disabled={busy}>Activar protección</button>
        <button type="button" class="btn" onclick={() => handleEnable('passkey')} disabled={busy}>Usar passkey</button>
      </div>

    {:else if state === 'locked'}
      <p class="hint">El dispositivo está bloqueado. Ingresa tu PIN para desbloquear.</p>
      <div class="input-group">
        <label for="pin-unlock">PIN de 6 dígitos:</label>
        <input
          id="pin-unlock"
          type="password"
          inputmode="numeric"
          maxlength="6"
          autocomplete="off"
          disabled={busy}
          bind:value={pinInput}
        />
      </div>
      <div class="btns">
        <button type="button" class="btn" onclick={handleUnlock} disabled={busy}>Desbloquear</button>
      </div>

    {:else if state === 'unlocked'}
      <p class="hint">La protección está activa y el dispositivo está desbloqueado.</p>
      <div class="btns">
        <button type="button" class="btn" onclick={handleLock} disabled={busy}>Bloquear ahora</button>
      </div>

      <div class="change-pin-box">
        <h3 class="swal-kicker">Cambiar PIN</h3>
        <div class="input-group">
          <label for="old-pin">PIN actual:</label>
          <input
            id="old-pin"
            type="password"
            inputmode="numeric"
            maxlength="6"
            autocomplete="off"
            disabled={busy}
            bind:value={oldPinInput}
          />
        </div>
        <div class="input-group">
          <label for="new-pin">Nuevo PIN:</label>
          <input
            id="new-pin"
            type="password"
            inputmode="numeric"
            maxlength="6"
            autocomplete="off"
            disabled={busy}
            bind:value={newPinInput}
          />
        </div>
        <button type="button" class="btn" onclick={handleChangePin} disabled={busy}>Cambiar PIN</button>
      </div>

      <div class="disable-box">
        <p class="hint">Si desactivas la protección, los datos volverán a guardarse en texto plano en este navegador.</p>
        <button type="button" class="btn" onclick={handleDisable} disabled={busy}>Desactivar protección</button>
      </div>

    {:else if state === 'transition'}
      <p class="hint">Un cambio de protección anterior no se completó. Desbloquea para reanudar el proceso.</p>
      <div class="input-group">
        <label for="pin-resume">PIN (si se requiere):</label>
        <input
          id="pin-resume"
          type="password"
          inputmode="numeric"
          maxlength="6"
          autocomplete="off"
          disabled={busy}
          bind:value={pinInput}
        />
      </div>
      <div class="btns">
        <button type="button" class="btn" onclick={handleUnlock} disabled={busy}>Reanudar</button>
      </div>
    {:else if state === 'error'}
      <p class="hint">Ocurrió un error con la protección del dispositivo. Recarga la página o contacta con soporte si el problema continúa.</p>
    {/if}
  </div>
</section>

<style>
  .inner { padding: 0.875rem 1rem; display: flex; flex-direction: column; gap: 0.625rem; }
  h2, h3 { margin: 0; display: flex; align-items: center; gap: 0.5rem; font-weight: 500; }
  .hint { margin: 0; font-size: 0.8125rem; color: var(--swal-text-muted); }
  .btns { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
  .btn { min-height: 44px; padding: 0 1rem; font: inherit; font-size: 0.875rem; cursor: pointer; color: var(--swal-text); background: var(--swal-surface); border: 1px solid var(--swal-border-strong); display: inline-flex; align-items: center; text-decoration: none; }
  .btn:hover { background: var(--swal-surface-hover); }
  .btn:focus-visible { outline: 2px solid var(--swal-text); outline-offset: 2px; }
  .btn:disabled { opacity: 0.6; cursor: progress; }

  .error-msg { color: var(--swal-error, #d32f2f); font-weight: bold; margin: 0; font-size: 0.875rem; }
  .success-msg { color: var(--swal-success, #2e7d32); font-weight: bold; margin: 0; font-size: 0.875rem; }

  .input-group { display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.5rem; }
  .input-group label { font-size: 0.875rem; color: var(--swal-text); }
  .input-group input { min-height: 44px; padding: 0 0.5rem; font-size: 1rem; font-family: monospace; letter-spacing: 0.25rem; border: 1px solid var(--swal-border-strong); border-radius: 4px; background: var(--swal-surface); color: var(--swal-text); max-width: 150px; }

  .recovery-box { margin-top: 1rem; padding: 1rem; border: 1px dashed var(--swal-border-strong); border-radius: 4px; background: var(--swal-surface-hover); }
  .recovery-box:focus { outline: 2px solid var(--swal-text); outline-offset: 2px; }
  .code-block { display: block; margin: 0.5rem 0 1rem 0; font-family: monospace; font-size: 1.125rem; word-break: break-all; background: var(--swal-surface); padding: 0.5rem; border: 1px solid var(--swal-border-strong); border-radius: 4px; }

  .change-pin-box, .disable-box { margin-top: 1.5rem; border-top: 1px solid var(--swal-border); padding-top: 1rem; }
</style>
