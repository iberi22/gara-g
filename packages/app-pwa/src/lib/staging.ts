/**
 * src/lib/staging.ts — ¿Esta instancia es el stage de pruebas?
 *
 * Un solo booleano, leido de la var `DEPLOY_TARGET` del Worker. Existe para una
 * cosa: que el stage se note EN LA PANTALLA y NO ROMPA DATOS.
 *
 * ⚠  Deliberadamente NO se apoya en `ENVIRONMENT`. Ese valor tiene que quedarse en
 * 'production' en los DOS Workers, porque es el que cierra los fallbacks de
 * administracion y la lectura del tenant desde la sesion (ver src/lib/session.ts
 * y src/lib/fleetApi.ts:resolveInstanceId). Poner ENVIRONMENT='staging' en el stage
 * no solo reabre el backdoor: haria que `resolveInstanceId` volviera a aceptar
 * `?instanceId=` del cliente, o sea que cualquier visitante del stage podria leer y
 * BORRAR la flota de un tenant de produccion Sharing una misma D1. Son dos variables
 * distintas porque responden a dos preguntas distintas: ENVIRONMENT = "que tan cerrado
 * esta el runtime" (produccion en los dos), DEPLOY_TARGET = "que URL es esta".
 */
import { env } from 'cloudflare:workers';

interface Env {
  DEPLOY_TARGET?: string;
}

/**
 * Nombre del stage. Se muestra en la interfaz, asi que va en un solo sitio: quien
 * lo cambia para otra URL lo cambia aqui.
 */
export const STAGING_HOST = 'gara-g.pages.dev';

/**
 * ¿Sirve este Worker el stage de pruebas?
 *
 * Ante la duda, `false`. El default es produccion: si la var falta, esta instance
 * se comporta como produccion, que es el fallo que no se nota. Sin env (build,
 * vitest, prerender) tambien: no hay binding, no se pinta banner.
 */
export function isStaging(): boolean {
  try {
    return (env as unknown as Env).DEPLOY_TARGET === 'staging';
  } catch {
    /* sin env: no hay stage que marcar */
    return false;
  }
}

/**
 * Prefijo que se antepone al <title> en el stage.
 *
 * Vive en el titulo y no solo en el banner porque el titulo es lo que se ve en la
 * pestaña del navegador, en el historial y en los marcadores: es el sitio por donde
 * alguien se da cuenta de que esta en el stage cuando ya esta escribiendo datos.
 */
export const STAGING_TITLE_PREFIX = '[STAGING] ';

/**
 * Tenant del stage. Es un valor NUEVO, no uno de los que ya existen en D1.
 *
 * La PK de la tabla `entity` es (instance_id, entity, id), asi que las filas del
 * stage son un conjunto disjunto del de produccion (`gara-g-default-instance`) sin
 * migrar nada ni cambiar el esquema: mismo D1, mismo R2, mismos usuarios, y a la vez
 * un hueco de datos donde nadie real esta escribiendo.
 *
 * Que sea un tenant NUEVO es lo que hace segura la D1 compartida. Si se usara
 * `gara-g-default-instance`, cualquier DELETE de un DELETE de prueba que se lanzara
 * en el stage borraria filas de produccion.
 */
export const STAGING_TENANT = 'gara-staging';

/**
 * Fija el tenant del stage por encima del que traiga la sesion o el cliente.
 *
 * El WHY de que sea "por encima" y no "solo si falta": las sesiones viven en el
 * namespace KV `SESSION`, que es el MISMO en los dos Workers. Una cookie de sesion
 * de produccion es, literalmente, una cookie valida en el stage. Si el stage
 * respetara el instanceId de la sesion, un admin de produccion que abriera el stage
 * por error escribiria sobre la flota de produccion creyendo estar en el stage.
 * Fijar aqui cierra ese caso: en el stage, el tenant es siempre `gara-staging`.
 */
export function pinTenant(instanceId: string | null | undefined): string | null | undefined {
  return isStaging() ? STAGING_TENANT : instanceId;
}