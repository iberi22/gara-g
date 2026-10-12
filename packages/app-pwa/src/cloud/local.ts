/**
 * src/cloud/local.ts — Default cloud module: everything off, nothing leaves the device.
 *
 * Used by every build unless `GARA_CLOUD=1` and the private module is present (see
 * cloud-overlay.mjs). Routes answer 404 "cloud disabled"; inference falls back to the local
 * path; nothing is billed or anchored.
 */
import type { CloudModule } from './types';

export const CLOUD_DISABLED = 'cloud disabled';

/** 404 JSON for any cloud-only endpoint when the cloud module is not installed. */
export function cloudDisabled(): Response {
  return new Response(JSON.stringify({ error: CLOUD_DISABLED }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

const localCloud: CloudModule = {
  enabled: false,
  billing: {
    // No billing on the device: local inference is never metered.
    canAffordInference: () => true,
    creditStatus: (used) => ({ used, limit: Number.POSITIVE_INFINITY }),
    cfAiInfer: async () => null,
    isMeshOnlyMode: (mode) => mode === 'mesh-only' || mode === 'free',
  },
  anchor: {
    registerOnPolygon: () => undefined,
  },
  routes: {
    stripeWebhook: () => cloudDisabled(),
  },
};

export default localCloud;
