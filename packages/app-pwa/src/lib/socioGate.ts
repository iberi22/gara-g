/**
 * SWAL-GARA Socio Gate (Stripe Billing Infrastructure)
 * Socio status is determined by active Stripe billing for infrastructure (e.g., R2 quota).
 * Socio gate unlocks: Cloud Backup feature.
 */

export interface SocioBillingInfo {
  customerId: string;
  subscriptionId?: string;
  status: 'active' | 'triaing' | 'past_due' | 'canceled' | 'unpaid' | 'inactive';
  planTier?: 'basic' | 'pro' | 'enterprise' | 'socio_infra';
  r2StorageQuotaBytes?: number;
  r2StorageUsedBytes?: number;
  currentPeriodEnd?: number; // Unix timestamp in seconds
}

/**
 * Checks if socio infrastructure billing is active.
 * Gates cloud backup feature access.
 *
 * @param billing SocioBillingInfo | null | undefined
 */
export function isSocioActivo(billing?: SocioBillingInfo | null): boolean {
  if (!billing) {
    return false;
  }

  return billing.status === 'active';
}

/**
 * Gate check for Cloud Backup features.
 */
export function canAccessCloudBackup(billing?: SocioBillingInfo | null): boolean {
  return isSocioActivo(billing);
}
