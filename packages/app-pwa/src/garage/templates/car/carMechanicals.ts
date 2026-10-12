/**
 * carMechanicals.ts — Ranuras mecanicas internas y de chasis para carros y pesados.
 *
 * Construye con precision las siguientes ranuras canonicas:
 *   - engine (motor: bloque, culata, tapa de valvulas, admision y poleas)
 *   - engine_oil (aceite de motor: carter inferior, tapa de llenado y varilla)
 *   - oil_filter (filtro de aceite: cartucho roscado metalico)
 *   - air_filter (filtro de aire: caja portafiltro y ducto de admision)
 *   - battery (bateria automotriz de 12V con bornes positivo y negativo)
 *   - fuel_filter (filtro de combustible canister sobre linea de alimentacion)
 *   - clutch (embrague y campana de transmision acoplada al motor)
 *   - spark_plugs (bujias / bobinas de encendido independientes sobre la culata)
 *   - suspension_front (tijeras, amortiguadores, resortes y barra estabilizadora)
 *   - suspension_rear (brazos de suspension, amortiguadores y resortes traseros)
 *   - exhaust (colector, catalizador, tuberia central, silenciador y salidas cromadas)
 *
 * Todas las piezas respetan el despeje al suelo (y >= groundClearance >= 0.14m)
 * para que solo las llantas toquen y = 0.
 */
import { Group } from 'three/webgpu';
import type { PartSlotId, TemplateContext, VehicleSpec } from '../../contracts';
import { mesh, part, roundedBox, tube } from '../common/geometry';
import { mm } from '../common/units';

export interface MechanicalsConfig {
  wb: number;
  trackFront: number;
  trackRear: number;
  rFront: number;
  rRear: number;
  xFront: number;
  xRear: number;
  hoodY: number;
  groundY: number;
}

export interface BuiltMechanicals {
  parts: Map<PartSlotId, Group>;
  focusPoints: Record<PartSlotId, [number, number, number]>;
}

