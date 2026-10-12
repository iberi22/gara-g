<script lang="ts">
  /** MercadoApp — la bandeja del dueno: ofertas emparejadas con sus vehiculos y sus controles de consentimiento. */
  import { onMount, tick } from 'svelte';
  import { getClientMode } from '../../lib/appMode';
  import { DEFAULT_MARKET_PREFS, type Market, type MarketState } from '../../mesh/datos/market';
  import { CATEGORY_LABELS, OFFER_CATEGORIES, type OfferCategory } from '../../mesh/datos/offer';
  import type { OwnerVehicle } from '../../mesh/datos/vehicles';
  import ConsentPanel from './ConsentPanel.svelte';
  import OfferCard from './OfferCard.svelte';
  import PaymentsNotice from './PaymentsNotice.svelte';
  import ReportDialog from './ReportDialog.svelte';
  import TodoVehiculos from './TodoVehiculos.svelte';
  import { cityRegions, getMarket, loadOwnerVehicles, regionFromGeolocation, watchMarket } from './controller';
  import './mercado.css';

  let market = $state<Market | null>(null);
  let real = $state(false);
  let s = $state<MarketState | null>(null);
  let vehicles = $state<OwnerVehicle[]>([]);
  let vehiclesLoaded = $state(false);
  let tab = $state<'para-ti' | 'todo'>('para-ti');
  let error = $state('');
  let locating = $state(false);

  let catFilter = $state<OfferCategory | ''>('');
  let vehicleFilter = $state('');
  let onlyNeeds = $state(false);

  const cities = cityRegions();
  const guest = getClientMode() === 'guest';

  onMount(() => {
    let off = () => {};
    (async () => {
      const h = await getMarket();
      market = h.market;
      real = h.real;
      off = watchMarket(h.market, (st) => (s = st));
      vehicles = await loadOwnerVehicles();
      vehiclesLoaded = true;
      h.market.setVehicles(vehicles);
    })().catch((e) => (error = `No se pudo abrir el mercado: ${e instanceof Error ? e.message : e}`));
    return () => off();
  });

  const inbox = $derived(
    (s?.inbox ?? []).filter(
      (m) =>
        (!catFilter || m.offer.category === catFilter) &&
        (!vehicleFilter || m.vehicleId === vehicleFilter) &&
        (!onlyNeeds || !!m.need),
    ),
  );

  const TABS = [
    { id: 'para-ti', label: 'Para ti' },
    { id: 'todo', label: 'Todo para tus vehículos' },
  ] as const;
  function onTabKey(e: KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : -1;
    if (next < 0) return;
    e.preventDefault();
    tab = TABS[next].id;
    document.getElementById(`tab-${tab}`)?.focus();
  }

  async function pickCity(e: Event) {
    const cell = (e.currentTarget as HTMLSelectElement).value;
    await market?.setRegion(cell || null);
  }
  async function locate() {
    locating = true;
    error = '';
    try {
      await market?.setRegion(await regionFromGeolocation());
    } catch {
      error = 'No pudimos obtener tu ubicación. Elige tu ciudad en la lista.';
    } finally {
      locating = false;
    }
  }
  // Reporte en linea (antes window.prompt): una oferta a la vez, con el boton que lo abrio
  // guardado para devolverle el foco al cerrar.
  let reporting = $state<{ id: string; title: string; trigger: HTMLElement } | null>(null);
  function report(id: string, title: string, trigger: HTMLElement) {
    reporting = { id, title, trigger };
  }
  async function sendReport(reason: string) {
    const id = reporting?.id;
    reporting = null;
    if (!id) return;
    await market?.reportOffer(id, reason);
    // La oferta reportada se oculta y se lleva el boton con el foco: se deja en el titulo de la bandeja.
    await tick();
    if (!document.activeElement || document.activeElement === document.body) {
      const h = document.getElementById('bandeja-t');
      h?.setAttribute('tabindex', '-1');
      h?.focus();
    }
  }
</script>

