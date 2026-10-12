// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_INSTANCE_ID } from '../../lib/appMode';
import { getMemoryAdapter, listEntities, setStorageAdapter } from '../../lib/domain';
import { closeLocalDb } from '../../lib/local/indexedDbAdapter';
import { GarageApiClient } from './api';
import {
  addLocalMaintenance,
  addLocalVehicle,
  deleteLocalVehicle,
  ensureDemoVehicle,
  loadLocalDetail,
  loadLocalSnapshot,
  resolveMaintenanceDraft,
  resolveVehicleDraft,
  resolveVehicleEdit,
  setLocalUsage,
  updateLocalVehicle,
} from './guestGarage';

const NOW = new Date('2026-10-02T12:00:00Z');

beforeEach(async () => {
  await closeLocalDb();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  localStorage.clear();
});

afterEach(() => {
  setStorageAdapter(getMemoryAdapter());
  vi.unstubAllGlobals();
  document.cookie = 'gara_mode=; max-age=0';
});

describe('resolveVehicleDraft', () => {
  it('modelo del catálogo: el tipo y la unidad salen del modelo', () => {
    const r = resolveVehicleDraft({ modelKey: 'Toyota|Hilux', plate: ' abc123 ', year: '2020', usage: '45000' }, NOW);
    expect(r.ok && r.value).toMatchObject({ make: 'Toyota', model: 'Hilux', type: 'pickup', plate: 'ABC123', year: 2020, unit: 'km', usage: 45000 });
  });

  it('maquinaria del catálogo: horómetro y placa opcional', () => {
    const r = resolveVehicleDraft({ modelKey: 'Caterpillar|320', year: 2018, usage: '1200,5' }, NOW);
    expect(r.ok && r.value).toMatchObject({ unit: 'h', usage: 1200.5, plate: '' });
  });

  it('"otro": marca, modelo y tipo libres; el tipo decide la unidad', () => {
    const r = resolveVehicleDraft({ modelKey: 'otro', make: 'Marca X', model: 'Modelo Y', type: 'excavadora', year: 2015, usage: 10 }, NOW);
    expect(r.ok && r.value).toMatchObject({ make: 'Marca X', model: 'Modelo Y', type: 'excavadora', unit: 'h' });
  });

  it('"otro" que existe en el catálogo toma el catálogo', () => {
    const r = resolveVehicleDraft({ modelKey: 'otro', make: 'toyota', model: 'HILUX', plate: 'AAA111', year: 2020, usage: 1 }, NOW);
    expect(r.ok && r.value).toMatchObject({ make: 'Toyota', model: 'Hilux', type: 'pickup' });
  });

  it('errores por campo', () => {
    const r = resolveVehicleDraft({ modelKey: 'otro', year: '1800', usage: '-5' }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['make', 'model', 'type', 'usage', 'year']);
    const p = resolveVehicleDraft({ modelKey: 'Toyota|Hilux', year: 2020, usage: 0 }, NOW);
    expect(!p.ok && p.errors.plate).toBeTruthy();
    const none = resolveVehicleDraft({ modelKey: '', year: 2020, usage: 0 }, NOW);
    expect(!none.ok && none.errors.modelKey).toBeTruthy();
  });
});

describe('resolveMaintenanceDraft / resolveVehicleEdit', () => {
  it('valida tipo, fecha, lectura y costo', () => {
    expect(resolveMaintenanceDraft({ type: '', date: '' }, NOW).ok).toBe(false);
    expect(resolveMaintenanceDraft({ type: 'x', date: '2026-12-31' }, NOW).ok).toBe(false);
    expect(resolveMaintenanceDraft({ type: 'x', date: '2026-10-01', cost: 'abc' }, NOW).ok).toBe(false);
    const ok = resolveMaintenanceDraft({ type: ' Aceite ', date: '2026-10-01', reading: '46000', cost: '180000' }, NOW);
    expect(ok.ok && ok.value).toMatchObject({ type: 'Aceite', reading: 46000, cost: 180000 });
  });

  it('editar exige marca y modelo; la placa solo en vehículos de km', () => {
    expect(resolveVehicleEdit({ make: '', model: '', year: 2020 }, 'km', NOW).ok).toBe(false);
    expect(resolveVehicleEdit({ make: 'A', model: 'B', year: 2020 }, 'h', NOW).ok).toBe(true);
    expect(resolveVehicleEdit({ make: 'A', model: 'B', year: 2020 }, 'km', NOW).ok).toBe(false);
  });
});

