/**
 * store.ts — Acceso a datos y cobro del shop, sobre la instancia compartida `gara-g-ads`.
 *
 * Por que una instancia aparte: los anunciantes pujan por usuarios de TODOS los tenants,
 * asi que estas filas no pueden vivir en el `instanceId` de la sesion (quien creo la
 * campana perderia al usuario de otra flota). `ADS_INSTANCE_ID` las mantiene
 * compartidas; el aislamiento se hace aqui, con reglas explicitas de dueno, en vez de
 * con el `instanceId` de cada llamada.
 *
 * ENTIDADES (ya estan en domain.config.ts, no se duplican aqui):
 *   adAdvertiser — el anunciante, con su saldo prepagado (es lo que se descuenta).
 *   adCampaign   — la campana; `status: 'exhausted'` cuando se acaba el presupuesto o el saldo.
 *   adStat       — una fila por campana y dia: `${campaignId}:${YYYY-MM-DD}`. Lleva los
 *                  contadores (impresiones, clics, gasto) y `freq`: userHash -> impresiones
 *                  de hoy, que es el tope de frecuencia.
 *   adClick      — un registro por clic cobrado, indexado por token: es la idempotencia.
 *   shopPost     — publicaciones organicas del feed.
 *
 * ⚠ CONDICION DE CARRERA (documentada a proposito, aceptada en el MVP)
 * `chargeImpression` hace leer-modificar-escribir sobre `adStat` y sobre el saldo del
 * anunciante: dos impresiones simultaneas del mismo token/campana pueden leer el mismo
 * valor inicial y escribir el mismo incremented, y se pierde un cobro. D1 serializa
 * cada sentencia pero no la secuencia leer→escribir entre dos peticiones, y no hay
 * transaccion multi-tabla desde el helper generico. El impacto real es pequeno: el
 * anunciante pierde unos pesos, nunca se le cobra de mas ni se rompe el saldo (el
 * descuento se limita al saldo disponible).
 *
 * DONDE IRIA UN DURABLE OBJECT (fuera de esta isla, fase siguiente): mover `charge*` a
 * un DO por campana (o un DO global de ads). El DO serializa por clave, asi que el
 * leer→modificar→escribir de `adStat` y del saldo deja de ser una carrera, y el clic
 * idempotente por token queda garantizado por el propio DO en vez de por una fila en
 * D1. La interfaz de este fichero no cambia: solo se cambia el backend detras.
 */
import {
  createEntity,
  getEntity,
  getStorageAdapter,
  listEntities,
  updateEntity,
  type DomainRecord,
} from '../../lib/domain';
import { ADS_INSTANCE_ID } from '../../lib/domain.config';
import type { AdCampaign, Advertiser, ShopPost } from '../contracts';

/**
 * Tipos de las filas internas del cobro. Viven aqui y no en contracts.ts porque son
 * el detalle del almacen, no la frontera entre islas: las rutas y la UI solo las leen
 * para mostrar estadisticas, nunca las construyen a mano.
 */
export interface AdStatDay {
  impressions: number;
  clicks: number;
  spendCOP: number;
  /** userHash -> impresiones de hoy de ese usuario. */
  freq: Record<string, number>;
}

/**
 * Fila del shop tal como sale de D1: el contrato mas las columnas de la tabla generica
 * (`id`, `instance_id`). Se exporta para que se pueda comprobar, en tests o en el portal,
 * QUE INSTANCIA guardo la fila: las del shop van siempre en `gara-g-ads`.
 */
export type ShopRecord<T> = T & { id: string; instance_id: string };

