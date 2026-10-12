// vehicle.test.ts — Validadores puros + CRUD Vehicle (WAVE-11.02, issue #877).
//
// Cubre:
//   - validateVIN: acepta 17-char alphanumeric sin I/O/Q (test 1)
//   - validateVIN: rechaza 16 chars (test 2)
//   - validateVIN: rechaza VIN con letra I (test 3)
//   - validateVIN: rechaza VIN con letra Q (test 4)
//   - validateVIN: rechaza VIN vacío (test 5)
//   - validatePlate: acepta formato Colombia ABC-123 (test 6)
//   - validatePlate: acepta formato Mercosur ABC1D23 (test 7)
//   - validatePlate: rechaza lowercase / wrong format / empty (test 8)
//   - validateVehicleFields: catches year out of range (test 9)
//   - validateVehicleFields: catches empty make/model/fleetId (test 10)
//   - validateVehicleFields: passes complete valid vehicle (test 11)
//   - validateVehicleFields: catches invalid VIN/plate (test 12)
//   - CRUD lifecycle (test 13)

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateVIN,
  validatePlate,
  normalizePlate,
  validateVehicleFields,
  createVehicle,
  listVehicles,
  getVehicle,
  updateVehicle,
  deleteVehicle,
  type VehicleFields,
} from './vehicle.js';
import { getMemoryAdapter, setStorageAdapter } from './domain.js';

const baseVehicle = (over: Partial<VehicleFields> = {}): VehicleFields => ({
  plate: 'ABC-123',
  vin: '1HGCR2F83HA000000',
  make: 'Tesla',
  model: 'Model 3',
  year: 2024,
  status: 'active',
  fleetId: 'fleet-1',
  ...over,
});

describe('validateVIN (W11.02)', () => {
  it('accepts 17-char alphanumeric VIN without I/O/Q', () => {
    expect(validateVIN('1HGCR2F83HA000000')).toBe(true);
    expect(validateVIN('JH4DA1750HS000001')).toBe(true);
    expect(validateVIN('5YJ3E1EA7JF000123')).toBe(true);
    expect(validateVIN('ABCDEFGHJK1234567')).toBe(true);
  });

  it('rejects VIN with 16 chars (too short)', () => {
    expect(validateVIN('1HGCR2F83HA00000')).toBe(false); // 16
    expect(validateVIN('1HGCR2F83HA0000000')).toBe(false); // 18
  });

  it('rejects VIN containing letter I', () => {
    expect(validateVIN('1HGCR2F83IA000000')).toBe(false); // I en pos 10
    expect(validateVIN('IHGCR2F83HA000000')).toBe(false); // I al inicio
  });

  it('rejects VIN containing letter Q', () => {
    expect(validateVIN('1HGCR2F83QA000000')).toBe(false); // Q en pos 10
    expect(validateVIN('QHGCR2F83HA000000')).toBe(false); // Q al inicio
  });

  it('rejects VIN containing letter O', () => {
    // O es prohibida por la misma norma (confusión con 0)
    expect(validateVIN('1HGCR2F83OA000000')).toBe(false);
  });

  it('rejects empty VIN', () => {
    expect(validateVIN('')).toBe(false);
  });
});

describe('validatePlate — placas colombianas reales', () => {
  // Antes solo se aceptaba ABC-123 y Mercosur: ninguna moto colombiana (ABC12D) se
  // podia registrar, y la placa de carro escrita como va en la lamina (ABC123) tampoco.
  it('acepta placas de moto ABC12D, con o sin guion', () => {
    expect(validatePlate('ABC12D')).toBe(true);
    expect(validatePlate('XYZ98K')).toBe(true);
    expect(validatePlate('ABC-12D')).toBe(true);
  });
  it('acepta placas de carro sin guion', () => {
    expect(validatePlate('ABC123')).toBe(true);
  });
  it('sigue rechazando lo que no es una placa', () => {
    expect(validatePlate('abc12d')).toBe(false);
    expect(validatePlate('ABC1D2')).toBe(false);
    expect(validatePlate('AB12CD')).toBe(false);
    expect(validatePlate('ABC12DE')).toBe(false);
    expect(validatePlate('ABC--123')).toBe(false);
  });
  it('validateVehicleFields deja registrar una moto', () => {
    const r = validateVehicleFields(baseVehicle({ plate: 'ABC12D' }));
    expect(r.ok).toBe(true);
  });
});

