/**
 * src/pages/api/xavier/health.ts — comprueba si Xavier está vivo, desde el servidor.
 *
 * Antes esto se comprobaba desde el navegador (probeXavierHealth contra
 * localhost:8006), así que en producción siempre daba "inactivo". Desde el Worker
 * el resultado es real.
 */
import type { APIRoute } from 'astro';
import { callXavier } from './_proxy';

export const prerender = false;

export const GET: APIRoute = async () => {
  const result = await callXavier('/health', { method: 'GET' });
  return new Response(result.body, {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
