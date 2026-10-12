import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('../src/pages/fleet/users/index.astro', import.meta.url), 'utf8');

describe('/fleet/users lista solo los usuarios del tenant de la sesion', () => {
  it('no consulta un tenant fijo', () => {
    // Con DEFAULT_INSTANCE_ID, el admin de cualquier cuenta veia los usuarios de la cuenta por defecto.
    expect(page).not.toContain('DEFAULT_INSTANCE_ID');
    expect(page).toMatch(/sessionInstance = instanceIdFor\(Astro\.request, Astro\.locals\)/);
  });

  it('el rol sale de la sesion validada por el middleware, no de leer la cookie a mano', () => {
    expect(page).toContain('Astro.locals');
    expect(page).not.toMatch(/match\(\/\(\?:\^\|;\\s\*\)session=/);
  });
});
