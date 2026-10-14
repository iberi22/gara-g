<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getClientMode } from '../../lib/appMode';
  import { parseBackupCode } from '../../lib/e2ee/crypto';
  import { createSyncClient, type SyncResult } from '../../lib/e2ee/syncClient';
  import { downloadMyData } from '../../lib/local/exportMyData';
  import { MARKET } from '../../lib/market';

  const sync = createSyncClient();

  type View = 'loading' | 'off' | 'on';
  let view = $state<View>('loading');
  let mode = $state<'guest' | 'cloud'>('guest');
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');

  // Activar
  let pendingCode = $state(''); // codigo mostrado, aun sin subir
  let confirmText = $state('');
  let copied = $state(false);

  // Activo
  let lastSyncAt = $state<string | null>(null);
  let auto = $state(false);
  let shownCode = $state(''); // vacio = oculto
  let askShow = $state(false);
  let askDisable = $state(false);
  let deleteRemote = $state(true);
  let stopAuto: (() => void) | null = null;

  // Restaurar
  let restoreOpen = $state(false);
  let restoreInput = $state('');
  let restoreCheck = $state<{ ok: boolean; msg: string }>({ ok: false, msg: '' });
  let preview = $state<{ vehicles: number; maintenance: number } | null>(null);
  let restoreMode = $state<'replace' | 'merge'>('merge');

  const lastGroup = $derived(pendingCode ? pendingCode.split('-').at(-1)! : '');
  const confirmed = $derived(!!lastGroup && confirmText.trim().toUpperCase() === lastGroup);

  function refresh() {
    view = sync.isEnabled() ? 'on' : 'off';
    lastSyncAt = sync.readState().lastSyncAt;
    auto = sync.readAuto();
  }

  function applyAuto() {
    stopAuto?.();
    stopAuto = null;
    if (view === 'on' && auto) stopAuto = sync.startAutoSync((r) => report(r));
  }

  function report(r: SyncResult) {
    if (r.status === 'error') { error = r.message; return; }
    error = '';
    lastSyncAt = r.at;
    notice = r.status === 'conflict-resolved' ? 'Se combinaron cambios de otro dispositivo.' : '';
  }

  onMount(() => {
    mode = getClientMode();
    refresh();
    applyAuto();
  });
  onDestroy(() => stopAuto?.());

  async function guard(fn: () => Promise<void>) {
    busy = true;
    error = '';
    try { await fn(); } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { busy = false; }
  }

  const start = () => guard(async () => { pendingCode = await sync.newCode(); confirmText = ''; copied = false; });
  const cancelStart = () => { pendingCode = ''; confirmText = ''; };

  const finishEnable = () => guard(async () => {
    await sync.enable(pendingCode);
    pendingCode = '';
    confirmText = '';
    notice = 'Respaldo activado. La primera copia ya está en la nube, cifrada.';
    refresh();
    applyAuto();
  });

  async function copy(code: string) {
    try { await navigator.clipboard.writeText(code); copied = true; } catch { error = 'No se pudo copiar: selecciona el código y cópialo a mano.'; }
  }

  function download(code: string) {
    const text = `Código de respaldo de GARA-G\n\n${code}\n\nSin este código nadie puede recuperar tu respaldo, ni siquiera nosotros. Guárdalo en un lugar seguro y no lo compartas.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gara-g-codigo-de-respaldo.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  const syncNow = () => guard(async () => {
    const r = await sync.syncNow();
    report(r);
    if (r.status === 'conflict-resolved') notice = 'Se combinaron cambios de otro dispositivo. Recarga la página para verlos.';
  });

  function toggleAuto() {
    sync.writeAuto(auto);
    applyAuto();
  }

  const doDisable = () => guard(async () => {
    stopAuto?.();
    stopAuto = null;
    await sync.disable({ deleteRemote });
    askDisable = false;
    shownCode = '';
    notice = deleteRemote ? 'Respaldo desactivado y borrado de la nube.' : 'Respaldo desactivado en este dispositivo. La copia en la nube sigue ahí: con el código se puede restaurar.';
    refresh();
  });

  async function checkRestore() {
    preview = null;
    if (!restoreInput.trim()) { restoreCheck = { ok: false, msg: '' }; return; }
    try {
      await parseBackupCode(restoreInput);
      restoreCheck = { ok: true, msg: 'Código válido.' };
    } catch (e) {
      restoreCheck = { ok: false, msg: e instanceof Error ? e.message : String(e) };
    }
  }

  const doPreview = () => guard(async () => {
    const p = await sync.preview(restoreInput);
    preview = { vehicles: p.vehicles, maintenance: p.maintenance };
  });

  const doRestore = () => guard(async () => {
    await sync.restore(restoreInput, restoreMode);
    restoreOpen = false;
    restoreInput = '';
    preview = null;
    notice = 'Restaurado. Recarga la página para ver los datos.';
    refresh();
    applyAuto();
  });

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(MARKET.locale, { dateStyle: 'medium', timeStyle: 'short' }) : 'todavía no');
</script>

<div class="bk" data-testid="backup-panel">
  <p class="live" role="status" aria-live="polite">{notice}</p>
  {#if error}<p class="err" role="alert" data-testid="backup-error">{error}</p>{/if}

  {#if mode === 'cloud'}
    <section class="blk swal-card-frame">
      <div class="swal-card-inner inner">
        <p class="hint" data-testid="backup-cloud-note">Tienes sesión: los datos de tu cuenta ya están en la nube. Este respaldo cubre solo los datos del <strong>modo local</strong> de este navegador (el garage sin cuenta).</p>
      </div>
    </section>
  {/if}

  {#if view === 'loading'}
    <p class="swal-kicker">Cargando…</p>

  {:else if view === 'off' && !pendingCode}
    <section class="blk swal-card-frame">
      <div class="swal-card-inner inner">
        <h2 class="swal-kicker"><span class="swal-tick" aria-hidden="true"></span> Respaldo cifrado</h2>
        <p>Tus datos del modo local viven solo en este navegador: si borras los datos del sitio o cambias de equipo, se pierden. El respaldo guarda una copia en la nube, <strong>cifrada en este dispositivo antes de subirse</strong>.</p>
        <ul class="list">
          <li>Se cifra todo: vehículos, mantenimientos y preferencias.</li>
          <li>El servidor guarda solo texto cifrado y no puede leerlo.</li>
          <li>Se protege con un <strong>código de respaldo</strong> que verás una sola vez al activarlo.</li>
          <li><strong>Si pierdes el código, nadie puede recuperar el respaldo</strong>, ni siquiera nosotros.</li>
        </ul>
        <div class="btns">
          <button type="button" class="btn on" onclick={start} disabled={busy} data-testid="backup-enable">Activar respaldo cifrado</button>
        </div>
      </div>
    </section>

  {:else if view === 'off' && pendingCode}
    <section class="blk swal-card-frame" aria-labelledby="code-h">
      <div class="swal-card-inner inner">
        <h2 id="code-h" class="swal-kicker"><span class="swal-tick" aria-hidden="true"></span> Tu código de respaldo</h2>
        <p class="code" data-testid="backup-code" aria-label="Código de respaldo">{#each pendingCode.split('-') as g, i}<span class="grp">{g}{i < 6 ? '-' : ''}</span>{/each}</p>
        <div class="btns">
          <button type="button" class="btn" onclick={() => copy(pendingCode)}>{copied ? 'Copiado' : 'Copiar'}</button>
          <button type="button" class="btn" onclick={() => download(pendingCode)}>Descargar .txt</button>
        </div>
        <p class="hint">Guárdalo ahora en un gestor de contraseñas o impreso. No volverá a mostrarse solo: para verlo después tendrás que confirmarlo en esta página.</p>
        <label class="field">
          <span>Para confirmar que lo guardaste, escribe el último grupo ({lastGroup.length} caracteres)</span>
          <input type="text" bind:value={confirmText} autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="8" data-testid="backup-confirm" />
        </label>
        <div class="btns">
          <button type="button" class="btn on" onclick={finishEnable} disabled={!confirmed || busy} data-testid="backup-finish">{busy ? 'Subiendo…' : 'Ya lo guardé, subir la primera copia'}</button>
          <button type="button" class="btn" onclick={cancelStart} disabled={busy}>Cancelar</button>
        </div>
      </div>
    </section>

  {:else}
    <section class="blk swal-card-frame">
      <div class="swal-card-inner inner">
        <h2 class="swal-kicker"><span class="swal-tick" aria-hidden="true"></span> Respaldo activo</h2>
        <p data-testid="backup-last">Última sincronización: <strong>{fmt(lastSyncAt)}</strong></p>
        <div class="btns">
          <button type="button" class="btn on" onclick={syncNow} disabled={busy} data-testid="backup-sync">{busy ? 'Sincronizando…' : 'Sincronizar ahora'}</button>
        </div>
        <label class="switch">
          <input type="checkbox" role="switch" bind:checked={auto} onchange={toggleAuto} data-testid="backup-auto" />
          <span>Sincronización automática (5 s después de cada cambio y al salir de la página)</span>
        </label>
      </div>
    </section>

    <section class="blk swal-card-frame">
      <div class="swal-card-inner inner">
        <h2 class="swal-kicker"><span class="swal-tick" aria-hidden="true"></span> Código</h2>
        {#if shownCode}
          <p class="code" data-testid="backup-code">{#each shownCode.split('-') as g, i}<span class="grp">{g}{i < 6 ? '-' : ''}</span>{/each}</p>
          <div class="btns">
            <button type="button" class="btn" onclick={() => copy(shownCode)}>{copied ? 'Copiado' : 'Copiar'}</button>
            <button type="button" class="btn" onclick={() => download(shownCode)}>Descargar .txt</button>
            <button type="button" class="btn" onclick={() => { shownCode = ''; }}>Ocultar</button>
          </div>
        {:else if askShow}
          <p class="hint">Cualquiera que vea este código puede leer y borrar tu respaldo. Asegúrate de que nadie mira tu pantalla.</p>
          <div class="btns">
            <button type="button" class="btn on" onclick={() => { shownCode = sync.getCode() ?? ''; askShow = false; copied = false; }} data-testid="backup-show-yes">Sí, mostrar el código</button>
            <button type="button" class="btn" onclick={() => { askShow = false; }}>Cancelar</button>
          </div>
        {:else}
          <div class="btns"><button type="button" class="btn" onclick={() => { askShow = true; }} data-testid="backup-show">Mostrar código</button></div>
        {/if}
      </div>
    </section>

    <section class="blk swal-card-frame">
      <div class="swal-card-inner inner">
        <h2 class="swal-kicker"><span class="swal-tick" aria-hidden="true"></span> Desactivar</h2>
        {#if askDisable}
          <p class="hint">Este dispositivo dejará de subir copias y olvidará el código. Si no lo tienes guardado, no podrás restaurar.</p>
          <label class="switch"><input type="checkbox" bind:checked={deleteRemote} /><span>Borrar también el respaldo de la nube</span></label>
          <div class="btns">
            <button type="button" class="btn danger" onclick={doDisable} disabled={busy} data-testid="backup-disable-yes">Desactivar</button>
            <button type="button" class="btn" onclick={() => { askDisable = false; }}>Cancelar</button>
          </div>
        {:else}
          <div class="btns"><button type="button" class="btn" onclick={() => { askDisable = true; }} data-testid="backup-disable">Desactivar en este dispositivo</button></div>
        {/if}
      </div>
    </section>
  {/if}

  <section class="blk swal-card-frame">
    <div class="swal-card-inner inner">
      <h2 class="swal-kicker"><span class="swal-tick" aria-hidden="true"></span> Exportar mis datos</h2>
      <p class="hint">Descarga todos los datos generados en este dispositivo sin cifrar (SQL o JSON). No incluye la clave de sincronización.</p>
      <div class="btns">
        <button type="button" class="btn" onclick={() => downloadMyData('json')} data-testid="backup-export-json">Descargar JSON</button>
        <button type="button" class="btn" onclick={() => downloadMyData('sql')} data-testid="backup-export-sql">Descargar SQL</button>
      </div>
    </div>
  </section>

  <section class="blk swal-card-frame">
    <div class="swal-card-inner inner">
      <h2 class="swal-kicker"><span class="swal-tick" aria-hidden="true"></span> Restaurar en este dispositivo</h2>
      {#if !restoreOpen}
        <div class="btns"><button type="button" class="btn" onclick={() => { restoreOpen = true; }} data-testid="backup-restore-open">Restaurar con un código</button></div>
      {:else}
        <label class="field">
          <span>Código de respaldo</span>
          <input type="text" bind:value={restoreInput} oninput={checkRestore} autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" aria-describedby="restore-msg" data-testid="backup-restore-input" />
        </label>
        <p id="restore-msg" class="hint" class:okmsg={restoreCheck.ok} class:badmsg={!!restoreCheck.msg && !restoreCheck.ok} aria-live="polite">{restoreCheck.msg || ' '}</p>
        {#if !preview}
          <div class="btns">
            <button type="button" class="btn on" onclick={doPreview} disabled={!restoreCheck.ok || busy} data-testid="backup-preview">{busy ? 'Descargando…' : 'Ver qué hay en el respaldo'}</button>
            <button type="button" class="btn" onclick={() => { restoreOpen = false; restoreInput = ''; restoreCheck = { ok: false, msg: '' }; }}>Cancelar</button>
          </div>
        {:else}
          <p data-testid="backup-preview-result">El respaldo tiene <strong>{preview.vehicles}</strong> vehículo{preview.vehicles === 1 ? '' : 's'} y <strong>{preview.maintenance}</strong> mantenimiento{preview.maintenance === 1 ? '' : 's'}.</p>
          <fieldset class="radios">
            <legend class="swal-kicker">Qué hacer con lo que hay en este dispositivo</legend>
            <label><input type="radio" bind:group={restoreMode} value="merge" /> Combinar: conserva lo de aquí y suma lo del respaldo (gana lo más reciente)</label>
            <label><input type="radio" bind:group={restoreMode} value="replace" /> Reemplazar lo de este dispositivo por el respaldo</label>
          </fieldset>
          <div class="btns">
            <button type="button" class="btn on" onclick={doRestore} disabled={busy} data-testid="backup-restore">{busy ? 'Restaurando…' : 'Restaurar'}</button>
            <button type="button" class="btn" onclick={() => { preview = null; }}>Atrás</button>
          </div>
        {/if}
      {/if}
    </div>
  </section>
</div>

<style>
  .bk { display: flex; flex-direction: column; gap: 1rem; max-width: 720px; color: var(--swal-text); }
  .live { margin: 0; min-height: 1.25rem; font-size: 0.8125rem; color: var(--swal-success); }
  .err { margin: 0; padding: 0.75rem 1rem; background: var(--swal-danger-bg); color: var(--swal-danger); border: 1px solid var(--swal-danger-muted); font-size: 0.875rem; }
  .inner { padding: 0.875rem 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .inner p { margin: 0; font-size: 0.9375rem; line-height: 1.5; }
  h2 { margin: 0; display: flex; align-items: center; gap: 0.5rem; font-weight: 500; }
  .hint { font-size: 0.8125rem !important; color: var(--swal-text-muted); }
  .okmsg { color: var(--swal-success); }
  .badmsg { color: var(--swal-danger); }
  .list { margin: 0; padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.375rem; font-size: 0.9375rem; line-height: 1.5; }
  .code { font-family: var(--swal-font-mono, monospace); font-size: clamp(1.125rem, 5.2vw, 1.75rem) !important; letter-spacing: 0.04em; font-weight: 600; padding: 0.875rem 1rem; background: var(--swal-bg-elevated); border: 1px solid var(--swal-border-strong); display: flex; flex-wrap: wrap; column-gap: 0; user-select: all; }
  .grp { white-space: nowrap; }
  .btns { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .btn { min-height: 44px; padding: 0 1rem; font: inherit; font-size: 0.875rem; cursor: pointer; color: var(--swal-text); background: var(--swal-surface); border: 1px solid var(--swal-border-strong); display: inline-flex; align-items: center; }
  .btn:hover:not(:disabled) { background: var(--swal-surface-hover); }
  .btn.on { background: var(--swal-accent); border-color: var(--swal-accent); color: var(--swal-accent-contrast); font-weight: 600; }
  .btn.danger { border-color: var(--swal-danger); color: var(--swal-danger); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn:focus-visible, input:focus-visible { outline: 2px solid var(--swal-text); outline-offset: 2px; }
  .field { display: flex; flex-direction: column; gap: 0.375rem; font-size: 0.875rem; }
  input[type='text'] { min-height: 44px; padding: 0 0.75rem; font: inherit; font-family: var(--swal-font-mono, monospace); color: var(--swal-text); background: var(--swal-bg-elevated); border: 1px solid var(--swal-border-strong); text-transform: uppercase; }
  .switch, .radios label { display: flex; gap: 0.625rem; align-items: flex-start; font-size: 0.875rem; min-height: 44px; align-items: center; }
  .switch input, .radios input { width: 1.25rem; height: 1.25rem; flex: none; accent-color: var(--swal-accent); }
  .radios { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
</style>
