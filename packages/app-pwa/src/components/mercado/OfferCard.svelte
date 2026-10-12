<script lang="ts">
  /** OfferCard — una oferta, con la razon por la que le sale al dueno (o vista previa del vendedor). */
  import { CATEGORY_LABELS, CONTACT_KIND_LABELS, NEED_LABELS, type VendorOffer, parseContact } from '../../mesh/datos/offer';
  import { formatCOP } from '../../lib/vehicleCatalog';

  let {
    offer,
    why = '',
    reasons = [],
    from = '',
    distanceKm,
    onhide,
    onblock,
    onreport,
    onwithdraw,
  }: {
    offer: VendorOffer;
    why?: string;
    reasons?: string[];
    from?: string;
    distanceKm?: number;
    onhide?: () => void;
    onblock?: () => void;
    onreport?: (trigger: HTMLElement) => void;
    onwithdraw?: () => void;
  } = $props();

  const until = $derived(new Date(offer.validUntil).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }));
  // El contacto viaja en una oferta de un desconocido: se vuelve a validar al pintarlo y solo
  // entonces se convierte en enlace (nunca HTML crudo).
  const contact = $derived(offer.contact ? parseContact(offer.contact) : null);
  const contactText = $derived(
    !contact ? '' : contact.kind === 'web' ? new URL(contact.value).hostname : contact.value.replace(/^tel:/, '').replace(/^https:\/\/wa\.me\//, ''),
  );
  const rest = $derived(reasons.filter((r) => r !== why));
</script>

<article class="mk-card offer" data-testid="offer-card">
  <div class="mk-row head">
    <span class="mk-badge">{CATEGORY_LABELS[offer.category]}</span>
    {#if offer.target.need}<span class="mk-badge">{NEED_LABELS[offer.target.need]}</span>{/if}
    {#if offer.discountPct}<span class="mk-badge">-{offer.discountPct}%</span>{/if}
  </div>
  <h4>{offer.title}</h4>
  {#if why}<p class="mk-why" data-testid="offer-why">{why}</p>{/if}
  {#if offer.description}<p class="desc">{offer.description}</p>{/if}
  <div class="mk-row mk-muted">
    <span>{offer.vendor}</span>
    {#if offer.priceCop !== undefined}<span>· {formatCOP(offer.priceCop)}</span>{/if}
    <span>· hasta {until}</span>
    {#if distanceKm !== undefined}<span>· {distanceKm < 1 ? 'en tu ciudad' : `~${distanceKm} km`}</span>{/if}
  </div>
  <div class="deal" data-testid="offer-deal">
    <p class="deal-t">Acordar con el prestador</p>
    {#if contact}
      <div class="mk-row">
        <a
          class="mk-btn"
          href={contact.value}
          rel="noopener noreferrer nofollow"
          target={contact.kind === 'tel' ? undefined : '_blank'}
          data-testid="offer-contact"
        >{CONTACT_KIND_LABELS[contact.kind]}: {contactText}</a>
        {#if offer.acceptsSwalToken}<span class="mk-badge" data-testid="offer-swal">Acepta token SWAL</span>{/if}
      </div>
    {:else}
      <div class="mk-row">
        <span class="mk-muted" data-testid="offer-no-contact">El prestador no dejó un contacto en esta oferta.</span>
        {#if offer.acceptsSwalToken}<span class="mk-badge" data-testid="offer-swal">Acepta token SWAL</span>{/if}
      </div>
    {/if}
    <p class="mk-muted">El pago se acuerda directamente con el prestador o con el token SWAL. GARA-G no cobra.</p>
  </div>
  {#if from}
    <p class="mk-muted">
      Firmada por el nodo <code>{from.slice(0, 10)}</code>. La firma prueba que la oferta es de ese nodo; no verifica que el negocio sea quien dice ser.
    </p>
  {/if}
  {#if rest.length}
    <details>
      <summary class="mk-muted">Por qué te sale</summary>
      <ul class="mk-list">{#each rest as r}<li>{r}</li>{/each}</ul>
    </details>
  {/if}
  {#if onhide || onblock || onreport || onwithdraw}
    <div class="mk-row">
      {#if onhide}<button class="mk-btn" type="button" onclick={onhide}>Ocultar</button>{/if}
      {#if onreport}<button class="mk-btn" type="button" onclick={(e) => onreport(e.currentTarget)}>Reportar</button>{/if}
      {#if onblock}<button class="mk-btn danger" type="button" onclick={onblock}>Bloquear vendedor</button>{/if}
      {#if onwithdraw}<button class="mk-btn danger" type="button" onclick={onwithdraw}>Retirar oferta</button>{/if}
    </div>
  {/if}
</article>

<style>
  .head { gap: 0.4rem; }
  .deal { display: flex; flex-direction: column; gap: 0.4rem; border-top: 1px solid var(--swal-border); padding-top: 0.6rem; }
  .deal-t { font-weight: 700; color: var(--swal-text); }
  .desc { white-space: pre-line; }
  code { font-family: var(--swal-font-mono, monospace); }
</style>