/**
 * UNIDADES (importante: es donde se perdia dinero en la ronda 1)
 *
 * `AdCampaign.pricing.bidCOP` y el `priceCOP` del token son un precio POR MIL, para CPM
 * (docs/garage/ARCHITECTURE.md): "2.000 COP por cada 1.000 impresiones". Una impresion
 * individual vale por tanto `priceCOP / 1000` COP: 2 COP, no 2.000.
 *
 * - `AdStat.spendCOP`      — gasto ACUMULADO del dia, en COP enteros.
 * - `AdStat.spendMilliCOP` — el MISMO gasto en milesimas de peso (COP x 1000), para no
 *                            perder el resto en cada fraccion. Es el campo autoritativo.
 * - `Advertiser.balanceCOP`— saldo en COP enteros.
 *
 * Por que dos campos y no uno: 2.000 COP/1000 impresiones = 2 COP exactos por impresion, y
 * un CPM de 2.500 = 2,5 COP por impresion. Si se redondease el gasto en cada impresion,
 * 1000 impresiones de 2,5 COP darian 3.000 (un 20 % de sobrecobra) y el anunciante pierde
 * dinero. Guardando el acumulado en milesimas, esas 1000 impresiones suman exactamente
 * 2.500 y el saldo solo baja en el COP entero que corresponde.
 */
export interface AdClickRecord {
  kind: 'click';
  campaignId: string;
  /** Nonce firmado del token: un clic por token, aunque se repita la peticion. */
  tokenId: string;
  /** Lo que se cobro de verdad por ese clic, en COP. 0 si se marco pero no se pudo cobrar. */
  chargedCOP: number;
  at?: string;
}

/**
 * Registro de una impresion ya cobrada: es lo que hace idempotente el cobro CPM.
 *
 * Se guarda en la MISMA entidad `adClick` que el clic, no en una entidad nueva, por dos
 * razones: (1) no hace falta tocar `domain.config.ts` (fuera de esta isla) para anadir una
 * entidad que solo usaria el shop, y (2) los dos registros son estructuralmente el mismo
 * hecho —"este nonce ya se cobro"— y comparten dedupe, caducidad (la del token, 30 min) y
 * forma `{ campaignId, tokenId, chargedCOP }`. El campo `kind` los distingue para auditar.
 */
export interface AdImpressionRecord {
  kind: 'impression';
  campaignId: string;
  /** Nonce firmado del token de impresion. */
  tokenId: string;
  /** Gasto de ESTA impresion, en COP. */
  chargedCOP: number;
  at?: string;
}

const ADS = ADS_INSTANCE_ID;

/** Fila de estadistica de una campana para un dia. */
export interface AdStatRecord extends DomainRecord<Record<string, unknown>> {
  campaignId: string;
  day: string;
  impressions: number;
  clicks: number;
  /** Gasto acumulado del dia en COP enteros (derivado de `spendMilliCOP`). */
  spendCOP: number;
  /** Gasto acumulado del dia en milesimas de peso. Campo autoritativo del gasto. */
  spendMilliCOP: number;
  freq: Record<string, number>;
}

