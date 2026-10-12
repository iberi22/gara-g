import { describe, expect, it } from 'vitest';
import { Events } from './packet';
import { angleDiff, assessAll, assessHazard, assessNeighbor, toEnu, type VehicleState } from './risk';

const NOW = 1_800_000_000_000;
const O = { lat: 4.711, lon: -74.0721 };
const kmh = (v: number) => v / 3.6;

/** Estado de un vehiculo a (e, n) metros del origen. */
function car(id: number, e: number, n: number, speedKmh: number, heading: number, patch: Partial<VehicleState> = {}): VehicleState {
  return {
    id,
    lat: O.lat + n / 111_320,
    lon: O.lon + e / (111_320 * Math.cos((O.lat * Math.PI) / 180)),
    speedMps: kmh(speedKmh),
    headingDeg: heading,
    accuracyM: 4,
    ts: NOW,
    vehicleClass: 'carro',
    events: 0,
    ...patch,
  };
}
const me = (speedKmh: number, heading = 0, patch: Partial<VehicleState> = {}) => car(1, 0, 0, speedKmh, heading, patch);

describe('geometria', () => {
  it('ENU y diferencia angular', () => {
    const p = toEnu(O, O.lat + 100 / 111_320, O.lon);
    expect(p.n).toBeCloseTo(100, 3);
    expect(p.e).toBeCloseTo(0, 3);
    expect(angleDiff(350, 10)).toBe(-20);
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(0, 180)).toBe(180);
  });
});

describe('riesgo entre vehiculos', () => {
  it('de frente a 60+60 km/h, mismo carril: peligro (≈3 s)', () => {
    const r = assessNeighbor(me(60), car(2, 0, 100, 60, 180), NOW);
    expect(r.level).toBe('peligro');
    expect(r.ttcS).toBeCloseTo(3, 0);
    expect(r.closingMps).toBeCloseTo(33.3, 0);
  });

  it('de frente pero aun lejos (6 s): solo aviso', () => {
    const r = assessNeighbor(me(60), car(2, 0, 200, 60, 180), NOW);
    expect(r.level).toBe('aviso');
  });

  it('de frente a 12 s: sin riesgo todavia', () => {
    expect(assessNeighbor(me(60), car(2, 0, 400, 60, 180), NOW).level).toBe('none');
  });

  it('cruce normal en carril contrario (3,5 m al lado): sin alarma', () => {
    const r = assessNeighbor(me(60), car(2, 3.6, 100, 60, 180), NOW);
    expect(r.level).toBe('none');
  });

  it('de frente con GPS malo (>12 m): se ignora en vez de alarmar', () => {
    const r = assessNeighbor(me(60), car(2, 0, 100, 60, 180, { accuracyM: 20 }), NOW);
    expect(r.ignored).toBe(true);
    expect(r.level).toBe('none');
  });

  it('mismo sentido, mismo carril, siguiendo a distancia segura: ninguno', () => {
    const r = assessNeighbor(me(60), car(2, 0, -40, 60, 0), NOW); // coche detras a 40 m, igual velocidad
    expect(r.level).toBe('none');
    const front = assessNeighbor(me(60), car(3, 0, 40, 60, 0), NOW);
    expect(front.level).toBe('none');
  });

  it('alcance lento al de delante (cierre 5 m/s a 40 m = 8 s): aviso', () => {
    const r = assessNeighbor(me(72), car(2, 0, 40, 54, 0), NOW);
    expect(r.level).toBe('aviso');
    expect(r.reason).toBe('alcance');
    expect(assessAll(me(72), [car(2, 0, 40, 54, 0)], [], NOW).headline?.message).toBe('Cuidado: te acercas a un vehículo');
  });

  it('el de delante frena en seco (va a 0 a 25 m, yo a 72 km/h): peligro', () => {
    const r = assessNeighbor(me(72), car(2, 0, 25, 0, 0), NOW);
    expect(r.level).toBe('peligro');
  });

  it('el de delante frena y lo avisa con HARD_BRAKE: peligro por evento aunque su velocidad llegue tarde', () => {
    // Su baliza aun dice 54 km/h (frenada reciente) pero lleva la marca.
    const a = assessAll(me(72), [car(2, 0, 30, 70, 0, { events: Events.HARD_BRAKE })], [], NOW);
    // Cierre ~0: el rumbo y la velocidad no bastan, la marca por si sola no da peligro sin cierre.
    expect(a.neighbors[0].level).toBe('none');
    const b = assessAll(me(72), [car(2, 0, 30, 20, 0, { events: Events.HARD_BRAKE })], [], NOW);
    expect(b.neighbors[0].level).toBe('peligro');
    expect(b.headline?.level).toBe('peligro');
  });

  it('cruce en interseccion: llegan a la vez => peligro; con ~1 s de diferencia => aviso', () => {
    // Yo al norte a 54 km/h (15 m/s), punto de cruce a 40 m. El otro al este a 15 m/s.
    const both = assessNeighbor(me(54), car(2, -40, 40, 54, 90), NOW);
    expect(both.level).toBe('peligro');
    expect(both.dminM).toBeLessThan(1);
    const offset = assessNeighbor(me(54), car(2, -55, 40, 54, 90), NOW);
    expect(offset.level).toBe('aviso');
    const late = assessNeighbor(me(54), car(2, -120, 40, 54, 90), NOW);
    expect(late.level).toBe('none');
  });

  it('vecino caducado (> 3,5 s) se ignora', () => {
    const r = assessNeighbor(me(60), car(2, 0, 50, 60, 180, { ts: NOW - 4_000 }), NOW);
    expect(r.ignored).toBe(true);
    expect(r.reason).toBe('caducado');
  });

  it('vecino con precision mala (> 30 m) se ignora', () => {
    expect(assessNeighbor(me(60), car(2, 0, 50, 60, 180, { accuracyM: 45 }), NOW).ignored).toBe(true);
    expect(assessNeighbor(me(60, 0, { accuracyM: 45 }), car(2, 0, 50, 60, 180), NOW).ignored).toBe(true);
  });

  it('extrapola al neighbor con su edad: una baliza de 1 s ya recorrio 16 m', () => {
    const r = assessNeighbor(me(0, 0), car(2, 0, 100, 60, 180, { ts: NOW - 1_000 }), NOW);
    expect(r.n).toBeCloseTo(100 - 16.67, 0);
  });

  it('vehiculos en sentidos opuestos que ya se cruzaron (se alejan): sin riesgo', () => {
    const r = assessNeighbor(me(60), car(2, 0, -10, 60, 180), NOW);
    expect(r.level).toBe('none');
    expect(r.closingMps).toBeLessThan(0);
  });

  it('paralelo en la via de al lado, misma velocidad: ninguno', () => {
    expect(assessNeighbor(me(54), car(2, 30, 0, 54, 0), NOW).level).toBe('none');
  });

  it('muy cerca y rodando (cambio de carril): aviso; parado en atasco: nada', () => {
    expect(assessNeighbor(me(40), car(2, 2.5, 0, 40, 0), NOW).level).toBe('aviso');
    expect(assessNeighbor(me(0), car(2, 2.5, 0, 0, 0), NOW).level).toBe('none');
  });
});

