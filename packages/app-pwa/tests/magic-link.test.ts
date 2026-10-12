import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * tests/magic-link.test.ts — el acceso sin contraseña es de un solo uso y cerrado.
 *
 * Cubre lo que hace que un enlace mágico sea aceptable: que no se pueda adivinar,
 * que no sirva dos veces, que no sea un oráculo de enumeración de usuarios y que
 * el enlace no se pueda redirigir a un dominio elegido por el atacante.
 */
import { describe, expect, it } from 'vitest';

/** Sin comentarios: los docstrings citan la regla a proposito. */
function code(only: string): string {
  return only.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const ROOT = resolve(import.meta.dirname, '..');
const LIB = readFileSync(resolve(ROOT, 'src/lib/magic-link.ts'), 'utf-8');
const REQ = readFileSync(resolve(ROOT, 'src/pages/api/auth/magic-request.ts'), 'utf-8');
const MAGIC = readFileSync(resolve(ROOT, 'src/pages/api/auth/magic.ts'), 'utf-8');

describe('el token es de un solo uso y no se adivina', () => {
  it('nunca usa Math.random para el token', () => {
    expect(code(LIB)).not.toMatch(/Math\.random/);
    expect(LIB).toMatch(/crypto\.randomUUID\(\)/);
    expect(LIB).toMatch(/crypto\.getRandomValues/);
  });

  it('guarda el hash del token, no el token', () => {
    // Un volcado de KV no debe permitir autenticarse.
    // La libreria la ofrece; el endpoint de canje es quien la usa.
    expect(LIB).toMatch(/export async function hashToken/);
    expect(MAGIC).toMatch(/hashToken\(token\)/);
    expect(code(LIB)).toMatch(/REQUEST_PREFIX\}\$\{tokenHash\}/);
    expect(LIB).toMatch(/crypto\.subtle\.digest\('SHA-256'/);
  });

  it('el token tiene TTL corto', () => {
    expect(LIB).toMatch(/MAGIC_LINK_TTL\s*=\s*15\s*\*\s*60/);
  });

  it('canjear el token lo borra de KV', () => {
    expect(MAGIC).toMatch(/kv\.delete\(key\)/);
    // Y borra antes de crear la sesion, para que dos clicks simultaneos no
    // consigan ambos una sesion.
    const iDel = MAGIC.indexOf('kv.delete(key)');
    const iPut = MAGIC.indexOf('kv.put(`${SESSION_PREFIX}');
    expect(iDel).toBeGreaterThan(-1);
    expect(iPut).toBeGreaterThan(-1);
    expect(iDel, 'borra despues de crear la sesion').toBeLessThan(iPut);
  });

  it('el token borrado no vuelve a valer', () => {
    expect(MAGIC).toMatch(/if \(!raw\)\s*return redirect\('\/login\?error=invalid-link'\)/);
  });
});

describe('no hay oráculo de enumeración de usuarios', () => {
  it('la respuesta es la misma exista o no el email', () => {
    // Caminofeliz y camino "no existe" devuelven ambos { ok: true } sin cuerpo.
    expect(REQ).toMatch(/if \(!user\)[\s\S]{0,200}?json\(\s*\{\s*ok:\s*true\s*\},\s*200\s*\)/);
  });

  it('un email mal formado tampoco distingue', () => {
    expect(REQ).toMatch(/if \(!email[\s\S]{0,200}?json\(\s*\{\s*ok:\s*true\s*\},\s*200\s*\)/);
  });

  it('no responde 404 ni "usuario no encontrado"', () => {
    expect(code(REQ)).not.toMatch(/404/);
    expect(code(REQ)).not.toMatch(/no encontrado|not found|no existe/i);
  });

  it('el token nunca vuelve al cliente ni al log', () => {
    expect(REQ).not.toMatch(/console\.log[\s\S]{0,80}token/);
    expect(REQ).not.toMatch(/json\(\{[^}]*\btoken\b/);
  });
});

describe('el enlace no se puede redirigir a un dominio elegido por el atacante', () => {
  it('el origen sale de una lista permitida, no de la request', () => {
    expect(LIB).toMatch(/export function allowedOrigins/);
    expect(LIB).toMatch(/export function resolveOrigin/);
  });

  it('un origen no permitido cae al dominio de produccion', () => {
    expect(LIB).toMatch(/permitidos\.includes\(limpio\)\s*\?\s*limpio/);
    expect(LIB).toMatch(/: permitidos\[permitidos\.length - 1\]/);
  });

  it('produccion esta siempre en la lista permitida', () => {
    expect(LIB).toMatch(/https:\/\/gara-g\.swal\.network/);
  });
});

describe('el canje no filtra ni acepta destinos abiertos', () => {
  it('no dice por que fallo el token', () => {
    // Un unico error para token inexistente, caducado y ya usado.
    const errores = MAGIC.match(/error=([a-z-]+)/g) ?? [];
    const unicos = new Set(errores.map((e) => e.split('=')[1]));
    expect([...unicos].length, `errores distintos: ${[...unicos].join(', ')}`).toBe(1);
  });

  it('rechaza tokens demasiado cortos sin tocar KV', () => {
    expect(MAGIC).toMatch(/token\.length\s*<\s*32/);
  });

  it('la redireccion posterior al login es interna', () => {
    expect(MAGIC).toMatch(/startsWith\('\/'\)/);
    expect(MAGIC).toMatch(/!rawNext\.startsWith\('\/\/'\)/);
  });

  it('el tenant lo fija el servidor, no la peticion', () => {
    expect(MAGIC).not.toMatch(/searchParams\.get\(\s*['"]instanceId/);
    // El tenant sale de la constante canonica, no de un literal escrito aqui: el
    // valor vive en un solo sitio (lib/domain.config.ts) y este fichero lo importa.
    expect(MAGIC).toMatch(/instanceId:\s*DEFAULT_INSTANCE_ID/);
    expect(MAGIC).toMatch(
      /import\s*\{[^}]*DEFAULT_INSTANCE_ID[^}]*\}\s*from\s*['"][^'"]*domain\.config['"]/,
    );
    expect(MAGIC).not.toMatch(/instanceId:\s*'gara-g-default-instance'/);
  });

  it('la cookie de sesion sale con los atributos seguros', () => {
    expect(MAGIC).toMatch(/httpOnly:\s*true/);
    expect(MAGIC).toMatch(/secure:\s*true/);
    expect(MAGIC).toMatch(/sameSite:\s*'lax'/);
  });
});

describe('el envio de correo usa Cloudflare, sin proveedor externo', () => {
  it('envía con el binding send_email', () => {
    expect(LIB).toMatch(/send_email/);
  });

  it('no hay dependencias de correo externas', () => {
    const pkg = readFileSync(resolve(ROOT, 'package.json'), 'utf-8');
    for (const proveedor of ['resend', 'sendgrid', 'mailgun', 'nodemailer', 'postmark']) {
      expect(pkg.toLowerCase(), `${proveedor} no debe ser dependencia`).not.toMatch(
        new RegExp(proveedor),
      );
    }
  });

  it('si falta Email Routing responde 503 explicito', () => {
    // Es configuracion ausente, no fallo del usuario: no se finge el envio.
    expect(REQ).toMatch(/canSendMagicEmail\(\)/);
    expect(REQ).toMatch(/503/);
  });

  it('el HTML del correo va escapado', () => {
    // El escape vive en lib/html.ts desde que se unificaron las dos copias que
    // habia (esta private, que no cubria el apostrofo, y otra en un .astro).
    // El cuerpo se interpola dentro de <pre>, asi que tiene que pasar por ahi.
    expect(LIB).toMatch(/import\s*\{[^}]*escapeHtml[^}]*\}\s*from\s*['"][^'"]*html\.js['"]/);
    expect(LIB).toMatch(/escapeHtml\(body\)/);
    // Y no debe quedar una copia local que se lleve por delante la importada.
    expect(LIB).not.toMatch(/function escapeHtml/);
  });

  // El bloqueo NO es el secret.
  //
  // `send_email` es Email Sending, y Cloudflare no lo ofrece en Workers Free
  // ("Sending to arbitrary recipients requires the Workers Paid plan"). Un
  // mensaje de error que solo diga "falta EMAIL_FROM_DOMAIN" hace pensar que con
  // dos `wrangler secret put` el magic link funciona, y no: hace falta el plan.
  it('el 503 nombra el plan, no solo los secrets', () => {
    // Tiene que ser el literal que ve el cliente, no el fichero entero: si solo
    // se mira el texto completo, un comentario que mencione el plan haria pasar
    // el test con el mensaje viejo.
    const literales = [...REQ.matchAll(/'([^'\n]+)'/g)].map((m) => m[1]);
    // El mensaje se arma con varios literales concatenated, asi que se juntan
    // todos los que hablan del bloque de configuracion: eso es lo que recibe el
    // cliente.
    const detalle = literales
      .filter((s) => /EMAIL_FROM_DOMAIN|Workers Paid|Email Routing/.test(s))
      .join(' ');

    expect(detalle, 'debe haber un detalle del 503').not.toBe('');
    expect(detalle, 'debe decir que hace falta Workers Paid').toMatch(/Workers Paid/i);
    expect(detalle, 'no debe abrir con "falta el secret": no es la causa').not.toMatch(/^Falta\b/);
  });
});