function todayKey(now: number): string {
  const d = new Date(now);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Id de la fila de estadistica: `${campaignId}:${YYYY-MM-DD}`. */
export function statKey(campaignId: string, day: string): string {
  return `${campaignId}:${day}`;
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Anunciante por id. Devuelve null si no existe (o si el id no es de un anunciante). */
export async function getAdvertiser(id: string): Promise<Advertiser | null> {
  const row = await getEntity<Record<string, unknown>>('adAdvertiser', id, ADS);
  return row ? (row as unknown as Advertiser) : null;
}

/** Anunciantes que son de este usuario (un usuario puede tener varios, p. ej. tienda + taller). */
export async function listAdvertisersOf(ownerUserId: string): Promise<Advertiser[]> {
  const rows = await listEntities<Record<string, unknown>>('adAdvertiser', ADS);
  return rows.filter((r) => r.ownerUserId === ownerUserId) as unknown as Advertiser[];
}

/** Todas las campanas de la instancia compartida. La subasta las filtra en memoria. */
export async function listCampaigns(): Promise<AdCampaign[]> {
  const rows = await listEntities<Record<string, unknown>>('adCampaign', ADS);
  return rows as unknown as AdCampaign[];
}

export async function getCampaign(id: string): Promise<AdCampaign | null> {
  const row = await getEntity<Record<string, unknown>>('adCampaign', id, ADS);
  return row ? (row as unknown as AdCampaign) : null;
}

/** Fila de estadistica del dia, o ceros si la campana aun no se ha servido hoy. */
export async function getStatToday(campaignId: string, now: number): Promise<AdStatRecord> {
  const day = todayKey(now);
  const row = await getEntity<Record<string, unknown>>('adStat', statKey(campaignId, day), ADS);
  if (!row) {
    return {
      id: statKey(campaignId, day),
      instance_id: ADS,
      created_at: '',
      updated_at: '',
      campaignId,
      day,
      impressions: 0,
      clicks: 0,
      spendCOP: 0,
      spendMilliCOP: 0,
      freq: {},
    };
  }
  return normalizeStat(row, campaignId, day);
}

function normalizeStat(row: DomainRecord<Record<string, unknown>>, campaignId: string, day: string): AdStatRecord {
  const freq = row.freq && typeof row.freq === 'object' ? (row.freq as Record<string, number>) : {};
  const spendMilliCOP = Number(row.spendMilliCOP ?? Math.round(Number(row.spendCOP ?? 0) * 1000));
  return {
    ...row,
    campaignId,
    day,
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    // Derivar `spendCOP` de las milesimas (y no al reves) evita que las dos fuentes se
    // desincronicen por redondeos: la milesima manda.
    spendCOP: Math.round(spendMilliCOP / 1000),
    spendMilliCOP,
    freq,
  };
}

/** Todos los dias con datos de una campana, del mas reciente al mas viejo. */
export async function listStatsOf(campaignId: string): Promise<AdStatRecord[]> {
  const rows = await listEntities<Record<string, unknown>>('adStat', ADS);
  return rows
    .filter((r) => r.campaignId === campaignId)
    .map((r) => normalizeStat(r, campaignId, String(r.day ?? '')))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** Impresiones y clics acumulados de una campana: alimentan el pCTR de la subasta. */
export async function lifetimeTotals(
  campaignId: string,
): Promise<{ impressions: number; clicks: number; spendCOP: number; spendMilliCOP: number }> {
  const rows = await listStatsOf(campaignId);
  return rows.reduce(
    (acc, r) => ({
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      // Se acumula en milesimas para que el total tampoco pierda redondeos al sumar dias.
      spendCOP: acc.spendCOP + r.spendCOP,
      spendMilliCOP: acc.spendMilliCOP + r.spendMilliCOP,
    }),
    { impressions: 0, clicks: 0, spendCOP: 0, spendMilliCOP: 0 },
  );
}

/** Publicaciones organicas del feed, de la marca o version del vehiculo. */
export async function listShopPosts(make?: string, versionKey?: string): Promise<ShopPost[]> {
  const rows = await listEntities<Record<string, unknown>>('shopPost', ADS);
  const posts = rows as unknown as ShopPost[];
  const wanted = (p: ShopPost) => {
    if (p.versionKey && versionKey) return p.versionKey === versionKey;
    if (p.make && make) return (p.make ?? '').toLowerCase() === make.toLowerCase();
    return false;
  };
  return posts
    .filter(wanted)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 20);
}

// ---------------------------------------------------------------------------
// Escritura (ciclo de vida de anunciante y campana)
// ---------------------------------------------------------------------------

export async function createAdvertiser(
  input: Omit<Advertiser, 'id' | 'balanceCOP' | 'verified'>,
): Promise<ShopRecord<Advertiser>> {
  const row = await createEntity<Record<string, unknown>>(
    'adAdvertiser',
    { ...input, balanceCOP: 0, verified: false },
    ADS,
  );
  return row as unknown as ShopRecord<Advertiser>;
}

export async function createCampaign(campaign: Omit<AdCampaign, 'id' | 'createdAt'>): Promise<ShopRecord<AdCampaign>> {
  const row = await createEntity<Record<string, unknown>>(
    'adCampaign',
    { ...campaign, createdAt: new Date().toISOString() },
    ADS,
  );
  return row as unknown as ShopRecord<AdCampaign>;
}

export async function patchCampaign(id: string, patch: Partial<AdCampaign>): Promise<AdCampaign | null> {
  const row = await updateEntity<Record<string, unknown>>('adCampaign', id, patch as Record<string, unknown>, ADS);
  return row ? (row as unknown as AdCampaign) : null;
}

/**
 * Recarga de saldo (admin). El movimiento queda en la fila del anunciante, con su momento,
 * para poder auditar de donde sale el saldo.
 *
 * ⚠ CARRERA (misma naturaleza que la de `applySpend`, y aceptada en el MVP): esto es leer
 * (`getAdvertiser`), calcular `balance + amount` y escribir. Dos recargas simultaneas del
 * mismo anunciante pueden leer el mismo saldo y escribir el mismo incremented, y se pierde
 * una. Como alli, la perdida va en contra de GARA-G (el anunciante recibe de menos), nunca a
 * favor: nunca se crea saldo que no se recargo. Con un Durable Object por anunciante, o con
 * un `UPDATE ... SET balance = balance + ?` en D1, desaparece; la interfaz no cambia.
 */
export async function topUpAdvertiser(id: string, amountCOP: number): Promise<ShopRecord<Advertiser> | null> {
  if (!Number.isFinite(amountCOP) || amountCOP <= 0) throw new Error('amountCOP debe ser positivo');
  const current = await getAdvertiser(id);
  if (!current) return null;
  const row = await updateEntity<Record<string, unknown>>(
    'adAdvertiser',
    id,
    {
      balanceCOP: current.balanceCOP + Math.round(amountCOP),
      // Recargar no verifica al anunciante: eso es decision del admin aparte.
      movements: [
        ...(Array.isArray((current as unknown as { movements?: unknown[] }).movements) ? (current as unknown as { movements: unknown[] }).movements : []),
        { amountCOP: Math.round(amountCOP), at: new Date().toISOString(), by: 'admin' },
      ],
    },
    ADS,
  );
  return row ? (row as unknown as ShopRecord<Advertiser>) : null;
}

// ---------------------------------------------------------------------------
// Cobro
// ---------------------------------------------------------------------------

/**
 * Los motivos de fallo son los mismos cortes que usa la subasta (`not_active`,
 * `outside_dates`, `daily_budget_exhausted`, `total_budget_exhausted`) mas los propios del
 * cobro: que la campana no exista, que el anunciante no exista, que no haya saldo, o que el
 * token ya se haya cobrado (dedupe).
 */
export type ChargeResult =
  | {
      ok: true;
      /** Lo que se desconto de verdad del saldo, en COP enteros. */
      chargedCOP: number;
      stat: AdStatRecord;
      balanceCOP: number;
      campaignExhausted: boolean;
    }
  | {
      ok: false;
      reason:
        | 'no_campaign'
        | 'no_advertiser'
        | 'no_balance'
        | 'duplicate'
        | 'not_active'
        | 'outside_dates'
        | 'daily_budget_exhausted'
        | 'total_budget_exhausted';
    };

/**
 * Fila de estadistica del dia, creandola si no existe.
 *
 * Se crea por el ADAPTER y no por `createEntity` a proposito: `createEntity` genera un id
 * aleatorio, y aqui el id DEBE ser `${campaignId}:${YYYY-MM-DD}` porque de el dependen
 * (a) el `getStatToday` del cobro siguiente y (b) que haya una sola fila por campana y dia.
 * Con un id aleatorio, cada cobro crearia su propia fila y el gasto quedaria repartido en
 * filas que nadie suma. Es el unico punto del store que necesita id propio.
 */
async function ensureStat(campaignId: string, day: string): Promise<AdStatRecord> {
  const id = statKey(campaignId, day);
  const row = await getEntity<Record<string, unknown>>('adStat', id, ADS);
  if (row) return normalizeStat(row, campaignId, day);
  const now = new Date().toISOString();
  const created = await getStorageAdapter().create('adStat', {
    id,
    instance_id: ADS,
    created_at: now,
    updated_at: now,
    campaignId,
    day,
    impressions: 0,
    clicks: 0,
    spendCOP: 0,
    spendMilliCOP: 0,
    freq: {},
  } as DomainRecord);
  return normalizeStat(created, campaignId, day);
}

/**
 * Aplica un gasto al saldo y a la estadistica del dia.
 *
 * `spendMilliCOP` es el gasto en MILESIMAS de peso (sin redondear) y es la unidad que se
 * acumula: un CPM de 2.500 son 2,5 COP por impresion, que no se pueden escribir en un
 * entero sin redondear a 3 (un 20 % de sobrecobra en cada impresion). El saldo SI se
 * descuenta en COP enteros, pero del ACUMULADO: se mira cuanto COP representa ya el gasto
 * del dia y ese es el que sale de la caja. Asi 1000 impresiones de 2,5 COP descuentan
 * 2.500 exactos, ni un peso de mas ni de menos.
 *
 * C4: `lifetimeTotals` se lee DESPUES de escribir la fila de hoy, asi que ya incluye este
 * gasto. Sumarle otra vez `chargeable` contaba el cobro dos veces y vaciaba el presupuesto
 * total por la mitad de lo que correspondia.
 */
async function applySpend(
  campaign: AdCampaign,
  advertiser: Advertiser,
  spendMilliCOP: number,
  clickCount: number,
  impressions: number,
  userHash: string,
  now: number,
): Promise<{ chargedCOP: number; balanceCOP: number; campaignExhausted: boolean; stat: AdStatRecord }> {
  const day = todayKey(now);
  const stat = await ensureStat(campaign.id, day);
  const deltaMilli = Math.max(0, Math.round(spendMilliCOP));
  const nextMilli = stat.spendMilliCOP + deltaMilli;

  const freq = { ...stat.freq };
  // Solo la IMPRESION cuenta para el tope de frecuencia: un clic no vuelve a "enseñarle"
  // el anuncio a alguien que ya lo vio, asi que no debe sumar a su contador.
  if (impressions > 0) freq[userHash] = (stat.freq[userHash] ?? 0) + impressions;

  // Cuanto dinero representa ya el gasto acumulado (en COP enteros). El saldo nunca queda
  // negativo: si el anunciante no tiene para esto, se cobra lo que hay y no se inventa deuda.
  const dueCOP = Math.round(nextMilli / 1000);
  const chargeable = Math.min(Math.max(0, dueCOP - stat.spendCOP), advertiser.balanceCOP);
  const balanceCOP = Math.max(0, advertiser.balanceCOP - chargeable);

  const nextStat: Record<string, unknown> = {
    impressions: stat.impressions + impressions,
    clicks: stat.clicks + clickCount,
    // El gasto del dia es el REALMENTE cobrado, no el pedido: si no, las estadisticas
    // dirian que el anunciante gasto mas de lo que le descontaron.
    spendMilliCOP: nextMilli,
    spendCOP: stat.spendCOP + chargeable,
    freq,
  };
  await updateEntity<Record<string, unknown>>('adStat', statKey(campaign.id, day), nextStat, ADS);
  await updateEntity<Record<string, unknown>>('adAdvertiser', advertiser.id, { balanceCOP }, ADS);

  const statAfter = normalizeStat({ ...stat, ...nextStat } as DomainRecord<Record<string, unknown>>, campaign.id, day);
  // El total ya incluye la fila de hoy (leida despues de escribirla): NO se le suma nada.
  const lifetime = await lifetimeTotals(campaign.id);
  const campaignExhausted =
    lifetime.spendMilliCOP >= campaign.totalBudgetCOP * 1000 || statAfter.spendCOP >= campaign.dailyBudgetCOP;
  if (campaignExhausted && campaign.status === 'active') {
    await updateEntity<Record<string, unknown>>('adCampaign', campaign.id, { status: 'exhausted' }, ADS);
  }
  return { chargedCOP: chargeable, balanceCOP, campaignExhausted, stat: statAfter };
}

type ChargeFailure = Extract<ChargeResult, { ok: false }>;

/**
 * Revalida la campana en el momento del cobro (C3). La subasta filtro el estado cuando
 * sirvio el anuncio, pero entre servirlo y reportar la impresion la campana pudo pausarse,
 * quedar `exhausted` o terminarse. Cobrar sin mirar seria cobrar un servicio que la subasta
 * ya no autoriza: por eso `charge*` NO se fia del token y vuelve a leer la campana.
 *
 * Reutiliza los mismos cortes que `runAuction`, para que el motivo que ve el anunciante en
 * el log sea el mismo por el que se le excluyo de la subasta.
 */
function revalidate(
  campaign: AdCampaign,
  now: number,
  spendMilliCOP: number,
  todaySpendMilliCOP: number,
  lifetimeSpendMilliCOP: number,
): ChargeFailure | null {
  if (campaign.status !== 'active') return { ok: false, reason: 'not_active' };
  const today = todayKey(now);
  if (campaign.startDate && campaign.startDate.slice(0, 10) > today) return { ok: false, reason: 'outside_dates' };
  if (campaign.endDate && campaign.endDate.slice(0, 10) < today) return { ok: false, reason: 'outside_dates' };
  // ⚠ El corte es `>` y no `>=`, y a proposito: lo que se bloquea es el gasto que SE
  // PASARIA del presupuesto, no el que lo CIERRA. Con `>=` la campana no podria gastar ni el
  // ultimo peso de su presupuesto, y ademas `applySpend` la marcaria `exhausted` antes de
  // tiempo, con lo que la ultima impresion se rechazaria por `not_active` y el anunciante
  // pagaria de menos por el presupuesto que si habia contratado. Aqui se deja pasar el
  // gasto que iguala el tope; el siguiente cobro (una unidad por encima) ya no pasa.
  // Todo en milesimas: redondear por separado lo acumulado y lo pendiente dejaba pasar
  // 2,4 + 2,4 COP contra un tope de 4 (2 + 2 = 4) y se acababan cobrando 5.
  if (campaign.dailyBudgetCOP > 0 && todaySpendMilliCOP + spendMilliCOP > campaign.dailyBudgetCOP * 1000) {
    return { ok: false, reason: 'daily_budget_exhausted' };
  }
  // El tope TOTAL se compara con lo gastado en toda la vida de la campana, no con el dia.
  if (campaign.totalBudgetCOP > 0 && lifetimeSpendMilliCOP + spendMilliCOP > campaign.totalBudgetCOP * 1000) {
    return { ok: false, reason: 'total_budget_exhausted' };
  }
  return null;
}

/**
 * Cobra una impresion (modelo CPM).
 *
 * El `priceCOP` del token es un precio POR MIL. En milesimas de peso es 1:1: un CPM de
 * 2.500 son 2.500 milesimas (2,5 COP) por impresion. Cobrar `priceCOP` entero por impresion
 * multiplicaba el ingreso x1000.
 *
 * Idempotente por nonce (C2): se reserva el nonce ANTES de cobrar, con id igual al nonce.
 * La PK de D1 `(instance_id, entity, id)` hace que el segundo intento del mismo token choque
 * y se traduzca en `duplicate`, sin volver a cobrar. Un reenvio del navegador devuelve 204
 * sin cobrar nada.
 */
export async function chargeImpression(input: {
  campaignId: string;
  token: string;
  priceCOP: number;
  userHash: string;
  now: number;
}): Promise<ChargeResult> {
  const campaign = await getCampaign(input.campaignId);
  if (!campaign) return { ok: false, reason: 'no_campaign' };
  const advertiser = await getAdvertiser(campaign.advertiserId);
  if (!advertiser) return { ok: false, reason: 'no_advertiser' };
  if (advertiser.balanceCOP <= 0) return { ok: false, reason: 'no_balance' };

  const tokenId = tokenNonce(input.token);
  const spendMilliCOP = Math.max(0, Math.round(input.priceCOP));

  const stat = await getStatToday(campaign.id, input.now);
  const lifetime = await lifetimeTotals(campaign.id);
  const bloqueada = revalidate(campaign, input.now, spendMilliCOP, stat.spendMilliCOP, lifetime.spendMilliCOP);
  if (bloqueada) return bloqueada;

  const reservado = await claimNonce('impression', campaign.id, tokenId, spendMilliCOP, input.now);
  if (!reservado.ok) return reservado;

  const applied = await applySpend(campaign, advertiser, spendMilliCOP, 0, 1, input.userHash, input.now);
  await markCharged(tokenId, applied.chargedCOP);
  return { ok: true, ...applied };
}

/**
 * Cobra un clic (modelo CPC). Idempotente por token con la MISMA mecanica que la impresion:
 * fila con id = nonce (la PK hace el dedupe atomico) y cobro despues. Si el cobro falla, la
 * fila queda con `chargedCOP: 0`, para que se vea que ese clic se conto pero no se cobro, en
 * vez de dejar constancia de un cobro que no ocurrio.
 */
export async function chargeClick(input: {
  campaignId: string;
  token: string;
  priceCOP: number;
  userHash: string;
  now: number;
}): Promise<ChargeResult> {
  const campaign = await getCampaign(input.campaignId);
  if (!campaign) return { ok: false, reason: 'no_campaign' };
  const advertiser = await getAdvertiser(campaign.advertiserId);
  if (!advertiser) return { ok: false, reason: 'no_advertiser' };
  if (advertiser.balanceCOP <= 0) return { ok: false, reason: 'no_balance' };

  const tokenId = tokenNonce(input.token);
  // En CPC el precio YA es por clic: no hay fraccion, asi que 1 COP = 1.000 milesimas.
  const spendMilliCOP = Math.max(0, Math.round(input.priceCOP)) * 1000;

  const stat = await getStatToday(campaign.id, input.now);
  const lifetime = await lifetimeTotals(campaign.id);
  const bloqueada = revalidate(campaign, input.now, spendMilliCOP, stat.spendMilliCOP, lifetime.spendMilliCOP);
  if (bloqueada) return bloqueada;

  const reservado = await claimNonce('click', campaign.id, tokenId, spendMilliCOP, input.now);
  if (!reservado.ok) return reservado;

  const applied = await applySpend(campaign, advertiser, spendMilliCOP, 1, 0, input.userHash, input.now);
  await markCharged(tokenId, applied.chargedCOP);
  return { ok: true, ...applied };
}

/**
 * Reserva un nonce creando la fila con id = nonce. La PK `(instance_id, entity, id)` hace el
 * dedupe atomico en la propia base: dos peticiones del mismo token a la vez, una gana el
 * INSERT y la otra recibe el error de clave duplicada, que aqui es `duplicate`.
 */
async function claimNonce(
  kind: 'click' | 'impression',
  campaignId: string,
  tokenId: string,
  spendMilliCOP: number,
  now: number,
): Promise<{ ok: true } | ChargeFailure> {
  // Comprobacion previa a la escritura. En D1 la PK `(instance_id, entity, id)` haria que
  // el INSERT duplicado fallara y bastaria con capturar ese error, pero el adaptador NO
  // esta obligado a lanzar (el de pruebas sobreescribe en silencio), asi que el dedupe
  // NO puede depender solo de la excepcion: se pregunta primero y, aun asi, se intenta
  // escribir y se capturaria el error tambien. Asi el cobro es idempotente con cualquier
  // adaptador, y en D1 la carrera simultanea la resuelve la PK.
  const yaExiste = await getEntity<Record<string, unknown>>('adClick', tokenId, ADS);
  if (yaExiste) return { ok: false, reason: 'duplicate' };

  const nowIso = new Date(now).toISOString();
  try {
    // `adClick` es la entidad de los dos registros de cobro (ver AdImpressionRecord).
    await getStorageAdapter().create('adClick', {
      id: tokenId,
      instance_id: ADS,
      created_at: nowIso,
      updated_at: nowIso,
      kind,
      campaignId,
      tokenId,
      // Se deja en 0 hasta que el cobro termine: si el cobro falla, el registro queda como
      // "contado, no cobrado" y no como un cobro fantasma.
      chargedCOP: 0,
      spendMilliCOP,
      at: nowIso,
    } as DomainRecord);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'duplicate' };
  }
}

/** Pone el importe real cobrado en el registro del nonce, ya creado. */
async function markCharged(tokenId: string, chargedCOP: number): Promise<void> {
  await updateEntity<Record<string, unknown>>('adClick', tokenId, { chargedCOP }, ADS);
}

/** Id del clic a partir del token completo: basta con el nonce firmado. */
export function tokenNonce(token: string): string {
  const parts = token.split('.');
  const body = parts[0] ?? token;
  try {
    const parsed = JSON.parse(atob(body)) as { nonce?: string };
    return parsed.nonce ?? body;
  } catch {
    return body;
  }
}
