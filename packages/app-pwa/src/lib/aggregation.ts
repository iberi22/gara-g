/**
 * Privacy-preserving Data Aggregation & Differential Privacy (DP) Laplace Noise Generator
 *
 * Implements k-anonymity filtering, Laplace noise injection for DP,
 * and H3 cell traffic density heatmap generation for marketplace aggregation.
 */

export interface DpParams {
  /** Epsilon privacy budget (smaller = more privacy) */
  epsilon: number;
  /** Delta parameter */
  delta: number;
  /** Query sensitivity */
  sensitivity: number;
}

export const DEFAULT_DP_PARAMS: DpParams = {
  epsilon: 1.0,
  delta: 1e-6,
  sensitivity: 1.0,
};

export interface TrafficReading {
  h3Index: string;
  density: number;
  timestamp: number;
}

export interface HeatmapCell {
  h3Index: string;
  value: number;
  contributorCount: number;
}

export interface HeatmapData {
  resolution: number;
  cells: HeatmapCell[];
  privacyParams: DpParams;
}

export class DataAggregator {
  private dpParams: DpParams;
  private kAnonymity: number;

  constructor(dpParams: DpParams = DEFAULT_DP_PARAMS, kAnonymity: number = 3) {
    this.dpParams = dpParams;
    this.kAnonymity = kAnonymity;
  }

  /**
   * Calculate Laplace noise for Differential Privacy:
   * noise = -scale * sgn(u) * ln(1 - 2|u|) where u ~ Uniform(-0.5, 0.5)
   */
  public generateLaplaceNoise(): number {
    const scale = this.dpParams.sensitivity / this.dpParams.epsilon;
    const u = Math.random() - 0.5;
    const sgn = u >= 0 ? 1 : -1;
    const term = Math.max(1e-15, 1.0 - 2.0 * Math.abs(u));
    return -scale * sgn * Math.log(term);
  }

  /**
   * Aggregate numeric sum with DP noise if k-anonymity threshold is met
   */
  public aggregateSum(values: number[]): number | null {
    if (values.length < this.kAnonymity) {
      return null; // Suppressed under k-anonymity
    }

    const trueSum = values.reduce((acc, val) => acc + val, 0);
    const noise = this.generateLaplaceNoise();

    return trueSum + noise;
  }

  /**
   * Aggregate average with DP noise if k-anonymity threshold is met
   */
  public aggregateAvg(values: number[]): number | null {
    if (values.length < this.kAnonymity) {
      return null; // Suppressed under k-anonymity
    }

    const trueAvg = values.reduce((acc, val) => acc + val, 0) / values.length;
    const noise = this.generateLaplaceNoise() / values.length;

    return trueAvg + noise;
  }

  /**
   * Generate aggregated, anonymized heatmap data from telemetry/traffic readings
   */
  public createHeatmap(readings: TrafficReading[], h3Resolution: number = 8): HeatmapData {
    const byHex = new Map<string, number[]>();

    for (const r of readings) {
      if (!byHex.has(r.h3Index)) {
        byHex.set(r.h3Index, []);
      }
      byHex.get(r.h3Index)!.push(r.density);
    }

    const cells: HeatmapCell[] = [];

    for (const [hex, densities] of byHex.entries()) {
      const avg = this.aggregateAvg(densities);
      if (avg !== null) {
        cells.push({
          h3Index: hex,
          value: avg,
          contributorCount: densities.length,
        });
      }
    }

    return {
      resolution: h3Resolution,
      cells,
      privacyParams: this.dpParams,
    };
  }
}
