import { describe, expect, it } from 'vitest';
import type { MeshPort } from '../contracts';
import { LocalMeshHub } from '../localHub';
import { demandCategoryKey } from './demand';
import { DEFAULT_MARKET_PREFS, type Market, createMarket } from './market';
import { TOPIC_DEMAND, TOPIC_OFFER } from './topics';
import { createMemoryStore } from './store';
import { BOGOTA, DAY, MEDELLIN, NOW, hilux, offer } from './testkit';

function world() {
  const hub = new LocalMeshHub(() => NOW);
  const mk = (id: string, extra: Partial<Parameters<typeof createMarket>[0]> = {}) =>
    createMarket({ port: hub.createPort(id), clock: () => NOW, sleep: async () => {}, ...extra });
  return { hub, mk };
}

const form = (over: Record<string, unknown> = {}) => {
  const { id: _id, createdAt: _c, active: _a, ...rest } = offer() as unknown as Record<string, unknown>;
  return { ...rest, ...over };
};

async function owner(m: Market, region = BOGOTA) {
  await m.start();
  await m.setRegion(region);
  m.setVehicles([hilux()]);
  await m.setPrefs({ enabled: true, categories: [...DEFAULT_MARKET_PREFS.categories, ...['offer:lubricentro', 'offer:repuestos', 'offer:taller', 'offer:llanteria', 'offer:revision', 'offer:seguro']] });
}

