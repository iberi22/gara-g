/**
 * src/pages/api/garage/shop/_shared.ts — Piezas compartidas por las rutas del shop.
 *
 * Concentra lo que TODAS las rutas de /api/garage/ads/* y /api/garage/shop necesitan:
 * la instancia compartida, el tenant de la sesion (nunca del cliente), la validacion
 * de creativos y las respuestas JSON. Tenerlo aqui evita que cada ruta reimplemente el
 * "de donde sale el vehiculo", que es justo donde se puede colar una fuga entre tenants.
 */
import { priceFloorCOP } from '../../../../garage/shop/auction';
import type { AdCampaign, AdCreative, AdSlot, AdTargeting, Advertiser } from '../../../../garage/contracts';
import { DEFAULT_INSTANCE_ID } from '../../../../lib/domain.config';
import { pinTenant } from '../../../../lib/staging';
import { isValidHttpsUrl } from '../../../../garage/shop/url';

/** Todas las rutas de esta isla son SSR: el middleware ya devuelve 401 JSON en /api/*. */
export const prerender = false;

/** Instancia compartida: los anunciantes pujan por usuarios de todos los tenants. */
export const ADS_INSTANCE = DEFAULT_INSTANCE_ID;

/** El tenant sale de la sesion (locals), no de la query ni del body.
 *
 *  En el stage se reescribe al tenant de pruebas, para que una sesion de produccion
 *  (que es valida aqui, mismo KV SESSION) no escriba en las campanas reales.
 */
export function tenantOf(locals: unknown): string {
  const tenant = (locals as { tenant?: { instanceId?: string } } | undefined)?.tenant;
  return pinTenant(tenant?.instanceId ?? DEFAULT_INSTANCE_ID) ?? DEFAULT_INSTANCE_ID;
}

