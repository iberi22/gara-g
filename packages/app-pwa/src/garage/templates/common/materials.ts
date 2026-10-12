/**
 * materials.ts — Kit de materiales PBR compartidos (node materials de three/webgpu).
 *
 * Funcionan igual con el backend WebGPU y con el de WebGL2. Cada material se crea una
 * sola vez por clave y se reutiliza: en WebGPU cada material distinto es un pipeline
 * que se compila, y compilar 60 pipelines al cambiar de vehiculo se nota como tiron.
 * Las plantillas NUNCA crean materiales por su cuenta: piden al kit.
 */
import {
  Color,
  DoubleSide,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  type Material,
} from 'three/webgpu';
import { color, float, fract, mix, mx_noise_float, positionLocal, step, uv, vec2 } from 'three/tsl';
import type { MaterialKit, PaintSpec } from '../../contracts';

type Finish = PaintSpec['finish'];

const FINISH: Record<Finish, { metalness: number; roughness: number; clearcoat: number; clearcoatRoughness: number; iridescence?: number }> = {
  gloss: { metalness: 0.0, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.04 },
  metallic: { metalness: 0.75, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.06 },
  matte: { metalness: 0.15, roughness: 0.78, clearcoat: 0.0, clearcoatRoughness: 1.0 },
  pearl: { metalness: 0.35, roughness: 0.28, clearcoat: 1.0, clearcoatRoughness: 0.05, iridescence: 0.55 },
  satin: { metalness: 0.45, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.4 },
};

export function createMaterialKit(): MaterialKit {
  const cache = new Map<string, Material>();

  function memo<T extends Material>(key: string, make: () => T): T {
    let m = cache.get(key) as T | undefined;
    if (!m) {
      m = make();
      m.name = key;
      cache.set(key, m);
    }
    return m;
  }

  function standard(key: string, hex: string, metalness: number, roughness: number): MeshStandardNodeMaterial {
    return memo(key, () => {
      const m = new MeshStandardNodeMaterial();
      m.color = new Color(hex);
      m.metalness = metalness;
      m.roughness = roughness;
      return m;
    });
  }

  return {
    paint(spec) {
      const f = FINISH[spec.finish] ?? FINISH.gloss;
      return memo(`paint:${spec.baseColor}:${spec.finish}`, () => {
        const m = new MeshPhysicalNodeMaterial();
        m.color = new Color(spec.baseColor);
        m.metalness = f.metalness;
        m.roughness = f.roughness;
        m.clearcoat = f.clearcoat;
        m.clearcoatRoughness = f.clearcoatRoughness;
        if (f.iridescence) {
          m.iridescence = f.iridescence;
          m.iridescenceIOR = 1.3;
        }
        return m;
      });
    },

    accent(spec) {
      const hex = spec.accentColor ?? '#1a1a1d';
      return memo(`accent:${hex}`, () => {
        const m = new MeshPhysicalNodeMaterial();
        m.color = new Color(hex);
        m.metalness = 0.6;
        m.roughness = 0.35;
        m.clearcoat = 0.6;
        return m;
      });
    },

    rubber() {
      return memo('rubber', () => {
        const m = new MeshStandardNodeMaterial();
        // Caucho con algo de variacion: un ruido de baja frecuencia evita el negro plano.
        const n = mx_noise_float(positionLocal.mul(38.0)).mul(0.5).add(0.5);
        m.colorNode = mix(color(0x111113), color(0x1d1d20), n);
        m.roughnessNode = float(0.86).add(n.mul(0.08));
        m.metalness = 0;
        return m;
      });
    },

    metal(kind) {
      switch (kind) {
        case 'steel':
          return standard('metal:steel', '#8d9298', 0.9, 0.38);
        case 'aluminum':
          return standard('metal:aluminum', '#c3c7cc', 0.95, 0.28);
        case 'brushed':
          return memo('metal:brushed', () => {
            const m = new MeshStandardNodeMaterial();
            m.color = new Color('#a9adb3');
            m.metalness = 0.95;
            // Cepillado: rayas finas en una direccion moduladas por ruido.
            const streak = mx_noise_float(vec2(positionLocal.x.mul(4.0), positionLocal.y.mul(260.0)));
            m.roughnessNode = float(0.3).add(streak.mul(0.12));
            return m;
          });
        case 'dark':
        default:
          return standard('metal:dark', '#2a2c30', 0.85, 0.45);
      }
    },

    chrome() {
      return standard('chrome', '#f2f4f7', 1.0, 0.06);
    },

    plastic(kind) {
      if (kind === 'textured') {
        return memo('plastic:textured', () => {
          const m = new MeshStandardNodeMaterial();
          m.color = new Color('#18191b');
          m.metalness = 0;
          m.roughnessNode = float(0.7).add(mx_noise_float(positionLocal.mul(120.0)).mul(0.15));
          return m;
        });
      }
      return kind === 'gray' ? standard('plastic:gray', '#4a4d52', 0.0, 0.6) : standard('plastic:black', '#141517', 0.0, 0.5);
    },

    glass(kind) {
      return memo(`glass:${kind}`, () => {
        const m = new MeshPhysicalNodeMaterial();
        const tint = kind === 'tinted' ? '#0d1116' : kind === 'visor' ? '#1b2530' : '#9fb3c4';
        m.color = new Color(tint);
        m.metalness = 0;
        m.roughness = 0.04;
        m.transparent = true;
        m.opacity = kind === 'clear' ? 0.35 : 0.72;
        m.clearcoat = 1;
        m.side = DoubleSide;
        m.depthWrite = false;
        return m;
      });
    },

    light(kind) {
      const hex = kind === 'tail' ? '#ff1a2a' : kind === 'turn' ? '#ff9a1a' : kind === 'drl' ? '#e8f4ff' : '#fff6e0';
      return memo(`light:${kind}`, () => {
        const m = new MeshStandardNodeMaterial();
        m.color = new Color(hex);
        m.emissive = new Color(hex);
        m.emissiveIntensity = kind === 'tail' ? 2.2 : 2.8;
        m.roughness = 0.2;
        return m;
      });
    },

    carbon() {
      return memo('carbon', () => {
        const m = new MeshPhysicalNodeMaterial();
        // Tejido 2x2 procedural sobre UV: dos tonos alternos + barniz.
        const cell = fract(uv().mul(48.0));
        const weave = step(0.5, cell.x).add(step(0.5, cell.y)).mod(2.0);
        m.colorNode = mix(color(0x0e0f11), color(0x26282c), weave);
        m.metalness = 0.3;
        m.roughness = 0.45;
        m.clearcoat = 1;
        m.clearcoatRoughness = 0.08;
        return m;
      });
    },

    seat() {
      return memo('seat', () => {
        const m = new MeshStandardNodeMaterial();
        const n = mx_noise_float(positionLocal.mul(220.0)).mul(0.5).add(0.5);
        m.colorNode = mix(color(0x141414), color(0x1f1f21), n);
        m.roughness = 0.82;
        m.metalness = 0;
        return m;
      });
    },

    dispose() {
      for (const m of cache.values()) m.dispose();
      cache.clear();
    },
  };
}
