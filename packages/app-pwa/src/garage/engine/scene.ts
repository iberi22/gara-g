/**
 * scene.ts — Construccion y gestion de los escenarios 3D del garage.
 *
 * Soporta dos temas (StageTheme):
 * 1. 'studio' (por defecto):
 *    - Fondo TRANSPARENTE del canvas (clear alpha 0).
 *    - Sin paredes ni tiras del garage.
 *    - Sombra de contacto suave (gradiente radial TSL / canvas escalado al bbox del vehiculo).
 *    - Sombra real proyectada por luz clave sobre plano transparente con ShadowMaterial.
 *    - Entorno PMREM de estudio procedural (ciclorama + softboxes superiores y laterales).
 *    - Rig de luces de estudio: clave calida, relleno frio y contraluz azulado para silueta.
 *    - Exposicion ~1.15.
 * 2. 'garage':
 *    - Piso de concreto pulido TSL y tornamesa circular elevado con aro emisivo.
 *    - Pared de fondo oscura con tiras emisivas.
 *    - Rig de luces de garage y entorno RoomEnvironment.
 *    - Fondo solido #0e1116 y exposicion 1.0.
 */
import {
  Box3,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  PMREMGenerator,
  RingGeometry,
  Scene,
  ShadowMaterial,
  type Texture,
  Vector3,
  type WebGPURenderer,
} from 'three/webgpu';
import { color, float, length, mix, mx_noise_float, positionWorld, smoothstep, uv, vec2 } from 'three/tsl';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { QualityTier, StageTheme } from '../contracts';

/**
 * Genera la textura de gradiente radial para la sombra de contacto suave bajo el vehiculo.
 */
export function createContactShadowTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  const g = ctx.createRadialGradient(256, 128, 12, 256, 128, 235);
  g.addColorStop(0.0, 'rgba(13, 15, 18, 0.58)');
  g.addColorStop(0.42, 'rgba(13, 15, 18, 0.28)');
  g.addColorStop(0.80, 'rgba(13, 15, 18, 0.06)');
  g.addColorStop(1.0, 'rgba(13, 15, 18, 0.0)');

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);

  const tex = new CanvasTexture(c);
  return tex;
}

/**
 * Genera el entorno equirectangular de estudio con gradiente de ciclorama y softboxes.
 */
