import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * tests/production-config.test.ts — la config desplegada no puede abrir el backdoor.
 *
 * Contexto: los tres puntos donde antes existía un fallback a admin
 * (lib/session.ts:devAdminSession, fleetApi/auth.ts:devAdminUser, auth/login.ts:DEMO_USERS)
 * se activaban con `ENVIRONMENT !== 'production'`. Las dos sesiones de admin ahora exigen
 * además DEV_ADMIN_SESSION="true" y ENVIRONMENT development/local, pero ENVIRONMENT
 * sigue cerrando el resto (DEMO_USERS, tenant por query). Eso significa que el backdoor
 * reaparece si ENVIRONMENT se borra, se renombra o se despliega sin esa var.
 *
 * Estos tests leen el wrangler.toml real: fallan si alguien despliega sin la var,
 * que es el modo de fallo más fácil de no ver.
 */
import { describe, expect, it } from 'vitest';
import { wranglerToml } from '../../../scripts/infra-config.mjs';

const root = resolve(process.cwd(), '../..');
// wrangler.toml real -> private/infra -> wrangler.example.toml (scripts/infra-config.mjs): las
// mismas reglas valen para la plantilla publica y para la config real del deploy.
const wrangler = readFileSync(wranglerToml().path, 'utf-8');

/** Valor de una var dentro del bloque [vars]. */
function varValue(name: string): string | null {
  const m = wrangler.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm'));
  return m?.[1] ?? null;
}

describe('Configuracion de produccion', () => {
  it('ENVIRONMENT es "production" — sin esto se abre el fallback a admin', () => {
    expect(varValue('ENVIRONMENT')).toBe('production');
  });

  it('no declara DEV_ADMIN_SESSION: la sesion de admin de dev nunca va en la config desplegada', () => {
    expect(varValue('DEV_ADMIN_SESSION')).toBeNull();
    expect(wrangler).not.toMatch(/^\s*DEV_ADMIN_SESSION\s*=/m);
  });

  it('declara DOMAIN con el dominio real', () => {
    expect(varValue('DOMAIN')).toBe('gara-g.swal.network');
  });

  it('declara XAVIER_URL para que el proxy server-side tenga destino', () => {
    expect(varValue('XAVIER_URL')).toMatch(/^https:\/\//);
  });

  it('no declara PUBLIC_DEMO=true en esta config', () => {
    expect(varValue('PUBLIC_DEMO')).not.toBe('true');
  });

  it('declara FLEET_ONLY="true": la entrega al cliente es solo flota', () => {
    expect(varValue('FLEET_ONLY')).toBe('true');
  });

  it('declara el binding de D1 que usa el login', () => {
    expect(wrangler).toContain('SWAL_D1');
  });

  /**
   * Astro 5 separa los estáticos en dist/client y el server en dist/server. Si
   * `assets.directory` apunta a dist/, el Worker sirve /manifest.json y /icons/*
   * como 404: la PWA no se instala. Los tests unitarios no lo detectan porque
   * nunca tocan los assets; solo se ve arrancando `wrangler dev`.
   */
  it('los assets apuntan a dist/client, no a dist/', () => {
    const dir = wrangler.match(/assets\s*=\s*\{[^}]*directory\s*=\s*"([^"]*)"/)?.[1];
    expect(dir).toBe('packages/app-pwa/dist/client');
  });

  it('main apunta al entry del servidor', () => {
    const main = wrangler.match(/^main\s*=\s*"([^"]*)"/m)?.[1];
    expect(main).toBe('packages/app-pwa/dist/server/entry.mjs');
  });

  it('declara el binding de R2 que usa la gestion de documentos', () => {
    expect(wrangler).toMatch(/SWAL_R2/);
  });

  it('ninguna credencial queda escrita en el fichero de config', () => {
    // Los secretos van por `wrangler secret put`, nunca en el repositorio.
    const offenders = wrangler
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .filter((l) => /\b(password|secret|token|api_key|apikey)\b/i.test(l))
      .filter((l) => /=/.test(l) && !/^\s*(#|public_|.*_name|.*_id|binding)/i.test(l));
    expect(offenders).toEqual([]);
  });
});
