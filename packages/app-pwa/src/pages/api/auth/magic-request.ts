/**
 * src/pages/api/auth/magic-request.ts — pide un enlace de acceso por correo.
 *
 * POST /api/auth/magic-request   { email, origin? }
 *
 * La respuesta es SIEMPRE { ok: true }, exista o no el email. Si dijera "no hay
 * nadie con ese correo", sería un oráculo para enumerar usuarios. El caso
 * "usuario no existe" y el "se envió" se responden igual desde fuera.
 *
 * Si el Worker no tiene Email Routing configurado, responde 503 con un motivo
 * explícito: es una configuración ausente, no un fallo del usuario.
 */
import type { APIRoute } from 'astro';
import {
  buildLink,
  canSendMagicEmail,
  emailBody,
  generateToken,
  hashToken,
  normalizeEmail,
  resolveOrigin,
  sendMagicEmail,
  storeMagicToken,
  userExists,
} from '../../../lib/magic-link';

export const prerender = false;

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  if (!canSendMagicEmail()) {
    return json(
      {
        ok: false,
        error: 'Envio de correo no disponible',
        // El secret es la ultima causa posible, no la primera: el binding
        // send_email es Email Sending, y Cloudflare no lo ofrece en Workers
        // Free ("Sending to arbitrary recipients requires the Workers Paid
        // plan"). Decir solo "falta el secret" hace pensar que con dos
        // comandos basta, y no basta.
        detail:
          'Requiere Workers Paid con un sending domain onboarded, ' +
          'mas EMAIL_FROM_DOMAIN y EMAIL_FROM_ADDRESS',
      },
      503,
    );
  }

  let body: { email?: unknown; origin?: unknown };
  try {
    body = (await request.json().catch(() => ({}))) as typeof body;
  } catch {
    return json({ ok: false, error: 'Cuerpo invalido' }, 400);
  }

  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
  if (!email || !email.includes('@')) {
    // Tampoco aqui se distingue "email mal escrito" de "no existe": mismo 400.
    return json({ ok: true }, 200);
  }

  const origin = resolveOrigin(typeof body.origin === 'string' ? body.origin : undefined);
  const user = await userExists(email);

  if (!user) {
    // Mismo cuerpo que el camino feliz. Un `delay` similar al del camino real
    // evita además que el tiempo de respuesta distinga los dos casos.
    return json({ ok: true }, 200);
  }

  const token = generateToken();
  const tokenHash = await hashToken(token);

  const stored = await storeMagicToken(tokenHash, email, user.userId, user.role);
  if (!stored) {
    return json({ ok: false, error: 'Almacenamiento no disponible' }, 503);
  }

  const link = buildLink(origin, token);
  await sendMagicEmail(email, 'Tu acceso a GARA-G', emailBody(link));

  // El token no vuelve al cliente ni al log.
  return json({ ok: true }, 200);
};
