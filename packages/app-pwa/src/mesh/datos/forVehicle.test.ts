import { describe, expect, it } from 'vitest';
import { DEFAULT_MARKET_PREFS } from './market';
import { AGE_HINT_YEARS, CATALOG, itemsForVehicle, offerCoversItem, planForVehicles, vehicleAge, vehicleTitle } from './forVehicle';
import { BOGOTA, MEDELLIN, NOW, hilux, moto, offer } from './testkit';

const ENABLED_PREFS = {
  ...DEFAULT_MARKET_PREFS,
  enabled: true,
  categories: ['offer:lubricentro', 'offer:repuestos', 'offer:taller', 'offer:llanteria', 'offer:revision', 'offer:seguro'],
};
const ctx = { now: NOW, ownerCell: BOGOTA, prefs: ENABLED_PREFS };
const excavadora = (over: Parameters<typeof hilux>[0] = {}) => hilux({ id: 'v-exc', name: 'Excavadora', cls: 'maquinaria', make: 'Caterpillar', model: '320', year: 2015, usage: 'h', needs: [{ key: 'aceite', remaining: 20, unit: 'h' }], ...over });
const camion = () => hilux({ id: 'v-cam', name: 'Camión', cls: 'pesado', make: 'Chevrolet', model: 'NPR', year: 2012, needs: [] });

describe('itemsForVehicle', () => {
  const ids = (v: ReturnType<typeof hilux>) => itemsForVehicle(v).map((i) => i.id);

  it('cada clase recibe sus rubros propios y no los de otra', () => {
    expect(ids(moto())).toEqual(expect.arrayContaining(['aceite', 'llantas', 'casco', 'equipaje', 'arrastre']));
    expect(ids(moto())).not.toContain('carretera');
    expect(ids(hilux())).toEqual(expect.arrayContaining(['carretera', 'interior', 'luces']));
    expect(ids(hilux())).not.toContain('casco');
    expect(ids(camion())).toEqual(expect.arrayContaining(['carga', 'carretera']));
    expect(ids(camion())).not.toContain('interior');
    expect(ids(excavadora())).toEqual(expect.arrayContaining(['desgaste', 'hidraulico']));
    expect(ids(excavadora())).not.toContain('carretera');
  });

  it('el rubro hidraulico solo existe para vehiculos medidos en horas', () => {
    expect(ids(excavadora())).toContain('hidraulico');
    expect(ids(excavadora({ usage: 'km' }))).not.toContain('hidraulico');
  });

  it('los ids del catalogo son unicos y toda necesidad tiene su rubro', () => {
    expect(new Set(CATALOG.map((i) => i.id)).size).toBe(CATALOG.length);
    for (const k of ['aceite', 'llantas', 'frenos', 'bateria', 'filtros', 'seguro', 'revision']) {
      expect(CATALOG.some((i) => i.need === k), k).toBe(true);
    }
  });
});

describe('vehicleTitle / vehicleAge', () => {
  it('usa marca, modelo y ano; sin ellos, el nombre', () => {
    expect(vehicleTitle(hilux())).toBe('Toyota Hilux 2018');
    expect(vehicleTitle(hilux({ make: undefined, model: undefined, year: undefined }))).toBe('Hilux');
  });
  it('la edad sale del ano y del reloj inyectado', () => {
    expect(vehicleAge(hilux(), NOW)).toBe(2026 - 2018);
    expect(vehicleAge(hilux({ year: undefined }), NOW)).toBeUndefined();
    expect(vehicleAge(hilux({ year: 2030 }), NOW)).toBeUndefined();
  });
});

describe('offerCoversItem', () => {
  const item = (id: string) => CATALOG.find((i) => i.id === id)!;
  it('por la necesidad que declara la oferta', () => {
    const o = offer({ target: { classes: [], brands: [], models: [], need: 'aceite', withinKm: 5000 } });
    expect(offerCoversItem(o, item('aceite'))).toBe(true);
    expect(offerCoversItem(o, item('frenos'))).toBe(false);
  });
  it('sin necesidad declarada, por palabras (sin acentos) y categoria', () => {
    expect(offerCoversItem(offer({ category: 'lubricentro', title: 'Cambio de ACEITE sintético' }), item('aceite'))).toBe(true);
    expect(offerCoversItem(offer({ category: 'repuestos', title: 'Cascos certificados 20% off', description: '' }), item('casco'))).toBe(true);
    // la palabra sirve solo si la categoria del vendedor es la del rubro
    expect(offerCoversItem(offer({ category: 'taller', title: 'Cascos', description: '' }), item('casco'))).toBe(false);
    expect(offerCoversItem(offer({ category: 'lubricentro', title: 'Lavado', description: 'Con brillo' }), item('aceite'))).toBe(false);
  });
});

