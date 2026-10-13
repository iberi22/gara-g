/**
 * driver.ts — Driver domain helpers and computed status validation.
 *
 * El campo de identificacion se llama `cedula` porque el modelo nacio en Colombia; en Chile
 * guarda un RUT. El NOMBRE del campo no cambia (renombrarlo rompe las filas guardadas y la
 * API); lo que cambia es como se etiqueta y se valida, ver `lib/market.ts` y `lib/rut.ts`.
 */
import { MARKET, type MarketConfig } from './market';
import { formatRut, isValidRut } from './rut';

export interface DriverData {
  id?: string;
  name: string;
  /** Identificacion del conductor: RUT en Chile, cedula en Colombia. */
  cedula: string;
  licenseCategory: string;
  licenseExpiry: string;
  phone: string;
  status: 'active' | 'on_leave' | 'suspended' | 'expired' | string;
  fleetId: string;
  vehicleId: string;
}

/**
 * ¿El valor es una identificacion valida en este mercado?
 * En Chile exige RUT con digito verificador (modulo 11); en Colombia, solo que no este vacio
 * (la cedula no trae DV).
 */
export function isValidDriverId(value: unknown, market: MarketConfig = MARKET): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  return market.id === 'CL' ? isValidRut(value) : true;
}

/**
 * Identificacion del conductor lista para mostrar: en Chile un RUT VALIDO se agrupa con
 * puntos y guion (`12.345.678-5`). Cualquier otro valor se muestra tal cual: una cedula
 * colombiana no se reescribe con un digito verificador que no le corresponde, y un dato del
 * usuario nunca se descarta.
 */
export function formatDriverId(value: unknown, market: MarketConfig = MARKET): string {
  const raw = value === undefined || value === null ? '' : String(value);
  if (raw === '') return '—';
  if (market.id !== 'CL' || !isValidRut(raw)) return raw;
  return formatRut(raw);
}

/**
 * Computes the driver's current operational status.
 * If licenseExpiry is in the past, status is automatically evaluated as 'expired'.
 */
export function computeDriverStatus(driver: { status?: string; licenseExpiry?: string }): string {
  if (driver.licenseExpiry) {
    const expiryDate = new Date(driver.licenseExpiry);
    const now = new Date();
    if (!isNaN(expiryDate.getTime()) && expiryDate < now) {
      return 'expired';
    }
  }
  return driver.status || 'active';
}
