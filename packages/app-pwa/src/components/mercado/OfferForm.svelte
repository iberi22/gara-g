<script lang="ts">
  /** OfferForm — formulario del vendedor. La validacion real la hace parseOffer al publicar. */
  import { CATEGORY_LABELS, CLASS_LABELS, NEED_LABELS, NEED_KEYS, OFFER_CATEGORIES, VEHICLE_CLASSES, type VehicleClass } from '../../mesh/datos/offer';
  import type { OfferDraft } from '../../mesh/datos/offerForm';

  let { draft = $bindable(), cities, busy = false, error = '', onsubmit }: {
    draft: OfferDraft;
    cities: { name: string; cell: string }[];
    busy?: boolean;
    error?: string;
    onsubmit: () => void;
  } = $props();

  function toggleClass(c: VehicleClass) {
    draft.classes = draft.classes.includes(c) ? draft.classes.filter((x) => x !== c) : [...draft.classes, c];
  }
</script>

<form class="mk-card" data-testid="offer-form" onsubmit={(e) => { e.preventDefault(); onsubmit(); }}>
  <h3>Nueva oferta</h3>
  <div class="mk-grid two">
    <label class="mk-field"><span>Nombre de tu negocio</span><input bind:value={draft.vendor} maxlength="60" required /></label>
    <label class="mk-field"><span>Categoría</span>
      <select bind:value={draft.category}>{#each OFFER_CATEGORIES as c}<option value={c}>{CATEGORY_LABELS[c]}</option>{/each}</select>
    </label>
  </div>
  <label class="mk-field"><span>Título</span><input bind:value={draft.title} maxlength="80" required /></label>
  <label class="mk-field"><span>Descripción</span><textarea bind:value={draft.description} maxlength="500"></textarea></label>
  <div class="mk-grid two">
    <label class="mk-field"><span>Precio (COP, opcional)</span><input bind:value={draft.priceCop} inputmode="numeric" /></label>
    <label class="mk-field"><span>Descuento % (opcional)</span><input bind:value={draft.discountPct} inputmode="numeric" /></label>
    <label class="mk-field"><span>Vigencia</span>
      <select bind:value={draft.days}>{#each ['7', '15', '30', '60', '90'] as d}<option value={d}>{d} días</option>{/each}</select>
    </label>
  </div>

  <h4>Cómo acordar contigo</h4>
  <p class="mk-muted">GARA-G solo conecta: el cliente te escribe o te llama y ustedes acuerdan el pago. Escribe un celular, un enlace de WhatsApp (wa.me) o tu sitio web (https).</p>
  <label class="mk-field"><span>Contacto (celular, WhatsApp o web)</span><input bind:value={draft.contact} maxlength="200" inputmode="url" placeholder="300 123 4567 · wa.me/573001234567 · https://tutaller.co" data-testid="contact-input" /></label>
  <label class="mk-chip"><input type="checkbox" bind:checked={draft.acceptsSwalToken} data-testid="swal-token" /> Acepto el token de la red SWAL como pago</label>

  <h4>Dónde atiendes</h4>
  <div class="mk-grid two">
    <label class="mk-field"><span>Ciudad</span>
      <select bind:value={draft.region} required>
        <option value="">Elige la ciudad</option>
        {#each cities as c}<option value={c.cell}>{c.name}</option>{/each}
      </select>
    </label>
    <label class="mk-field"><span>Radio (km)</span><input bind:value={draft.radiusKm} inputmode="numeric" /></label>
  </div>

  <h4>A quién va dirigida</h4>
  <p class="mk-muted">Sin marcar nada, la oferta es para todos en tu zona. Mientras más específica, menos ruido para los dueños.</p>
  <div class="mk-row" role="group" aria-label="Tipo de vehículo">
    {#each VEHICLE_CLASSES as c}
      <button class="mk-chip" type="button" aria-pressed={draft.classes.includes(c)} onclick={() => toggleClass(c)}>{CLASS_LABELS[c]}</button>
    {/each}
  </div>
  <div class="mk-grid two">
    <label class="mk-field"><span>Marcas (separadas por coma)</span><input bind:value={draft.brands} placeholder="Toyota, Renault" /></label>
    <label class="mk-field"><span>Modelos (separados por coma)</span><input bind:value={draft.models} placeholder="Hilux, Duster" /></label>
    <label class="mk-field"><span>Año desde</span><input bind:value={draft.yearFrom} inputmode="numeric" /></label>
    <label class="mk-field"><span>Año hasta</span><input bind:value={draft.yearTo} inputmode="numeric" /></label>
    <label class="mk-field"><span>Cuando el vehículo necesita</span>
      <select bind:value={draft.need}>
        <option value="">Cualquier momento</option>
        {#each NEED_KEYS as n}<option value={n}>{NEED_LABELS[n]}</option>{/each}
      </select>
    </label>
    {#if draft.need}
      <label class="mk-field"><span>…y le faltan menos de (km)</span><input bind:value={draft.withinKm} inputmode="numeric" /></label>
    {/if}
  </div>

  {#if error}<p class="mk-err" role="alert" data-testid="form-error">{error}</p>{/if}
  <div class="mk-row"><button class="mk-btn primary" type="submit" disabled={busy} data-testid="publish">{busy ? 'Publicando…' : 'Publicar oferta firmada'}</button></div>
</form>
