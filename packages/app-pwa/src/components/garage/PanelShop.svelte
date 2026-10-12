<script lang="ts">
/**
 * PanelShop.svelte — Panel de Ofertas, Servicios y Anuncios Patrocinados (Shop).
 *
 * Muestra anuncios servidos por la subasta (con etiqueta "Patrocinado" y registro de
 * impresiones por visibilidad ≥50% durante ≥1s) y publicaciones comerciales orgánicas.
 * Los clics de anuncios conducen a /api/garage/ads/click?t=... para auditoría y cobro CPC.
 */
import { onDestroy } from 'svelte';
import type { ShopFeed } from '../../garage/contracts';
import { adTracker } from './ads';
import { garageApi } from './api';
import { formatTimeAgo } from './formatters';

interface Props {
  vehicleId?: string;
}

const { vehicleId }: Props = $props();

let shopFeed = $state<ShopFeed | null>(null);
let isLoading = $state(true);

$effect(() => {
  isLoading = true;
  void garageApi.getShop(vehicleId).then((feed) => {
    shopFeed = feed;
    isLoading = false;
  });
});

function registerAd(el: HTMLElement, token: string) {
  adTracker.observe(el, token);
  return {
    destroy() {
      adTracker.unobserve(el);
    },
  };
}

onDestroy(() => {
  adTracker.destroy();
});
</script>

<div class="panel-shop-root">
  {#if isLoading}
    <div class="loading-state">
      <span class="spinner"></span>
      <span>Cargando ofertas y repuestos recomendados...</span>
    </div>
  {:else if shopFeed}
    <!-- Sección de Anuncios Patrocinados -->
    {#if shopFeed.sponsored.length > 0}
      <section class="section-block">
        <div class="section-head">
          <span class="section-badge swal-kicker"><span class="swal-tick" aria-hidden="true"></span> SUBASTA OFICIAL</span>
          <h3 class="section-title">Destacados para tu vehículo</h3>
        </div>

        <div class="ads-grid" role="list">
          {#each shopFeed.sponsored as ad (ad.token)}
            <div
              class="sponsored-card swal-card-frame is-active"
              role="listitem"
              use:registerAd={ad.token}
            >
             <div class="sponsored-inner swal-card-inner">
              <div class="sponsored-top">
                <span class="sponsored-tag">{ad.sponsoredLabel}</span>
                <span class="advertiser-label">{ad.creative.advertiserName}</span>
              </div>

              <h4 class="ad-card-title">{ad.creative.title}</h4>
              <p class="ad-card-body">{ad.creative.body}</p>

              <a
                href={garageApi.getAdClickUrl(ad.token)}
                target="_blank"
                rel="noopener noreferrer"
                class="ad-card-cta swal-chamfer-sm"
              >
                {ad.creative.ctaLabel} ↗
              </a>
             </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Sección de Publicaciones y Novedades Orgánicas -->
    <section class="section-block">
      <div class="section-head">
        <h3 class="section-title">Servicios y Novedades de la Red</h3>
      </div>

      {#if shopFeed.posts.length === 0}
        <p class="empty-text">No hay publicaciones comerciales en este momento.</p>
      {:else}
        <div class="posts-list" role="list">
          {#each shopFeed.posts as post (post.id)}
            <article class="post-card swal-card-frame" role="listitem">
             <div class="post-inner swal-card-inner">
              <div class="post-card-top">
                <span class="kind-tag {post.kind}">
                  {post.kind === 'offer' ? 'PROMOCIÓN' : post.kind === 'service' ? 'TALLER' : 'NOTICIA'}
                </span>
                <span class="post-time">{formatTimeAgo(post.createdAt)}</span>
              </div>

              <h4 class="post-title">{post.title}</h4>
              <p class="post-desc">{post.body}</p>

              {#if post.url}
                <a
                  href={post.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="post-link"
                >
                  Conocer más ↗
                </a>
              {/if}
             </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .panel-shop-root {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .section-block {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .section-head {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .section-badge {
    align-self: flex-start;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.6rem;
    font-weight: 800;
    color: var(--swal-accent-text);
  }
  .section-title {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--swal-text);
    margin: 0;
  }

  /* Anuncios patrocinados: marco naranja, sin degradado. */
  .ads-grid {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .sponsored-inner {
    padding: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .sponsored-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .sponsored-tag {
    background: var(--swal-accent);
    color: var(--swal-accent-contrast);
    font-family: var(--swal-font-mono);
    font-size: 0.6rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 0.15rem 0.45rem;
  }
  .advertiser-label {
    font-size: 0.72rem;
    color: var(--swal-text-muted);
  }
  .ad-card-title {
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--swal-text);
    margin: 0;
  }
  .ad-card-body {
    font-size: 0.76rem;
    color: var(--swal-text-secondary);
    line-height: 1.4;
    margin: 0;
  }
  .ad-card-cta {
    align-self: flex-start;
    background: var(--swal-accent);
    color: var(--swal-accent-contrast);
    text-decoration: none;
    font-size: 0.76rem;
    font-weight: 700;
    padding: 0.4rem 0.85rem;
    margin-top: 0.3rem;
    transition: background 120ms ease;
  }
  .ad-card-cta:hover {
    background: var(--swal-accent-hover);
  }
  .ad-card-cta:focus-visible,
  .post-link:focus-visible {
    outline: 2px solid var(--swal-accent);
    outline-offset: 2px;
  }

  /* Publicaciones */
  .posts-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .post-inner {
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .post-card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .kind-tag {
    font-family: var(--swal-font-mono);
    font-size: 0.6rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    padding: 0.15rem 0.45rem;
  }
  .kind-tag.offer {
    background: var(--swal-success-muted);
    color: var(--swal-success);
  }
  .kind-tag.service {
    background: var(--swal-accent-muted);
    color: var(--swal-accent-text);
  }
  .kind-tag.news {
    background: var(--swal-info-muted);
    color: var(--swal-text-secondary);
  }
  .post-time {
    font-family: var(--swal-font-mono);
    font-size: 0.64rem;
    color: var(--swal-text-muted);
  }
  .post-title {
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--swal-text);
    margin: 0;
  }
  .post-desc {
    font-size: 0.76rem;
    color: var(--swal-text-secondary);
    line-height: 1.4;
    margin: 0;
  }
  .post-link {
    align-self: flex-start;
    color: var(--swal-accent-text);
    text-decoration: none;
    font-size: 0.74rem;
    font-weight: 600;
    margin-top: 0.2rem;
  }
  .post-link:hover {
    text-decoration: underline;
  }

  .empty-text {
    font-size: 0.78rem;
    color: var(--swal-text-muted);
    font-style: italic;
  }

  .loading-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 3rem 1rem;
    color: var(--swal-text-muted);
    font-size: 0.82rem;
  }
  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--swal-border);
    border-top-color: var(--swal-accent);
    border-radius: 50%;
    animation: spin 700ms linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
