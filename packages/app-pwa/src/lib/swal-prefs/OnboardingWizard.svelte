<script module lang="ts">
export interface WizardFeature {
  id: string;
  title: string;
  desc: string;
  /** Etiqueta corta, p. ej. "Con cuenta". */
  badge?: string;
}
export type StorageChoice = 'local' | 'cloud';
export interface FinishChoice {
  /** Undefined si el asistente no pregunto (`askStorage` apagado). */
  storage?: StorageChoice;
  /** Respaldo cifrado de extremo a extremo marcado (solo con storage 'local'). */
  backup: boolean;
}
</script>

<script lang="ts">
  /**
   * OnboardingWizard — Asistente de bienvenida generico:
   *   [que ofrece] → [donde guardar los datos] → perfil → menu → paneles → listo.
   * Los pasos entre corchetes son opcionales: aparecen solo si se pasa `features` (tarjetas de
   * lo que ofrece la app) y `askStorage` (elegir entre este dispositivo y la nube). Sin ellos
   * son los cuatro pasos de siempre.
   * Parte de `value`, edita una copia local y solo emite al terminar (onfinish) con
   * onboarded:true y la eleccion de almacenamiento. Portable al core @swal/ui: solo importa
   * ./schema, ./resolve y ./PrefsEditor.
   */
  import PrefsEditor from './PrefsEditor.svelte';
  import { applyPreset, defaultPrefs } from './resolve';
  import { applyNeeds, explainNeeds } from './needs';
  import type { Need } from './needs';
  import type { Preferences, PrefsSchema } from './schema';

  interface Props {
    schema: PrefsSchema;
    value: Preferences;
    title?: string;
    onfinish: (p: Preferences, choice: FinishChoice) => void | Promise<void>;
    onskip?: () => void;
    /** Paso "que ofrece": tarjetas breves. Sin esto, el paso no existe. */
    features?: WizardFeature[];
    /** Texto bajo el titulo del paso "que ofrece". */
    welcomeLead?: string;
    /** Sello junto al titulo, p. ej. "100 % gratis". */
    badge?: string;
    /** Paso "donde guardar tus datos" (solo sin sesion). */
    askStorage?: boolean;
    /** Destino de la tarjeta "con mi cuenta" (login). */
    cloudHref?: string;
    /** Eleccion previa (p. ej. ya estaba en modo local). */
    initialStorage?: StorageChoice;
    /** Perfil que se preselecciona si el usuario aun no tiene uno. */
    defaultPreset?: string;
    /** Pregunta "que necesitas" dentro del paso de perfil. Sin esto, no se pregunta. */
    needs?: Need[];
    /** Modulos que las necesidades nunca apagan. */
    needsCore?: string[];
  }

  let {
    schema,
    value,
    title = 'Bienvenido',
    onfinish,
    onskip,
    features,
    welcomeLead = '',
    badge = '',
    askStorage = false,
    cloudHref = '/login',
    initialStorage,
    defaultPreset,
    needs = [],
    needsCore = [],
  }: Props = $props();

  type StepId = 'welcome' | 'storage' | 'profile' | 'menu' | 'panels' | 'done';
  const steps: StepId[] = [
    ...(features?.length ? (['welcome'] as StepId[]) : []),
    ...(askStorage ? (['storage'] as StepId[]) : []),
    'profile',
    'menu',
    'panels',
    'done',
  ];
  const TOTAL = steps.length;
  let step = $state(1);
  const current = $derived(steps[step - 1]);
  let storage = $state<StorageChoice | undefined>(askStorage ? initialStorage : undefined);
  let backup = $state(true);
  let busy = $state(false);
  // Copia local: el asistente no toca `value` hasta el final.
  let draft = $state<Preferences>(structuredClone($state.snapshot(value)) as Preferences);
  // Sin cuenta se preselecciona el perfil personal, salvo que ya haya uno guardado.
  if (askStorage && defaultPreset && !draft.preset) draft = applyPreset(schema, draft, defaultPreset);

  const presets = $derived(schema.presets ?? []);
  const modulesOn = $derived(Object.values(draft.modules).filter(Boolean).length);
  const modulesTotal = $derived(Object.keys(draft.modules).length);
  const panelsOn = $derived(Object.values(draft.panels).filter((p) => p.enabled).length);
  const panelsTotal = $derived(Object.keys(draft.panels).length);

  // Necesidades elegidas (solo del asistente; no se guardan: lo guardado son los modulos y paneles).
  let selectedNeeds = $state<string[]>([]);
  const reasons = $derived(explainNeeds(schema, draft, needs, selectedNeeds));

  function toggleNeed(id: string) {
    selectedNeeds = selectedNeeds.includes(id) ? selectedNeeds.filter((n) => n !== id) : [...selectedNeeds, id];
    // Parte de los valores por defecto para que quitar una necesidad devuelva lo que ella habia tocado.
    const d = defaultPrefs(schema);
    draft = applyNeeds(schema, { ...d, onboarded: draft.onboarded }, needs, selectedNeeds, needsCore);
  }
  function choose(id: string) {
    selectedNeeds = [];
    draft = applyPreset(schema, draft, id);
  }
  function fromScratch() {
    selectedNeeds = [];
    const d = defaultPrefs(schema);
    draft = { ...d, onboarded: draft.onboarded };
  }
  function edit(p: Preferences) {
    draft = p;
  }
  function useLocal() {
    storage = 'local';
    step += 1;
  }
  async function finish() {
    if (busy) return;
    busy = true;
    try {
      await onfinish({ ...$state.snapshot(draft), onboarded: true } as Preferences, {
        storage,
        backup: storage === 'local' && backup,
      });
    } finally {
      busy = false;
    }
  }
