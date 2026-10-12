/**
 * serve.ts — Puente entre la subasta pura y la peticion real: carga candidatos de D1,
 * corre `runAuction`, firma los tokens de los ganadores y arma los `ServedAd`.
 *
 * Vive separado de `auction.ts` a proposito: la subasta es pura y testeable sin
 * ningun acceso a datos; aqui es donde se toca la instancia compartida `gara-g-ads`, se
 * lee el vehiculo del tenant de la sesion para armar el contexto y se firman tokens. Si
 * manana la subasta se mueve a un DO, este fichero es el unico que hay que tocar.
 *
 * El contexto NUNCA se arma con lo que manda el cliente: la ruta pasa solo el
 * `vehicleId`, y de la entidad `vehicle` del tenant salen familia, carroceria, marca,
 * modelo y version. Aceptar marca o familia del cliente seria mostrar anuncios de una
 * moto a un dueño de carro y, peor, permitir que alguien segmente por lo que quiera.
 */
import type { AdCampaign, AdContext, AdSlot, ServedAd, VehicleFamily, BodyType } from '../contracts';
import { getEntity } from '../../lib/domain';
import { bodyFor } from '../domain/vehicleSpec';
import { versionRefFor } from '../domain/versionKey';
import { DEFAULT_INSTANCE_ID } from '../../lib/domain.config';
import { runAuction, type AuctionCandidate, type AuctionExcluded } from './auction';
import { getAdvertiser, getStatToday, lifetimeTotals, listCampaigns } from './store';
import { signAdToken, userHash } from './tokens';

/** Cupos por slot: el feed del shop muestra 3 patrocinados; los demas, uno. */
export const SLOTS_PER_PLACE: Record<AdSlot, number> = {
  shop_feed: 3,
  part_context: 1,
  garage_banner: 1,
};

interface VehicleRow {
  id: string;
  make?: string;
  model?: string;
  year?: number;
  type?: string;
  plate?: string;
}

export interface VehicleContext {
  family: VehicleFamily;
  body: BodyType;
  make?: string;
  model?: string;
  versionKey?: string;
  city?: string;
}

/**
 * Contexto del vehiculo desde su fila del tenant. `instanceId` es el del tenant: la
 * fila se busca ahi y NO en la instancia compartida, para que nadie pueda leer (ni
 * segmentar por) un vehiculo de otra flota.
 */
export async function contextForVehicle(
  vehicleId: string,
  instanceId: string = DEFAULT_INSTANCE_ID,
): Promise<VehicleContext | null> {
  const row = await getEntity<VehicleRow>('vehicle', vehicleId, instanceId);
  if (!row) return null;
  // Misma resolucion que el 3D: tipo normalizado ('Camión' → camion) y, si no, el catalogo.
  const { family, body } = bodyFor(row as unknown as Parameters<typeof bodyFor>[0]);
  const version = versionRefFor({ make: row.make, model: row.model, year: row.year });
  return {
    family,
    body,
    make: row.make,
    model: row.model,
    versionKey: version.key,
  };
}

/** Arma el `AdContext` de la subasta a partir del vehiculo y del usuario que mira. */
export function buildAdContext(slot: AdSlot, vehicle: VehicleContext, hash: string, partCategory?: string): AdContext {
  return {
    slot,
    family: vehicle.family,
    body: vehicle.body,
    make: vehicle.make,
    model: vehicle.model,
    versionKey: vehicle.versionKey,
    city: vehicle.city,
    partCategory: partCategory as AdContext['partCategory'],
    userHash: hash,
  };
}

/**
 * Carga las candidatas de la instancia compartida y las deja listas para `runAuction`:
 * cada campana con su anunciante, su estadistica de HOY (tope de frecuencia y ritmo) y
 * sus totales historicos (pCTR). Se leen en paralelo porque son tres lectures
 * independientes por campana.
 */
export async function loadCandidates(now: number): Promise<AuctionCandidate[]> {
  const campaigns = await listCampaigns();
  return Promise.all(
    campaigns.map(async (campaign: AdCampaign) => {
      const advertiser = await getAdvertiser(campaign.advertiserId);
      const today = await getStatToday(campaign.id, now);
      const lifetime = await lifetimeTotals(campaign.id);
      return {
        campaign,
        // Sin anunciante la campana no se cobra ni se sirve: se descarta aqui.
        advertiser: advertiser ?? {
          id: '',
          name: '',
          kind: 'other',
          contactEmail: '',
          balanceCOP: 0,
          verified: false,
          ownerUserId: '',
        },
        today: {
          campaignId: campaign.id,
          day: today.day,
          impressions: today.impressions,
          clicks: today.clicks,
          spendCOP: today.spendCOP,
          freq: today.freq,
        },
        lifetimeSpendCOP: lifetime.spendCOP,
        lifetime: { impressions: lifetime.impressions, clicks: lifetime.clicks },
      } satisfies AuctionCandidate;
    }),
  );
}

export interface ServeResult {
  ads: ServedAd[];
  /** Motivos de exclusion de esta peticion; se loguean, no se devuelven al cliente. */
  excluded: AuctionExcluded[];
}

/**
 * Subasta completa para un slot: carga, corre, firma. El precio va dentro del token
 * firmado, no en la respuesta: el cliente no necesita verlo (y si lo manipulase, da igual
 * porque el token manda).
 */
export async function serveAds(input: {
  slot: AdSlot;
  ctx: AdContext;
  now: number;
  rand?: () => number;
}): Promise<ServeResult> {
  const candidates = await loadCandidates(input.now);
  const slots = SLOTS_PER_PLACE[input.slot] ?? 1;
  const { winners, excluded } = runAuction(candidates, input.ctx, {
    slots,
    now: input.now,
    // `Math.random` es suficiente para el ritmo: no decide el precio ni el orden, solo
    // frena el gasto anticipado. Los tests inyectan un `rand` fijo.
    rand: input.rand ?? Math.random,
  });

  const byId = new Map(candidates.map((c) => [c.campaign.id, c.campaign]));
  const ads: ServedAd[] = [];
  for (const winner of winners) {
    const campaign = byId.get(winner.campaignId);
    if (!campaign) continue;
    const token = await signAdToken({
      campaignId: campaign.id,
      slot: input.slot,
      userHash: input.ctx.userHash,
      priceCOP: winner.priceCOP,
      pricingModel: campaign.pricing.model,
      now: input.now,
    });
    ads.push({
      campaignId: campaign.id,
      creative: { ...campaign.creative, advertiserName: campaign.creative.advertiserName },
      sponsoredLabel: 'Patrocinado',
      position: winner.position,
      token,
    });
  }
  return { ads, excluded };
}

/** Hash del usuario que mira: HMAC del userId con el secreto del token. */
export async function hashForUser(userId: string): Promise<string> {
  return userHash(userId);
}