/**
 * src/cloud/types.ts — Contract between the app and the OPTIONAL cloud module.
 *
 * GARA-G is local-first: every vehicle, fleet and document lives on the device and the app
 * works with no backend. Paid cloud features (billing, payments, market settlement, on-chain
 * anchoring) are a separate, private module. The app only talks to them through this
 * interface; the default implementation (./local.ts) turns all of them off.
 */
import type { APIContext } from 'astro';
import type { SealedPack } from '../lib/sealedPack';

export interface CreditStatus {
  used: number;
  limit: number;
  [key: string]: unknown;
}

export interface CloudInferenceResult {
  text: string;
  tokensUsed: number;
  cost: number;
}

export interface CloudBilling {
  /** Can this tier spend `estimatedTokens` more on cloud inference? */
  canAffordInference(estimatedTokens: number, used: number, tierId?: string): boolean;
  creditStatus(used: number, tierId?: string): CreditStatus;
  /** Workers AI through the billed proxy. `null` = not available, use the local fallback. */
  cfAiInfer(
    prompt: string,
    opts?: { tierId?: string; mode?: string; estimatedTokens?: number },
  ): Promise<CloudInferenceResult | null>;
  /** Free / mesh-only plans never use cloud inference. */
  isMeshOnlyMode(mode: string): boolean;
}

/** Opaque result of anchoring a sealed pack's hash on a chain. */
export type AnchorResult = { targetChain: string; [key: string]: unknown };

export interface CloudModule {
  /** `false` in the public build: no billing, no payments, no anchoring. */
  readonly enabled: boolean;
  readonly billing: CloudBilling;
  readonly anchor: {
    /** Anchors the content hash of a sealed pack. `undefined` when cloud is off. */
    registerOnPolygon(pack: SealedPack, bus?: unknown): AnchorResult | undefined;
  };
  readonly routes: {
    /** POST /api/webhooks/stripe. Local implementation: 404 "cloud disabled". */
    stripeWebhook(ctx: APIContext): Response | Promise<Response>;
  };
}
