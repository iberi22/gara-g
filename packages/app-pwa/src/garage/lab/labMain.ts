/**
 * labMain.ts — Laboratorio de plantillas: pinta UNA plantilla en un estudio neutro
 * para revisarla a ojo y sacar capturas (scripts/garage-shot.mjs).
 *
 * Parametros de la URL (/fleet/garage/lab?...):
 *   template  id de plantilla (default debug-block)
 *   view      side | front | rear | three-quarter | top   (default three-quarter)
 *   lod       high | low
 *   color, finish, accent   pintura (finish: gloss|metallic|matte|pearl|satin)
 *   dims      JSON parcial de VehicleDimensions, ej. {"wheelbaseMm":1500}
 *   shape     JSON de parametros de forma, ej. {"tankVolume":0.8}
 *   gl=1      fuerza el backend WebGL2
 *   bg        color de fondo (default #dfe3e8)
 *
 * Al terminar el primer frame publica window.__garageLab con backend, triangulos,
 * draw calls, ranuras construidas y medidas reales del modelo (para verificar contra
 * la ficha tecnica).
 */
import {
  ACESFilmicToneMapping,
  Box3,
  CircleGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { PaintFinish, VehicleSpec } from '../contracts';
import { createMaterialKit } from '../templates/common/materials';
import { getTemplateById, TEMPLATES } from '../templates/registry';

const VIEWS: Record<string, [number, number, number]> = {
  side: [0, 0.18, 1],
  front: [1, 0.22, 0.02],
  rear: [-1, 0.22, 0.02],
  'three-quarter': [0.78, 0.36, 0.72],
  top: [0.001, 1, 0.001],
};

function json<T>(raw: string | null): Partial<T> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<T>;
  } catch {
    return {};
  }
}

export async function startLab(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const template = getTemplateById(params.get('template') ?? 'debug-block');
  if (!template) {
    throw new Error(`Plantilla desconocida. Disponibles: ${['debug-block', ...TEMPLATES.map((t) => t.id)].join(', ')}`);
  }

  const renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL: params.get('gl') === '1' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';

  const scene = new Scene();
  scene.background = new Color(params.get('bg') ?? '#dfe3e8');
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.9;

  const floorMat = new MeshStandardNodeMaterial();
  floorMat.color = new Color('#d3d7dc');
  floorMat.roughness = 0.92;
  const floor = new Mesh(new CircleGeometry(14, 64), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  scene.add(new HemisphereLight('#ffffff', '#8a8f96', 0.6));
  const key = new DirectionalLight('#ffffff', 2.4);
  key.position.set(3, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  const sc = key.shadow.camera;
  sc.left = -4;
  sc.right = 4;
  sc.top = 4;
  sc.bottom = -4;
  sc.near = 0.5;
  sc.far = 20;
  scene.add(key);

  const dims = { ...template.defaults.dims, ...json<VehicleSpec['dims']>(params.get('dims')) };
  const spec: VehicleSpec = {
    ...template.defaults,
    dims,
    shape: json<Record<string, number>>(params.get('shape')) as Record<string, number>,
    variants: json<Record<string, string>>(params.get('variants')) as Record<string, string>,
    paint: {
      baseColor: params.get('color') ?? '#b9bfc7',
      finish: (params.get('finish') as PaintFinish) ?? 'metallic',
      accentColor: params.get('accent') ?? undefined,
    },
  };

  const kit = createMaterialKit();
  const lod = params.get('lod') === 'low' ? 'low' : 'high';
  const t0 = performance.now();
  const built = template.build(spec, { materials: kit, lod });
  const buildMs = performance.now() - t0;
  scene.add(built.root);

  const box = new Box3().setFromObject(built.root);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());

  const camera = new PerspectiveCamera(32, canvas.clientWidth / canvas.clientHeight, 0.05, 100);
  const dir = new Vector3(...(VIEWS[params.get('view') ?? 'three-quarter'] ?? VIEWS['three-quarter'])).normalize();
  const radius = size.length() / 2;
  const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 0.92;
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.lookAt(center);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(center);
  controls.enableDamping = true;

  window.addEventListener('resize', () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  });

  let frames = 0;
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
    frames++;
    if (frames === 3) {
      const info = renderer.info.render as { drawCalls?: number; calls?: number; triangles?: number };
      (window as unknown as { __garageLab: unknown }).__garageLab = {
        ready: true,
        backend,
        template: template.id,
        lod,
        buildMs: Math.round(buildMs),
        triangles: built.triangles,
        drawCalls: info.drawCalls ?? info.calls ?? null,
        slots: [...built.parts.keys()].sort(),
        sizeMm: {
          length: Math.round(size.x * 1000),
          height: Math.round(size.y * 1000),
          width: Math.round(size.z * 1000),
        },
        minY: Number(box.min.y.toFixed(4)),
        spec,
      };
      document.body.dataset.ready = '1';
    }
  });
}
