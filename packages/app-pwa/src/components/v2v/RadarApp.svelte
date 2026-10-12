<script lang="ts">
  /**
   * RadarApp — La pantalla del radar V2V: boton de inicio/parada, radar, banner de peligro con
   * voz, contador de vehiculos cercanos y la nota de privacidad.
   *
   * Notas de plataforma:
   * - Geolocalizacion y DeviceMotion (iOS) exigen un gesto del usuario: por eso el puerto y el
   *   nodo se preparan al montar y el click llama a `start()` sin esperas previas.
   * - Una PWA no corre en segundo plano: se pide Screen Wake Lock mientras el radar esta
   *   activo y se vuelve a pedir si la pestaña regresa a primer plano.
   * - `?demo=1` usa trafico simulado sobre el hub en memoria (para ver la UI sin salir a la calle).
   */
  import { onMount } from 'svelte';
  import { acquireV2VPort } from '../../mesh/v2v/port';
  import { createV2VNode, type V2VNode, type V2VState } from '../../mesh/v2v/v2vNode';
  import { createAnnouncer } from '../../mesh/v2v/announcer';
  import { createDemoWorld } from '../../mesh/v2v/demo';
  import { LocalMeshHub } from '../../mesh/localHub';
  import type { VehicleClassName } from '../../mesh/v2v/packet';
  import RadarView from './RadarView.svelte';

  const CLASSES: { id: VehicleClassName; label: string }[] = [
    { id: 'carro', label: 'Carro' },
    { id: 'moto', label: 'Moto' },
    { id: 'camion', label: 'Camión' },
    { id: 'maquinaria', label: 'Maquinaria' },
  ];

  const idle: V2VState = {
    status: 'idle', error: null, motionNote: null, selfId: null, own: null, neighbors: [], hazards: [], nearby: 0,
    level: 'none', headline: null, cell: null, dropped: { flood: 0, invalid: 0, duplicate: 0, unverified: 0 },
  };

  let node = $state<V2VNode | null>(null);
  let st = $state<V2VState>(idle);
  let vehicleClass = $state<VehicleClassName>('carro');
  let simulated = $state(false);
  let demo = $state(false);
  let ready = $state(false);
  let wake: WakeLockSentinel | null = null;
  let wakeOk = $state(false);
  let stopDemo: (() => void) | null = null;
  let unsub: (() => void) | undefined;
  let voiceOn = $state(true);

  const announcer = createAnnouncer((text) => {
    if (!voiceOn || typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-ES';
    u.rate = 1.1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });

  const running = $derived(st.status === 'active' || st.status === 'starting');
  const nearbyText = $derived(
    st.nearby === 0 ? 'Sin vehículos cerca' : st.nearby === 1 ? '1 vehículo cerca' : `${st.nearby} vehículos cerca`,
  );
  const kmh = $derived(st.own ? Math.round(st.own.speedMps * 3.6) : 0);

  // La voz y la vibracion siguen al titular: un cambio de aviso a peligro suena una vez.
  $effect(() => {
    const h = st.headline;
    if (announcer.update(h) && typeof navigator !== 'undefined') navigator.vibrate?.([250, 120, 250]);
  });

  async function holdWake() {
    try {
      wake = (await navigator.wakeLock?.request('screen')) ?? null;
      wakeOk = !!wake;
      wake?.addEventListener('release', () => (wakeOk = false));
    } catch {
      wakeOk = false; // sin permiso o sin soporte: el radar sigue, la pantalla puede apagarse
    }
  }

  function onVisible() {
    if (document.visibilityState === 'visible' && running && !wakeOk) void holdWake();
  }

  onMount(() => {
    demo = new URLSearchParams(location.search).get('demo') === '1';
    let cancelled = false;
    (async () => {
      let portFactory;
      let geo;
      if (demo) {
        const hub = new LocalMeshHub();
        let n = 0;
        portFactory = async () => hub.createPort(`radar-demo-${n++}`);
        const world = createDemoWorld((id) => hub.createPort(id));
        geo = world.geo;
        stopDemo = world.stop;
        simulated = true;
      } else {
        const acquired = await acquireV2VPort();
        portFactory = acquired.portFactory;
        simulated = acquired.simulated;
      }
      if (cancelled) return;
      node = createV2VNode({ portFactory, geo });
      unsub = node.subscribe((s) => (st = s));
      ready = true;
    })();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      unsub?.();
      void node?.stop();
      stopDemo?.();
      void wake?.release();
    };
  });

  function toggle() {
    if (!node) return;
    if (running) {
      void node.stop();
      void wake?.release();
      wake = null;
      wakeOk = false;
      announcer.reset();
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    } else {
      // Sin await antes: el gesto del usuario tiene que llegar vivo a geolocalizacion y DeviceMotion.
      const p = node.start({ vehicleClass });
      void holdWake();
      // "Desbloquea" la voz en iOS, que solo deja hablar tras un gesto.
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.speak(new SpeechSynthesisUtterance(''));
      void p;
    }
  }
</script>

