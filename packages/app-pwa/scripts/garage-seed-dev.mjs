#!/usr/bin/env node
/**
 * garage-seed-dev.mjs — Carga 4 vehiculos del catalogo con mantenimientos en un dev server
 * local, por la API normal (/api/fleet/*), para ver el garage 3D con datos reales.
 *
 *   node scripts/garage-seed-dev.mjs --base http://127.0.0.1:4391
 *
 * En dev sin KV cualquier cookie `session` vale como admin. Idempotente a medias: si ya hay
 * vehiculos con esas placas no los duplica.
 */
const i = process.argv.indexOf('--base');
const base = i > -1 ? process.argv[i + 1] : 'http://127.0.0.1:4391';
const headers = { 'content-type': 'application/json', cookie: 'session=garage-seed-dev' };

async function api(path, body) {
  const res = await fetch(new URL(path, base), body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

// Placas en formato que acepta la validacion actual (ver REPORT: las de moto ABC12D no pasan).
const VEHICLES = [
  { plate: 'ABC1D23', vin: '9C6KE1720L0012345', make: 'Yamaha', model: 'FZ16', year: 2021, type: 'moto', mileage: 28450, soatExpiry: '2026-10-13', tecnoExpiry: '2027-03-01', color: '#1f4fd1' },
  { plate: 'GHK-123', vin: '9BRBD3HE8L0123456', make: 'Toyota', model: 'Corolla', year: 2020, type: 'sedan', mileage: 64210, soatExpiry: '2027-01-20', tecnoExpiry: '2026-11-15', color: '#8a1c22' },
  { plate: 'JKL-987', vin: '8AJBA3CD4P1002341', make: 'Toyota', model: 'Hilux', year: 2022, type: 'pickup', mileage: 41800, soatExpiry: '2027-05-02', tecnoExpiry: '2027-05-02', color: '#e8e8e6' },
  { plate: 'XYZ3G45', vin: 'MH3SG3410N0123456', make: 'Yamaha', model: 'NMAX', year: 2023, type: 'moto', mileage: 9100, soatExpiry: '2027-04-28', color: '#e9ecef' },
];

const MAINTENANCE = {
  'ABC1D23': [
    { type: 'Cambio de aceite 10W-40', km: 25100, date: '2026-07-02', cost: 45000, workshop: 'Moto Taller Centro', status: 'completed' },
    { type: 'Kit de arrastre cadena sprocket', km: 12850, date: '2025-08-10', cost: 180000, workshop: 'Moto Taller Centro', status: 'completed' },
    { type: 'Pastillas freno delantero', km: 20000, date: '2026-01-10', cost: 60000, workshop: 'Moto Taller Centro', status: 'completed' },
  ],
  'GHK-123': [
    { type: 'Pastillas freno delantero', km: 29010, date: '2024-02-15', cost: 320000, workshop: 'Taller Norte', status: 'completed' },
    { type: 'Cambio de aceite 0W-20', km: 58200, date: '2026-05-20', cost: 210000, workshop: 'Taller Norte', status: 'completed' },
  ],
  'JKL-987': [{ type: 'Rotacion de llantas', km: 40000, date: '2026-08-01', cost: 60000, workshop: 'Llantas del Sur', status: 'scheduled', nextKm: 44000 }],
};

const existing = (await api('/api/fleet/vehicle')).data ?? [];
for (const v of VEHICLES) {
  let row = existing.find((e) => e.plate === v.plate);
  if (!row) row = (await api('/api/fleet/vehicle', { ...v, fleetId: 'fleet-demo', status: 'active' })).data;
  console.log(`vehiculo ${v.make} ${v.model} → ${row.id}`);
  if (existing.some((e) => e.plate === v.plate)) continue;
  for (const m of MAINTENANCE[v.plate] ?? []) await api('/api/fleet/maintenance', { ...m, vehicleId: row.id });
}
const snap = await api('/api/garage/vehicles');
console.log(`garage: ${snap.vehicles?.length ?? 0} vehiculos`);