describe('validatePlate / normalizePlate — placas chilenas', () => {
  // La primera entrega es una flota de volquetas en Chile (tenant flota-demo-chile, ZZBC-11).
  // Antes la API rechazaba crear o editar cualquier camión chileno.
  it('acepta el formato actual ABCD-12, con o sin guion', () => {
    expect(validatePlate('ZZBC-11')).toBe(true);
    expect(validatePlate('ZZBC11')).toBe(true);
    expect(validatePlate('ABCD-12')).toBe(true);
    expect(validatePlate('BBDF-99')).toBe(true);
  });

  it('acepta el formato antiguo AB-1234, con o sin guion', () => {
    expect(validatePlate('AB-1234')).toBe(true);
    expect(validatePlate('AB1234')).toBe(true);
    expect(validatePlate('XY-0001')).toBe(true);
  });

  it('normaliza a mayúsculas con guion', () => {
    expect(normalizePlate('zzbc11')).toBe('ZZBC-11');
    expect(normalizePlate('ZZBC11')).toBe('ZZBC-11');
    expect(normalizePlate('zzbc-11')).toBe('ZZBC-11');
    expect(normalizePlate('  ZzBc-11 ')).toBe('ZZBC-11');
    expect(normalizePlate('ZZ·BC·11')).toBe('ZZBC-11');
    expect(normalizePlate('zz bc 11')).toBe('ZZBC-11');
    expect(normalizePlate('ab1234')).toBe('AB-1234');
    expect(normalizePlate('AB-1234')).toBe('AB-1234');
  });

  it('no altera las placas colombianas/Mercosur salvo las mayúsculas', () => {
    expect(normalizePlate('ABC123')).toBe('ABC123');
    expect(normalizePlate('ABC-123')).toBe('ABC-123');
    expect(normalizePlate('abc12d')).toBe('ABC12D');
    expect(normalizePlate('abc1d23')).toBe('ABC1D23');
    // Un espacio interno en una placa no chilena sigue siendo inválido.
    expect(validatePlate(normalizePlate('ABC 123'))).toBe(false);
  });

  it('rechaza lo que no es una placa chilena', () => {
    expect(validatePlate('zzbc-11')).toBe(false); // sin normalizar: minúsculas
    expect(validatePlate('ZZBC-1')).toBe(false); // 1 dígito
    expect(validatePlate('ZZBC-111')).toBe(false); // 3 dígitos
    expect(validatePlate('ZZBCD-11')).toBe(false); // 5 letras
    expect(validatePlate('ZZB1-11')).toBe(false); // dígito entre las letras
    expect(validatePlate('A-12345')).toBe(false); // 1 letra
    expect(validatePlate('AB-12345')).toBe(false); // 5 dígitos
    expect(validatePlate('AB--1234')).toBe(false); // guion doble
    expect(validatePlate('ZZBC_11')).toBe(false);
    expect(validatePlate(normalizePlate('ZZBC-11!'))).toBe(false);
    expect(validatePlate(normalizePlate('ZZ-BC-11'))).toBe(false); // guion en medio de las letras
  });

  it('validateVehicleFields acepta un camión chileno, también en minúsculas', () => {
    expect(validateVehicleFields(baseVehicle({ plate: 'ZZBC-11', type: 'volqueta' })).ok).toBe(true);
    expect(validateVehicleFields(baseVehicle({ plate: 'zzbc11', type: 'volqueta' })).ok).toBe(true);
    expect(validateVehicleFields(baseVehicle({ plate: 'AB-1234' })).ok).toBe(true);
    const bad = validateVehicleFields(baseVehicle({ plate: 'ZZBC-1' }));
    expect(bad.ok).toBe(false);
    expect(bad.errors.some((e) => e.includes('plate inválida'))).toBe(true);
  });
});

