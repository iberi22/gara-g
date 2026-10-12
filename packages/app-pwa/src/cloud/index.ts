/**
 * src/cloud/index.ts — The one entry point to the optional cloud module.
 *
 * `@gara/cloud-impl` is resolved at build time (cloud-overlay.mjs):
 *   - default (public build, tests, `private/` absent): ./local.ts — everything off;
 *   - `GARA_CLOUD=1` with the private overlay present: the real implementation
 *     (private/cloud/packages/app-pwa/src/cloud/impl.ts).
 * For type checking, tsconfig maps the alias to ./local.ts.
 */
import impl from '@gara/cloud-impl';
import type { CloudModule } from './types';

export type { CloudModule } from './types';
export { CLOUD_DISABLED, cloudDisabled } from './local';

export const cloud: CloudModule = impl;

/**
 * Cloud routes called by third parties WITHOUT a user session (signed webhooks). The middleware
 * opens them only while the cloud module is active; their handlers authenticate the caller
 * themselves (Stripe: HMAC signature + replay window, fail-closed without a secret). With the
 * local module they stay behind the session guard and the route itself answers 404.
 */
export const CLOUD_PUBLIC_PATHS: readonly string[] = ['/api/webhooks/stripe'];

export function isCloudPublicPath(pathname: string, mod: Pick<CloudModule, 'enabled'> = cloud): boolean {
  return mod.enabled && CLOUD_PUBLIC_PATHS.includes(pathname);
}
