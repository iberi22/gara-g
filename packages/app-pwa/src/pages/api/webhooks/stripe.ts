/**
 * POST /api/webhooks/stripe — Payment webhook, served by the optional cloud module.
 *
 * Without the cloud module (public build) this answers 404 {"error":"cloud disabled"}:
 * GARA-G itself never bills or processes payments. See src/cloud/.
 */
import type { APIRoute } from 'astro';
import { cloud } from '../../../cloud';

export const prerender = false;

export const POST: APIRoute = (ctx) => cloud.routes.stripeWebhook(ctx);
