<script lang="ts">
  import { onMount } from 'svelte';
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

  // State for enabling protection
  let pinInput = $state('');
  let recoveryCode = $state('');

  // State for change PIN
  let oldPinInput = $state('');
  let newPinInput = $state('');

  async function loadState() {
    try {
      state = await getLockState();
      currentMethod = getMethod();
    } catch (err: any) {
      errorMsg = err.message || 'Error cargando estado';
      state = 'error';
    }
  }

  onMount(() => {
    loadState();
  });

  async function handleEnable(method: 'pin' | 'passkey') {
    errorMsg = '';
    successMsg = '';
    recoveryCode = '';
    if (!/^\d{6}$/.test(pinInput)) {
      errorMsg = 'PIN debe tener exactamente 6 dígitos';
      return;
    }
    try {
      recoveryCode = await enableProtection(method, pinInput);
      await loadState();
      pinInput = '';
    } catch (err: any) {
      errorMsg = err.message || String(err);
    }
  }

  async function handleLock() {
    errorMsg = '';
    successMsg = '';
    try {
      lock();
      await loadState();
    } catch (err: any) {
      errorMsg = err.message || String(err);
    }
  }

  async function handleUnlock() {
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
      await loadState();
      pinInput = '';
    } catch (err: any) {
      errorMsg = err.message || String(err);
    }
  }

  async function handleDisable() {
    errorMsg = '';
    successMsg = '';
    try {
      await disableProtection();
      await loadState();
    } catch (err: any) {
      errorMsg = err.message || String(err);
    }
  }

  async function handleChangePin() {
    errorMsg = '';
    successMsg = '';
    if (!/^\d{6}$/.test(oldPinInput) || !/^\d{6}$/.test(newPinInput)) {
      errorMsg = 'Ambos PINs deben tener exactamente 6 dígitos';
      return;
    }
    try {
      await changePin(oldPinInput, newPinInput);
      await loadState();
      oldPinInput = '';
      newPinInput = '';
      successMsg = 'PIN cambiado correctamente';
    } catch (err: any) {
      errorMsg = err.message || String(err);
    }
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

    {#if state === 'loading'}
      <p class="hint">Cargando...</p>
    {:else if recoveryCode}
      <div class="recovery-box">
        <p class="hint"><strong>Guarda este código de recuperación.</strong> Sin él y sin este teléfono no podrás recuperar los datos encriptados.</p>
        <code class="code-block">{recoveryCode}</code>
        <button type="button" class="btn" onclick={copyCode}>Copiar código</button>
      </div>
    {/if}

    {#if state === 'off'}
      <p class="hint">Tus datos están guardados en texto plano en este navegador. Activa la protección con un PIN de 6 dígitos.</p>

      {#if !recoveryCode}
        <div class="input-group">
          <label for="pin-enable">PIN de 6 dígitos (respaldo obligatorio):</label>
          <input
            id="pin-enable"
            type="password"
            inputmode="numeric"
            maxlength="6"
            autocomplete="off"
            bind:value={pinInput}
          />
        </div>
        <div class="btns">
          <button type="button" class="btn" onclick={() => handleEnable('pin')}>Activar protección</button>
          <button type="button" class="btn" onclick={() => handleEnable('passkey')}>Usar passkey</button>
        </div>
      {/if}

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
          bind:value={pinInput}
        />
      </div>
      <div class="btns">
        <button type="button" class="btn" onclick={handleUnlock}>Desbloquear</button>
      </div>

    {:else if state === 'unlocked'}
      <p class="hint">La protección está activa y el dispositivo está desbloqueado.</p>
      <div class="btns">
        <button type="button" class="btn" onclick={handleLock}>Bloquear ahora</button>
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
            bind:value={newPinInput}
          />
        </div>
        <button type="button" class="btn" onclick={handleChangePin}>Cambiar PIN</button>
      </div>

      <div class="disable-box">
        <p class="hint">Si desactivas la protección, los datos volverán a guardarse en texto plano en este navegador.</p>
        <button type="button" class="btn" onclick={handleDisable}>Desactivar protección</button>
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
          bind:value={pinInput}
        />
      </div>
      <div class="btns">
        <button type="button" class="btn" onclick={handleUnlock}>Reanudar</button>
      </div>
    {:else if state === 'error'}
      <p class="hint">Ocurrió un error con la protección del dispositivo. Por favor, recarga la página o intenta desbloquear.</p>
      <div class="input-group">
        <label for="pin-resume">PIN (si se requiere):</label>
        <input
          id="pin-resume"
          type="password"
          inputmode="numeric"
          maxlength="6"
          autocomplete="off"
          bind:value={pinInput}
        />
      </div>
      <div class="btns">
        <button type="button" class="btn" onclick={handleUnlock}>Reanudar</button>
      </div>
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

  .error-msg { color: var(--swal-error, #d32f2f); font-weight: bold; margin: 0; font-size: 0.875rem; }
  .success-msg { color: var(--swal-success, #2e7d32); font-weight: bold; margin: 0; font-size: 0.875rem; }

  .input-group { display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.5rem; }
  .input-group label { font-size: 0.875rem; color: var(--swal-text); }
  .input-group input { min-height: 44px; padding: 0 0.5rem; font-size: 1rem; font-family: monospace; letter-spacing: 0.25rem; border: 1px solid var(--swal-border-strong); border-radius: 4px; background: var(--swal-surface); color: var(--swal-text); max-width: 150px; }

  .recovery-box { margin-top: 1rem; padding: 1rem; border: 1px dashed var(--swal-border-strong); border-radius: 4px; background: var(--swal-surface-hover); }
  .code-block { display: block; margin: 0.5rem 0 1rem 0; font-family: monospace; font-size: 1.125rem; word-break: break-all; background: var(--swal-surface); padding: 0.5rem; border: 1px solid var(--swal-border-strong); border-radius: 4px; }

  .change-pin-box, .disable-box { margin-top: 1.5rem; border-top: 1px solid var(--swal-border); padding-top: 1rem; }
</style>
