import { describe, it, expect } from 'vitest';
import {
  MarketplaceKVAdapter,
  isOfferMatchingOptIn,
  DEFAULT_OPT_IN_PREFERENCES,
  MarketplaceOffer,
  OptInPreferences,
} from '../src/lib/marketplaceOptIn';
import {
  DataAggregator,
  DEFAULT_DP_PARAMS,
  TrafficReading,
} from '../src/lib/aggregation';

describe('Marketplace Opt-In & KV Adapter Unit Tests', () => {
  it('should store and retrieve preferences via KV adapter', async () => {
    const adapter = new MarketplaceKVAdapter();
    const prefs = await adapter.getPreferences('user_1');
    expect(prefs).toEqual(DEFAULT_OPT_IN_PREFERENCES);
    expect(prefs.enabled).toBe(false);
    expect(prefs.categories).toEqual([]);

    const updated = await adapter.savePreferences('user_1', {
      minPayoutGara: 25.0,
      categories: ['telemetry'],
    });

    expect(updated.minPayoutGara).toBe(25.0);
    expect(updated.categories).toEqual(['telemetry']);

    const fetched = await adapter.getPreferences('user_1');
    expect(fetched.minPayoutGara).toBe(25.0);
  });

  it('should store and retrieve marketplace offers', async () => {
    const adapter = new MarketplaceKVAdapter();
    const offer: MarketplaceOffer = {
      id: 'offer_101',
      title: 'High Density Telemetry NYC',
      category: 'telemetry',
      payoutGara: 50.0,
      distanceKm: 12.0,
      timestamp: Date.now(),
    };

    await adapter.saveOffer(offer);
    const fetched = await adapter.getOffer('offer_101');
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe('offer_101');
    expect(fetched?.payoutGara).toBe(50.0);
  });

  it('should match offer based on categories, minPayout, and distance', () => {
    const offer: MarketplaceOffer = {
      id: 'offer_1',
      title: 'Test Offer',
      category: 'telemetry',
      payoutGara: 15.0,
      distanceKm: 10.0,
      timestamp: Date.now(),
    };

    const prefs: OptInPreferences = {
      ...DEFAULT_OPT_IN_PREFERENCES,
      minPayoutGara: 10.0,
      maxDistanceKm: 20.0,
    };

    expect(isOfferMatchingOptIn(offer, prefs)).toBe(false);

    const enabledPrefs: OptInPreferences = {
      ...prefs,
      enabled: true,
      categories: ['telemetry']
    };

    expect(isOfferMatchingOptIn(offer, enabledPrefs)).toBe(true);

    // Below min payout
    expect(isOfferMatchingOptIn({ ...offer, payoutGara: 5.0 }, enabledPrefs)).toBe(false);

    // Category mismatch
    expect(isOfferMatchingOptIn({ ...offer, category: 'unknown' }, enabledPrefs)).toBe(false);

    // Exceeds max distance
    expect(isOfferMatchingOptIn({ ...offer, distanceKm: 30.0 }, enabledPrefs)).toBe(false);
  });
});

describe('DP Aggregation & Heatmap Unit Tests', () => {
  it('should enforce k-anonymity threshold on aggregateSum and aggregateAvg', () => {
    const aggregator = new DataAggregator(DEFAULT_DP_PARAMS, 3);

    // Under k-anonymity threshold (2 < 3)
    const smallValues = [10.0, 20.0];
    expect(aggregator.aggregateSum(smallValues)).toBeNull();
    expect(aggregator.aggregateAvg(smallValues)).toBeNull();

    // Meets k-anonymity threshold (3 >= 3)
    const validValues = [10.0, 20.0, 30.0];
    const sumResult = aggregator.aggregateSum(validValues);
    const avgResult = aggregator.aggregateAvg(validValues);

    expect(sumResult).not.toBeNull();
    expect(avgResult).not.toBeNull();
    expect(typeof sumResult).toBe('number');
    expect(typeof avgResult).toBe('number');
  });

  it('should generate finite Laplace noise', () => {
    const aggregator = new DataAggregator(DEFAULT_DP_PARAMS, 1);
    for (let i = 0; i < 50; i++) {
      const noise = aggregator.generateLaplaceNoise();
      expect(Number.isFinite(noise)).toBe(true);
    }
  });

  it('should group by H3 index and create anonymized heatmap data', () => {
    const aggregator = new DataAggregator(DEFAULT_DP_PARAMS, 2);
    const readings: TrafficReading[] = [
      { h3Index: '882a100891fffff', density: 40.0, timestamp: 100 },
      { h3Index: '882a100891fffff', density: 50.0, timestamp: 105 },
      { h3Index: '882a100893fffff', density: 10.0, timestamp: 100 }, // dropped (1 < k 2)
    ];

    const heatmap = aggregator.createHeatmap(readings, 8);
    expect(heatmap.resolution).toBe(8);
    expect(heatmap.cells.length).toBe(1);
    expect(heatmap.cells[0].h3Index).toBe('882a100891fffff');
    expect(heatmap.cells[0].contributorCount).toBe(2);
  });
});