describe('mercado de punta a punta sobre LocalMeshHub', () => {
  it('el vendedor publica; el dueno de la misma region la ve ordenada; el de otra ciudad no', async () => {
    const { mk } = world();
    const vendor = mk('taller-1');
    const bogota = mk('dueno-bogota');
    const medellin = mk('dueno-medellin');
    await vendor.start();
    await vendor.setRegion(BOGOTA);
    await owner(bogota);
    await owner(medellin, MEDELLIN);

    const general = await vendor.publishOffer(form({ title: 'Repuestos en general', category: 'repuestos' }));
    const aceite = await vendor.publishOffer(
      form({ title: 'Aceite para Toyota', target: { classes: ['liviano'], brands: ['Toyota'], models: [], need: 'aceite', withinKm: 5000 } }),
    );
    expect(general.ok && aceite.ok).toBe(true);

    const inbox = bogota.getState().inbox;
    expect(inbox).toHaveLength(2);
    expect(inbox[0].offer.title).toBe('Aceite para Toyota');
    expect(inbox[0].why).toBe('Tu Hilux necesita cambio de aceite en ~800 km.');
    expect(inbox[0].from).toBe('taller-1');
    expect(medellin.getState().inbox).toHaveLength(0);
    expect(medellin.getState().received).toBe(0);
  });

  it('descarta ofertas sin firma verificada', async () => {
    const { hub, mk } = world();
    const rx = mk('dueno');
    await owner(rx);
    // Un par que publica SIN firmar, saltandose a Market
    const rogue: MeshPort = hub.createPort('rogue');
    await rogue.join('datos', BOGOTA);
    await rogue.publish('datos', BOGOTA, TOPIC_OFFER, { v: 1, offer: offer() }, { sign: false });
    expect(rx.getState().inbox).toHaveLength(0);
    expect(rx.getState().dropped.unsigned).toBe(1);
  });

  it('descarta oferta mal formada, sobredimensionada y vencida', async () => {
    const { hub, mk } = world();
    const rx = mk('dueno');
    await owner(rx);
    const p = hub.createPort('v');
    await p.join('datos', BOGOTA);
    const send = (o: unknown) => p.publish('datos', BOGOTA, TOPIC_OFFER, { v: 1, offer: o }, { sign: true });
    await send({ ...offer(), category: 'x' });
    await send({ ...offer(), description: 'x'.repeat(5000) });
    await send(offer({ validFrom: NOW - 3 * DAY, validUntil: NOW - DAY }));
    await p.publish('datos', BOGOTA, TOPIC_OFFER, 'basura', { sign: true });
    const s = rx.getState();
    expect(s.inbox).toHaveLength(0);
    expect(s.dropped.invalid).toBe(3);
    expect(s.dropped.expired).toBe(1);
  });

  it('deduplica por id, y solo el mismo nodo puede actualizar o retirar', async () => {
    const { hub, mk } = world();
    const rx = mk('dueno');
    await owner(rx);
    const a = hub.createPort('vendedor-a');
    const b = hub.createPort('vendedor-b');
    for (const p of [a, b]) await p.join('datos', BOGOTA);
    const send = (p: MeshPort, o: unknown) => p.publish('datos', BOGOTA, TOPIC_OFFER, { v: 1, offer: o }, { sign: true });

    await send(a, offer({ createdAt: NOW - 100 }));
    await send(a, offer({ createdAt: NOW - 100 })); // duplicado exacto
    expect(rx.getState().inbox).toHaveLength(1);
    expect(rx.getState().dropped.duplicate).toBe(1);

    await send(b, offer({ createdAt: NOW, title: 'Secuestrada', active: false })); // otro nodo, misma id
    expect(rx.getState().inbox).toHaveLength(1);
    expect(rx.getState().dropped.foreign).toBe(1);

    await send(a, offer({ createdAt: NOW - 50, title: 'Actualizada' }));
    expect(rx.getState().inbox[0].offer.title).toBe('Actualizada');

    await send(a, offer({ createdAt: NOW, active: false })); // retiro del dueno de la oferta
    expect(rx.getState().inbox).toHaveLength(0);
  });

  it('limite de ritmo por vendedor (receptor) y por publicacion (emisor)', async () => {
    const { hub, mk } = world();
    const rx = mk('dueno');
    await owner(rx);
    const p = hub.createPort('spammer');
    await p.join('datos', BOGOTA);
    for (let i = 0; i < 14; i++) {
      await p.publish('datos', BOGOTA, TOPIC_OFFER, { v: 1, offer: offer({ id: `spam-${String(i).padStart(4, '0')}` }) }, { sign: true });
    }
    expect(rx.getState().received).toBe(10);
    expect(rx.getState().dropped.rateLimited).toBe(4);

    const vendor = mk('taller');
    await vendor.start();
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await vendor.publishOffer(form({ title: `Oferta ${i}` })));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.at(-1)).toMatchObject({ ok: false, error: 'ritmo' });
  });

  it('las ofertas vencen con el reloj', async () => {
    const { hub } = world();
    let now = NOW;
    const rx = createMarket({ port: hub.createPort('dueno'), clock: () => now, sleep: async () => {} });
    const vendor = createMarket({ port: hub.createPort('taller'), clock: () => now, sleep: async () => {} });
    await owner(rx);
    await vendor.start();
    await vendor.publishOffer(form({ validFrom: NOW - 1000, validUntil: NOW + DAY }));
    expect(rx.getState().inbox).toHaveLength(1);
    now = NOW + 2 * DAY;
    await rx.tick();
    expect(rx.getState().inbox).toHaveLength(0);
    expect(rx.getState().received).toBe(0);
  });

  it('bloquear vendedor, reportar y ocultar quitan la oferta y se recuerdan', async () => {
    const { hub, mk } = world();
    const store = createMemoryStore();
    const rx = mk('dueno', { store });
    await owner(rx);
    const v1 = mk('malo');
    const v2 = mk('dudoso');
    const v3 = mk('ok');
    for (const v of [v1, v2, v3]) await v.start();
    const rooms = [BOGOTA];
    void rooms;
    await v1.publishOffer(form({ title: 'Del malo' }));
    await v2.publishOffer(form({ title: 'Del dudoso' }));
    await v3.publishOffer(form({ title: 'Del bueno' }));
    expect(rx.getState().inbox).toHaveLength(3);

    await rx.blockSeller('malo');
    await rx.reportOffer(rx.getState().inbox.find((m) => m.offer.title === 'Del dudoso')!.offer.id, 'sospechosa');
    expect(rx.getState().inbox.map((m) => m.offer.title)).toEqual(['Del bueno']);

    // un bloqueado no vuelve a entrar
    await v1.publishOffer(form({ title: 'Otra del malo' }));
    expect(rx.getState().inbox).toHaveLength(1);
    expect(rx.getState().dropped.blocked).toBe(1);

    // y todo sobrevive a reiniciar (memoria como respaldo del IndexedDB)
    await rx.stop();
    const again = createMarket({ port: hub.createPort('dueno'), clock: () => NOW, store, sleep: async () => {} });
    await again.start();
    again.setVehicles([hilux()]);
    expect(again.getState().blockedSellers).toEqual(['malo']);
    expect(again.getState().inbox.map((m) => m.offer.title)).toEqual(['Del bueno']);
  });

  it('el vendedor ve sus ofertas y puede retirarlas; los duenos la pierden', async () => {
    const { mk } = world();
    const vendor = mk('taller');
    const rx = mk('dueno');
    await vendor.start();
    await owner(rx);
    const r = await vendor.publishOffer(form());
    if (!r.ok) throw new Error('debia publicar');
    expect(vendor.getState().own).toHaveLength(1);
    expect(rx.getState().inbox).toHaveLength(1);
    await vendor.withdrawOffer(r.offer.id);
    expect(vendor.getState().own).toHaveLength(0);
    expect(rx.getState().inbox).toHaveLength(0);
  });

  it('una oferta con radio grande tambien llega a la celda vecina', async () => {
    const { mk } = world();
    const vendor = mk('taller');
    await vendor.start();
    const vecina = (await import('../geocell')).cellWithNeighbors(4.711, -74.072, 4).find((c) => c !== BOGOTA)!;
    const rx = mk('dueno-vecino');
    await owner(rx, vecina);
    await vendor.publishOffer(form({ radiusKm: 60 }));
    expect(rx.getState().inbox).toHaveLength(1);
  });

  it('re-anuncia las ofertas propias para quien se une despues', async () => {
    const { hub } = world();
    let now = NOW;
    const mkm = (id: string) => createMarket({ port: hub.createPort(id), clock: () => now, sleep: async () => {} });
    const vendor = mkm('taller');
    await vendor.start();
    await vendor.publishOffer(form());
    const tarde = mkm('dueno-tarde');
    await owner(tarde);
    expect(tarde.getState().inbox).toHaveLength(0);
    now += 3 * 60_000;
    await vendor.tick();
    expect(tarde.getState().inbox).toHaveLength(1);
  });

  it('rechaza publicar una oferta invalida sin tocar la red', async () => {
    const { mk } = world();
    const vendor = mk('taller');
    await vendor.start();
    expect(await vendor.publishOffer(form({ category: 'nada' }))).toMatchObject({ ok: false, error: 'categoria' });
    expect(vendor.getState().own).toHaveLength(0);
  });
});

