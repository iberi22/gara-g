/**
 * driver.ts — Driver domain helpers and computed status validation.
 */

export interface DriverData {
  id?: string;
  name: string;
  cedula: string;
  licenseCategory: string;
  licenseExpiry: string;
  phone: string;
  status: 'active' | 'on_leave' | 'suspended' | 'expired' | string;
  fleetId: string;
  vehicleId: string;
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
