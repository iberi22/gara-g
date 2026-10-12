#!/usr/bin/env node
/**
 * seed-demo-obras.mjs — Cuenta demo para clientes de obra: volquetas, camiones y
 * maquinaria amarilla con historial de mantenimiento, cargas de combustible y alertas.
 *
 * Usa la API normal (/api/fleet/*) con una sesion real, asi que pasa por las mismas
 * validaciones que un usuario. Idempotente: un vehiculo que ya existe (misma placa o serie)
 * no se duplica ni recibe historial de nuevo.
 *
 *   # dev (sin KV, cualquier cookie vale como admin del tenant por defecto)
 *   node scripts/seed-demo-obras.mjs --base http://127.0.0.1:4471 --cookie dev
 *
 *   # produccion: inicia sesion con el usuario de la cuenta demo
 *   DEMO_PASSWORD=... node scripts/seed-demo-obras.mjs --base https://gara-g.swal.network \
 *     --email demo@gara-g.swal.network --tenant demo-obras
 *
 * Las fechas se calculan contra hoy, para que la demo siempre tenga cosas por vencer.
 */
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const base = arg('base', 'http://127.0.0.1:4471');
let cookie = arg('cookie') ? `session=${arg('cookie')}` : '';

if (!cookie) {
  const email = arg('email');
  const password = process.env.DEMO_PASSWORD;
  const tenant = arg('tenant', 'demo-obras');
  if (!email || !password) {
    console.error('Falta --cookie (dev) o --email + DEMO_PASSWORD (produccion)');
    process.exit(1);
  }
  const res = await fetch(new URL(`/api/auth/login?instanceId=${encodeURIComponent(tenant)}`, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });
  const set = res.headers.get('set-cookie') ?? '';
  const m = /session=([^;]+)/.exec(set);
  if (!res.ok || !m) {
    console.error(`Login fallo (${res.status}): ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  cookie = `session=${m[1]}`;
}

const headers = { 'content-type': 'application/json', cookie };
async function api(path, body) {
  const res = await fetch(new URL(path, base), body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

const DAY = 86400000;
const today = new Date();
const daysAgo = (n) => new Date(today.getTime() - n * DAY).toISOString().slice(0, 10);
const daysAhead = (n) => new Date(today.getTime() + n * DAY).toISOString().slice(0, 10);

const FLEETS = [
  { key: 'camiones', name: 'Volquetas y camiones', region: 'Antioquia', tags: ['pesados', 'obra'] },
  { key: 'maquinaria', name: 'Maquinaria amarilla', region: 'Antioquia', tags: ['maquinaria', 'obra'] },
];

/** km o horas segun el vehiculo: `use` es el contador actual. */
const VEHICLES = [
  // --- Camiones (km) ---
  {
    fleet: 'camiones', name: 'Volqueta 01', type: 'volqueta', make: 'Kenworth', model: 'T800 Volqueta', year: 2019,
    plate: 'TKV418', vin: '1NKDL40X3KJ123456', mileage: 286400, color: '#b3261e', kmpg: 6.4,
    fuel: [[285100, 9, 105], [285780, 5, 98], [286400, 1, 101]],
    soatExpiry: daysAhead(134), tecnoExpiry: daysAhead(12),
    history: [
      { type: 'Cambio de aceite 15W-40 pesado y filtro de aceite pesado', km: 279800, d: 38, cost: 520000 },
      { type: 'Cambio de filtro de combustible pesado', km: 268100, d: 95, cost: 130000 },
      { type: 'Bandas freno traseras', km: 259300, d: 150, cost: 1500000 },
      { type: 'Sellos del cilindro de volteo', km: 231000, d: 260, cost: 980000 },
    ],
  },
  {
    fleet: 'camiones', name: 'Volqueta 02', type: 'volqueta', make: 'International', model: '7600 Volqueta', year: 2021,
    plate: 'SNK552', vin: '3HSDJAPR5MN123987', mileage: 154200, color: '#eceeef', kmpg: 7.1,
    fuel: [[153300, 6, 120], [154200, 1, 126]],
    soatExpiry: daysAhead(34), tecnoExpiry: daysAhead(210),
    history: [
      { type: 'Cambio de aceite 15W-40 pesado', km: 145900, d: 52, cost: 340000 },
      { type: 'Cambio de filtro de aceite pesado', km: 145900, d: 52, cost: 85000 },
      { type: 'Bandas freno delanteras', km: 121500, d: 190, cost: 780000 },
      { type: 'Llantas traseras volqueta', km: 98000, d: 320, cost: 9200000 },
    ],
    upcoming: { type: 'Revisión general 160.000 km', km: 150000, nextKm: 160000, nextDays: 20 },
  },
  {
    fleet: 'camiones', name: 'Tractomula 01', type: 'tractomula', make: 'Kenworth', model: 'T800', year: 2020,
    plate: 'WFR903', vin: '1XKAD49X9LJ456712', mileage: 512300, color: '#1f3a5f', kmpg: 7.8,
    fuel: [[510900, 4, 160], [512300, 1, 178]],
    soatExpiry: daysAhead(250), tecnoExpiry: daysAhead(250),
    history: [
      { type: 'Cambio de aceite 15W-40 pesado y filtro', km: 498000, d: 30, cost: 448000 },
      { type: 'Pastillas freno tractomula', km: 470500, d: 120, cost: 820000 },
    ],
  },
  {
    fleet: 'camiones', name: 'Furgón reparto', type: 'camion', make: 'Chevrolet', model: 'NPR', year: 2022,
    plate: 'GTZ771', vin: '9GDNPR729NB123456', mileage: 98400, color: '#f2f2f0', kmpg: 14.5,
    fuel: [[97900, 7, 32], [98400, 2, 34]],
    soatExpiry: daysAhead(-6), tecnoExpiry: daysAhead(160),
    history: [{ type: 'Cambio de aceite y filtro de aceite', km: 92000, d: 40, cost: 310000 }],
  },
  {
    fleet: 'camiones', name: 'Estacas materiales', type: 'estacas', make: 'Hino', model: 'Serie 500 Estacas', year: 2020,
    plate: 'TSN260', vin: 'JHHUCS2H0LK123456', mileage: 176900, color: '#2e6b3f',
    soatExpiry: daysAhead(90), tecnoExpiry: daysAhead(45),
    history: [
      { type: 'Cambio de aceite 15W-40', km: 169500, d: 60, cost: 260000 },
      { type: 'Bandas freno delanteras', km: 140000, d: 230, cost: 520000 },
    ],
  },
  // --- Maquinaria amarilla (horas) ---
  {
    fleet: 'maquinaria', name: 'Excavadora 01', type: 'excavadora', make: 'Caterpillar', model: '320', year: 2019,
    plate: '', vin: 'CAT0320GKZ1234', hours: 6840,
    history: [
      { type: 'Cambio de aceite de motor y filtro de aceite de motor', hours: 6500, d: 34, cost: 780000 },
      { type: 'Cambio de filtro de combustible', hours: 6500, d: 34, cost: 240000 },
      { type: 'Cambio de filtro hidraulico de retorno', hours: 6100, d: 75, cost: 380000 },
      { type: 'Cambio de dientes del balde', hours: 6200, d: 64, cost: 1600000 },
      { type: 'Cambio de aceite hidraulico', hours: 4100, d: 290, cost: 4200000 },
      { type: 'Cambio de zapatas y cadena de oruga', hours: 2500, d: 600, cost: 38000000 },
      { type: 'Aceite de mandos finales', hours: 5100, d: 180, cost: 520000 },
    ],
    upcoming: { type: 'Servicio de 7.000 horas', hours: 6500, nextHours: 7000, nextDays: 15 },
    fuel: [[6700, 0, 95], [6760, 6, 80], [6840, 1, 104]],
  },
  {
    fleet: 'maquinaria', name: 'Excavadora 02', type: 'excavadora', make: 'Komatsu', model: 'PC200', year: 2017,
    plate: '', vin: 'PC200C12345', hours: 11260,
    history: [
      { type: 'Cambio de aceite de motor y filtro de aceite de motor', hours: 10780, d: 46, cost: 750000 },
      { type: 'Cambio de filtro hidraulico', hours: 10300, d: 98, cost: 360000 },
      { type: 'Cambio de dientes del balde', hours: 10900, d: 36, cost: 1500000 },
    ],
    fuel: [[11100, 9, 90], [11260, 1, 160]],
  },
  {
    fleet: 'maquinaria', name: 'Cargador 01', type: 'cargador', make: 'Caterpillar', model: '950', year: 2018,
    plate: '', vin: 'CAT0950MLXS2201', hours: 9120,
    history: [
      { type: 'Cambio de aceite de motor y filtro de aceite de motor', hours: 8700, d: 40, cost: 940000 },
      { type: 'Cambio de cuchilla y cantoneras del balde', hours: 8600, d: 52, cost: 4600000 },
      { type: 'Cambio de llantas 23.5R25', hours: 5900, d: 400, cost: 36000000 },
      { type: 'Aceite de transmision', hours: 7600, d: 160, cost: 1200000 },
    ],
    fuel: [[9000, 6, 120], [9120, 1, 145]],
  },
  {
    fleet: 'maquinaria', name: 'Bulldozer 01', type: 'bulldozer', make: 'Caterpillar', model: 'D6', year: 2016,
    plate: '', vin: 'CAT00D6TGWX0042', hours: 14230,
    history: [
      { type: 'Cambio de aceite de motor y filtro de aceite de motor', hours: 13790, d: 48, cost: 940000 },
      { type: 'Cambio de cuchillas y esquineros de la hoja', hours: 13300, d: 105, cost: 7800000 },
      { type: 'Cambio de punta del escarificador', hours: 13950, d: 30, cost: 950000 },
      { type: 'Zapatas y cadena de oruga', hours: 10100, d: 450, cost: 52000000 },
    ],
  },
  {
    fleet: 'maquinaria', name: 'Motoniveladora 01', type: 'motoniveladora', make: 'Caterpillar', model: '140', year: 2020,
    plate: 'MC4027', vin: 'CAT0140MD9N0311', hours: 5310, soatExpiry: daysAhead(70),
    history: [
      { type: 'Cambio de aceite de motor y filtro de aceite de motor', hours: 5000, d: 33, cost: 940000 },
      { type: 'Cambio de cuchillas de la vertedera', hours: 4900, d: 44, cost: 3600000 },
    ],
  },
  {
    fleet: 'maquinaria', name: 'Retroexcavadora 01', type: 'retroexcavadora', make: 'JCB', model: '3CX', year: 2021,
    plate: 'MC1958', vin: 'JCB3CXT2101987', hours: 3480, soatExpiry: daysAhead(18),
    history: [
      { type: 'Cambio de aceite de motor y filtro de aceite de motor', hours: 3020, d: 50, cost: 460000 },
      { type: 'Cambio de dientes del balde de la retro', hours: 3100, d: 40, cost: 600000 },
      { type: 'Cambio de filtro hidraulico', hours: 2600, d: 120, cost: 240000 },
    ],
    fuel: [[3400, 5, 30], [3480, 1, 34]],
  },
  {
    fleet: 'maquinaria', name: 'Vibrocompactador 01', type: 'vibrocompactador', make: 'Dynapac', model: 'CA250', year: 2019,
    plate: '', vin: 'DYCA250D190455', hours: 7740,
    history: [
      { type: 'Cambio de aceite de motor y filtro de aceite de motor', hours: 7300, d: 45, cost: 440000 },
      { type: 'Aceite del tambor vibratorio', hours: 6900, d: 95, cost: 420000 },
      { type: 'Cambio de raspadores del tambor', hours: 6500, d: 140, cost: 480000 },
    ],
  },
];

const ALERTS = [
  { vehicle: 'Excavadora 01', kind: 'maintenance', severity: 'warning', message: 'Aceite hidráulico cerca del cambio de 3.000 h' },
  { vehicle: 'Furgón reparto', kind: 'document', severity: 'critical', message: 'SOAT vencido: el vehículo no puede circular' },
  { vehicle: 'Volqueta 01', kind: 'document', severity: 'warning', message: 'Revisión técnico-mecánica vence en 12 días' },
];

const fleetsNow = (await api('/api/fleet/fleet')).data ?? [];
const fleetIds = {};
for (const f of FLEETS) {
  let row = fleetsNow.find((x) => x.name === f.name);
  if (!row) row = (await api('/api/fleet/fleet', { name: f.name, region: f.region, tags: f.tags, organizationId: 'org-demo-obras' })).data;
  fleetIds[f.key] = row.id;
}

const existing = (await api('/api/fleet/vehicle')).data ?? [];
const ids = {};
for (const v of VEHICLES) {
  const { fleet, history, upcoming, fuel, kmpg, ...fields } = v;
  const found = existing.find((e) => (v.plate && e.plate === v.plate) || (v.vin && e.vin === v.vin));
  if (found) {
    ids[v.name] = found.id;
    console.log(`= ${v.name} ya existe (${found.id})`);
    continue;
  }
  const body = { ...fields, fleetId: fleetIds[fleet], status: 'active' };
  if (!body.plate) delete body.plate;
  const row = (await api('/api/fleet/vehicle', body)).data;
  ids[v.name] = row.id;
  const unit = v.hours !== undefined ? 'hours' : 'km';
  for (const h of history ?? []) {
    await api('/api/fleet/maintenance', {
      vehicleId: row.id,
      type: h.type,
      [unit]: h[unit],
      date: daysAgo(h.d),
      cost: h.cost,
      workshop: unit === 'hours' ? 'Taller de maquinaria La Obra' : 'Servicentro Pesados',
      status: 'completed',
    });
  }
  if (upcoming) {
    await api('/api/fleet/maintenance', {
      vehicleId: row.id,
      type: upcoming.type,
      [unit]: upcoming[unit],
      [unit === 'hours' ? 'nextHours' : 'nextKm']: upcoming[unit === 'hours' ? 'nextHours' : 'nextKm'],
      date: daysAgo(30),
      nextDate: daysAhead(upcoming.nextDays),
      status: 'scheduled',
    });
  }
  for (const [counter, d, gallons] of fuel ?? []) {
    await api('/api/fleet/fuelLog', {
      vehicleId: row.id,
      date: daysAgo(d),
      [unit]: counter,
      gallons,
      cost: gallons * 15800,
      station: 'Combustibles La 80',
      ...(kmpg ? { kmPerGallon: kmpg } : {}),
    });
  }
  console.log(`+ ${v.name} (${v.make} ${v.model}) → ${row.id}`);
}

const alertsNow = (await api('/api/fleet/alert')).data ?? [];
for (const a of ALERTS) {
  const vehicleId = ids[a.vehicle];
  if (!vehicleId || alertsNow.some((x) => x.vehicleId === vehicleId && x.message === a.message)) continue;
  await api('/api/fleet/alert', { vehicleId, kind: a.kind, severity: a.severity, message: a.message, acknowledged: false });
}

const snap = await api('/api/garage/vehicles');
const machines = (snap.vehicles ?? []).filter((v) => v.usageUnit === 'h').length;
console.log(`garage: ${snap.vehicles?.length ?? 0} vehiculos (${machines} por horas)`);
