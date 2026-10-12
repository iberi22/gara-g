<script lang="ts">
  /** ConsentPanel — que se recibe y que se comparte. Reusa OptInPreferences de marketplaceOptIn. */
  import type { OptInPreferences } from '../../lib/marketplaceOptIn';
  import { demandCategoryKey, offerCategoryKey, type DemandDetail, type DemandSignal, dueLabel } from '../../mesh/datos/demand';
  import { CATEGORY_LABELS, CLASS_LABELS, NEED_LABELS, OFFER_CATEGORIES, type OfferCategory } from '../../mesh/datos/offer';

  let {
    prefs,
    demandEnabled,
    demandDetail,
    preview,
    available,
    onprefs,
    ondemand,
  }: {
    prefs: OptInPreferences;
    demandEnabled: boolean;
    demandDetail: DemandDetail;
    preview: DemandSignal[];
    available: boolean;
    onprefs: (p: Partial<OptInPreferences>) => void;
    ondemand: (enabled: boolean, detail?: DemandDetail) => void;
  } = $props();

  const has = (key: string) => prefs.categories.includes(key);
  function toggle(key: string) {
    onprefs({ categories: has(key) ? prefs.categories.filter((c) => c !== key) : [...prefs.categories, key] });
  }
  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
</script>

<section class="mk-card" aria-labelledby="consent-t" data-testid="consent-panel">
  <h3 id="consent-t">Qué ofertas quieres recibir</h3>
  <p>Las ofertas llegan a tu dispositivo y se comparan aquí, con tus vehículos. Nadie sabe cuáles viste.</p>
  <div class="mk-row">
    <label class="mk-chip"><input type="checkbox" checked={prefs.enabled} onchange={(e) => onprefs({ enabled: (e.currentTarget as HTMLInputElement).checked })} /> Recibir ofertas</label>
  </div>
  <div class="mk-row" role="group" aria-label="Categorías de ofertas">
    {#each OFFER_CATEGORIES as c}
      <button class="mk-chip" type="button" aria-pressed={has(offerCategoryKey(c))} onclick={() => toggle(offerCategoryKey(c))}>{CATEGORY_LABELS[c]}</button>
    {/each}
  </div>
  <div class="mk-grid two">
    <label class="mk-field"><span>Distancia máxima (km)</span>
      <input type="number" min="1" max="500" value={prefs.maxDistanceKm} onchange={(e) => onprefs({ maxDistanceKm: num(e) })} />
    </label>
  </div>
</section>

<section class="mk-card" aria-labelledby="demand-t" data-testid="demand-panel">
  <h3 id="demand-t">Mostrar mi demanda</h3>
  <p>
    Si lo activas, los vendedores de tu ciudad pueden ver que hay quien necesita, por ejemplo, un cambio de aceite pronto. Así te llegan ofertas mejores. Está apagado hasta que lo enciendas.
  </p>
  <label class="mk-chip"><input type="checkbox" data-testid="demand-toggle" disabled={!available} checked={demandEnabled} onchange={(e) => ondemand((e.currentTarget as HTMLInputElement).checked)} /> Mostrar mi demanda</label>

  <div class="mk-grid two">
    <div>
      <h4>Qué se comparte</h4>
      <ul class="mk-list">
        <li>Qué necesitas (por ejemplo, aceite) y en cuánto tiempo, en un rango como «en menos de 1000 km».</li>
        <li>Tipo de vehículo y marca. Con «más detalle», también el modelo y un rango de 5 años.</li>
        <li>Tu ciudad (una zona de unos 40 km), nada más fino.</li>
        <li>El día, sin la hora.</li>
      </ul>
    </div>
    <div>
      <h4>Qué no se comparte nunca</h4>
      <ul class="mk-list">
        <li>Placa, VIN ni el nombre de tu vehículo.</li>
        <li>Kilometraje exacto.</li>
        <li>Tu posición ni tus recorridos.</li>
        <li>Tu cuenta ni tu nombre.</li>
      </ul>
    </div>
  </div>

  <div class="mk-row" role="group" aria-label="Nivel de detalle">
    <button class="mk-chip" type="button" aria-pressed={demandDetail === 'basic'} onclick={() => ondemand(demandEnabled, 'basic')}>Básico (clase y marca)</button>
    <button class="mk-chip" type="button" aria-pressed={demandDetail === 'full'} onclick={() => ondemand(demandEnabled, 'full')}>Más detalle (modelo y años)</button>
  </div>

  <div class="mk-row" role="group" aria-label="Categorías de demanda">
    {#each OFFER_CATEGORIES as c}
      <button class="mk-chip" type="button" aria-pressed={has(demandCategoryKey(c as OfferCategory))} onclick={() => toggle(demandCategoryKey(c))}>{CATEGORY_LABELS[c]}</button>
    {/each}
  </div>
  <p class="mk-muted">Solo se comparte la demanda de las categorías marcadas, y solo dentro del horario que configures.</p>

  {#if !available}
    <p class="mk-warn mk-muted" data-testid="demand-unavailable">
      Tu demanda no se comparte en este momento: para que sea anónima hace falta una identidad desechable, y ahora no está disponible. Preferimos no publicar nada antes que hacerlo con el identificador fijo de tu dispositivo.
    </p>
  {:else}
    <p class="mk-muted">Cada vez que se comparte, sale con una identidad nueva y desechable que se cierra al terminar, así nadie puede enlazar una vez con otra.</p>
  {/if}

  <div data-testid="demand-preview">
    <h4>Esto es lo que se compartiría ahora</h4>
    {#if preview.length === 0}
      <p class="mk-muted">Nada: {!available ? 'no hay identidad desechable disponible.' : demandEnabled ? 'ninguna categoría marcada, fuera de horario o sin necesidades próximas.' : 'la demanda está apagada.'}</p>
    {:else}
      <ul class="mk-list">
        {#each preview as s}
          <li>
            {NEED_LABELS[s.need]} · {dueLabel(s.due, s.unit)} · {CLASS_LABELS[s.cls]}{s.brand ? ` ${s.brand}` : ''}{s.model ? ` ${s.model}` : ''}{s.yearBucket ? ` (${s.yearBucket})` : ''}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