describe('validatePlate (W11.02)', () => {
  it('accepts Colombia classic format [A-Z]{3}-\\d{3}', () => {
    expect(validatePlate('ABC-123')).toBe(true);
    expect(validatePlate('XYZ-999')).toBe(true);
  });

  it('accepts Mercosur format [A-Z]{3}\\d[A-Z]\\d{2}', () => {
    expect(validatePlate('ABC1D23')).toBe(true);
    expect(validatePlate('XYZ9Z99')).toBe(true);
  });

  it('rejects lowercase plates', () => {
    expect(validatePlate('abc-123')).toBe(false);
    expect(validatePlate('abc1d23')).toBe(false);
    expect(validatePlate('Abc-123')).toBe(false);
  });

  it('rejects wrong format plates', () => {
    // AB-1234 y ABCD-12 ya no van aquí: son placas chilenas válidas (ver bloque Chile).
    expect(validatePlate('AB-123')).toBe(false); // wrong length
    expect(validatePlate('ABC1234')).toBe(false); // missing dash, 6 chars
    expect(validatePlate('ABCD123')).toBe(false); // 4 letters no dash, 7 chars
  });

  it('rejects empty plate', () => {
    expect(validatePlate('')).toBe(false);
  });

  it('rejects plate with special chars or spaces', () => {
    expect(validatePlate('ABC-12!')).toBe(false);
    expect(validatePlate('ABC 123')).toBe(false); // space no permitido
    expect(validatePlate('ABC_123')).toBe(false); // underscore no permitido
  });
});

describe('validateVehicleFields (W11.02)', () => {
  const full = baseVehicle();

  it('passes a complete valid vehicle', () => {
    const r = validateVehicleFields(full);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('catches year out of range (too old / future)', () => {
    const tooOld = validateVehicleFields({ ...full, year: 1899 });
    expect(tooOld.ok).toBe(false);
    expect(tooOld.errors.some((e) => e.includes('year'))).toBe(true);

    const nextYear = new Date().getFullYear() + 2;
    const tooFuture = validateVehicleFields({ ...full, year: nextYear });
    expect(tooFuture.ok).toBe(false);
    expect(tooFuture.errors.some((e) => e.includes('year'))).toBe(true);
  });

  it('catches empty make / model / fleetId', () => {
    const noMake = validateVehicleFields({ ...full, make: '' });
    expect(noMake.ok).toBe(false);
    expect(noMake.errors.some((e) => e.includes('make'))).toBe(true);

    const noModel = validateVehicleFields({ ...full, model: '' });
    expect(noModel.ok).toBe(false);
    expect(noModel.errors.some((e) => e.includes('model'))).toBe(true);

    const noFleet = validateVehicleFields({ ...full, fleetId: '' });
    expect(noFleet.ok).toBe(false);
    expect(noFleet.errors.some((e) => e.includes('fleetId'))).toBe(true);
  });

  it('catches invalid VIN and plate', () => {
    const badVin = validateVehicleFields({ ...full, vin: 'TOO_SHORT' });
    expect(badVin.ok).toBe(false);
    expect(badVin.errors.some((e) => e.includes('vin'))).toBe(true);

    const badPlate = validateVehicleFields({ ...full, plate: 'invalid' });
    expect(badPlate.ok).toBe(false);
    expect(badPlate.errors.some((e) => e.includes('plate'))).toBe(true);
  });

  it('accepts vehicle with optional fields blank', () => {
    const r = validateVehicleFields({
      ...baseVehicle(),
      type: '',
      capacity: undefined,
      soatExpiry: '',
      tecnoExpiry: '',
      photoUrl: '',
    });
    expect(r.ok).toBe(true);
  });
});

describe('vehicle CRUD (W11.02)', () => {
  beforeEach(() => {
    getMemoryAdapter().clear();
    setStorageAdapter(getMemoryAdapter());
  });

  it('create → list → get → update → delete lifecycle', async () => {
    const created = await createVehicle(baseVehicle({ plate: 'AAA-111' }), 'inst-life');
    expect(created.id).toBeTruthy();
    expect(created.plate).toBe('AAA-111');
    expect(created.vin).toBe('1HGCR2F83HA000000');
    expect(created.instance_id).toBe('inst-life');
    expect(created.status).toBe('active');

    const list = await listVehicles('inst-life');
    expect(list).toHaveLength(1);

    const got = await getVehicle(created.id, 'inst-life');
    expect(got?.make).toBe('Tesla');

    const updated = await updateVehicle(created.id, { make: 'Ford' }, 'inst-life');
    expect(updated?.make).toBe('Ford');

    expect(await deleteVehicle(created.id, 'inst-life')).toBe(true);
    expect(await listVehicles('inst-life')).toHaveLength(0);
  });
});