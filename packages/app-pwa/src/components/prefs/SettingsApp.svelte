<script lang="ts">
  /** SettingsApp — ajustes de interfaz: tema, perfiles, menu y paneles, con autoguardado. */
  import { onMount } from 'svelte';
  import PrefsEditor from '../../lib/swal-prefs/PrefsEditor.svelte';
  import { applyPreset, resolvePrefs } from '../../lib/swal-prefs';
  import type { Preferences } from '../../lib/swal-prefs';
  import { GARA_PREFS_SCHEMA as schema, ONBOARDING_PATH, SETTINGS_PATH } from '../../lib/prefs.config';
  import { localPrefsStore, prefsStore } from '../../lib/prefs.client';
  import { leaveGuestMode } from '../../lib/prefs.guest';
  import { LANDING_QUERY } from '../../lib/appMode';

  // `guest`: sin cuenta. Las preferencias son solo locales (sin /api/prefs, que exige sesion).
  let { guest = false }: { guest?: boolean } = $props();
  const store = guest ? localPrefsStore : prefsStore;

  type Mode = 'light' | 'dark' | 'system';
  type Swal = { get(): Mode; set(m: Mode): void };

  let value = $state<Preferences | null>(null);
  let status = $state<'idle' | 'saving' | 'saved' | 'local' | 'error'>('idle');
  let statusMsg = $state('');
  let mode = $state<Mode>('light');
  let timer: ReturnType<typeof setTimeout> | undefined;

  const themes: { id: Mode; label: string }[] = [
    { id: 'light', label: 'Claro' },
    { id: 'dark', label: 'Oscuro' },
    { id: 'system', label: 'Sistema' },
  ];
  const wizardHref = `${ONBOARDING_PATH}?next=${SETTINGS_PATH}&again=1`;

  const swalTheme = (): Swal | undefined => (window as unknown as { swalTheme?: Swal }).swalTheme;

  onMount(() => {
    const syncTheme = () => (mode = swalTheme()?.get() ?? 'light');
    syncTheme();
    document.addEventListener('swal:themechange', syncTheme);
    store.load().then((p) => (value = p));
    return () => {
      document.removeEventListener('swal:themechange', syncTheme);
      clearTimeout(timer);
    };
  });

  function change(p: Preferences) {
    value = p;
    status = 'saving';
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const res = await store.save(p);
      if (res.ok) {
        status = 'saved';
      } else if (res.error?.startsWith('Sin conexion')) {
        status = 'local';
      } else {
        status = 'error';
        statusMsg = res.error ?? '';
      }
    }, 400);
  }

  // Salir del modo local: borra la cookie y deja los datos de este navegador donde estan.
  function exitLocal() {
    leaveGuestMode();
    location.href = `/?${LANDING_QUERY}=1`;
  }

  const reset = () => change(resolvePrefs(schema, { onboarded: true, version: schema.version }));
</script>

<div class="st" data-testid="settings-app">
  <p class="status swal-kicker" role="status" aria-live="polite" data-testid="settings-status">
    {#if status === 'saving'}Guardando…
    {:else if status === 'saved'}Guardado
    {:else if status === 'local'}Guardado solo en este equipo
    {:else if status === 'error'}No se pudo guardar{statusMsg ? `: ${statusMsg}` : ''}
    {:else}&nbsp;{/if}
  </p>

  <section class="blk swal-card-frame">
    <div class="swal-card-inner inner">
      <h2 class="swal-kicker"><span class="swal-tick" aria-hidden="true"></span> Tema</h2>
      <div class="seg" role="group" aria-label="Tema">
        {#each themes as t (t.id)}
          <button type="button" class="segbtn" class:on={mode === t.id} aria-pressed={mode === t.id} onclick={() => swalTheme()?.set(t.id)}>{t.label}</button>
        {/each}
      </div>
    </div>
  </section>

  {#if guest}
    <section class="blk swal-card-frame" data-testid="guest-exit">
      <div class="swal-card-inner inner">
        <h2 class="swal-kicker"><span class="swal-tick" aria-hidden="true"></span> Modo local</h2>
        <p class="hint">Estás usando GARA-G sin cuenta: tus datos están solo en este navegador. Salir del modo local no borra esos datos; solo deja de abrirte la app sin cuenta.</p>
        <div class="btns">
          <button type="button" class="btn" onclick={exitLocal} data-testid="exit-local">Salir del modo local en este navegador</button>
        </div>
      </div>
    </section>
  {/if}

  {#if value}
    <section class="blk swal-card-frame">
      <div class="swal-card-inner inner">
        <h2 class="swal-kicker"><span class="swal-tick" aria-hidden="true"></span> Perfil</h2>
        <p class="hint">Volver a aplicar un perfil cambia los módulos y paneles que menciona; lo demás queda igual.</p>
        <div class="btns">
          <span class="swal-kicker sr">Volver a aplicar un perfil</span>
          {#each schema.presets ?? [] as p (p.id)}
            <button type="button" class="btn" class:on={value.preset === p.id} title={p.description} onclick={() => change(applyPreset(schema, value!, p.id))}>{p.label}</button>
          {/each}
        </div>
        <div class="btns">
          <button type="button" class="btn" onclick={reset}>Restablecer valores por defecto</button>
          <a class="btn link" href={wizardHref} data-astro-reload>Ver el asistente de bienvenida</a>
        </div>
      </div>
    </section>

    <PrefsEditor {schema} {value} onchange={change} />
  {:else}
    <p class="swal-kicker">Cargando…</p>
  {/if}
</div>

<style>
  .st { display: flex; flex-direction: column; gap: 1rem; max-width: 960px; color: var(--swal-text); }
  .status { margin: 0; min-height: 1.25rem; }
  .inner { padding: 0.875rem 1rem; display: flex; flex-direction: column; gap: 0.625rem; }
  h2 { margin: 0; display: flex; align-items: center; gap: 0.5rem; font-weight: 500; }
  .hint { margin: 0; font-size: 0.8125rem; color: var(--swal-text-muted); }
  .btns { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .btn, .segbtn { min-height: 44px; padding: 0 1rem; font: inherit; font-size: 0.875rem; cursor: pointer; color: var(--swal-text); background: var(--swal-surface); border: 1px solid var(--swal-border-strong); display: inline-flex; align-items: center; text-decoration: none; }
  .btn:hover, .segbtn:hover { background: var(--swal-surface-hover); }
  .btn.on, .segbtn.on { background: var(--swal-accent); border-color: var(--swal-accent); color: var(--swal-accent-contrast); font-weight: 600; }
  .btn:focus-visible, .segbtn:focus-visible { outline: 2px solid var(--swal-text); outline-offset: 2px; }
  .seg { display: inline-flex; flex-wrap: wrap; align-self: flex-start; }
  .seg .segbtn + .segbtn { border-left: 0; }
</style>