describe('peligros por delante', () => {
  const haz = (e: number, n: number, events: number, patch: Partial<VehicleState> = {}) =>
    car(9, e, n, 0, 0, { events, ...patch });

  it('un choque a 100 m en mi rumbo a 72 km/h (5 s): peligro', () => {
    const h = assessHazard(me(72), haz(0, 100, Events.CRASH), NOW);
    expect(h.level).toBe('peligro');
    expect(h.ahead).toBe(true);
    expect(h.etaS).toBeCloseTo(5, 0);
  });

  it('el mismo a 250 m (12,5 s): aviso', () => {
    expect(assessHazard(me(72), haz(0, 250, Events.CRASH), NOW).level).toBe('aviso');
  });

  it('un peligro detras de mi se ignora', () => {
    const h = assessHazard(me(72), haz(0, -60, Events.CRASH), NOW);
    expect(h.level).toBe('none');
    expect(h.ahead).toBe(false);
  });

  it('un peligro fuera del cono de ±30 grados se ignora; dentro, no', () => {
    expect(assessHazard(me(72), haz(100, 100, Events.CRASH), NOW).level).toBe('none'); // 45°
    expect(assessHazard(me(72), haz(30, 100, Events.CRASH), NOW).level).toBe('peligro'); // ~17°
  });

  it('el cono sigue MI rumbo, no el norte', () => {
    expect(assessHazard(me(72, 90), haz(100, 0, Events.CRASH), NOW).level).toBe('peligro');
    expect(assessHazard(me(72, 90), haz(0, 100, Events.CRASH), NOW).level).toBe('none');
  });

  it('fuera de la ventana de distancia no avisa (parado a 600 m)', () => {
    expect(assessHazard(me(72), haz(0, 600, Events.STOPPED_VEHICLE), NOW).level).toBe('none');
  });

  it('un bache nunca da peligro, solo aviso', () => {
    expect(assessHazard(me(72), haz(0, 40, Events.POTHOLE), NOW).level).toBe('aviso');
  });

  it('con mi coche detenido no hay "por delante"', () => {
    expect(assessHazard(me(0), haz(0, 20, Events.CRASH), NOW).level).toBe('none');
  });

  it('un peligro de otra calzada (rumbo opuesto y a 12 m al lado) se ignora', () => {
    expect(assessHazard(me(72), haz(12, 100, Events.CRASH, { headingDeg: 180 }), NOW).level).toBe('none');
  });

  it('una frenada brusca vieja (> 15 s) ya no vale; un coche detenido de hace 40 s si', () => {
    expect(assessHazard(me(72), haz(0, 100, Events.HARD_BRAKE, { ts: NOW - 16_000 }), NOW).level).toBe('none');
    expect(assessHazard(me(72), haz(0, 100, Events.STOPPED_VEHICLE, { ts: NOW - 40_000 }), NOW).level).toBe('peligro');
  });

  it('assessAll da el titular mas grave y omite mis propios peligros', () => {
    const a = assessAll(
      me(72),
      [car(2, 0, 400, 60, 180)],
      [haz(0, 40, Events.POTHOLE), haz(0, 100, Events.CRASH), car(1, 0, 100, 0, 0, { events: Events.CRASH })],
      NOW,
    );
    expect(a.level).toBe('peligro');
    expect(a.headline?.message).toBe('Choque adelante');
    expect(a.hazards).toHaveLength(2);
  });

  it('sin nada cerca: sin titular', () => {
    const a = assessAll(me(60), [], [], NOW);
    expect(a.level).toBe('none');
    expect(a.headline).toBeNull();
  });
});
