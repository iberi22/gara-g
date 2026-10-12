/**
 * Marketplace Opt-In Control & Cloudflare KV Adapter
 *
 * Provides user configuration management for data marketplace offers,
 * schedule filtering, category selection, minimum payout threshold,
 * and Cloudflare KV storage operations for PWA/edge nodes.
 */

export interface OptInSchedule {
  startHour: number; // 0 - 23
  endHour: number;   // 0 - 23
  daysOfWeek: number[]; // 0=Sunday, 1=Monday... 6=Saturday
}

export interface OptInPreferences {
  enabled: boolean;
  categories: string[];
  minPayoutGara: number;
  maxDistanceKm: number;
  schedule?: OptInSchedule;
  updatedAt: number;
}

export interface MarketplaceOffer {
  id: string;
  title: string;
  category: string;
  payoutGara: number;
  distanceKm: number;
  timestamp: number;
}

export const DEFAULT_OPT_IN_PREFERENCES: OptInPreferences = {
  enabled: true,
  categories: ['telemetry', 'traffic_density', 'road_hazards', 'new_listings', 'deals'],
  minPayoutGara: 10.0,
  maxDistanceKm: 50.0,
  schedule: {
    startHour: 0,
    endHour: 24,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  },
  updatedAt: Date.now(),
};

/**
 * Interface representing Cloudflare KV namespace behavior
 */
export interface CloudflareKVNamespace {
  get(key: string, type?: 'text' | 'json'): Promise<any>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Key-Value adapter for managing marketplace offers & preferences on Cloudflare KV
 */
export class MarketplaceKVAdapter {
  private kvStore: Map<string, string> | CloudflareKVNamespace;
  private isCloudflareBinding: boolean;

  constructor(kvBinding?: CloudflareKVNamespace) {
    if (kvBinding) {
      this.kvStore = kvBinding;
      this.isCloudflareBinding = true;
    } else {
      this.kvStore = new Map<string, string>();
      this.isCloudflareBinding = false;
    }
  }

  /**
   * Fetch opt-in preferences for a user
   */
  async getPreferences(userId: string): Promise<OptInPreferences> {
    const key = `optin:prefs:${userId}`;
    if (this.isCloudflareBinding) {
      const data = await (this.kvStore as CloudflareKVNamespace).get(key, 'json');
      return data || DEFAULT_OPT_IN_PREFERENCES;
    } else {
      const data = (this.kvStore as Map<string, string>).get(key);
      return data ? JSON.parse(data) : DEFAULT_OPT_IN_PREFERENCES;
    }
  }

  /**
   * Save user opt-in preferences
   */
  async savePreferences(userId: string, prefs: Partial<OptInPreferences>): Promise<OptInPreferences> {
    const key = `optin:prefs:${userId}`;
    const current = await this.getPreferences(userId);
    const updated: OptInPreferences = {
      ...current,
      ...prefs,
      updatedAt: Date.now(),
    };

    if (this.isCloudflareBinding) {
      await (this.kvStore as CloudflareKVNamespace).put(key, JSON.stringify(updated));
    } else {
      (this.kvStore as Map<string, string>).set(key, JSON.stringify(updated));
    }

    return updated;
  }

  /**
   * Save marketplace offer
   */
  async saveOffer(offer: MarketplaceOffer, ttlSeconds: number = 86400): Promise<void> {
    const key = `marketplace:offer:${offer.id}`;
    if (this.isCloudflareBinding) {
      await (this.kvStore as CloudflareKVNamespace).put(key, JSON.stringify(offer), {
        expirationTtl: ttlSeconds,
      });
    } else {
      (this.kvStore as Map<string, string>).set(key, JSON.stringify(offer));
    }
  }

  /**
   * Fetch marketplace offer by ID
   */
  async getOffer(offerId: string): Promise<MarketplaceOffer | null> {
    const key = `marketplace:offer:${offerId}`;
    if (this.isCloudflareBinding) {
      return await (this.kvStore as CloudflareKVNamespace).get(key, 'json');
    } else {
      const data = (this.kvStore as Map<string, string>).get(key);
      return data ? JSON.parse(data) : null;
    }
  }
}

/**
 * Filter Marketplace Offers according to Opt-In & Schedule preferences
 */
export function isOfferMatchingOptIn(
  offer: MarketplaceOffer,
  prefs: OptInPreferences,
  date: Date = new Date()
): boolean {
  // Check if opt-in is enabled
  if (!prefs.enabled) {
    return false;
  }

  // Check category match
  if (!prefs.categories.includes(offer.category)) {
    return false;
  }

  // Check minimum payout threshold
  if (offer.payoutGara < prefs.minPayoutGara) {
    return false;
  }

  // Check maximum distance threshold
  if (offer.distanceKm > prefs.maxDistanceKm) {
    return false;
  }

  // Check schedule if present
  if (prefs.schedule) {
    const currentDay = date.getDay(); // 0-6
    const currentHour = date.getHours(); // 0-23

    if (!prefs.schedule.daysOfWeek.includes(currentDay)) {
      return false;
    }

    if (prefs.schedule.startHour <= prefs.schedule.endHour) {
      if (currentHour < prefs.schedule.startHour || currentHour >= prefs.schedule.endHour) {
        return false;
      }
    } else {
      // Overnight schedule e.g., 22:00 to 06:00
      if (currentHour < prefs.schedule.startHour && currentHour >= prefs.schedule.endHour) {
        return false;
      }
    }
  }

  return true;
}
