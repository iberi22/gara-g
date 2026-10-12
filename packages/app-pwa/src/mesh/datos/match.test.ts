import { describe, expect, it } from 'vitest';
import { DEFAULT_OPT_IN_PREFERENCES } from '../../lib/marketplaceOptIn';
import { DEFAULT_MARKET_PREFS } from './market';
import { approx, cellDistanceKm, matchOffers } from './match';
import { BOGOTA, DAY, MEDELLIN, NOW, hilux, moto, offer } from './testkit';

const ctx = { now: NOW, ownerCell: BOGOTA, prefs: DEFAULT_MARKET_PREFS };

describe('matchOffers', () => {
  it('explica el por que: "tu Hilux necesita cambio de aceite en ~800 km"', () => {
    const o = offer({ target: { classes: ['liviano'], brands: ['toyota'], models: [], need: 'aceite', withinKm: 5000 } });
    const [m] = matchOffers([o], [hilux()], ctx);
    expect(m.why).toBe('Tu Hilux necesita cambio de aceite en ~800 km.');
    expect(m.vehicleId).toBe('v-hilux');
    expect(m.need).toBe('aceite');
  });

  it('una oferta para motos no le sale a una camioneta, y viceversa (clase)', () => {
    const paraMotos = offer({ id: 'moto-0001', category: 'llanteria', target: { classes: ['moto'], brands: [], models: [] } });
    const paraPesados = offer({ id: 'camion-001', category: 'taller', target: { classes: ['pesado'], brands: [], models: [] } });
    expect(matchOffers([paraMotos, paraPesados], [hilux()], ctx)).toEqual([]);
    const r = matchOffers([paraMotos, paraPesados], [hilux(), moto()], ctx);
    expect(r.map((m) => m.offer.id)).toEqual(['moto-0001']);
    expect(r[0].vehicleId).toBe('v-moto');
  });

  it('marca, modelo y rango de anios son filtros duros', () => {
    const base = { classes: [] as never[], brands: [] as string[], models: [] as string[] };
    expect(matchOffers([offer({ target: { ...base, brands: ['toyota'] } })], [hilux()], ctx)).toHaveLength(1);
    expect(matchOffers([offer({ target: { ...base, brands: ['renault'] } })], [hilux()], ctx)).toHaveLength(0);
    expect(matchOffers([offer({ target: { ...base, models: ['hilux'] } })], [hilux()], ctx)).toHaveLength(1);
    expect(matchOffers([offer({ target: { ...base, years: { from: 2019, to: 2024 } } })], [hilux()], ctx)).toHaveLength(0);
    expect(matchOffers([offer({ target: { ...base, years: { from: 2015, to: 2019 } } })], [hilux()], ctx)).toHaveLength(1);
  });

  it('ventana de uso: "aceite a los 5 000 km" solo si a la necesidad le faltan <= 5 000', () => {
    const o = offer({ target: { classes: [], brands: [], models: [], need: 'aceite', withinKm: 5000 } });
    expect(matchOffers([o], [hilux({ needs: [{ key: 'aceite', remaining: 4800, unit: 'km' }] })], ctx)).toHaveLength(1);
    expect(matchOffers([o], [hilux({ needs: [{ key: 'aceite', remaining: 9000, unit: 'km' }] })], ctx)).toHaveLength(0);
    // ya vencido tambien cuenta, y la razon lo dice
    const [m] = matchOffers([o], [hilux({ needs: [{ key: 'aceite', remaining: -300, unit: 'km' }] })], ctx);
    expect(m.why).toBe('Tu Hilux necesita cambio de aceite: ya se pasó hace ~300 km.');
    // sin esa necesidad registrada no hay con que calzar
    expect(matchOffers([o], [hilux({ needs: [] })], ctx)).toHaveLength(0);
  });

  it('rango de odometro', () => {
    const o = offer({ target: { classes: [], brands: [], models: [], odometer: { min: 80_000, max: 100_000 } } });
    expect(matchOffers([o], [hilux()], ctx)).toHaveLength(1);
    expect(matchOffers([o], [hilux({ odometer: 20_000 })], ctx)).toHaveLength(0);
  });

  it('distancia: fuera del radio no sale; mas cerca puntua mas a igualdad de lo demas', () => {
    expect(cellDistanceKm(BOGOTA, MEDELLIN)).toBeGreaterThan(200);
    expect(matchOffers([offer({ region: MEDELLIN, radiusKm: 30 })], [hilux()], ctx)).toHaveLength(0);
    // con radio enorme llega, pero pierde contra la local
    const lejos = offer({ id: 'lejos-0001', region: MEDELLIN, radiusKm: 200 });
    const cerca = offer({ id: 'cerca-0001' });
    const r = matchOffers([lejos, cerca], [], ctx);
    expect(r.map((m) => m.offer.id)).toEqual(['cerca-0001']); // 200 km + holgura no alcanza 240 km
    const lejos2 = offer({ id: 'lejos-0002', region: MEDELLIN, radiusKm: 200 });
    expect(cellDistanceKm(BOGOTA, MEDELLIN)).toBeGreaterThan(220);
    expect(matchOffers([lejos2], [], { ...ctx, ownerCell: MEDELLIN })).toHaveLength(1);
  });

  it('ordena: la que atiende una necesidad urgente va primero, luego descuento, luego general', () => {
    const general = offer({ id: 'general-01', category: 'repuestos', title: 'Repuestos' });
    const conDescuento = offer({ id: 'descuento1', category: 'repuestos', discountPct: 30 });
    const aceite = offer({ id: 'aceite-001', category: 'lubricentro' });
    const r = matchOffers([general, conDescuento, aceite], [hilux()], ctx);
    expect(r.map((m) => m.offer.id)).toEqual(['aceite-001', 'descuento1', 'general-01']);
    expect(r[0].why).toContain('cambio de aceite');
  });

  it('una necesidad mas urgente sube la oferta', () => {
    const o = offer({ target: { classes: [], brands: [], models: [], need: 'aceite', withinKm: 5000 } });
    const urgente = matchOffers([o], [hilux({ needs: [{ key: 'aceite', remaining: 200, unit: 'km' }] })], ctx)[0];
    const lejana = matchOffers([o], [hilux({ needs: [{ key: 'aceite', remaining: 4500, unit: 'km' }] })], ctx)[0];
    expect(urgente.score).toBeGreaterThan(lejana.score);
  });

  it('respeta el consentimiento: categoria apagada, modo apagado', () => {
    const sinLubricentro = { ...DEFAULT_MARKET_PREFS, categories: DEFAULT_MARKET_PREFS.categories.filter((c) => c !== 'offer:lubricentro') };
    expect(matchOffers([offer()], [hilux()], { ...ctx, prefs: sinLubricentro })).toHaveLength(0);
    expect(matchOffers([offer()], [hilux()], { ...ctx, prefs: { ...DEFAULT_MARKET_PREFS, enabled: false } })).toHaveLength(0);
    // GARA-G no intermedia pagos: un payoutGara heredado no filtra ni puntua
    expect(matchOffers([offer({ payoutGara: 5 })], [hilux()], ctx)).toHaveLength(1);
    expect(matchOffers([offer({ payoutGara: 5 })], [hilux()], ctx)[0].score).toBe(matchOffers([offer()], [hilux()], ctx)[0].score);
    expect(matchOffers([offer()], [hilux()], ctx)).toHaveLength(1);
    // prefs "viejos" sin categorias del mercado: nada sale
    expect(matchOffers([offer()], [hilux()], { ...ctx, prefs: DEFAULT_OPT_IN_PREFERENCES })).toHaveLength(0);
  });

  it('el horario no oculta la bandeja', () => {
    const noche = { ...DEFAULT_MARKET_PREFS, schedule: { startHour: 1, endHour: 2, daysOfWeek: [0] } };
    expect(matchOffers([offer()], [hilux()], { ...ctx, prefs: noche })).toHaveLength(1);
  });

  it('vencidas, futuras y retiradas no salen', () => {
    expect(matchOffers([offer({ validUntil: NOW - 1 })], [hilux()], ctx)).toHaveLength(0);
    expect(matchOffers([offer({ validFrom: NOW + DAY })], [hilux()], ctx)).toHaveLength(0);
    expect(matchOffers([offer({ active: false })], [hilux()], ctx)).toHaveLength(0);
  });

  it('es determinista y estable', () => {
    const a = offer({ id: 'aaaaaaaa1' });
    const b = offer({ id: 'bbbbbbbb1' });
    expect(matchOffers([b, a], [hilux()], ctx).map((m) => m.offer.id)).toEqual(matchOffers([a, b], [hilux()], ctx).map((m) => m.offer.id));
  });

  it('approx redondea', () => {
    expect(approx(830, 'km')).toBe('~800 km');
    expect(approx(42, 'h')).toBe('~40 h');
  });
});
