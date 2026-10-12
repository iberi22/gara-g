/**
 * projection.ts — Proyeccion de puntos 3D a coordenadas CSS del canvas y calculo de cotas.
 *
 * Provee funciones puras y testeables para:
 * 1. Proyectar un Vector3 en espacio de mundo a ScreenPoint (x, y en px CSS, visible).
 * 2. Calcular los 8 puntos de DimensionAnchors de un vehiculo montado.
 * 3. Proyectar la ranura de una pieza (focusPoint o centro del bbox).
 */
import { Box3, type PerspectiveCamera, Vector3 } from 'three/webgpu';
import type { BuiltVehicle, DimensionAnchors, PartSlotId, ScreenPoint, VehicleSpec } from '../contracts';
import { mm, tireRadius } from '../templates/common/units';

/**
 * Proyecta un punto en coordenadas de mundo al espacio de pantalla (px CSS).
 * Un punto es visible solo si esta delante del plano de la camara y dentro
 * del viewport visible del canvas.
 */
export function projectPointToScreen(
  point: Vector3,
  camera: PerspectiveCamera,
  width: number,
  height: number,
): ScreenPoint {
  if (width <= 0 || height <= 0) {
    return { x: 0, y: 0, visible: false };
  }

  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  // En espacio de vista de Three.js (+Y arriba, +X derecha, -Z adelante),
  // los puntos delante de la camara tienen z < 0.
  const viewPos = point.clone().applyMatrix4(camera.matrixWorldInverse);
  const inFront = viewPos.z < 0;

  // Proyeccion a NDC [-1, 1]
  const ndc = point.clone().project(camera);

  // Visible si esta dentro del frustum de la camara (NDC [-1, 1]) y delante de ella
  const inFrustum =
    ndc.x >= -1 && ndc.x <= 1 &&
    ndc.y >= -1 && ndc.y <= 1 &&
    ndc.z >= -1 && ndc.z <= 1;

  const visible = inFront && inFrustum;

  // Conversion de NDC [-1, 1] a pixeles CSS relativos a la esquina superior izquierda
  const x = ((ndc.x + 1) / 2) * width;
  const y = ((-ndc.y + 1) / 2) * height;

  return { x, y, visible };
}

/**
 * Obtiene o calcula el BoundingBox local del vehiculo en coordenadas neutrales.
 */
export function getVehicleLocalBox(vehicle: BuiltVehicle): Box3 {
  if (vehicle.root.userData.localBox instanceof Box3) {
    return vehicle.root.userData.localBox as Box3;
  }

  const savedPos = vehicle.root.position.clone();
  const savedRot = vehicle.root.rotation.clone();
  vehicle.root.position.set(0, 0, 0);
  vehicle.root.rotation.set(0, 0, 0);
  vehicle.root.updateMatrixWorld(true);

  const box = new Box3().setFromObject(vehicle.root);
  vehicle.root.userData.localBox = box;

  vehicle.root.position.copy(savedPos);
  vehicle.root.rotation.copy(savedRot);
  vehicle.root.updateMatrixWorld(true);

  return box;
}

/**
 * Calcula los 8 puntos de cota tecnicos (DimensionAnchors) del vehiculo actual
 * proyectados sobre el canvas.
 */
export function computeDimensionAnchors(
  vehicle: BuiltVehicle,
  spec: VehicleSpec,
  camera: PerspectiveCamera,
  width: number,
  height: number,
): DimensionAnchors {
  const localBox = getVehicleLocalBox(vehicle);

  const wb = mm(spec.dims.wheelbaseMm);
  const rf = tireRadius(spec.tireFront);
  const rr = tireRadius(spec.tireRear);

  const groundY = Math.min(0, localBox.min.y);
  const topY = localBox.max.y;
  const centerX = (localBox.min.x + localBox.max.x) / 2;

  // Puntos en coordenadas locales del vehiculo
  const frontTopLocal = new Vector3(localBox.max.x, topY, 0);
  const rearTopLocal = new Vector3(localBox.min.x, topY, 0);
  const frontGroundLocal = new Vector3(localBox.max.x, groundY, 0);
  const rearGroundLocal = new Vector3(localBox.min.x, groundY, 0);
  const topLocal = new Vector3(centerX, topY, 0);
  const topGroundLocal = new Vector3(centerX, groundY, 0);
  const axleFrontLocal = new Vector3(wb / 2, rf, 0);
  const axleRearLocal = new Vector3(-wb / 2, rr, 0);

  // Asegurar que la matriz de mundo del vehiculo este actualizada
  vehicle.root.updateMatrixWorld(true);

  // Transformar al espacio de mundo y proyectar
  const project = (ptLocal: Vector3): ScreenPoint => {
    const ptWorld = ptLocal.clone().applyMatrix4(vehicle.root.matrixWorld);
    return projectPointToScreen(ptWorld, camera, width, height);
  };

  return {
    frontTop: project(frontTopLocal),
    rearTop: project(rearTopLocal),
    frontGround: project(frontGroundLocal),
    rearGround: project(rearGroundLocal),
    top: project(topLocal),
    topGround: project(topGroundLocal),
    axleFront: project(axleFrontLocal),
    axleRear: project(axleRearLocal),
  };
}

/**
 * Proyecta la posicion en pantalla de una pieza (focusPoint o centro de su bbox).
 */
export function projectVehicleSlot(
  vehicle: BuiltVehicle,
  slotId: PartSlotId,
  camera: PerspectiveCamera,
  width: number,
  height: number,
): ScreenPoint | null {
  vehicle.root.updateMatrixWorld(true);

  let worldPt: Vector3 | null = null;
  const focusPt = vehicle.focusPoints[slotId];
  if (focusPt) {
    worldPt = new Vector3(...focusPt).applyMatrix4(vehicle.root.matrixWorld);
  } else {
    const partObj = vehicle.parts.get(slotId);
    if (partObj) {
      partObj.updateMatrixWorld(true);
      const box = new Box3().setFromObject(partObj);
      worldPt = box.getCenter(new Vector3());
    }
  }

  if (!worldPt) return null;
  return projectPointToScreen(worldPt, camera, width, height);
}
