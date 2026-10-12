<script lang="ts">
  /** VenderApp — el vendedor publica ofertas firmadas, ve las suyas y la demanda agregada de su zona. */
  import { onMount } from 'svelte';
  import type { Market, MarketState } from '../../mesh/datos/market';
  import { CATEGORY_LABELS, CLASS_LABELS, NEED_LABELS, type VendorOffer, parseOffer } from '../../mesh/datos/offer';
  import { EMPTY_DRAFT, type OfferDraft, draftToOffer } from '../../mesh/datos/offerForm';
  import PaymentsNotice from './PaymentsNotice.svelte';
  import OfferCard from './OfferCard.svelte';
  import OfferForm from './OfferForm.svelte';
  import { cityRegions, getMarket, watchMarket } from './controller';
  import './mercado.css';

  const ERRORS: Record<string, string> = {
    forma: 'Revisa los campos: algo no tiene el formato esperado.',
    tamano: 'La oferta es demasiado grande.',
    id: 'Identificador inválido.',
    categoria: 'Elige una categoría de la lista.',
    texto: 'Revisa los textos: nombre, título (3 a 80) y descripción (hasta 500).',
    precio: 'Revisa el precio o el descuento (1 a 100).',
    contacto: 'Revisa el contacto: un celular, un enlace de WhatsApp (wa.me) o un sitio web que empiece por https://.',
    targeting: 'Revisa a quién va dirigida: años (desde ≤ hasta), necesidad y kilómetros.',
    region: 'Elige una ciudad y un radio entre 1 y 200 km.',
    vigencia: 'La vigencia no es válida.',
    expirada: 'La oferta ya vencería.',
    ritmo: 'Publicaste muchas ofertas seguidas; espera un rato.',
  };

  let market = $state<Market | null>(null);
  let s = $state<MarketState | null>(null);
  let real = $state(false);
  let draft = $state<OfferDraft>({ ...EMPTY_DRAFT });
  let error = $state('');
  let busy = $state(false);
  let done = $state('');
  const cities = cityRegions();

  onMount(() => {
    let off = () => {};
    getMarket()
      .then((h) => {
        market = h.market;
        real = h.real;
        off = watchMarket(h.market, (st) => {
          s = st;
          if (!draft.region && st.region) draft.region = st.region;
        });
      })
      .catch((e) => (error = `No se pudo abrir el mercado: ${e instanceof Error ? e.message : e}`));
    return () => off();
  });

  // Vista previa: la misma validacion que al publicar; si aun no es valida no se muestra.
  const preview = $derived.by((): VendorOffer | null => {
    const now = Date.now();
    const r = parseOffer({ ...draftToOffer(draft, now), id: 'vista-previa', createdAt: now, active: true }, now);
    return r.ok ? r.offer : null;
  });

  async function submit() {
    if (!market) return;
    busy = true;
    error = '';
    done = '';
    const res = await market.publishOffer(draftToOffer(draft, Date.now()));
    busy = false;
    if (!res.ok) {
      error = res.error === 'ritmo' ? (res.detail ?? ERRORS.ritmo) : (ERRORS[res.error] ?? 'No se pudo publicar.');
      return;
    }
    done = 'Oferta publicada y firmada.';
    draft = { ...EMPTY_DRAFT, vendor: draft.vendor, region: draft.region };
  }
</script>

<div class="mk" data-testid="vender">
  <header>
    <h2>Vender en el mercado</h2>
    <p>
      Tus ofertas viajan firmadas por la red hasta los dueños de tu ciudad, y cada dueño decide en su dispositivo si le sirven. No sabrás quién las vio. La firma identifica tu nodo; por ahora no hay un sello que verifique tu negocio.
    </p>
    {#if market && !real}<p class="mk-status">Red local de prueba: sin pares reales conectados.</p>{/if}
  </header>

  <PaymentsNotice />

  {#if done}<p role="status" data-testid="published">{done}</p>{/if}
  <OfferForm bind:draft {cities} busy={busy || !market} {error} onsubmit={submit} />

  {#if preview}
    <section aria-labelledby="prev-t">
      <h3 id="prev-t">Así la verá el dueño</h3>
      <OfferCard offer={preview} />
    </section>
  {/if}

  <section class="mk-card" aria-labelledby="own-t">
    <h3 id="own-t">Tus ofertas activas</h3>
    {#if !s || s.own.length === 0}
      <p class="mk-muted" data-testid="own-empty">Aún no tienes ofertas activas.</p>
    {:else}
      <div class="mk-grid">
        {#each s.own as o (o.id)}
          <OfferCard offer={o} onwithdraw={() => market?.withdrawOffer(o.id)} />
        {/each}
      </div>
    {/if}
  </section>

  <section class="mk-card" aria-labelledby="pulse-t">
    <h3 id="pulse-t">Demanda en tu zona</h3>
    <p class="mk-muted">Cuántos dueños distintos mostraron que necesitan algo. Solo se muestran grupos de 3 o más, para no señalar a nadie.</p>
    {#if !s || s.demandPulse.length === 0}
      <p class="mk-muted">Todavía no hay grupos suficientes.</p>
    {:else}
      <ul class="mk-list">
        {#each s.demandPulse as p}
          <li>{p.count} · {NEED_LABELS[p.need]} · {CLASS_LABELS[p.cls]} (a {CATEGORY_LABELS[p.cat]})</li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