export function createStudioEnvTexture(pmrem: PMREMGenerator, theme: StageTheme = 'studio'): Texture | null {
  if (typeof document === 'undefined') return null;
  const W = 512;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const garage = theme === 'garage';

  // Ciclorama: cielo -> horizonte -> suelo
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  if (garage) {
    grad.addColorStop(0.0, '#10141A');
    grad.addColorStop(0.28, '#3A4452');
    grad.addColorStop(0.49, '#262D37');
    grad.addColorStop(0.51, '#12151A');
    grad.addColorStop(1.0, '#07080A');
  } else {
    grad.addColorStop(0.0, '#1E242B');
    grad.addColorStop(0.25, '#DDE3EC');
    grad.addColorStop(0.46, '#6B7482');
    grad.addColorStop(0.5, '#2C333D');
    grad.addColorStop(0.54, '#14171C');
    grad.addColorStop(1.0, '#0D0F12');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Linea de horizonte
  ctx.fillStyle = garage ? 'rgba(186,230,253,0.35)' : 'rgba(255,255,255,0.45)';
  ctx.fillRect(0, H / 2 - 1, W, 2);

  // Rebote de suelo (resplandor suave bajo el horizonte)
  const bounce = ctx.createLinearGradient(0, H / 2, 0, H * 0.78);
  bounce.addColorStop(0, garage ? 'rgba(120,140,165,0.30)' : 'rgba(200,210,225,0.38)');
  bounce.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bounce;
  ctx.fillRect(0, H / 2, W, H * 0.28);

  // Softboxes (3) con borde suave
  const soft = (x: number, y: number, w: number, h: number, c: string): void => {
    ctx.save();
    ctx.shadowColor = c;
    ctx.shadowBlur = 14;
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  };
  if (garage) {
    // Tiras de luz como las del muro trasero (tono frio)
    for (const y of [70, 92, 114]) soft(60, y, 170, 5, '#BAE6FD');
    soft(300, 74, 150, 5, '#BAE6FD');
    soft(40, 24, 150, 22, '#F1F5F9');
    soft(330, 20, 130, 24, '#E2E8F0');
  } else {
    soft(40, 22, 180, 28, '#FFFFFF');
    soft(280, 18, 190, 32, '#FFFFFF');
    soft(238, 56, 34, 60, '#FFFFFF');
    soft(90, 85, 110, 14, '#93C5FD');
    // Tiras laterales que reflejan la carroceria
    soft(10, 60, 150, 5, '#E0F2FE');
    soft(350, 66, 150, 5, '#E0F2FE');
  }

  const tex = new CanvasTexture(canvas);
  tex.mapping = EquirectangularReflectionMapping;

  try {
    const envTarget = pmrem.fromEquirectangular(tex);
    tex.dispose();
    return envTarget.texture;
  } catch {
    tex.dispose();
    return null;
  }
}

export class GarageSceneManager {
  public readonly scene: Scene;
  public readonly keyLight: DirectionalLight;
  public readonly hemiLight: HemisphereLight;
  public readonly rimLight: DirectionalLight;

  private currentTheme: StageTheme = 'studio';
  private pmrem: PMREMGenerator | null = null;
  private studioEnvTexture: Texture | null = null;
  private garageEnvTexture: Texture | null = null;

  // Elementos de garage
  private floorMesh: Mesh;
  private turntableMesh: Mesh;
  private rimMesh: Mesh;
  private backWall: Mesh;
  private wallStrips: Mesh[] = [];
  private contactShadowMesh: Mesh;

  // Elementos de estudio
  private studioShadowPlane: Mesh;
  private studioContactShadowGroup: Group;
  private studioContactShadowMesh: Mesh;
  private studioContactTex: CanvasTexture | null = null;

  constructor() {
    this.scene = new Scene();

    // 1. Elementos del escenario 'garage'
    const floorGeo = new CircleGeometry(15, 64);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new MeshStandardNodeMaterial();
    floorMat.name = 'garage:floor';
    floorMat.color = new Color('#14171e');
    floorMat.metalness = 0.08;
    const floorNoise = mx_noise_float(positionWorld.xz.mul(1.5)).mul(0.5).add(0.5);
    floorMat.roughnessNode = float(0.32).add(floorNoise.mul(0.08));

    this.floorMesh = new Mesh(floorGeo, floorMat);
    this.floorMesh.position.y = -0.05;
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);

    const turntableGeo = new CylinderGeometry(2.8, 2.85, 0.05, 64);
    const turntableMat = new MeshStandardNodeMaterial();
    turntableMat.name = 'garage:turntable';
    turntableMat.color = new Color('#1c202a');
    turntableMat.metalness = 0.25;
    turntableMat.roughness = 0.45;

    this.turntableMesh = new Mesh(turntableGeo, turntableMat);
    this.turntableMesh.position.y = -0.025;
    this.turntableMesh.receiveShadow = true;
    this.scene.add(this.turntableMesh);

    const rimGeo = new RingGeometry(2.72, 2.77, 64);
    rimGeo.rotateX(-Math.PI / 2);
    const rimMat = new MeshBasicNodeMaterial();
    rimMat.name = 'garage:rim_strip';
    rimMat.colorNode = color(0x38bdf8);

    this.rimMesh = new Mesh(rimGeo, rimMat);
    this.rimMesh.position.y = 0.001;
    this.scene.add(this.rimMesh);

    const backWallGeo = new PlaneGeometry(16, 6);
    const backWallMat = new MeshStandardNodeMaterial();
    backWallMat.name = 'garage:backwall';
    backWallMat.color = new Color('#0f1218');
    backWallMat.roughness = 0.85;
    backWallMat.metalness = 0.1;

    this.backWall = new Mesh(backWallGeo, backWallMat);
    this.backWall.position.set(0, 2.5, -5.2);
    this.backWall.receiveShadow = true;
    this.scene.add(this.backWall);

    const stripYPositions = [1.1, 2.1, 3.1];
    const stripGeo = new BoxGeometry(8.5, 0.045, 0.02);
    const stripMat = new MeshBasicNodeMaterial();
    stripMat.name = 'garage:light_strip';
    stripMat.colorNode = color(0xbae6fd);

    for (const y of stripYPositions) {
      const strip = new Mesh(stripGeo, stripMat);
      strip.position.set(0, y, -5.18);
      this.scene.add(strip);
      this.wallStrips.push(strip);
    }

    // Sombra falsa radial en tier 'low' para garage
    const contactGeo = new PlaneGeometry(3.6, 2.0);
    contactGeo.rotateX(-Math.PI / 2);
    const contactMat = new MeshStandardNodeMaterial();
    contactMat.name = 'garage:contact_shadow';
    contactMat.color = new Color('#000000');
    contactMat.roughness = 1.0;
    contactMat.metalness = 0;
    contactMat.transparent = true;
    contactMat.depthWrite = false;
    const d = length(uv().sub(vec2(0.5, 0.5)).mul(2.0));
    contactMat.opacityNode = mix(float(0.72), float(0.0), smoothstep(float(0.18), float(1.0), d));

    this.contactShadowMesh = new Mesh(contactGeo, contactMat);
    this.contactShadowMesh.position.y = 0.002;
    this.contactShadowMesh.visible = false;
    this.scene.add(this.contactShadowMesh);

    // 2. Elementos del escenario 'studio'
    // Plano receptor de sombra real de la luz clave sobre fondo transparente
    const shadowPlaneGeo = new PlaneGeometry(16, 16);
    shadowPlaneGeo.rotateX(-Math.PI / 2);
    const shadowPlaneMat = new ShadowMaterial({ opacity: 0.22 });
    this.studioShadowPlane = new Mesh(shadowPlaneGeo, shadowPlaneMat);
    this.studioShadowPlane.position.y = 0.001;
    this.studioShadowPlane.receiveShadow = true;
    this.scene.add(this.studioShadowPlane);

    // Sombra de contacto suave con textura radial escalable
    this.studioContactTex = createContactShadowTexture();
    const studioContactMat = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
    });
    if (this.studioContactTex) {
      studioContactMat.map = this.studioContactTex;
    }
    const studioContactGeo = new PlaneGeometry(1, 1);
    studioContactGeo.rotateX(-Math.PI / 2);

    this.studioContactShadowMesh = new Mesh(studioContactGeo, studioContactMat);
    this.studioContactShadowGroup = new Group();
    this.studioContactShadowGroup.position.set(0, 0.002, 0);
    this.studioContactShadowGroup.add(this.studioContactShadowMesh);
    this.scene.add(this.studioContactShadowGroup);

    // 3. Rig de iluminacion compartido y reconfigurable
    this.keyLight = new DirectionalLight('#fffdf9', 2.1);
    this.keyLight.position.set(-2.6, 4.8, 3.6);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.autoUpdate = false;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.bias = -0.0003;

    const sc = this.keyLight.shadow.camera;
    sc.left = -3.5;
    sc.right = 3.5;
    sc.top = 3.5;
    sc.bottom = -3.5;
    sc.near = 0.5;
    sc.far = 20;
    this.scene.add(this.keyLight);

    this.hemiLight = new HemisphereLight('#f8fafc', '#94a3b8', 0.85);
    this.scene.add(this.hemiLight);

    this.rimLight = new DirectionalLight('#d8e6ff', 1.45);
    this.rimLight.position.set(0.6, 3.5, -3.8);
    this.scene.add(this.rimLight);

    // Aplicar configuracion inicial de studio
    this.applyThemeState('studio', null);
  }

  public getTheme(): StageTheme {
    return this.currentTheme;
  }

  public initEnvironment(renderer: WebGPURenderer): void {
    if (!this.pmrem) {
      this.pmrem = new PMREMGenerator(renderer);
    }

    if (!this.garageEnvTexture) {
      this.garageEnvTexture = createStudioEnvTexture(this.pmrem, 'garage');
      if (!this.garageEnvTexture) {
        try {
          this.garageEnvTexture = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        } catch {
          // Fallback para entornos donde RoomEnvironment no compile
        }
      }
    }

    if (!this.studioEnvTexture) {
      this.studioEnvTexture = createStudioEnvTexture(this.pmrem);
      if (!this.studioEnvTexture && this.garageEnvTexture) {
        this.studioEnvTexture = this.garageEnvTexture;
      }
    }

    this.applyThemeState(this.currentTheme, renderer);
  }

  public setTheme(theme: StageTheme, renderer?: WebGPURenderer | null): void {
    this.currentTheme = theme;
    this.applyThemeState(theme, renderer ?? null);
  }

  private applyThemeState(theme: StageTheme, renderer: WebGPURenderer | null): void {
    if (theme === 'studio') {
      this.scene.background = null;

      if (renderer) {
        renderer.setClearColor(0x000000, 0);
        renderer.toneMappingExposure = 1.15;
      }

      // Ocultar entorno fisico del garage
      this.floorMesh.visible = false;
      this.turntableMesh.visible = false;
      this.rimMesh.visible = false;
      this.backWall.visible = false;
      for (const strip of this.wallStrips) {
        strip.visible = false;
      }
      this.contactShadowMesh.visible = false;

      // Mostrar sombras de estudio
      this.studioShadowPlane.visible = true;
      this.studioContactShadowGroup.visible = true;

      // Luces de estudio (clave calida, relleno frio, contraluz azulado)
      this.keyLight.color.set('#fffdf9');
      this.keyLight.intensity = 2.1;
      this.keyLight.position.set(-2.6, 4.8, 3.6);
      this.keyLight.castShadow = true;

      this.hemiLight.color.set('#f8fafc');
      this.hemiLight.groundColor.set('#94a3b8');
      this.hemiLight.intensity = 0.85;

      this.rimLight.color.set('#d8e6ff');
      this.rimLight.intensity = 1.45;
      this.rimLight.position.set(0.6, 3.5, -3.8);

      if (this.studioEnvTexture) {
        this.scene.environment = this.studioEnvTexture;
        this.scene.environmentIntensity = 1.25;
      }
    } else {
      // Modo garage
      this.scene.background = new Color('#0e1116');

      if (renderer) {
        renderer.setClearColor(0x0e1116, 1);
        renderer.toneMappingExposure = 1.0;
      }

      // Mostrar entorno fisico del garage
      this.floorMesh.visible = true;
      this.turntableMesh.visible = true;
      this.rimMesh.visible = true;
      this.backWall.visible = true;
      for (const strip of this.wallStrips) {
        strip.visible = true;
      }

      // Ocultar sombras transparentes de estudio
      this.studioShadowPlane.visible = false;
      this.studioContactShadowGroup.visible = false;

      // Luces de garage
      this.keyLight.color.set('#ffffff');
      this.keyLight.intensity = 2.3;
      this.keyLight.position.set(4, 7.5, 4.5);

      this.hemiLight.color.set('#f8fafc');
      this.hemiLight.groundColor.set('#181e28');
      this.hemiLight.intensity = 0.65;

      this.rimLight.color.set('#38bdf8');
      this.rimLight.intensity = 0.4;
      this.rimLight.position.set(-4, 3.5, -3.5);

      if (this.garageEnvTexture) {
        this.scene.environment = this.garageEnvTexture;
        this.scene.environmentIntensity = 0.88;
      }
    }

    this.requestShadowUpdate();
  }

  public updateContactShadow(box: Box3, rotationY = 0): void {
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());

    // Escalar la textura radial al largo (X) y ancho (Z) del vehiculo con margen para el desvanecimiento
    const scaleX = Math.max(size.x * 1.25, 2.4);
    const scaleZ = Math.max(size.z * 1.5, 1.2);

    this.studioContactShadowMesh.scale.set(scaleX, scaleZ, 1);
    this.studioContactShadowGroup.position.set(center.x, 0.002, center.z);
    this.studioContactShadowGroup.rotation.y = rotationY;
  }

  public updateContactShadowRotation(rotationY: number): void {
    this.studioContactShadowGroup.rotation.y = rotationY;
  }

  public requestShadowUpdate(): void {
    if (this.keyLight.castShadow) {
      this.keyLight.shadow.needsUpdate = true;
    }
  }

  public applyTier(tier: QualityTier, mapSize: number, shadowsEnabled: boolean): void {
    if (this.currentTheme === 'studio') {
      if (tier === 'low' || !shadowsEnabled) {
        this.keyLight.castShadow = false;
        this.studioShadowPlane.visible = false;
      } else {
        this.keyLight.castShadow = true;
        this.studioShadowPlane.visible = true;
        this.keyLight.shadow.mapSize.set(mapSize, mapSize);
        this.requestShadowUpdate();
      }
    } else {
      if (tier === 'low' || !shadowsEnabled) {
        this.keyLight.castShadow = false;
        this.contactShadowMesh.visible = true;
      } else {
        this.keyLight.castShadow = true;
        this.contactShadowMesh.visible = false;
        this.keyLight.shadow.mapSize.set(mapSize, mapSize);
        this.requestShadowUpdate();
      }
    }
  }

  public dispose(): void {
    this.floorMesh.geometry.dispose();
    (this.floorMesh.material as MeshStandardNodeMaterial).dispose();

    this.turntableMesh.geometry.dispose();
    (this.turntableMesh.material as MeshStandardNodeMaterial).dispose();

    this.rimMesh.geometry.dispose();
    (this.rimMesh.material as MeshBasicNodeMaterial).dispose();

    this.backWall.geometry.dispose();
    (this.backWall.material as MeshStandardNodeMaterial).dispose();

    this.contactShadowMesh.geometry.dispose();
    (this.contactShadowMesh.material as MeshStandardNodeMaterial).dispose();

    this.studioShadowPlane.geometry.dispose();
    (this.studioShadowPlane.material as ShadowMaterial).dispose();

    this.studioContactShadowMesh.geometry.dispose();
    (this.studioContactShadowMesh.material as MeshBasicNodeMaterial).dispose();

    if (this.studioContactTex) {
      this.studioContactTex.dispose();
      this.studioContactTex = null;
    }

    for (const strip of this.wallStrips) {
      strip.geometry.dispose();
      (strip.material as MeshBasicNodeMaterial).dispose();
    }

    if (this.studioEnvTexture) {
      this.studioEnvTexture.dispose();
      this.studioEnvTexture = null;
    }
    if (this.garageEnvTexture) {
      this.garageEnvTexture.dispose();
      this.garageEnvTexture = null;
    }
    if (this.pmrem) {
      this.pmrem.dispose();
      this.pmrem = null;
    }
  }
}
