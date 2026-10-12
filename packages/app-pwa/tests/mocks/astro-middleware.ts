/**
 * tests/mocks/astro-middleware.ts — stand-in de `astro:middleware` para vitest.
 *
 * `astro:middleware` es un modulo virtual que solo existe dentro del pipeline de Astro,
 * asi que vitest no lo puede resolver. Este mock devuelve `defineMiddleware` como
 * identidad: el middleware se prueba llamandolo directamente con un contexto falso.
 */
export function defineMiddleware<T>(fn: T): T {
  return fn;
}