describe('garage local sobre IndexedDB (mismos builders que el servidor)', () => {
  const hilux = () => {
    const r = resolveVehicleDraft({ modelKey: 'Toyota|Hilux', plate: 'ABC123', year: 2020, usage: 45000 }, NOW);
    if (!r.ok) throw new Error('draft');
    return r.value;
  };

  it('agregar → aparece en el snapshot con su unidad y odómetro; vacío antes y después de borrar', async () => {
    expect((await loadLocalSnapshot()).vehicles).toEqual([]);
    const v = await addLocalVehicle(hilux());
    expect(v.instance_id).toBe(LOCAL_INSTANCE_ID);
    const snap = await loadLocalSnapshot();
    expect(snap.vehicles).toHaveLength(1);
    expect(snap.vehicles[0]).toMatchObject({ id: v.id, plate: 'ABC123', usageUnit: 'km', odometerKm: 45000 });

    expect(await deleteLocalVehicle(v.id)).toBe(true);
    expect((await loadLocalSnapshot()).vehicles).toEqual([]);
    expect(await deleteLocalVehicle(v.id)).toBe(false);
  });

  it('maquinaria: el horómetro va en horas', async () => {
    const r = resolveVehicleDraft({ modelKey: 'Caterpillar|320', year: 2018, usage: 1200 }, NOW);
    if (!r.ok) throw new Error('draft');
    const v = await addLocalVehicle(r.value);
    const snap = await loadLocalSnapshot();
    expect(snap.vehicles[0]).toMatchObject({ id: v.id, usageUnit: 'h', odometerKm: 1200 });
    await setLocalUsage(v.id, 'h', 1300);
    expect((await loadLocalSnapshot()).vehicles[0].odometerKm).toBe(1300);
  });

  it('actualizar lectura y editar el vehículo', async () => {
    const v = await addLocalVehicle(hilux());
    await setLocalUsage(v.id, 'km', 52000);
    await updateLocalVehicle(v.id, { make: 'Toyota', model: 'Hilux', year: 2021, plate: 'XYZ789' });
    const [g] = (await loadLocalSnapshot()).vehicles;
    expect(g).toMatchObject({ odometerKm: 52000, plate: 'XYZ789', year: 2021 });
  });

  it('mantenimiento → aparece en el historial; una lectura mayor adelanta el odómetro', async () => {
    const v = await addLocalVehicle(hilux());
    const m = resolveMaintenanceDraft({ type: 'Cambio de aceite y filtro', date: '2026-09-30', reading: '46000', cost: '180000' }, NOW);
    if (!m.ok) throw new Error('draft');
    await addLocalMaintenance(v.id, 'km', m.value, 45000);
    const detail = await loadLocalDetail(v.id);
    const ev = detail?.history.find((e) => e.title.includes('Cambio de aceite'));
    expect(ev).toMatchObject({ costCOP: 180000, km: 46000 });
    expect(detail?.vehicle.odometerKm).toBe(46000);
  });

  it('sin lectura usa la actual y no la mueve', async () => {
    const v = await addLocalVehicle(hilux());
    const m = resolveMaintenanceDraft({ type: 'Filtro de aire', date: '2026-09-30' }, NOW);
    if (!m.ok) throw new Error('draft');
    await addLocalMaintenance(v.id, 'km', m.value, 45000);
    const detail = await loadLocalDetail(v.id);
    expect(detail?.history.find((e) => e.title.includes('Filtro de aire'))?.km).toBe(45000);
    expect(detail?.vehicle.odometerKm).toBe(45000);
  });

  it('borrar el vehículo borra su historial', async () => {
    const v = await addLocalVehicle(hilux());
    const m = resolveMaintenanceDraft({ type: 'Aceite', date: '2026-09-30' }, NOW);
    if (!m.ok) throw new Error('draft');
    await addLocalMaintenance(v.id, 'km', m.value, 45000);
    localStorage.setItem(`garage:paint:${v.id}`, '{}');
    await deleteLocalVehicle(v.id);
    expect(await listEntities('maintenance', LOCAL_INSTANCE_ID)).toEqual([]);
    expect(localStorage.getItem(`garage:paint:${v.id}`)).toBeNull();
  });
});