</script>

<div class="wz swal-blueprint-bg" data-testid="onboarding-wizard">
  <div class="sheet">
    <header class="top">
      <div class="steps" aria-hidden="true">
        {#each Array(TOTAL) as _, i}
          <span class="tick" class:done={i + 1 < step} class:cur={i + 1 === step}></span>
        {/each}
      </div>
      <p class="swal-kicker" data-testid="wizard-step" aria-live="polite">Paso {step} / {TOTAL}</p>
      {#if onskip}
        <button type="button" class="skip" onclick={() => onskip?.()}>Omitir</button>
      {/if}
    </header>

    {#if current === 'welcome'}
      <section aria-labelledby="wz-hw" data-testid="step-welcome">
        <h1 id="wz-hw" class="h">{title}{#if badge} <span class="free" data-testid="wizard-free">{badge}</span>{/if}</h1>
        {#if welcomeLead}<p class="lead">{welcomeLead}</p>{/if}
        <ul class="presets">
          {#each features ?? [] as f (f.id)}
            <li class="swal-card-frame">
              <div class="swal-card-inner card static" data-testid={`feature-${f.id}`}>
                <span class="name">{f.title}{#if f.badge} <span class="tag">{f.badge}</span>{/if}</span>
                <span class="desc">{f.desc}</span>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {:else if current === 'storage'}
      <section aria-labelledby="wz-hs" data-testid="step-storage">
        <h1 class="h"><span id="wz-hs">Dónde guardar tus datos</span></h1>
        <p class="lead">Puedes empezar ya, sin cuenta, o entrar con la cuenta de tu empresa.</p>
        <ul class="presets">
          <li class="swal-card-frame" class:is-active={storage === 'local'}>
            <div class="swal-card-inner card static" data-testid="storage-local">
              <span class="name">En este dispositivo, sin cuenta</span>
              <span class="desc">Garage, catálogo y ajustes funcionan sin registrarte. Tus datos se guardan en este navegador.</span>
              <p class="warn" role="note" data-testid="storage-warning">
                <svg class="warn-ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span>Solo en este navegador. Si borras los datos del sitio, usas modo privado o pierdes el equipo, se pierden. No se comparten entre dispositivos.</span>
              </p>
              <label class="chk">
                <input type="checkbox" bind:checked={backup} data-testid="backup-checkbox" />
                <span>
                  <strong>Activar el respaldo cifrado de extremo a extremo al terminar</strong>
                  <span class="desc">Se cifra en tu dispositivo con un código que solo tú tienes; el servidor solo guarda datos ilegibles; si pierdes el código nadie puede recuperarlos.</span>
                </span>
              </label>
              <button type="button" class="btn primary choose" onclick={useLocal} data-testid="choose-local">Usar en este dispositivo</button>
            </div>
          </li>
          <li class="swal-card-frame">
            <div class="swal-card-inner card static" data-testid="storage-cloud">
              <span class="name">Con mi cuenta en la nube</span>
              <span class="desc">Para flotas y equipos, con asistente de IA y manuales. La cuenta la crea el administrador de tu empresa.</span>
              <a class="btn choose link" href={cloudHref} data-astro-reload data-testid="choose-cloud">Entrar con mi cuenta</a>
            </div>
          </li>
        </ul>
      </section>
    {:else if current === 'profile'}
      <section aria-labelledby="wz-h1">
        <h1 id="wz-h1" class="h">{title}</h1>
        <p class="lead">Elige un punto de partida. Podrás ajustar el menú y los paneles en los pasos siguientes y cambiarlo cuando quieras en Ajustes.</p>
        {#if needs.length}
          <fieldset class="needs" data-testid="needs">
            <legend class="name">¿Qué necesitas? <span class="desc">Marca todo lo que aplique; el menú y los paneles se arman con eso.</span></legend>
            <ul class="presets">
              {#each needs as n (n.id)}
                <li class="swal-card-frame" class:is-active={selectedNeeds.includes(n.id)}>
                  <button type="button" class="swal-card-inner card" aria-pressed={selectedNeeds.includes(n.id)} data-testid={`need-${n.id}`} onclick={() => toggleNeed(n.id)}>
                    <span class="name">{n.label}</span>
                    {#if n.desc}<span class="desc">{n.desc}</span>{/if}
                  </button>
                </li>
              {/each}
            </ul>
          </fieldset>
        {/if}
        <ul class="presets">
          {#each presets as p (p.id)}
            <li class="swal-card-frame" class:is-active={draft.preset === p.id}>
              <button type="button" class="swal-card-inner card" aria-pressed={draft.preset === p.id} onclick={() => choose(p.id)}>
                <span class="name">{p.label}</span>
                {#if p.description}<span class="desc">{p.description}</span>{/if}
              </button>
            </li>
          {/each}
          <li class="swal-card-frame">
            <button type="button" class="swal-card-inner card" onclick={fromScratch}>
              <span class="name">Empezar desde cero</span>
              <span class="desc">Valores por defecto, sin perfil.</span>
            </button>
          </li>
        </ul>
      </section>
    {:else if current === 'menu'}
      <section aria-labelledby="wz-h2">
        <h1 class="h"><span id="wz-h2">Menú</span></h1>
        <p class="lead">Elige qué secciones aparecen en el menú lateral.</p>
        <PrefsEditor {schema} value={draft} onchange={edit} sections={['modules']} />
      </section>
    {:else if current === 'panels'}
      <section aria-labelledby="wz-h3">
        <h1 class="h"><span id="wz-h3">Paneles</span></h1>
        <p class="lead">Decide qué paneles y ayudas aparecen dentro de cada pantalla.</p>
        <PrefsEditor {schema} value={draft} onchange={edit} sections={['panels']} />
      </section>
    {:else}
      <section aria-labelledby="wz-h4">
        <h1 class="h"><span id="wz-h4">Listo</span></h1>
        <p class="lead">Tu interfaz está configurada.{#if storage === 'local'} {backup ? 'Al entrar te llevamos a activar el respaldo cifrado.' : 'Tus datos se guardan en este navegador.'}{/if}</p>
        <ul class="summary">
          <li class="swal-card-frame"><div class="swal-card-inner sum"><strong data-testid="sum-modules">{modulesOn}</strong><span>de {modulesTotal} módulos activos</span></div></li>
          <li class="swal-card-frame"><div class="swal-card-inner sum"><strong data-testid="sum-panels">{panelsOn}</strong><span>de {panelsTotal} paneles activos</span></div></li>
        </ul>
        {#if reasons.length}
          <h2 class="sub">Por qué se activó</h2>
          <ul class="why" data-testid="sum-reasons">
            {#each reasons as r (r.kind + r.id)}
              <li><strong>{r.label}</strong> <span class="desc">({r.kind === 'module' ? 'módulo' : 'panel'}) por {r.because.join(', ')}</span></li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    <footer class="nav">
      <button type="button" class="btn ghost" onclick={() => (step -= 1)} disabled={step === 1}>Atrás</button>
      {#if step < TOTAL}
        <button type="button" class="btn primary" onclick={() => (step += 1)} disabled={current === 'storage' && !storage}>Siguiente</button>
      {:else}
        <button type="button" class="btn primary" onclick={finish} disabled={busy}>Entrar</button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .wz { min-height: 100vh; padding: 1.5rem 1rem 3rem; color: var(--swal-text); font-family: var(--swal-font-sans, inherit); box-sizing: border-box; }
  .sheet { max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; }
  .top { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .top .swal-kicker { margin: 0; }
  .steps { display: flex; gap: 0.375rem; }
  .tick { width: 28px; height: 6px; background: var(--swal-border-strong); transform: skewX(-24deg); }
  .tick.done { background: var(--swal-text-muted); }
  .tick.cur { background: var(--swal-accent); }
  .skip { margin-left: auto; min-height: 44px; padding: 0 0.5rem; background: transparent; border: 0; cursor: pointer; font: inherit; font-size: 0.875rem; color: var(--swal-text-secondary); text-decoration: underline; }
  .h { margin: 0; font-size: 1.75rem; font-weight: 700; letter-spacing: -0.01em; color: var(--swal-text); }
  .lead { margin: 0.5rem 0 1.25rem; max-width: 60ch; color: var(--swal-text-secondary); line-height: 1.5; }
  .presets, .summary { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr; gap: 0.75rem; }
  @media (min-width: 900px) { .presets { grid-template-columns: 1fr 1fr; } .summary { grid-template-columns: 1fr 1fr; } }
  .card { width: 100%; min-height: 88px; padding: 0.875rem 1rem; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 0.25rem; border: 0; cursor: pointer; text-align: left; font: inherit; color: var(--swal-text); }
  .card:hover { background: var(--swal-surface-hover); }
  .card:focus-visible, .btn:focus-visible, .skip:focus-visible, .chk input:focus-visible { outline: 2px solid var(--swal-text); outline-offset: 2px; }
  .card.static { cursor: default; align-items: stretch; justify-content: flex-start; }
  /* transparent dejaba ver el marco gris (swal-card-frame) y la tarjeta parecia desactivada */
  .card.static:hover { background: var(--swal-surface); }
  .free { display: inline-block; margin-left: 0.5rem; padding: 0.125rem 0.625rem; font-size: 0.875rem; font-weight: 700; vertical-align: middle; background: var(--swal-accent); color: var(--swal-accent-contrast); }
  .tag { display: inline-block; margin-left: 0.375rem; padding: 0 0.375rem; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--swal-text-secondary); border: 1px solid var(--swal-border-strong); }
  .warn { margin: 0.5rem 0 0; padding: 0.625rem 0.75rem; display: flex; gap: 0.5rem; align-items: flex-start; font-size: 0.875rem; line-height: 1.4; color: var(--swal-text); background: var(--swal-warning-muted); border-left: 3px solid var(--swal-warning); }
  .warn-ic { flex-shrink: 0; margin-top: 1px; color: var(--swal-warning); }
  .chk { display: flex; gap: 0.625rem; align-items: flex-start; margin-top: 0.5rem; cursor: pointer; font-size: 0.9375rem; }
  .chk input { width: 20px; height: 20px; margin: 2px 0 0; flex-shrink: 0; accent-color: var(--swal-accent); }
  .chk > span { display: flex; flex-direction: column; gap: 0.25rem; }
  .choose { margin-top: 0.75rem; align-self: flex-start; display: inline-flex; align-items: center; text-decoration: none; }
  .btn.link { color: var(--swal-text); }
  .name { font-size: 1rem; font-weight: 700; }
  .desc { font-size: 0.875rem; line-height: 1.4; color: var(--swal-text-muted); }
  .needs { border: 0; margin: 0 0 1.25rem; padding: 0; }
  .needs legend { margin-bottom: 0.5rem; padding: 0; }
  .sub { margin: 1.25rem 0 0.5rem; font-size: 1rem; }
  .why { margin: 0; padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.25rem; }
  .sum { display: flex; align-items: baseline; gap: 0.75rem; padding: 1rem; }
  .sum strong { font-size: 2rem; font-family: var(--swal-font-mono, monospace); color: var(--swal-text); }
  .sum span { color: var(--swal-text-secondary); }
  .nav { display: flex; justify-content: space-between; gap: 0.75rem; padding-top: 0.5rem; }
  .btn { min-height: 44px; min-width: 112px; padding: 0 1.25rem; font: inherit; font-weight: 600; cursor: pointer; border: 1px solid var(--swal-border-strong); background: var(--swal-surface); color: var(--swal-text); }
  .btn.primary { background: var(--swal-accent); border-color: var(--swal-accent); color: var(--swal-accent-contrast); }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
