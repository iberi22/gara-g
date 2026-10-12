<script lang="ts">
  /**
   * TodoVehiculos — "Todo para tus vehiculos": por cada vehiculo del garage, lo que puede
   * necesitar o llevar (servicios, repuestos, accesorios), lo que vence pronto primero y las
   * ofertas recibidas que le sirven. Funciona con el garage local (sin cuenta).
   */
  import type { OptInPreferences } from '../../lib/marketplaceOptIn';
  import { type VehiclePlan, KIND_LABELS, planForVehicles } from '../../mesh/datos/forVehicle';
  import type { Match } from '../../mesh/datos/match';
  import { CATEGORY_LABELS } from '../../mesh/datos/offer';
  import type { OwnerVehicle } from '../../mesh/datos/vehicles';
  import OfferCard from './OfferCard.svelte';

  let {
    vehicles,
    inbox,
    region,
    prefs,
    loaded = true,
  }: {
    vehicles: OwnerVehicle[];
    inbox: (Match & { from: string })[];
    region: string | null;
    prefs: OptInPreferences;
    loaded?: boolean;
  } = $props();

  // Sin ciudad no hay ofertas que emparejar (la distancia sale de la region).
  const plans = $derived<VehiclePlan[]>(
    planForVehicles(vehicles, region ? inbox.map((m) => m.offer) : [], { now: Date.now(), ownerCell: region ?? '', prefs }),
  );
  const fromOf = $derived(new Map(inbox.map((m) => [m.offer.id, m.from])));
</script>

<div class="tv" data-testid="todo-vehiculos">
  <p class="mk-muted">
    Lo que cada uno de tus vehículos puede necesitar o llevar, según su tipo y su uso. Lo que vence pronto va primero. Las ofertas son de prestadores de tu ciudad: tú los contactas y acuerdan directamente.
  </p>

  {#if !loaded}
    <p class="mk-muted" role="status">Cargando tus vehículos…</p>
  {:else if vehicles.length === 0}
    <p class="mk-muted" data-testid="tv-empty">
      Aún no tienes vehículos en el garage. <a href="/fleet/garage">Agrega uno</a> para ver aquí todo lo que puede necesitar.
    </p>
  {:else}
    {#if !region}<p class="mk-warn mk-muted">Elige tu ciudad arriba para ver también las ofertas de cada rubro.</p>{/if}
    {#each plans as plan (plan.vehicle.id)}
      <section class="mk-card" aria-labelledby={`tv-${plan.vehicle.id}`} data-testid="tv-vehicle">
        <h3 id={`tv-${plan.vehicle.id}`}>
          {plan.title}
          {#if plan.title !== plan.vehicle.name}<span class="mk-muted"> · {plan.vehicle.name}</span>{/if}
        </h3>
        <p class="mk-muted">
          {#if plan.soonCount > 0}{plan.soonCount} {plan.soonCount === 1 ? 'cosa por atender pronto' : 'cosas por atender pronto'}.{:else}Nada urgente según su mantenimiento.{/if}
          Se mide en {plan.vehicle.usage === 'h' ? 'horas de uso' : 'kilómetros'}.
        </p>
        <ul class="tv-list">
          {#each plan.groups as g (g.id)}
            <li class="tv-item" class:soon={!!g.soon} data-testid={g.soon ? 'tv-item-soon' : 'tv-item'}>
              <div class="mk-row">
                <h4>{g.label}</h4>
                <span class="mk-badge">{KIND_LABELS[g.kind]}</span>
                <span class="mk-badge">{CATEGORY_LABELS[g.category]}</span>
                {#if g.soon}<span class="mk-badge tv-soon" class:overdue={g.soon.overdue}>{g.soon.text}</span>{/if}
              </div>
              {#if g.hint}<p class="mk-muted">{g.hint}</p>{/if}
              {#if g.offers.length}
                <div class="mk-grid">
                  {#each g.offers as m (m.offer.id)}
                    <OfferCard offer={m.offer} why={m.why} reasons={m.reasons} from={fromOf.get(m.offer.id) ?? ''} distanceKm={m.distanceKm} />
                  {/each}
                </div>
              {:else}
                <p class="mk-muted">Sin ofertas por ahora.</p>
              {/if}
            </li>
          {/each}
        </ul>
        {#if plan.others.length}
          <h4>Otras ofertas que le sirven</h4>
          <div class="mk-grid">
            {#each plan.others as m (m.offer.id)}
              <OfferCard offer={m.offer} why={m.why} reasons={m.reasons} from={fromOf.get(m.offer.id) ?? ''} distanceKm={m.distanceKm} />
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  {/if}
</div>

<style>
  .tv { display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
  .tv-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.75rem; }
  .tv-item { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.75rem; border: 1px solid var(--swal-border); min-width: 0; }
  .tv-item.soon { border-color: var(--swal-accent); border-left-width: 3px; }
  .tv-soon { color: var(--swal-accent-text); border-color: var(--swal-accent); }
  .tv-soon.overdue { color: var(--swal-danger, #C8352B); border-color: var(--swal-danger, #C8352B); }
  a { display: inline-flex; align-items: center; min-height: 44px; color: var(--swal-accent-text); }
</style>