<section class="radar" data-testid="radar-app" data-status={st.status} data-level={st.level}>
  <div class="banner" class:peligro={st.level === 'peligro'} class:aviso={st.level === 'aviso'} role={st.level === 'peligro' ? 'alert' : 'status'} data-testid="radar-banner">
    {#if st.headline}
      <span class="banner-icon" aria-hidden="true">{st.level === 'peligro' ? '⚠' : '!'}</span>
      <span class="banner-text">{st.headline.message}</span>
    {:else if running}
      <span class="banner-text calm">Vía despejada</span>
    {:else}
      <span class="banner-text calm">Radar apagado</span>
    {/if}
  </div>

  <div class="hud-row">
    <div class="stat" data-testid="radar-nearby" aria-live="polite">{nearbyText}</div>
    <div class="stat mono" data-testid="radar-speed">{kmh} km/h</div>
  </div>

  <RadarView neighbors={st.neighbors} hazards={st.hazards} headingDeg={st.own?.headingDeg ?? 0} active={running} />

  <div class="controls">
    <label class="class-pick">
      <span>Mi vehículo</span>
      <select bind:value={vehicleClass} disabled={running} data-testid="radar-class">
        {#each CLASSES as c}<option value={c.id}>{c.label}</option>{/each}
      </select>
    </label>
    <button
      type="button"
      class="start"
      class:stop={running}
      onclick={toggle}
      disabled={!ready}
      data-testid="radar-start"
      aria-pressed={running}
    >
      {running ? 'Detener radar' : 'Iniciar radar'}
    </button>
    <label class="voice"><input type="checkbox" bind:checked={voiceOn} data-testid="radar-voice" /> Voz</label>
  </div>

  <p class="status" data-testid="radar-status" role="status">
    {#if st.status === 'error'}
      {st.error}
    {:else if st.status === 'starting'}
      Buscando señal GPS…
    {:else if running}
      Radar activo{wakeOk ? ' · pantalla encendida' : ''}.
    {:else if !ready}
      Preparando…
    {:else}
      Toca «Iniciar radar» y deja esta pantalla abierta mientras conduces.
    {/if}
    {#if st.motionNote && running}<br />{st.motionNote}{/if}
  </p>

  {#if simulated}
    <p class="note sim" data-testid="radar-simulated">
      {demo
        ? 'Modo demostración: el tráfico que ves es simulado.'
        : 'La red de vehículos cercanos aún no está conectada en esta versión: el radar funciona en modo local y no verá a otros conductores.'}
    </p>
  {/if}

  <p class="note privacy" data-testid="radar-privacy">
    Tu posición solo se comparte con vehículos cercanos, con un id que cambia cada 10 minutos; no se guarda. No hace
    falta cuenta y nada de lo que se envía te identifica.
  </p>
</section>

<style>
  .radar {
    --hud-bg: var(--swal-void);
    --hud-fg: var(--swal-text-inverse);
    --hud-muted: var(--swal-border-strong);
    background: var(--hud-bg);
    color: var(--hud-fg);
    border: 1px solid var(--swal-border-strong);
    padding: 1rem;
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }
  /* En el tema oscuro el texto "inverso" es oscuro: sobre el fondo negro del HUD se usa el texto normal. */
  :global(:root[data-theme='taller-dark']) .radar {
    --hud-fg: var(--swal-text);
    --hud-muted: var(--swal-text-muted);
  }
  .banner {
    min-height: 4.2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    border: 2px solid var(--swal-border-strong);
    font-size: clamp(1.4rem, 5vw, 2.2rem);
    font-weight: 800;
    text-align: center;
    padding: 0.5rem 1rem;
  }
  .banner.aviso { background: var(--swal-accent); color: var(--swal-accent-contrast); border-color: var(--swal-accent); }
  .banner.peligro {
    background: var(--swal-danger);
    color: var(--swal-on-danger);
    border-color: var(--swal-danger);
    animation: pulse 0.7s steps(2) infinite;
  }
  .banner .calm { font-size: 1.1rem; font-weight: 600; color: var(--hud-muted); }
  @keyframes pulse { 50% { filter: brightness(1.25); } }
  @media (prefers-reduced-motion: reduce) { .banner.peligro { animation: none; } }
  .hud-row { display: flex; justify-content: space-between; gap: 1rem; font-size: 1.15rem; font-weight: 700; }
  .mono { font-family: var(--swal-font-mono); }
  .controls { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: end; }
  .class-pick { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8rem; color: var(--hud-muted); }
  .class-pick select {
    background: var(--hud-bg); color: var(--hud-fg); border: 1px solid var(--swal-border-strong);
    padding: 0.6rem; font-size: 1rem; min-height: 48px;
  }
  .start {
    flex: 1;
    min-width: 12rem;
    min-height: 56px;
    font-size: 1.25rem;
    font-weight: 800;
    background: var(--swal-accent);
    color: var(--swal-accent-contrast);
    border: 0;
    cursor: pointer;
  }
  .start.stop { background: transparent; color: var(--hud-fg); border: 2px solid var(--hud-fg); }
  .start:disabled { opacity: 0.5; cursor: wait; }
  .start:focus-visible, select:focus-visible { outline: 3px solid var(--swal-accent); outline-offset: 2px; }
  .voice { display: flex; align-items: center; gap: 0.4rem; min-height: 48px; }
  .status { margin: 0; font-size: 0.95rem; }
  .note { margin: 0; font-size: 0.85rem; color: var(--hud-muted); line-height: 1.4; }
  .note.sim { color: var(--swal-accent); }
</style>