export function isAdmin(role: string): boolean {
  return role === 'admin';
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function jsonError(message: string, status: number): Response {
  return json({ ok: false, error: message }, status);
}

const AD_SLOTS: readonly AdSlot[] = ['shop_feed', 'part_context', 'garage_banner'];

/** Slots conocidos. Un slot inventado en la URL se rechaza en vez de servirlo por defecto. */
export function parseSlot(value: string | null): AdSlot | null {
  if (!value) return null;
  return (AD_SLOTS as readonly string[]).includes(value) ? (value as AdSlot) : null;
}

const ADVERTISER_KINDS = ['parts_store', 'workshop', 'service', 'dealer', 'other'] as const;
type AdvertiserKind = (typeof ADVERTISER_KINDS)[number];

export function parseAdvertiserKind(value: unknown): AdvertiserKind | null {
  return typeof value === 'string' && (ADVERTISER_KINDS as readonly string[]).includes(value)
    ? (value as AdvertiserKind)
    : null;
}

/**
 * Valida el creativo de una campana. Los limites son cortos a proposito (titulo 60,
 * cuerpo 140, cta 20): es un banner dentro de un feed, no un articulo, y un texto largo
 * empuja los anuncios de los demas fuera de pantalla. La URL debe ser https (no http):
 * un anuncio que lleva a un sitio sin cifrar teaches a no pulsar "Patrocinado".
 */
export function validateCreative(input: unknown): { ok: true; creative: AdCreative } | { ok: false; error: string } {
  const c = (input ?? {}) as Partial<AdCreative>;
  const title = typeof c.title === 'string' ? c.title.trim() : '';
  const body = typeof c.body === 'string' ? c.body.trim() : '';
  const ctaLabel = typeof c.ctaLabel === 'string' ? c.ctaLabel.trim() : '';
  const url = typeof c.url === 'string' ? c.url.trim() : '';
  const advertiserName = typeof c.advertiserName === 'string' ? c.advertiserName.trim() : '';
  const imageUrl = typeof c.imageUrl === 'string' ? c.imageUrl.trim() : '';

  if (!title) return { ok: false, error: 'Falta el título del anuncio' };
  if (title.length > 60) return { ok: false, error: 'El título no puede pasar de 60 caracteres' };
  if (!body) return { ok: false, error: 'Falta el cuerpo del anuncio' };
  if (body.length > 140) return { ok: false, error: 'El cuerpo no puede pasar de 140 caracteres' };
  if (!ctaLabel) return { ok: false, error: 'Falta el texto del botón' };
  if (ctaLabel.length > 20) return { ok: false, error: 'El texto del botón no puede pasar de 20 caracteres' };
  if (!advertiserName) return { ok: false, error: 'Falta el nombre del anunciante' };
  if (!isValidHttpsUrl(url)) return { ok: false, error: 'La URL del anuncio debe empezar por https://' };
  if (imageUrl && !isValidHttpsUrl(imageUrl)) {
    return { ok: false, error: 'La URL de la imagen debe empezar por https://' };
  }

  return {
    ok: true,
    creative: { title, body, ctaLabel, url, advertiserName, ...(imageUrl ? { imageUrl } : {}) },
  };
}

const FAMILIES = ['moto', 'car', 'heavy', 'machinery'] as const;
const PART_CATEGORIES = [
  'motor',
  'frenos',
  'suspension',
  'llantas',
  'transmision',
  'electrico',
  'filtro',
  'liquido',
  'carroceria',
  'iluminacion',
  'escape',
  'chasis',
  'hidraulico',
] as const;

function strings(input: unknown): string[] {
  if (Array.isArray(input)) return input.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
  return [];
}

/**
 * Normaliza la segmentacion. Lo que no se reconoce se descarta en vez de pasar: una
 * familia o categoria inventada haria que la campana nunca coincidiera (o coincidiera
 * con cualquier cosa) y el anunciante pagaria por un target vacio.
 */
export function parseTargeting(input: unknown): AdTargeting {
  const t = (input ?? {}) as Record<string, unknown>;
  const families = strings(t.families).filter((v): v is (typeof FAMILIES)[number] => (FAMILIES as readonly string[]).includes(v));
  const partCategories = strings(t.partCategories).filter((v): v is (typeof PART_CATEGORIES)[number] =>
    (PART_CATEGORIES as readonly string[]).includes(v),
  );
  const targeting: AdTargeting = {};
  if (families.length) targeting.families = families as NonNullable<AdTargeting['families']>;
  if (partCategories.length) {
    targeting.partCategories = partCategories as NonNullable<AdTargeting['partCategories']>;
  }
  // `bodies` viene como texto libre y se filtra igual que el resto: la carroceria es un
  // BodyType del catalogo, y un valor que no exista simplemente nunca coincidira.
  for (const key of ['bodies', 'makes', 'models', 'versionKeys', 'cities'] as const) {
    const values = strings(t[key]);
    if (values.length) targeting[key] = values as never;
  }
  return targeting;
}

export interface CampaignInput {
  advertiserId: string;
  name: string;
  creative: AdCreative;
  targeting: AdTargeting;
  pricing: { model: 'cpm' | 'cpc'; bidCOP: number };
  dailyBudgetCOP: number;
  totalBudgetCOP: number;
  startDate?: string;
  endDate?: string;
  freqCapPerUserDay: number;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida el cuerpo de una campana. Los minimos de presupuesto evitan el caso tonto de
 * "subir el boton sin querer": un presupuesto diario menor al piso (2.000 CPM / 150 CPC)
 * no podria ganarse ni un slot, asi que se rechaza en el alta en vez de aceptarlo y
 * dejarlo inactivo para siempre.
 */
export function validateCampaignBody(
  input: unknown,
): { ok: true; campaign: CampaignInput } | { ok: false; error: string } {
  const b = (input ?? {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const advertiserId = typeof b.advertiserId === 'string' ? b.advertiserId.trim() : '';
  if (!name) return { ok: false, error: 'Falta el nombre de la campaña' };
  if (name.length > 80) return { ok: false, error: 'El nombre no puede pasar de 80 caracteres' };
  if (!advertiserId) return { ok: false, error: 'Falta el anunciante' };

  const creative = validateCreative(b.creative);
  if (!creative.ok) return creative;

  const pricing = (b.pricing ?? {}) as { model?: unknown; bidCOP?: unknown };
  const model = pricing.model === 'cpc' ? 'cpc' : pricing.model === 'cpm' ? 'cpm' : null;
  if (!model) return { ok: false, error: 'El modelo de precio debe ser cpm o cpc' };
  const bidCOP = Number(pricing.bidCOP);
  if (!Number.isFinite(bidCOP) || bidCOP <= 0) return { ok: false, error: 'La puja debe ser un número mayor que 0' };
  {
    // Precio de reserva: la subasta ignora pujas bajo el piso, asi que se rechazan al crearlas.
    const floor = priceFloorCOP(pricing.model === 'cpc' ? 'cpc' : 'cpm');
    if (bidCOP < floor) return { ok: false, error: `La puja mínima es ${floor} COP (${pricing.model === 'cpc' ? 'por clic' : 'por mil impresiones'})` };
  }

  const dailyBudgetCOP = Number(b.dailyBudgetCOP);
  const totalBudgetCOP = Number(b.totalBudgetCOP);
  if (!Number.isFinite(dailyBudgetCOP) || dailyBudgetCOP <= 0) return { ok: false, error: 'El presupuesto diario debe ser mayor que 0' };
  if (!Number.isFinite(totalBudgetCOP) || totalBudgetCOP <= 0) return { ok: false, error: 'El presupuesto total debe ser mayor que 0' };

  const freqRaw = Number(b.freqCapPerUserDay ?? 3);
  const freqCapPerUserDay = Number.isFinite(freqRaw) ? Math.max(1, Math.min(50, Math.floor(freqRaw))) : 3;

  const startDate = typeof b.startDate === 'string' && ISO_DAY.test(b.startDate) ? b.startDate : undefined;
  const endDate = typeof b.endDate === 'string' && ISO_DAY.test(b.endDate) ? b.endDate : undefined;
  if (startDate && endDate && endDate < startDate) return { ok: false, error: 'La fecha final va antes de la inicial' };

  return {
    ok: true,
    campaign: {
      advertiserId,
      name,
      creative: creative.creative,
      targeting: parseTargeting(b.targeting),
      pricing: { model, bidCOP: Math.round(bidCOP) },
      dailyBudgetCOP: Math.round(dailyBudgetCOP),
      totalBudgetCOP: Math.round(totalBudgetCOP),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      freqCapPerUserDay,
    },
  };
}

/** El anunciante es del usuario: sin esto, cualquiera podria crear campanas ajenas. */
export function ownsAdvertiser(advertiser: Advertiser | null, userId: string): boolean {
  return advertiser !== null && advertiser.ownerUserId === userId;
}

/** Patch parcial de campana: los mismos validadores, aplicados solo a lo que llega. */
export function applyCampaignPatch(campaign: AdCampaign, patch: Record<string, unknown>): AdCampaign {
  const next: AdCampaign = { ...campaign };
  if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim();
  if (patch.creative !== undefined) {
    const merged = validateCreative({ ...campaign.creative, ...(patch.creative as object) });
    if (merged.ok) next.creative = merged.creative;
  }
  if (patch.targeting !== undefined) next.targeting = parseTargeting(patch.targeting);
  if (patch.pricing !== undefined) {
    const p = patch.pricing as { model?: unknown; bidCOP?: unknown };
    const model = p.model === 'cpc' || p.model === 'cpm' ? p.model : campaign.pricing.model;
    const bid = Number(p.bidCOP);
    next.pricing = { model, bidCOP: Number.isFinite(bid) && bid > 0 ? Math.round(bid) : campaign.pricing.bidCOP };
  }
  if (patch.dailyBudgetCOP !== undefined) {
    const v = Number(patch.dailyBudgetCOP);
    if (Number.isFinite(v) && v > 0) next.dailyBudgetCOP = Math.round(v);
  }
  if (patch.totalBudgetCOP !== undefined) {
    const v = Number(patch.totalBudgetCOP);
    if (Number.isFinite(v) && v > 0) next.totalBudgetCOP = Math.round(v);
  }
  if (patch.freqCapPerUserDay !== undefined) {
    const v = Number(patch.freqCapPerUserDay);
    if (Number.isFinite(v)) next.freqCapPerUserDay = Math.max(1, Math.min(50, Math.floor(v)));
  }
  if (typeof patch.startDate === 'string' && ISO_DAY.test(patch.startDate)) next.startDate = patch.startDate;
  if (typeof patch.endDate === 'string' && ISO_DAY.test(patch.endDate)) next.endDate = patch.endDate;
  return next;
}