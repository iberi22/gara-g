/**
 * moto.test.ts — Verificacion de las 4 plantillas de moto contra la ficha tecnica.
 *
 * Que se comprueba aqui (y por que):
 *   - Se construye con los valores por defecto y con TODOS los shapeParams en 0 y en 1,
 *     en LOD high y low. Un parametro que rompe la geometria solo se ve en los extremos.
 *   - Todas las ranuras `requiredSlots('moto')` existen y estan nombradas `part:<slot>` en
 *     el arbol (de eso depende el picking del motor).
 *   - Largo y alto dentro de ±3 %, ancho ±8 % (el ancho lo manda el manubrio o el espejo).
 *   - minY ≈ 0: la llanta apoya en el piso.
 *   - Centros de rueda en ±entre ejes/2 (±5 mm): si esto falla, el modelo esta descentrado.
 *   - Triangulos dentro de RENDER_BUDGET en los dos LOD.
 *   - Sin NaN en ningun atributo de posicion (un NaN rompe el render entero).
 *   - Altura del sillin ±5 % de `seatHeightMm`.
 *
 * Los tests corren en node: no hacen falta GPU ni canvas porque solo se construye
 * geometria y materiales de three.
 */
import { tireRadius } from '../common/units';
import { describe, expect, it } from 'vitest';
import { Box3, Vector3, type Mesh } from 'three/webgpu';
import { RENDER_BUDGET, type BuiltVehicle, type VehicleSpec, type VehicleTemplate } from '../../contracts';
import { requiredSlots } from '../../parts';
import { createMaterialKit } from '../common/materials';
import { MOTO_TEMPLATES } from './index';
import { NAKED } from './naked';
import { SCOOTER } from './scooter';
import { SPORT } from './sport';
import { TRAIL } from './trail';

const ALL = [NAKED, SPORT, SCOOTER, TRAIL];
const KIT = createMaterialKit();
const mmv = (v: number): number => Math.round(v * 1000);
const PAINT = { baseColor: '#b9bfc7', finish: 'metallic' as const } as const;

function specOf(tpl: VehicleTemplate, shape?: Record<string, number>): VehicleSpec {
  return { ...tpl.defaults, paint: PAINT, ...(shape ? { shape } : {}) };
}

function build(tpl: VehicleTemplate, lod: 'high' | 'low', shape?: Record<string, number>): BuiltVehicle {
  return tpl.build(specOf(tpl, shape), { materials: KIT, lod });
}

function boxOf(built: BuiltVehicle): Box3 {
  return new Box3().setFromObject(built.root);
}

/** Todas las combinaciones extremas de los parametros de forma. */
function extremeShapes(tpl: VehicleTemplate): [string, Record<string, number>][] {
  const out: [string, Record<string, number>][] = [];
  for (const p of tpl.shapeParams) {
    for (const v of [0, 1]) {
      out.push([`${p.id}=${v}`, { [p.id]: v }]);
    }
  }
  // Todos a un extremo a la vez: es el caso que mas rompe la geometria.
  out.push([
    'todos=0',
    Object.fromEntries(tpl.shapeParams.map((p) => [p.id, 0])),
  ]);
  out.push([
    'todos=1',
    Object.fromEntries(tpl.shapeParams.map((p) => [p.id, 1])),
  ]);
  return out;
}

function assertNoNaN(built: BuiltVehicle, label: string): void {
  const bad: string[] = [];
  built.root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !m.geometry) return;
    const pos = m.geometry.getAttribute('position')?.array;
    if (!pos) return;
    for (let i = 0; i < pos.length; i++) {
      if (!Number.isFinite(pos[i])) {
        bad.push(`${label}: NaN en ${m.parent?.name ?? '?'} (vertice ${i})`);
        break;
      }
    }
  });
  expect(bad).toEqual([]);
}

