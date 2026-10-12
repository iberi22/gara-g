<!--
  AdPreview.svelte — La tarjeta de anuncio TAL COMO la ve el usuario en el feed del shop.

  Existe como componente separado (y no como bloque dentro del portal) por dos razones:

    1. Es la MISMA pieza visual en los dos sitios. Si la vista previa del anunciante fuera una
       maqueta parecida pero distinta, el anunciante aprobaría una cosa y el usuario vería
       otra; ese desajuste es la fuente clásica de quejas por anuncios "que se ven distintos".
    2. El texto se escapa SIEMPRE. `{title}`, `{body}` y `{ctaLabel}` son entrada del
       anunciante (van a la base de datos y los ve cualquier usuario): se renderizan como
       texto de Svelte, nunca con {@html}. La URL pasa por el mismo validador de https que
       usa la ruta del clic, para que la vista previa no acepte lo que el servidor va a
       rechazar.

  El enlace NO apunta a la página del anunciante: en el feed real apunta a
  `/api/garage/ads/click?t=…`, que cobra el clic y redirige. Aquí, en la vista previa, va a
  la URL de ejemplo para que se pueda hacer clic sin gastar saldo.
-->
<script lang="ts">
  import { isValidHttpsUrl } from '../../garage/shop/url';

  interface Props {
    title: string;
    body: string;
    ctaLabel: string;
    imageUrl?: string;
    advertiserName: string;
    /** URL real de ejemplo; en el feed es /api/garage/ads/click?t=… */
    href?: string;
  }

  let { title, body, ctaLabel, imageUrl, advertiserName, href }: Props = $props();

  const imagenValida = $derived(isValidHttpsUrl(imageUrl) ? imageUrl : undefined);
  const destino = $derived(isValidHttpsUrl(href) ? href : undefined);
</script>

<article class="ad" data-testid="ad-preview">
  <p class="etiqueta">Patrocinado · {advertiserName}</p>
  {#if imagenValida}
    <img src={imagenValida} alt="" class="imagen" loading="lazy" />
  {/if}
  <h4 class="titulo">{title}</h4>
  <p class="cuerpo">{body}</p>
  {#if destino}
    <a class="cta" href={destino} target="_blank" rel="noopener noreferrer">{ctaLabel}</a>
  {:else}
    <span class="cta cta-inactiva">{ctaLabel || 'Ver'}</span>
  {/if}
</article>

<style>
  .ad {
    border: 1px solid var(--swal-border-light);
    border-radius: 0;
    padding: 0.75rem;
    background: var(--swal-surface);
    color: var(--swal-text);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  /* La etiqueta de patrocinado es obligatoria (docs/garage/ARCHITECTURE.md): sin ella el
     usuario no puede distinguir publicidad de contenido. */
  .etiqueta {
    margin: 0;
    font-family: var(--swal-font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--swal-text-muted);
  }
  .imagen { width: 100%; height: 110px; object-fit: cover; border-radius: 0; }
  .titulo { margin: 0; font-size: 0.98rem; line-height: 1.3; color: var(--swal-text); }
  .cuerpo { margin: 0; font-size: 0.85rem; color: var(--swal-text-secondary); line-height: 1.45; }
  /* Relleno naranja con la tinta de contraste: el blanco daria 2.9:1. */
  .cta {
    align-self: flex-start;
    background: var(--swal-accent);
    color: var(--swal-accent-contrast);
    border-radius: 0;
    padding: 0.3rem 0.7rem;
    font-size: 0.82rem;
    font-weight: 600;
    text-decoration: none;
  }
  a.cta:hover { background: var(--swal-accent-hover); text-decoration: none; }
  /* En la vista previa sin URL válida el botón se ve pero no lleva a ningún lado: mejor que
     sea un <a> roto que un enlace a un sitio inventado. */
  .cta-inactiva { background: var(--swal-surface-active); color: var(--swal-text-muted); }
</style>
