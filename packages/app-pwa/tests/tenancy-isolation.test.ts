import { env } from 'cloudflare:workers';
/**
 * tests/tenancy-isolation.test.ts — el cliente NO puede elegir su tenant.
 *
 * Contexto: la PK de la tabla `entity` en D1 es (instance_id, entity, id), asi que
 * el instanceId decide que datos ve cada usuario. resolveInstanceId() lo tomaba del
 * query string (`?instanceId=`) o de un header del cliente, de modo que cualquier
 * usuario autenticado podia leer o escribir la flota de otro cliente cambiando un
 * parametro. rbac.ts solo controla el ROL, nunca el TENANT.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveInstanceId } from '../src/lib/fleetApi.js';

const envMock = env as unknown as Record<string, unknown>;

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

beforeEach(() => {
  envMock.ENVIRONMENT = 'production';
});

/**
 * Contrato cambiado el 2026-10-01 (W3).
 *
 * Antes, sin tenant en la sesion, `resolveInstanceId` devolvia `demo-flota`: el
 * tenant de los DATOS DE EJEMPLO. Las escrituras de un cliente acababan ahi, y
 * los informes mezclaban sus datos con los de ejemplo.
 *
 * Ahora falla. Un tenant inventado es peor que un error: un error se ve, un
 * tenant equivocado no. Estos casos fijan el contrato nuevo.
 */
describe('resolveInstanceId: en produccion ignora lo que manda el cliente', () => {
  it('ignora ?instanceId= del query string', () => {
    const resolver = () =>
      resolveInstanceId(
        req('https://gara-g.swal.network/api/fleet/vehicle?instanceId=flota-de-otro-cliente'),
      );
    // No puede devolver el tenant que pide el cliente, ni siquiera envuelto en
    // un fallo: lo unico aceptable es que se niegue.
    expect(resolver).toThrow(/instanceId/);
  });

  it('ignora el header x-instance-id del cliente', () => {
    const resolver = () =>
      resolveInstanceId(
        req('https://gara-g.swal.network/api/fleet/vehicle', { 'x-instance-id': 'otro-cliente' }),
      );
    expect(resolver).toThrow(/instanceId/);
  });

  it('ignora ambos a la vez', () => {
    const resolver = () =>
      resolveInstanceId(
        req('https://gara-g.swal.network/api/fleet/vehicle?instanceId=ajeno1', {
          'x-instance-id': 'ajeno2',
        }),
      );
    expect(resolver).toThrow(/instanceId/);
  });

  /**
   * El tenant llega por `locals.tenant` (lo inyecta el middleware tras validar la
   * sesion en KV), NUNCA por un header: un header lo elige el cliente, asi que
   * aceptarlo como fuente de verdad devolvia el aislamiento a manos del atacante.
   */
  it('ignora x-tenant-instance si no viene de la sesion', () => {
    const resolver = () =>
      resolveInstanceId(
        req('https://gara-g.swal.network/api/fleet/vehicle', {
          'x-tenant-instance': 'atacante',
        }),
      );
    // El header del atacante no se usa como tenant, y tampoco se sustituye por
    // el de los datos demo: se niega.
    expect(resolver).toThrow(/instanceId/);
  });

  it('el tenant de la sesion gana aunque el cliente mande otro', () => {
    const id = resolveInstanceId(
      req('https://gara-g.swal.network/api/fleet/vehicle?instanceId=ajeno', {
        'x-tenant-instance': 'atacante',
      }),
      'flota-chile-01',
    );
    expect(id).toBe('flota-chile-01');
  });

  it('sin tenant resuelto falla, en vez de escribir en el tenant demo', () => {
    const resolver = () =>
      resolveInstanceId(req('https://gara-g.swal.network/api/fleet/vehicle?instanceId=ajeno'));
    expect(resolver).toThrow(/instanceId/);
  });
});

describe('resolveInstanceId: fuera de produccion mantiene la flexibilidad de dev', () => {
  it('con ENVIRONMENT=development acepta ?instanceId=', () => {
    envMock.ENVIRONMENT = 'development';
    const id = resolveInstanceId(
      req('http://localhost:4321/api/fleet/vehicle?instanceId=demo-flota'),
    );
    expect(id).toBe('demo-flota');
  });

  it('con ENVIRONMENT=development acepta x-instance-id', () => {
    envMock.ENVIRONMENT = 'development';
    const id = resolveInstanceId(
      req('http://localhost:4321/api/fleet/vehicle', { 'x-instance-id': 'demo-flota' }),
    );
    expect(id).toBe('demo-flota');
  });

  it('con ENVIRONMENT ausente (dev por defecto) tambien acepta ?instanceId=', () => {
    delete envMock.ENVIRONMENT;
    const id = resolveInstanceId(
      req('http://localhost:4321/api/fleet/vehicle?instanceId=demo-flota'),
    );
    expect(id).toBe('demo-flota');
  });
});