describe('demanda en el mercado', () => {
  const consent = (m: Market) =>
    m.setPrefs({ categories: [...DEFAULT_MARKET_PREFS.categories, demandCategoryKey('lubricentro'), demandCategoryKey('llanteria')] });

  /** Fabrica de puertos desechables que registra cada uno y si se cerro. */
  function ephemeralFactory(hub: LocalMeshHub) {
    const made: { id: string; closed: boolean }[] = [];
    const factory = async () => {
      const id = `efimero-${made.length}-${Math.random().toString(36).slice(2, 8)}`;
      const rec = { id, closed: false };
      made.push(rec);
      const port = hub.createPort(id);
      const close = port.close.bind(port);
      port.close = async () => {
        rec.closed = true;
        await close();
      };
      return port;
    };
    return { made, factory };
  }
  const noSleep = async () => {};

  async function spy(hub: LocalMeshHub) {
    const p = hub.createPort('vendedor-espia');
    await p.join('datos', BOGOTA);
    const froms: string[] = [];
    const payloads: unknown[] = [];
    p.subscribe('datos', TOPIC_DEMAND, (m) => {
      froms.push(m.from);
      payloads.push(m.payload);
    });
    return { froms, payloads };
  }

  it('falla cerrado: con solo el puerto estable no se publica demanda', async () => {
    const { hub, mk } = world();
    const { froms } = await spy(hub);
    const dueno = mk('nodo-estable', { sleep: noSleep }); // sin demandPortFactory
    await owner(dueno);
    await dueno.setDemand(true);
    await consent(dueno);
    expect(await dueno.publishDemand()).toEqual([]);
    expect(froms).toEqual([]);
    expect(dueno.getState().demandAvailable).toBe(false);
    expect(dueno.getState().demandPreview).toEqual([]); // no se promete lo que no saldra
  });

  it('con el consentimiento apagado no se publica nada, ni se abre un puerto', async () => {
    const { hub, mk } = world();
    const { froms } = await spy(hub);
    const eph = ephemeralFactory(hub);
    const dueno = mk('dueno', { demandPortFactory: eph.factory, sleep: noSleep });
    await owner(dueno);
    expect(await dueno.publishDemand()).toEqual([]); // interruptor apagado
    await dueno.setDemand(true);
    expect(await dueno.publishDemand()).toEqual([]); // categoria no consentida
    expect(froms).toEqual([]);
    expect(eph.made).toHaveLength(0);
    await consent(dueno);
    expect(await dueno.publishDemand()).toHaveLength(1);
    await dueno.setDemand(false);
    expect(dueno.getState().demandPreview).toEqual([]);
  });

  it('cada ronda usa un puerto nuevo: from distinto, nunca el estable, y se cierra', async () => {
    const { hub } = world();
    let now = NOW;
    const { froms, payloads } = await spy(hub);
    const eph = ephemeralFactory(hub);
    const dueno = createMarket({
      port: hub.createPort('nodo-estable'),
      clock: () => now,
      demandPortFactory: eph.factory,
      sleep: noSleep,
    });
    await owner(dueno);
    await dueno.setDemand(true);
    await consent(dueno);
    dueno.setVehicles([
      hilux({ needs: [{ key: 'aceite', remaining: 300, unit: 'km' }, { key: 'llantas', remaining: 300, unit: 'km' }] }),
    ]);

    expect(await dueno.publishDemand()).toHaveLength(2);
    // dos necesidades en la misma ronda comparten puerto
    expect(eph.made).toHaveLength(1);
    expect(new Set(froms).size).toBe(1);
    expect(eph.made[0].closed).toBe(true);

    now += 2 * DAY; // otra ronda
    expect(await dueno.publishDemand()).toHaveLength(2);
    expect(eph.made).toHaveLength(2);
    expect(eph.made.every((p) => p.closed)).toBe(true);

    expect(froms).toHaveLength(4);
    expect(new Set(froms).size).toBe(2); // las rondas no se enlazan por `from`
    expect(froms).not.toContain('nodo-estable');
    expect(JSON.stringify(payloads)).not.toMatch(/nodo-estable|Hilux|84200/i);
  });

  it('si abrir el puerto desechable falla, no se publica y no se marca como enviada', async () => {
    const { hub, mk } = world();
    const { froms } = await spy(hub);
    const dueno = mk('dueno', { demandPortFactory: async () => { throw new Error('sin identidad'); }, sleep: noSleep });
    await owner(dueno);
    await dueno.setDemand(true);
    await consent(dueno);
    expect(await dueno.publishDemand()).toEqual([]);
    expect(froms).toEqual([]);
  });

  it('la vista previa es exactamente lo que se publica', async () => {
    const { hub, mk } = world();
    const dueno = mk('dueno', { demandPortFactory: ephemeralFactory(hub).factory, sleep: noSleep });
    await owner(dueno);
    await dueno.setDemand(true, 'full');
    await consent(dueno);
    const preview = dueno.getState().demandPreview;
    expect(preview).toHaveLength(1);
    expect(await dueno.publishDemand()).toEqual(preview);
  });

  it('el vendedor ve la demanda agregada solo si hay k emisores distintos', async () => {
    const { hub, mk } = world();
    const vendor = mk('lubricentro');
    await vendor.start();
    await vendor.setRegion(BOGOTA);
    const duenos = ['a', 'b', 'c'].map((n) => mk(`dueno-${n}`, { demandPortFactory: ephemeralFactory(hub).factory, sleep: noSleep }));
    for (let i = 0; i < duenos.length; i++) {
      await owner(duenos[i]);
      await duenos[i].setDemand(true);
      await consent(duenos[i]);
      await duenos[i].publishDemand();
      if (i === 1) expect(vendor.getState().demandPulse).toEqual([]); // 2 emisores: suprimido
    }
    expect(vendor.getState().demandPulse).toEqual([{ cat: 'lubricentro', need: 'aceite', cls: 'liviano', count: 3 }]);
  });
});
