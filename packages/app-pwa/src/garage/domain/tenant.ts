/**
 * src/garage/domain/tenant.ts — Lectura tipada del tenant de la sesion.
 *
 * `App.Locals` (src/env.d.ts, FUERA de esta isla) declara `user` pero no `tenant`, asi que
 * `locals.tenant` no compila sin un cast. Las rutas de /api/fleet lo esquivan con
 * `(locals as any)?.tenant?.instanceId`; aqui se concentrates el unico `any` de la isla, en
 * un sitio, y se tipa lo que sale. Cuando el middleware declare `tenant` en App.Locals, esto
 * se borra entero.
 *
 * Por que importa mas de lo que parece: el tenant decide que filas se leen. Un cast mal
 * hecho (o un default silencioso cuando no hay tenant) seria una fuga entre clientes, asi que
 * este modulo NO tiene default: si no hay tenant, devuelve undefined y quien llama decide.
 */
import { resolveInstanceId } from '../../lib/fleetApi';

/** Lo que el middleware deja en locals cuando resolvio la sesion. */
interface SessionTenantLocals {
  tenant?: { instanceId?: string } | undefined;
}

/** Tenant de la sesion, o undefined si la request no tiene. Nunca un valor inventado. */
export function sessionInstanceId(locals: unknown): string | undefined {
  const tenant = (locals as SessionTenantLocals | undefined)?.tenant;
  const instanceId = tenant?.instanceId;
  return typeof instanceId === 'string' && instanceId.length > 0 ? instanceId : undefined;
}

/**
 * Tenant efectivo de la request. Delega en `resolveInstanceId` para heredar sus reglas
 * exactas (que en dev admiten ?instanceId= y el header), de modo que estas rutas se
 * comportan igual que /api/fleet/[entity].
 */
export function instanceIdFor(request: Request, locals: unknown): string {
  return resolveInstanceId(request, sessionInstanceId(locals));
}
