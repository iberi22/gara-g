/**
 * tenant.test.ts — Lectura del tenant de la sesion.
 *
 * El caso que justifica el modulo: cuando NO hay tenant, `sessionInstanceId` devuelve
 * undefined y no inventa un id. Un default silencioso aqui seria leer (o escribir) la flota
 * equivocada.
 */
import { describe, expect, it } from 'vitest';
import { instanceIdFor, sessionInstanceId } from './tenant';

const req = (url = 'https://gara-g.swal.network/api/garage/vehicles') => new Request(url);

describe('sessionInstanceId', () => {
  it('lee el instanceId que dejo el middleware', () => {
    expect(sessionInstanceId({ tenant: { instanceId: 't-1' } })).toBe('t-1');
  });

  it('sin tenant devuelve undefined (no un default inventado)', () => {
    expect(sessionInstanceId({})).toBeUndefined();
    expect(sessionInstanceId(undefined)).toBeUndefined();
    expect(sessionInstanceId({ tenant: {} })).toBeUndefined();
    expect(sessionInstanceId({ tenant: { instanceId: '' } })).toBeUndefined();
  });

  it('ignora un instanceId que no es texto', () => {
    expect(sessionInstanceId({ tenant: { instanceId: 42 } })).toBeUndefined();
  });

  it('no revienta con cualquier basura en locals', () => {
    expect(sessionInstanceId(null)).toBeUndefined();
    expect(sessionInstanceId('texto')).toBeUndefined();
    expect(sessionInstanceId(7)).toBeUndefined();
  });
});

describe('instanceIdFor', () => {
  it('gana el tenant de la sesion sobre el de la URL', () => {
    const url = 'https://gara-g.swal.network/api/garage/vehicles?instanceId=otro-tenant';
    expect(instanceIdFor(req(url), { tenant: { instanceId: 't-1' } })).toBe('t-1');
  });

  it('sin tenant de sesion delega en resolveInstanceId (mismas reglas que /api/fleet)', () => {
    // Sin sesion, resolveInstanceId aplica su fallback de desarrollo; lo importante es que la
    // ruta no rompe y que no usa nada de la request cuando si hay tenant.
    expect(() => instanceIdFor(req(), {})).not.toThrow();
    expect(instanceIdFor(req(), { tenant: { instanceId: 't-2' } })).toBe('t-2');
  });
});