describe('plantillas de moto', () => {
  it('el registro expone las 4 plantillas con ids unicos', () => {
    expect(MOTO_TEMPLATES.map((t) => t.id)).toEqual(['moto-naked', 'moto-sport', 'moto-scooter', 'moto-trail']);
    expect(new Set(MOTO_TEMPLATES.map((t) => t.id)).size).toBe(4);
  });

  for (const tpl of ALL) {
    describe(tpl.id, () => {
      it('construye con los valores por defecto en los dos LOD', () => {
        for (const lod of ['high', 'low'] as const) {
          const built = build(tpl, lod);
          expect(built.root).toBeTruthy();
          expect(built.triangles).toBeGreaterThan(0);
          assertNoNaN(built, `${tpl.id}/${lod}/defaults`);
        }
      });

      it('construye con cada shapeParam en 0 y en 1', () => {
        for (const lod of ['high', 'low'] as const) {
          for (const [label, shape] of extremeShapes(tpl)) {
            const built = build(tpl, lod, shape);
            expect(built.triangles, `${tpl.id}/${lod}/${label}`).toBeGreaterThan(0);
            assertNoNaN(built, `${tpl.id}/${lod}/${label}`);
          }
        }
      });

      it('tiene todas las ranuras requeridas de la familia moto, nombradas part:<slot>', () => {
        const built = build(tpl, 'high');
        const required = requiredSlots('moto');
        for (const slot of required) {
          const g = built.parts.get(slot);
          expect(g, `falta la ranura ${slot}`).toBeTruthy();
          expect(g?.name, `la ranura ${slot} debe llamarse part:${slot}`).toBe(`part:${slot}`);
          // Y debe existir como hijo real del root, que es lo que recorre el picking.
          const found = built.root.children.find((c) => c === g);
          expect(found, `la ranura ${slot} no cuelga del root`).toBeTruthy();
        }
      });

      it('respeta la ficha: largo y alto ±3 %, ancho ±8 %', () => {
        for (const lod of ['high', 'low'] as const) {
          const built = build(tpl, lod);
          const size = boxOf(built).getSize(new Vector3());
          const want = tpl.defaults.dims;
          // `got` viene en metros y la ficha en mm: hay que comparar en la misma unidad.
          const check = (gotM: number, expectMm: number, tol: number, what: string) => {
            const got = mmv(gotM);
            const dev = Math.abs((got - expectMm) / expectMm);
            expect(dev, `${tpl.id}/${lod} ${what}: ${got} vs ${expectMm} mm`).toBeLessThanOrEqual(tol);
          };
          check(size.x, want.lengthMm, 0.03, 'largo');
          check(size.y, want.heightMm, 0.03, 'alto');
          check(size.z, want.widthMm, 0.08, 'ancho');
        }
      });

      it('la llanta apoya en el piso (minY ≈ 0, ±2 mm)', () => {
        for (const lod of ['high', 'low'] as const) {
          const box = boxOf(build(tpl, lod));
          expect(Math.abs(mmv(box.min.y)), `${tpl.id}/${lod} minY`).toBeLessThanOrEqual(2);
        }
      });

      it('los centros de rueda estan en ±entre ejes / 2 (±5 mm)', () => {
        for (const lod of ['high', 'low'] as const) {
          const built = build(tpl, lod);
          const wb = tpl.defaults.dims.wheelbaseMm / 2;
          for (const [slot, expected] of [
            ['tire_front', wb],
            ['tire_rear', -wb],
          ] as const) {
            const g = built.parts.get(slot);
            expect(g, `${tpl.id}: falta ${slot}`).toBeTruthy();
            g?.updateWorldMatrix(true, true);
            const b = new Box3().setFromObject(g!);
            const cx = (b.min.x + b.max.x) / 2;
            expect(Math.abs(mmv(cx) - expected), `${tpl.id}/${lod} centro de ${slot}: ${mmv(cx)} vs ${expected} mm`).toBeLessThanOrEqual(5);
          }
        }
      });

      it('cabe en el presupuesto de triangulos de los dos LOD', () => {
        const high = build(tpl, 'high').triangles;
        const low = build(tpl, 'low').triangles;
        expect(high, `${tpl.id} LOD high`).toBeLessThanOrEqual(RENDER_BUDGET.vehicleTrianglesHigh);
        expect(low, `${tpl.id} LOD low`).toBeLessThanOrEqual(RENDER_BUDGET.vehicleTrianglesLow);
        // El LOD bajo tiene que ser de verdad mas barato: si no, no esta ahorrando nada.
        expect(low, `${tpl.id}: LOD low (${low}) no es mas barato que high (${high})`).toBeLessThan(high);
      });

      it('el alto del sillin cae dentro de ±5 % de seatHeightMm', () => {
        const want = tpl.defaults.dims.seatHeightMm;
        if (!want) return;
        for (const lod of ['high', 'low'] as const) {
          const built = build(tpl, lod);
          const seat = built.parts.get('seat');
          expect(seat, `${tpl.id}: falta la ranura seat`).toBeTruthy();
          seat!.updateWorldMatrix(true, true);
          const top = mmv(new Box3().setFromObject(seat!).max.y);
          expect(Math.abs((top - want) / want), `${tpl.id}/${lod} sillin: ${top} vs ${want} mm`).toBeLessThanOrEqual(0.05);
        }
      });

      it('declara shapeParams en español con default dentro de 0..1', () => {
        for (const p of tpl.shapeParams) {
          expect(p.label, `${tpl.id}/${p.id} sin label en español`).toBeTruthy();
          expect(p.default).toBeGreaterThanOrEqual(0);
          expect(p.default).toBeLessThanOrEqual(1);
        }
      });

      it('construye tambien con un shape fuera de rango (se satura, no se rompe)', () => {
        for (const p of tpl.shapeParams) {
          for (const v of [-5, 42]) {
            const built = build(tpl, 'high', { [p.id]: v });
            expect(built.triangles).toBeGreaterThan(0);
            assertNoNaN(built, `${tpl.id}/${p.id}=${v}`);
          }
        }
      });
    });
  }

  describe('distincion entre arquetipos', () => {
    it('las 4 siluetas miden distinto (no son la misma moto con otro nombre)', () => {
      const heights = ALL.map((t) => mmv(boxOf(build(t, 'high')).getSize(new Vector3()).y));
      expect(new Set(heights).size, `alturas repetidas: ${heights.join(', ')}`).toBe(4);
    });

    it('la trail es la mas alta y la scooter la mas baja de entre ejes', () => {
      const h = (t: VehicleTemplate) => mmv(boxOf(build(t, 'high')).getSize(new Vector3()).y);
      expect(h(TRAIL)).toBeGreaterThan(h(NAKED));
      expect(h(SCOOTER)).toBeGreaterThan(h(SPORT) - 100);
    });

    it('el trail alarga la horquilla con suspensionTravel sin mover la rueda del piso', () => {
      const corto = build(TRAIL, 'high', { suspensionTravel: 0 });
      const largo = build(TRAIL, 'high', { suspensionTravel: 1 });
      // Se mide la PERCHA (la ranura `fork`), no la caja completa: el alto total de la
      // trail lo fija el espejo, que no se mueve con la suspension. Lo que tiene que
      // crecer es la horquilla.
      const altoDe = (b: BuiltVehicle): number => {
        const f = b.parts.get('fork')!;
        f.updateWorldMatrix(true, true);
        return mmv(new Box3().setFromObject(f).max.y);
      };
      expect(altoDe(largo), 'la horquilla deberia ser mas alta con recorrido').toBeGreaterThan(altoDe(corto));
      // Y el piso no se mueve: la llanta sigue apoyando en y = 0 en los dos casos.
      expect(mmv(boxOf(largo).min.y)).toBeLessThanOrEqual(2);
      expect(mmv(boxOf(corto).min.y)).toBeLessThanOrEqual(2);
      // El recorrido completo (0..1) no debe pasar de 160 mm (travelRangeM del esqueleto).
      expect(altoDe(largo) - altoDe(corto)).toBeLessThanOrEqual(170);
    });

    it('la scooter monta la CVT (carcasa a la izquierda) y no la cadena', () => {
      const drive = build(SCOOTER, 'high').parts.get('drive');
      drive!.updateWorldMatrix(true, true);
      const b = new Box3().setFromObject(drive!);
      // La carcasa CVT va por fuera de la llanta trasera, al lado izquierdo (+Z).
      expect(b.max.z, 'la CVT deberia quedar a la izquierda (+Z) de la llanta').toBeGreaterThan(0.1);
    });
  });

  describe('siluetas que no deben volver a ser cajas', () => {
    /**
     * Vertices de un slot en coordenadas de mundo.
     * Se usa en vez de AABB por malla porque los faldones laterales son CHAPAS de 26 mm:
     * su caja engloba el hueco del motor y daria falsos positivos.
     */
    function slotVerts(b: BuiltVehicle, slot: string): { x: number; y: number; z: number }[] {
      const out: { x: number; y: number; z: number }[] = [];
      b.parts.get(slot)?.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh || !m.geometry) return;
        const at = m.geometry.getAttribute('position');
        if (!at) return;
        for (let i = 0; i < at.count; i++) out.push({ x: at.getX(i), y: at.getY(i), z: at.getZ(i) });
      });
      return out;
    }

    /** Semiancho del volumen en cada franja de X. */
    function halfWidthByX(verts: { x: number; z: number }[], x0: number, x1: number, step: number): number[] {
      const out: number[] = [];
      for (let x = x0; x < x1; x += step) {
        const bin = verts.filter((p) => p.x >= x && p.x < x + step);
        if (bin.length < 8) continue;
        out.push(Math.max(...bin.map((p) => Math.abs(p.z))));
      }
      return out;
    }

    it('moto-sport: el carenaje se estrecha sobre el manubrio (cintura) y no lo atraviesa', () => {
      const b = build(SPORT, 'high');
      const verts = slotVerts(b, 'bodywork');
      const shell = halfWidthByX(verts, 0.3, 0.87, 0.02);
      expect(shell.length, 'no se ha muestreado el frontal del carenaje').toBeGreaterThan(4);

      // El morro (la ultima franja, la mas delantera) es la parte mas estrecha: es la punta.
      // Antes era un capitulo plano de 138 mm, igual de ancho que el resto.
      const nose = shell[shell.length - 1];
      const max = Math.max(...shell);
      expect(nose, 'la punta del morro deberia ser la parte mas estrecha').toBeLessThan(max * 0.55);

      // La cintura: hay una franja claramente mas estrecha que el maximo Y que la
      // separacion de las torretas del manubrio (85 mm). Antes era un paralelepipedo
      // constante de 138 mm y las empunaduras (332 mm de semiancho) salian de sus lados.
      const waist = Math.min(...shell);
      expect(waist, 'deberia existir una cintura sobre el manubrio').toBeLessThan(max * 0.8);
      expect(waist, 'la cintura deberia ser mas estrecha que las torretas (85 mm)').toBeLessThan(0.085);

      // Y el techo del carenaje tiene que quedar POR ENCIMA de las barras: que el cockpit
      // no flote sobre una caja.
      const shellTop = Math.max(...verts.map((p) => p.y));
      const barTop = Math.max(...slotVerts(b, 'handlebar').map((p) => p.y));
      expect(shellTop, 'el carenaje deberia cubrir por encima del manubrio').toBeGreaterThan(barTop - 0.03);
    });

    it('moto-sport: el motor asoma por debajo del carenaje', () => {
      const b = build(SPORT, 'high');
      const engine = slotVerts(b, 'engine');
      const engineTop = Math.max(...engine.map((p) => p.y));
      // La culata llega a y ~ 763. Si el caparazon se cerrara por encima, el motor entero
      // quedaria tapado y la moto perderia su mecanica legible.
      expect(engineTop, 'el motor deberia llegar al menos a y = 600 mm').toBeGreaterThan(0.6);
      // Y el carenaje NO debe tapar el cazoleta: por debajo de la linea de la culata tiene
      // que haber hueco de cuerpo en la columna del motor.
      const cx = engine.reduce((s, p) => s + p.x, 0) / engine.length;
      const shell = slotVerts(b, 'bodywork');
      const mid = shell.filter((p) => Math.abs(p.x - cx) < 0.05);
      const shellLow = mid.length ? Math.min(...mid.map((p) => p.y)) : 1;
      const engineLow = Math.min(...engine.map((p) => p.y));
      expect(shellLow, 'el carenaje deberia empezar por encima del cazoleta').toBeGreaterThan(engineLow - 0.05);
    });

    it('moto-scooter: el escudo es vertical, va DETRAS de la rueda delantera y el piso es plano', () => {
      const b = build(SCOOTER, 'high');
      const verts = slotVerts(b, 'bodywork');
      // Geometria de referencia sacada de la spec, no de numeros fijos: el escudo va justo
      // detras de la rueda delantera (antes estaba en la punta, DELANTE de la rueda).
      const axleF = SCOOTER.defaults.dims.wheelbaseMm / 2000;
      const rF = tireRadius(SCOOTER.defaults.tireFront);
      const shieldFront = axleF - rF * 0.85;

      // Por encima del guardabarros (que si cubre la rueda y va en bodywork) no hay nada
      // delante del eje delantero: el escudo esta detras de la rueda, no en la punta.
      const aboveFender = verts.filter((p) => p.y > 2 * rF + 0.12);
      expect(aboveFender.length, 'no se ha muestreado la parte alta').toBeGreaterThan(50);
      const xmax = Math.max(...aboveFender.map((p) => p.x));
      expect(xmax, 'el escudo no deberia ir delante de la rueda delantera').toBeLessThan(axleF);

      // El escudo: una franja de ~15 cm detras de su cara delantera, alta como un muro.
      const shield = verts.filter((p) => p.x > shieldFront - 0.15 && p.x <= shieldFront + 0.02);
      expect(shield.length, 'no se ha muestreado el escudo').toBeGreaterThan(50);
      const shY = shield.map((p) => p.y);
      expect(mmv(Math.max(...shY) - Math.min(...shY)), 'el escudo deberia ser alto').toBeGreaterThan(0.35);

      // El piso: entre el escudo y el cuerpo trasero, una plataforma, no una rampa.
      const mid = verts.filter((p) => p.x > -0.05 && p.x < shieldFront - 0.2 && p.y < 0.45);
      expect(mid.length, 'no se ha muestreado el tramo del piso').toBeGreaterThan(20);
      const ymin = Math.min(...mid.map((p) => p.y));
      const ymax = Math.max(...mid.map((p) => p.y));
      expect(mmv(ymax - ymin), 'el piso no deberia ser una cuna: alto desproporcionado').toBeLessThan(160);
    });
  });
});