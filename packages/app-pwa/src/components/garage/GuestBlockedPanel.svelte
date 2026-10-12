<script lang="ts">
/**
 * GuestBlockedPanel.svelte — Estado vacio de lo que necesita cuenta (modo invitado).
 * Wiki, foro y tienda viven en el servidor; sin cuenta no se hace ninguna peticion.
 */
import { GUEST_BLOCKED_PATH } from '../../lib/appMode';

interface Props {
  /** Que seccion es ("La wiki", "El foro", "La tienda"). */
  what: string;
}

const { what }: Props = $props();
</script>

<div class="gb-root" data-testid="guest-blocked-panel">
  <p class="gb-title">Disponible con cuenta</p>
  <p class="gb-text">
    {what} vive en la nube y necesita una cuenta. Tu garage sigue funcionando sin ella, con los datos guardados en este navegador.
  </p>
  <a class="gb-link" href={GUEST_BLOCKED_PATH}>Ver por qué y cómo tener cuenta</a>
</div>

<style>
  .gb-root {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 1rem;
    border: 1px dashed var(--swal-border-strong);
    background: var(--swal-surface);
  }
  .gb-title {
    margin: 0;
    font-family: var(--swal-font-mono);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--swal-text);
  }
  .gb-text {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.45;
    color: var(--swal-text-secondary);
  }
  .gb-link {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--swal-accent-text);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .gb-link:focus-visible {
    outline: 2px solid var(--swal-accent);
    outline-offset: 2px;
  }
</style>
