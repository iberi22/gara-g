/**
 * /api/ai/infer.ts — Contrato de inferencia AI para AUI (Agentic UI) y Billing Socio.
 *
 * POST /api/ai/infer
 * Body: { prompt: string, tierId?: string, mode?: string, appId?: string }
 * Response: { text: string, tokensUsed: number, cost: number, spec?: AuiSpec }
 *
 * Gating Socio:
 * - tierId === 'free' || tierId === 'mesh-only' -> 402 Payment Required (solo socio/payg tiene acceso a cloud AI)
 * - Offline-first fallback con Yjs/IndexedDB structure en caso de no tener Worker AI binding activo.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { AuiSpec } from '../../../lib/aui';
import { cloud } from '../../../cloud';

const { isMeshOnlyMode } = cloud.billing;

export const prerender = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export const OPTIONS: APIRoute = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const POST: APIRoute = async ({ request }) => {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'JSON inválido' }, 400);
    }

    const { prompt = '', tierId = 'payg', mode = 'swal-managed', appId = 'gara-g' } = body ?? {};

    if (!prompt || typeof prompt !== 'string') {
      return jsonResponse({ error: 'prompt requerido' }, 400);
    }

    // 1. Socio Gate check: Inferencia AI cloud sólo disponible para tiers de pago (payg, socio, etc.)
    if (tierId === 'free' || tierId === 'mesh-only' || isMeshOnlyMode(mode)) {
      return jsonResponse(
        {
          error: 'Inferencia AI requiere cuenta tipo Socio (payg o payg-managed)',
          detail: 'El tier gratuito o mesh-only no incluye cuota de inferencia cloud.',
          tierId,
        },
        402
      );
    }

    // 2. Intentar usar Cloudflare Workers AI si el binding está presente
    const cfAi = (env as unknown as { AI?: { run: (model: string, opts: unknown) => Promise<any> } })?.AI;
    if (cfAi) {
      try {
        const result = await cfAi.run('@cf/meta/llama-3.1-70b-instruct', {
          messages: [
            {
              role: 'system',
              content: 'Eres el motor AUI de GARA-G. Genera SOLO JSON válido de tipo AuiSpec version 1.',
            },
            { role: 'user', content: prompt },
          ],
        });

        const rawText = result?.response ?? '';
        let parsedSpec: AuiSpec | undefined;
        try {
          parsedSpec = JSON.parse(rawText);
        } catch {}

        const tokensUsed = Math.max(25, Math.ceil((prompt.length + rawText.length) / 4));
        const cost = Number((tokensUsed * 0.00001).toFixed(6));

        return jsonResponse({
          text: rawText,
          tokensUsed,
          cost,
          spec: parsedSpec,
          model: '@cf/meta/llama-3.1-70b-instruct',
          via: 'cf-workers-ai',
        });
      } catch (cfErr) {
        console.warn('[api/ai/infer] Error en Workers AI, recurriendo a mock offline-first:', cfErr);
      }
    }

    // 3. Fallback determinístico offline-first / mock con contrato AuiSpec v1
    const lowerPrompt = prompt.toLowerCase();
    const isMaintenance = lowerPrompt.includes('manten') || lowerPrompt.includes('taller');
    const isAlerts = lowerPrompt.includes('alerta') || lowerPrompt.includes('critic');

    const generatedSpec: AuiSpec = {
      version: 1,
      theme: {
        accent: '#00e5ff',
        bg: '#0d0d10',
        radius: '8px',
      },
      copy: {
        title: isMaintenance
          ? 'Panel Inteligente de Mantenimiento'
          : isAlerts
          ? 'Monitor de Alertas y Telemetría Crítica'
          : 'Vista Resumen del Parque Automotor',
        subtitle: `Generado por AUI Ingestion Engine · Prompt: "${prompt.slice(0, 48)}${prompt.length > 48 ? '...' : ''}"`,
      },
      components: [
        {
          id: 'card-kpi-1',
          type: 'Card',
          props: {
            title: isMaintenance ? 'Próximos Servicios' : isAlerts ? 'Alertas Activas' : 'Disponibilidad de Flota',
            content: isMaintenance
              ? '4 vehículos programados para revisión de 50.000 km este mes.'
              : isAlerts
              ? '2 alertas de velocidad alta reportadas en las últimas 3 horas.'
              : '94% de unidades operativas en ruta. 12 activas, 1 en taller.',
          },
        },
        {
          id: 'badge-status-1',
          type: 'StatusBadge',
          props: {
            label: isAlerts ? 'Atención Requerida' : 'Operación Normal',
            status: isAlerts ? 'warning' : 'success',
          },
        },
        {
          id: 'badge-edge-1',
          type: 'Badge',
          props: {
            label: 'Nodo Edge: Activo (P2P + D1 Sync)',
          },
        },
        {
          id: 'table-summary-1',
          type: 'Table',
          props: {
            headers: ['Unidad', 'Estado', 'Último Registro'],
            rows: [
              ['FL-01 (Toyota Hilux)', 'Activo', 'Hace 2 min'],
              ['FL-02 (Chevrolet NPR)', 'Activo', 'Hace 5 min'],
              ['FL-03 (Kenworth T800)', isMaintenance ? 'En Taller' : 'Activo', 'Hace 12 min'],
            ],
          },
        },
        {
          id: 'btn-action-1',
          type: 'Button',
          props: {
            label: 'Exportar Reporte a Bóveda',
          },
        },
      ],
    };

    const tokensUsed = 120;
    const cost = 0.0012;

    return jsonResponse({
      text: JSON.stringify(generatedSpec),
      tokensUsed,
      cost,
      spec: generatedSpec,
      model: 'offline-mock-fallback',
      via: 'local-fallback',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/ai/infer] Excepción no controlada:', msg);
    return jsonResponse({ error: 'Error interno en inferencia', detail: msg }, 500);
  }
};