describe('vehículo de ejemplo (siembra de la demo)', () => {
  it('una sola vez: siembra el camión tolva de la flota demo chilena y no vuelve a sembrar ni duplica', async () => {
    await ensureDemoVehicle();
    const snap = await loadLocalSnapshot();
    expect(snap.vehicles).toHaveLength(1);
    expect(snap.vehicles[0]).toMatchObject({ make: 'Kenworth', model: 'T800 Volqueta', usageUnit: 'km', odometerKm: 186400 });
    expect(snap.vehicles[0].plate).toBe('ZZBC-11');
    expect(snap.vehicles[0].year).toBe(2019);

    // Segunda llamada: la marca evita duplicar y resucitar lo que el visitante borre.
    await ensureDemoVehicle();
    expect((await loadLocalSnapshot()).vehicles).toHaveLength(1);
  });

  it('no pisa un parque que ya tiene vehículos', async () => {
    const propio = await addLocalVehicle({ make: 'Chevrolet', model: 'N300', type: 'van', plate: 'XYZ111', year: 2019, status: 'active', unit: 'km', usage: 100 });
    await ensureDemoVehicle();
    const snap = await loadLocalSnapshot();
    expect(snap.vehicles.map((v) => v.id)).toEqual([propio.id]);
    expect(snap.vehicles[0].make).toBe('Chevrolet');
  });
});

describe('GarageApiClient en modo invitado: cero red', () => {
  it('ningún método toca fetch, getVehicles devuelve lo local (no el mock ni la caché) y no manda a /login', async () => {
    document.cookie = 'gara_mode=guest';
    const fetchSpy = vi.fn(() => Promise.reject(new Error('sin red')));
    vi.stubGlobal('fetch', fetchSpy);
    // Una caché de la nube que NO debe verse
    localStorage.setItem('garage:snapshot:v1', JSON.stringify({ vehicles: [{ id: 'nube', name: 'Nube' }], generatedAt: 'x' }));

    const api = new GarageApiClient();
    const empty = await api.getVehicles();
    expect(empty).toMatchObject({ isOffline: false });
    expect(empty.snapshot.vehicles).toEqual([]);

    const v = await addLocalVehicle({ make: 'Toyota', model: 'Hilux', type: 'pickup', plate: 'ABC123', year: 2020, status: 'active', unit: 'km', usage: 10 });
    const withOne = await api.getVehicles();
    expect(withOne.snapshot.vehicles.map((x) => x.id)).toEqual([v.id]);
    expect((await api.getVehicleDetail(v.id)).vehicle.id).toBe(v.id);
    await expect(api.getVehicleDetail('no-existe')).rejects.toThrow();

    expect((await api.getTelemetry('VIN')).connected).toBe(false);
    expect((await api.getWiki('k')).sections).toEqual([]);
    expect(await api.getForumThreads('k')).toEqual([]);
    expect((await api.getForumThreadDetail('t')).posts).toEqual([]);
    expect(await api.getShop('v')).toEqual({ sponsored: [], posts: [] });
    expect(await api.serveAd({ slot: 'part_context' })).toEqual([]);
    expect(await api.recordImpression('tok')).toBe(false);
    await expect(api.createForumThread('k', 't', 'b')).rejects.toThrow();
    await expect(api.createForumPost('t', 'b')).rejects.toThrow();
    await expect(api.updateWikiSection('k', 's', 'b', 0)).rejects.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('en modo nube sigue usando la red', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ vehicles: [], generatedAt: 'x' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchSpy);
    await new GarageApiClient().getVehicles();
    expect(fetchSpy).toHaveBeenCalledWith('/api/garage/vehicles', expect.anything());
  });
});