<div class="mk" data-testid="mercado">
  <header>
    <h2>Mercado</h2>
    <p>Ofertas de talleres, repuestos, aseguradoras, lubricentros y llanterías de tu ciudad, ordenadas por lo que tus vehículos necesitan. Todo se compara en tu dispositivo.</p>
  </header>

  <PaymentsNotice />

  {#if error}<p class="mk-err" role="alert">{error}</p>{/if}

  <section class="mk-card" aria-labelledby="zona-t">
    <h3 id="zona-t">Tu ciudad</h3>
    <div class="mk-row">
      <label class="mk-field"><span>Ciudad</span>
        <select value={s?.region ?? ''} onchange={pickCity} disabled={!market} data-testid="city-select">
          <option value="">Elige tu ciudad</option>
          {#each cities as c}<option value={c.cell}>{c.name}</option>{/each}
        </select>
      </label>
      <button class="mk-btn" type="button" onclick={locate} disabled={locating || !market}>{locating ? 'Buscando…' : 'Usar mi ubicación aproximada'}</button>
    </div>
    <p class="mk-muted">Solo se guarda la zona de unos 40 km, no tu posición.</p>
    <p class="mk-status" data-testid="mk-status">
      {#if !s?.region}Sin ciudad: no recibes ofertas.{:else}Sala {s.region} · {s.peers} {s.peers === 1 ? 'par' : 'pares'} conectados · {s.received} {s.received === 1 ? 'oferta recibida' : 'ofertas recibidas'}{/if}
      {#if market && !real} · red local de prueba{/if}
    </p>
  </section>

  <div class="mk-tabs" role="tablist" aria-label="Qué quieres ver" onkeydown={onTabKey}>
    {#each TABS as t}
      <button
        class="mk-chip"
        type="button"
        role="tab"
        id={`tab-${t.id}`}
        aria-selected={tab === t.id}
        aria-controls={`panel-${t.id}`}
        tabindex={tab === t.id ? 0 : -1}
        data-testid={`tab-${t.id}`}
        onclick={() => (tab = t.id)}
      >{t.label}</button>
    {/each}
  </div>

  <div id="panel-todo" role="tabpanel" aria-labelledby="tab-todo" hidden={tab !== 'todo'}>
    {#if tab === 'todo'}
      <h3 id="todo-t" class="mk-h">Todo para tus vehículos</h3>
      <TodoVehiculos vehicles={vehicles} inbox={s?.inbox ?? []} region={s?.region ?? null} prefs={s?.prefs ?? DEFAULT_MARKET_PREFS} loaded={vehiclesLoaded} />
    {/if}
  </div>

  <div id="panel-para-ti" role="tabpanel" aria-labelledby="tab-para-ti" hidden={tab !== 'para-ti'}>
  <section class="mk-card" aria-labelledby="bandeja-t">
    <h3 id="bandeja-t">Para ti</h3>
    <div class="mk-row" role="group" aria-label="Filtros">
      <button class="mk-chip" type="button" aria-pressed={catFilter === ''} onclick={() => (catFilter = '')}>Todas</button>
      {#each OFFER_CATEGORIES as c}
        <button class="mk-chip" type="button" aria-pressed={catFilter === c} onclick={() => (catFilter = catFilter === c ? '' : c)}>{CATEGORY_LABELS[c]}</button>
      {/each}
    </div>
    <div class="mk-row">
      {#if vehicles.length > 1}
        <label class="mk-field"><span>Vehículo</span>
          <select bind:value={vehicleFilter}>
            <option value="">Todos</option>
            {#each vehicles as v}<option value={v.id}>{v.name}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="mk-chip"><input type="checkbox" bind:checked={onlyNeeds} /> Solo lo que mis vehículos necesitan pronto</label>
    </div>

    {#if inbox.length === 0}
      <p class="mk-muted" data-testid="inbox-empty">
        {#if !s?.region}Elige tu ciudad para empezar a recibir ofertas.
        {:else if (s?.received ?? 0) === 0}Aún no hay ofertas en tu ciudad. Cuando un vendedor publique una, aparece aquí.
        {:else}Ninguna oferta coincide con tus filtros o tus preferencias.{/if}
        {#if vehicles.length === 0} Agrega tus vehículos en el garage para ver ofertas hechas a su medida.{/if}
      </p>
    {:else}
      {#if reporting}
        <ReportDialog
          offerTitle={reporting.title}
          returnFocusTo={reporting.trigger}
          onsubmit={sendReport}
          oncancel={() => (reporting = null)}
        />
      {/if}
      <div class="mk-grid">
        {#each inbox as m (m.offer.id)}
          <OfferCard
            offer={m.offer}
            why={m.why}
            reasons={m.reasons}
            from={m.from}
            distanceKm={m.distanceKm}
            onhide={() => market?.dismissOffer(m.offer.id)}
            onreport={(t) => report(m.offer.id, m.offer.title, t)}
            onblock={() => market?.blockSeller(m.from)}
          />
        {/each}
      </div>
    {/if}
  </section>
  </div>

  {#if s && market}
    <ConsentPanel
      prefs={s.prefs}
      demandEnabled={s.demandEnabled}
      demandDetail={s.demandDetail}
      preview={s.demandPreview}
      available={s.demandAvailable}
      onprefs={(p) => market?.setPrefs(p)}
      ondemand={async (en, d) => {
        await market?.setDemand(en, d);
        if (en) await market?.publishDemand();
      }}
    />

    {#if s.blockedSellers.length}
      <section class="mk-card" aria-labelledby="bloq-t">
        <h3 id="bloq-t">Vendedores bloqueados</h3>
        <ul class="mk-list">
          {#each s.blockedSellers as b}
            <li>Nodo <code>{b.slice(0, 10)}</code> <button class="mk-btn" type="button" onclick={() => market?.unblockSeller(b)}>Desbloquear</button></li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}

  <section class="mk-card">
    <h3>¿Tienes un negocio?</h3>
    <p>Publica ofertas firmadas para los dueños de tu ciudad.</p>
    <div class="mk-row"><a class="mk-btn" href="/fleet/mercado/vender" data-testid="go-vender">{guest ? 'Vender en el mercado (requiere cuenta)' : 'Vender en el mercado'}</a></div>
  </section>
</div>