describe('planForVehicles', () => {
  it('lo que vence pronto va primero, de la mas apurada a la menos; el resto sigue el orden del catalogo', () => {
    const v = hilux({ needs: [{ key: 'frenos', remaining: 3000, unit: 'km' }, { key: 'aceite', remaining: 800, unit: 'km' }, { key: 'llantas', remaining: 20_000, unit: 'km' }] });
    const [p] = planForVehicles([v], [], ctx);
    expect(p.groups.slice(0, 2).map((g) => g.id)).toEqual(['aceite', 'frenos']);
    expect(p.soonCount).toBe(2);
    expect(p.groups[0].soon).toMatchObject({ overdue: false, text: 'Vence en ~800 km' });
    expect(p.groups.find((g) => g.id === 'llantas')!.soon).toBeNull(); // lejos: no es "pronto"
    const rest = p.groups.slice(2).map((g) => g.id);
    expect(rest).toEqual(CATALOG.map((i) => i.id).filter((id) => rest.includes(id)));
  });

  it('un vencido va antes que uno que vence pronto, y dice cuanto se paso', () => {
    const v = hilux({ needs: [{ key: 'aceite', remaining: 100, unit: 'km' }, { key: 'seguro', remaining: -10, unit: 'dias' }] });
    const [p] = planForVehicles([v], [], ctx);
    expect(p.groups[0].id).toBe('seguro');
    expect(p.groups[0].soon).toMatchObject({ overdue: true });
    expect(p.groups[0].soon!.text).toMatch(/^Ya se pasó hace ~/);
  });

  it('en horas: 20 h para el aceite es "pronto" y se mide en la escala comun', () => {
    const [p] = planForVehicles([excavadora()], [], ctx);
    expect(p.groups[0]).toMatchObject({ id: 'aceite', label: 'Aceite del motor e hidráulico' });
    expect(p.groups[0].soon!.text).toBe('Vence en ~20 h');
  });

  it('las ofertas se reparten por vehiculo segun su segmentacion', () => {
    const paraToyota = offer({ id: 'toyota-0001', title: 'Aceite para Toyota', target: { classes: [], brands: ['toyota'], models: [] } });
    const paraMotos = offer({ id: 'motos-00001', category: 'repuestos', title: 'Cascos y guantes', description: '', target: { classes: ['moto'], brands: [], models: [] } });
    const [a, b] = planForVehicles([hilux(), moto()], [paraToyota, paraMotos], ctx);
    expect(a.groups.find((g) => g.id === 'aceite')!.offers.map((m) => m.offer.id)).toEqual(['toyota-0001']);
    expect(a.groups.flatMap((g) => g.offers).some((m) => m.offer.id === 'motos-00001')).toBe(false);
    expect(b.groups.find((g) => g.id === 'casco')!.offers.map((m) => m.offer.id)).toEqual(['motos-00001']);
    expect(b.groups.flatMap((g) => g.offers).some((m) => m.offer.id === 'toyota-0001')).toBe(false);
  });

  it('una oferta general aparece en cada vehiculo al que le sirve, una sola vez por vehiculo', () => {
    const o = offer({ id: 'aceite-gral', title: 'Aceite y filtro de aceite' });
    const plans = planForVehicles([hilux(), moto()], [o], ctx);
    for (const p of plans) expect([...p.groups.flatMap((g) => g.offers), ...p.others].filter((m) => m.offer.id === 'aceite-gral')).toHaveLength(1);
  });

  it('lo que no cae en ningun rubro va en "otras"; lo fuera de zona o vencido no sale', () => {
    const rara = offer({ id: 'rara-00001', category: 'taller', title: 'Lavado en seco', description: '' });
    const lejos = offer({ id: 'lejos-0001', region: MEDELLIN, radiusKm: 5 });
    const vencida = offer({ id: 'vencida-01', validUntil: NOW - 1, validFrom: NOW - 5 });
    const [p] = planForVehicles([hilux()], [rara, lejos, vencida], ctx);
    expect(p.others.map((m) => m.offer.id)).toEqual(['rara-00001']);
    expect(p.groups.flatMap((g) => g.offers)).toEqual([]);
  });

  it('respeta el consentimiento del dueno (categoria apagada)', () => {
    const prefs = { ...DEFAULT_MARKET_PREFS, categories: DEFAULT_MARKET_PREFS.categories.filter((c) => c !== 'offer:lubricentro') };
    const [p] = planForVehicles([hilux()], [offer()], { ...ctx, prefs });
    expect([...p.groups.flatMap((g) => g.offers), ...p.others]).toEqual([]);
  });

  it(`con ${AGE_HINT_YEARS}+ anos sugiere revisar bateria y frenos si no hay vencimiento`, () => {
    const [vieja, nueva] = planForVehicles([hilux({ year: 2010, needs: [] }), hilux({ id: 'v2', year: 2024, needs: [] })], [], ctx);
    expect(vieja.groups.find((g) => g.id === 'bateria')!.hint).toBe('Con 16 años conviene revisarlo.');
    expect(vieja.groups.find((g) => g.id === 'aceite')!.hint).toBeUndefined();
    expect(nueva.groups.find((g) => g.id === 'bateria')!.hint).toBeUndefined();
  });

  it('sin vehiculos no hay nada; es pura (mismo resultado dos veces)', () => {
    expect(planForVehicles([], [offer()], ctx)).toEqual([]);
    const o = [offer()];
    expect(planForVehicles([hilux()], o, ctx)).toEqual(planForVehicles([hilux()], o, ctx));
  });
});
