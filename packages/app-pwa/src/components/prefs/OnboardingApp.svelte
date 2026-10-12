<script lang="ts">
  /**
   * OnboardingApp — monta el asistente generico con el esquema y el store de GARA-G.
   *
   * Con sesion: perfil, menu y paneles, y las preferencias suben al servidor. Sin sesion: el
   * asistente pregunta donde guardar los datos; al elegir "este dispositivo" fija la cookie
   * de modo local y las preferencias quedan solo en localStorage (sin tocar /api/prefs).
   */
  import { onMount } from 'svelte';
  import OnboardingWizard from '../../lib/swal-prefs/OnboardingWizard.svelte';
  import type { FinishChoice, WizardFeature } from '../../lib/swal-prefs/OnboardingWizard.svelte';
  import { GARA_PREFS_SCHEMA, ONBOARDING_PATH } from '../../lib/prefs.config';
  import { localPrefsStore, prefsStore } from '../../lib/prefs.client';
  import { enterGuestMode } from '../../lib/prefs.guest';
  import { APP_HOME, BACKUP_PATH, getClientMode, isGuestAllowedPath } from '../../lib/appMode';
  import type { Preferences } from '../../lib/swal-prefs';

  let { next = '/fleet', hasSession = true }: { next?: string; hasSession?: boolean } = $props();

  const store = hasSession ? prefsStore : localPrefsStore;

  let value = $state<Preferences | null>(null);
  let error = $state('');

  const dest = $derived(next.startsWith('/fleet') && !next.startsWith('//') ? next : '/fleet');
  // Modo local: a su garage, o a donde venia si esa pagina funciona sin cuenta (p. ej. Ajustes).
  const guestDest = $derived(dest !== '/fleet' && isGuestAllowedPath(dest) ? dest : APP_HOME.guest);
  const initialStorage = getClientMode() === 'guest' ? ('local' as const) : undefined;

  // Lo que ofrece GARA-G. Lo que necesita cuenta lo dice: no se promete nada que el modo local no haga.
  const features: WizardFeature[] = [
    { id: 'garage', title: 'Garage 3D', desc: 'Tu vehículo en 3D con su estado, su plano y su historial.' },
    { id: 'maintenance', title: 'Mantenimiento por km u horas', desc: 'Compromisos por kilometraje, horas de motor o fecha, con aviso al acercarse.' },
    { id: 'documents', title: 'Documentos y vencimientos', desc: 'SOAT, tecnomecánica y licencias con su fecha de vencimiento.', badge: 'Con cuenta' },
    { id: 'fleets', title: 'Flotas y maquinaria', desc: 'Camiones, volquetas y maquinaria amarilla, con conductores y combustible.', badge: 'Con cuenta' },
    { id: 'ai', title: 'Expediente con IA', desc: 'Un asistente que responde sobre tu parque y tus manuales. Tiene un cupo diario.', badge: 'Con cuenta' },
    { id: 'theme', title: 'Tema claro u oscuro', desc: 'Cambia cuando quieras, o sigue el de tu sistema.' },
  ];

  onMount(async () => {
    value = await store.load();
  });

  async function go(p: Preferences, choice?: FinishChoice) {
    if (!hasSession) enterGuestMode();
    const res = await store.save(p);
    // Sin sesion o sin red, save() devuelve ok:false pero las preferencias ya quedaron en
    // localStorage: eso no es un error para el usuario.
    if (!res.ok && !res.prefs.onboarded) {
      error = res.error ?? 'No se pudo guardar';
      return;
    }
    if (hasSession) {
      location.href = dest;
    } else {
      location.href = choice?.backup ? BACKUP_PATH : guestDest;
    }
  }
</script>

{#if value}
  <OnboardingWizard
    schema={GARA_PREFS_SCHEMA}
    {value}
    title="Bienvenido a GARA-G"
    badge="Sin cobro · 3 piden cuenta"
    welcomeLead="Gestión de vehículos, maquinaria y flotas. No hay tarifa. Documentos, flotas e IA piden cuenta."
    {features}
    askStorage={!hasSession}
    {initialStorage}
    defaultPreset="personal"
    cloudHref={`/login?redirect=${encodeURIComponent(ONBOARDING_PATH)}`}
    onfinish={go}
    onskip={() => go({ ...store.get(), onboarded: true }, { backup: false })}
  />
  {#if error}<p role="alert" class="err">{error}</p>{/if}
{:else}
  <p class="swal-kicker loading">Cargando…</p>
{/if}

<style>
  .loading { padding: 2rem; }
  .err { position: fixed; bottom: 1rem; left: 1rem; right: 1rem; margin: 0 auto; max-width: 480px; padding: 0.75rem 1rem; background: var(--swal-danger-bg); color: var(--swal-danger); border: 1px solid var(--swal-danger-muted); }
</style>