export function buildCarMechanicals(
  spec: VehicleSpec,
  ctx: TemplateContext,
  cfg: MechanicalsConfig,
): BuiltMechanicals {
  const { materials: kit, lod } = ctx;
  const parts = new Map<PartSlotId, Group>();
  const focusPoints: Record<PartSlotId, [number, number, number]> = {};

  const { wb, trackFront, trackRear, rFront, rRear, xRear, groundY } = cfg;

  // Centro del vano motor (entre el eje delantero y el corta-fuegos)
  const engineX = wb / 2 - 0.08;
  const engineY = groundY + (rFront - groundY) * 0.95 + 0.12;
  const engineZ = 0.0;

  // =========================================================================
  // 1. ENGINE (Motor)
  // =========================================================================
  const engineGrp = new Group();
  // Bloque de cilindros
  const blockW = spec.family === 'heavy' ? 0.70 : 0.48;
  const blockH = spec.family === 'heavy' ? 0.50 : 0.36;
  const blockD = spec.family === 'heavy' ? 0.55 : 0.40;
  const block = mesh(roundedBox(blockW, blockH, blockD, 0.03), kit.metal('dark'), [engineX, engineY, engineZ]);
  engineGrp.add(block);

  // Culata y tapa de valvulas
  const headH = blockH * 0.32;
  const headY = engineY + blockH / 2 + headH / 2;
  const headMat = spec.paint.accentColor ? kit.accent(spec.paint) : kit.metal('aluminum');
  const head = mesh(roundedBox(blockW * 0.96, headH, blockD * 0.92, 0.02), headMat, [engineX, headY, engineZ]);
  engineGrp.add(head);

  // Multiple de admision con plenitud
  const plenum = mesh(
    roundedBox(blockW * 0.85, 0.12, 0.14, 0.02),
    kit.plastic('black'),
    [engineX, headY + 0.06, engineZ + blockD * 0.45],
  );
  engineGrp.add(plenum);

  // Poleas y correa de accesorios frontal
  const pulley = mesh(
    roundedBox(0.04, blockH * 0.7, blockD * 0.5, 0.02),
    kit.metal('steel'),
    [engineX + blockW / 2 + 0.02, engineY, engineZ],
  );
  engineGrp.add(pulley);

  const gEngine = part('engine', engineGrp);
  parts.set('engine', gEngine);
  focusPoints.engine = [engineX, engineY, engineZ];

  // =========================================================================
  // 2. ENGINE_OIL (Carter, tapa y varilla)
  // =========================================================================
  const oilGrp = new Group();
  // Carter inferior (bajo el bloque)
  const panH = 0.10;
  const panY = engineY - blockH / 2 - panH / 2 + 0.01;
  const pan = mesh(roundedBox(blockW * 0.88, panH, blockD * 0.84, 0.02), kit.metal('dark'), [engineX, panY, engineZ]);
  oilGrp.add(pan);

  // Tapa de llenado de aceite sobre la culata
  const cap = mesh(roundedBox(0.07, 0.03, 0.07, 0.015), kit.plastic('textured'), [
    engineX - blockW * 0.25,
    headY + headH / 2 + 0.015,
    engineZ - blockD * 0.2,
  ]);
  oilGrp.add(cap);

  // Varilla de medicion con mango de color distintivo
  const dipstick = mesh(roundedBox(0.03, 0.08, 0.03, 0.01), kit.accent(spec.paint), [
    engineX + blockW * 0.35,
    headY + 0.04,
    engineZ + blockD * 0.35,
  ]);
  oilGrp.add(dipstick);

  const gEngineOil = part('engine_oil', oilGrp);
  parts.set('engine_oil', gEngineOil);
  focusPoints.engine_oil = [engineX, panY, engineZ];

  // =========================================================================
  // 3. OIL_FILTER (Filtro de aceite en el lateral del bloque)
  // =========================================================================
  const filterX = engineX + blockW * 0.25;
  const filterY = engineY - blockH * 0.15;
  const filterZ = engineZ - blockD / 2 - 0.06;
  const oilFilter = mesh(roundedBox(0.09, 0.12, 0.09, 0.025), kit.metal('steel'), [filterX, filterY, filterZ]);
  const gOilFilter = part('oil_filter', oilFilter);
  parts.set('oil_filter', gOilFilter);
  focusPoints.oil_filter = [filterX, filterY, filterZ];

  // =========================================================================
  // 4. AIR_FILTER (Caja de filtro de aire y tubo)
  // =========================================================================
  const airGrp = new Group();
  const airX = engineX + 0.05;
  const airY = headY + 0.02;
  const airZ = engineZ - blockD / 2 - 0.22;
  const airBox = mesh(roundedBox(0.24, 0.16, 0.20, 0.02), kit.plastic('textured'), [airX, airY, airZ]);
  airGrp.add(airBox);

  // Ducto hacia la admision
  const duct = mesh(roundedBox(0.18, 0.08, 0.12, 0.03), kit.rubber(), [
    airX,
    airY + 0.04,
    airZ + 0.14,
  ]);
  airGrp.add(duct);

  const gAirFilter = part('air_filter', airGrp);
  parts.set('air_filter', gAirFilter);
  focusPoints.air_filter = [airX, airY, airZ];

  // =========================================================================
  // 5. BATTERY (Bateria 12V con bornes)
  // =========================================================================
  const batGrp = new Group();
  const batX = engineX - 0.28;
  const batY = engineY + 0.06;
  const batZ = engineZ + blockD / 2 + 0.18;
  const batCase = mesh(roundedBox(0.24, 0.18, 0.16, 0.015), kit.plastic('black'), [batX, batY, batZ]);
  batGrp.add(batCase);

  // Borne positivo (rojo) y borne negativo (oscuro)
  const posPost = mesh(roundedBox(0.025, 0.03, 0.025, 0.005), kit.light('tail'), [
    batX + 0.07,
    batY + 0.09 + 0.015,
    batZ - 0.04,
  ]);
  const negPost = mesh(roundedBox(0.025, 0.03, 0.025, 0.005), kit.metal('dark'), [
    batX - 0.07,
    batY + 0.09 + 0.015,
    batZ - 0.04,
  ]);
  batGrp.add(posPost, negPost);

  const gBattery = part('battery', batGrp);
  parts.set('battery', gBattery);
  focusPoints.battery = [batX, batY, batZ];

  // =========================================================================
  // 6. FUEL_FILTER (Filtro de combustible tipo canister en el corta-fuegos)
  // =========================================================================
  const ffX = engineX - blockW / 2 - 0.10;
  const ffY = engineY + 0.05;
  const ffZ = engineZ - 0.18;
  const fuelFilter = mesh(roundedBox(0.08, 0.13, 0.08, 0.03), kit.metal('aluminum'), [ffX, ffY, ffZ]);
  const gFuelFilter = part('fuel_filter', fuelFilter);
  parts.set('fuel_filter', gFuelFilter);
  focusPoints.fuel_filter = [ffX, ffY, ffZ];

  // =========================================================================
  // 7. CLUTCH (Campana de transmision / embrague)
  // =========================================================================
  const clX = engineX - blockW / 2 - 0.16;
  const clY = engineY - 0.02;
  const clZ = engineZ;
  const clutch = mesh(roundedBox(0.32, blockH * 0.88, blockD * 0.85, 0.04), kit.metal('aluminum'), [clX, clY, clZ]);
  const gClutch = part('clutch', clutch);
  parts.set('clutch', gClutch);
  focusPoints.clutch = [clX, clY, clZ];

  // =========================================================================
  // 8. SPARK_PLUGS (Riel de bobinas / bujias)
  // =========================================================================
  const spGrp = new Group();
  const plugCount = spec.family === 'heavy' ? 6 : 4;
  const stepX = (blockW * 0.7) / plugCount;
  const startX = engineX - (blockW * 0.35) + stepX / 2;
  for (let i = 0; i < plugCount; i++) {
    const pMesh = mesh(
      roundedBox(0.04, 0.05, 0.04, 0.01),
      kit.plastic('black'),
      [startX + i * stepX, headY + headH / 2 + 0.025, engineZ],
    );
    spGrp.add(pMesh);
  }
  const gSparkPlugs = part('spark_plugs', spGrp);
  parts.set('spark_plugs', gSparkPlugs);
  focusPoints.spark_plugs = [engineX, headY + headH / 2 + 0.025, engineZ];

  // =========================================================================
  // 9. SUSPENSION_FRONT (Brazos, resortes y amortiguadores delanteros)
  // =========================================================================
  const suspFGrp = new Group();
  const axFX = wb / 2;
  const armY = groundY + (rFront - groundY) * 0.55;
  const armLenZ = (trackFront / 2) * 0.65;

  // Subchasis / tijeras inferiores (izquierda y derecha)
  for (const s of [1, -1]) {
    const arm = mesh(roundedBox(0.18, 0.05, armLenZ, 0.015), kit.metal('dark'), [
      axFX,
      armY,
      s * (trackFront / 4),
    ]);
    // Puntal / resorte vertical hacia la mangueta
    const strut = mesh(roundedBox(0.08, rFront * 0.85, 0.08, 0.02), kit.metal('steel'), [
      axFX,
      armY + rFront * 0.45,
      s * (trackFront / 2 - 0.08),
    ]);
    suspFGrp.add(arm, strut);
  }
  // Barra estabilizadora transversal
  const swayF = mesh(roundedBox(0.04, 0.04, trackFront * 0.75, 0.015), kit.metal('dark'), [
    axFX + 0.12,
    armY + 0.04,
    0,
  ]);
  suspFGrp.add(swayF);

  const gSuspF = part('suspension_front', suspFGrp);
  parts.set('suspension_front', gSuspF);
  focusPoints.suspension_front = [axFX, armY + rFront * 0.4, 0];

  // =========================================================================
  // 10. SUSPENSION_REAR (Brazos, amortiguadores y resortes traseros)
  // =========================================================================
  const suspRGrp = new Group();
  const axRX = -wb / 2;
  const armRY = groundY + (rRear - groundY) * 0.55;
  const armRLenZ = (trackRear / 2) * 0.65;

  for (const s of [1, -1]) {
    const armR = mesh(roundedBox(0.24, 0.06, armRLenZ, 0.018), kit.metal('dark'), [
      axRX,
      armRY,
      s * (trackRear / 4),
    ]);
    const shockR = mesh(roundedBox(0.07, rRear * 0.82, 0.07, 0.02), kit.metal('steel'), [
      axRX - 0.04,
      armRY + rRear * 0.42,
      s * (trackRear / 2 - 0.08),
    ]);
    suspRGrp.add(armR, shockR);
  }
  // Barra o viga de torsion trasera
  const swayR = mesh(roundedBox(0.06, 0.06, trackRear * 0.78, 0.015), kit.metal('dark'), [
    axRX,
    armRY + 0.03,
    0,
  ]);
  suspRGrp.add(swayR);

  const gSuspR = part('suspension_rear', suspRGrp);
  parts.set('suspension_rear', gSuspR);
  focusPoints.suspension_rear = [axRX, armRY + rRear * 0.4, 0];

  // =========================================================================
  // 11. EXHAUST (Colector, catalizador, silenciador y colas de escape)
  // =========================================================================
  const exhGrp = new Group();
  const pipeR = spec.family === 'heavy' ? 0.055 : 0.032;
  const exhY = groundY + 0.07;

  // Tuberia central desde el vano motor hasta el eje trasero
  const midPipe = tube(
    [
      [engineX - 0.2, engineY - 0.1, engineZ + 0.12],
      [engineX - 0.4, exhY, 0.05],
      [0.2, exhY, 0.04],
      [-wb / 4, exhY, 0.04],
      [-wb / 2 - 0.1, exhY, 0.08],
      [-wb / 2 - 0.4, exhY + 0.06, 0.18],
    ],
    pipeR,
    { segments: lod === 'high' ? 24 : 12 },
  );
  exhGrp.add(mesh(midPipe, kit.metal('brushed')));

  // Convertidor catalitico
  const cat = mesh(roundedBox(0.32, 0.10, 0.18, 0.03), kit.metal('steel'), [wb * 0.15, exhY, 0.04]);
  exhGrp.add(cat);

  // Silenciador trasero transversal
  const mufW = 0.46;
  const mufH = 0.18;
  const mufD = 0.28;
  const mufX = -wb / 2 - 0.48;
  const muf = mesh(roundedBox(mufW, mufH, mufD, 0.04), kit.metal('steel'), [mufX, exhY + 0.08, 0]);
  exhGrp.add(muf);

  // Colas de escape cromadas saliendo al final
  const tipLen = Math.max(0.08, Math.abs(xRear - (mufX - mufW / 2)) + 0.03);
  const tipZ = 0.24;
  const tip1 = mesh(roundedBox(tipLen, pipeR * 2.2, pipeR * 2.2, pipeR), kit.chrome(), [
    xRear + tipLen / 2 - 0.01,
    exhY + 0.06,
    tipZ,
  ]);
  exhGrp.add(tip1);
  if (spec.family !== 'heavy') {
    const tip2 = mesh(roundedBox(tipLen, pipeR * 2.2, pipeR * 2.2, pipeR), kit.chrome(), [
      xRear + tipLen / 2 - 0.01,
      exhY + 0.06,
      -tipZ,
    ]);
    exhGrp.add(tip2);
  }

  const gExhaust = part('exhaust', exhGrp);
  parts.set('exhaust', gExhaust);
  focusPoints.exhaust = [mufX, exhY + 0.08, 0];

  return { parts, focusPoints };
}
