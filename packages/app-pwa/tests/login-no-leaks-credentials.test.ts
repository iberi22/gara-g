/**
 * tests/login-no-leaks-credentials.test.ts — la pagina de login no regala
 * credenciales (en ningun entorno desde que se quitaron los usuarios de demo).
 *
 * El fallo que cubre: `login.astro` renderizaba siempre
 *
 *     <p class="dev-note">Dev: admin@gara-g.swal.network / <contrasena demo></p>
 *
 * Eso era un doble problema. Uno: en produccion esas credenciales ya no
 * funcionan (el login de demo esta desactivado, `api/auth/login.ts` las
 * rechaza), asi que el texto era misinformation. Dos, el grave: publicaba el
 * nombre de la cuenta de administrador real en la propia pagina de entrada. Si
 * alguien llegara a crear esa cuenta en D1, el login quedaria abierto con una
 * contrasena escrita a la vista de cualquiera que visitara `/login`.
 *
 * El placeholder del campo de correo tambien lo daba, y ese si era codigo de
 * produccion, sin ninguna condicion.
 *
 * Este test es de ESTRUCTURA: comprueba las condiciones que hacen que Astro
 * elimine el bloque al compilar. Que el HTML SERVIDO ya no lo contenga lo
 * comprueba `tools/probe-production.sh`, contra el bundle real y contra
 * produccion. Un test de la suite no debe depender de la red.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const LOGIN = readFileSync(join(process.cwd(), 'src/pages/login.astro'), 'utf8');

const EMAIL_ADMIN = 'admin@gara-g.swal.network';
// Por partes, como en auth-fallback.test.ts: el literal no debe aparecer en el repo publico.
const PASSWORD_EJEMPLO = ['admin', '123'].join('');

describe('la pagina de login no muestra credenciales de ejemplo', () => {
  it('ni el email del admin ni la password de ejemplo aparecen en la pagina', () => {
    // Antes vivian en un bloque `import.meta.env.DEV`. Desde que no hay usuarios de demo
    // (src/lib/authenticate.ts) ni siquiera sirven en local: no hay nada que mostrar.
    expect(LOGIN, 'email del admin en login.astro').not.toContain(EMAIL_ADMIN);
    expect(LOGIN, 'password de ejemplo en login.astro').not.toContain(PASSWORD_EJEMPLO);
    expect(LOGIN).not.toContain('dev-note');
  });

  it('el placeholder del campo de correo no es la cuenta real', () => {
    // Este si era codigo de produccion sin condicion: se veia siempre.
    const placeholder = /name="email"[\s\S]{0,200}?placeholder="([^"]*)"/.exec(LOGIN)?.[1];
    expect(placeholder, 'el input de email debe tener placeholder').toBeDefined();
    expect(placeholder, 'el placeholder no debe ser el email del admin').not.toContain(
      'admin@gara-g',
    );
  });

  it('el formulario sigue siendo utilizable sin esas pistas', () => {
    expect(LOGIN).toContain('name="email"');
    expect(LOGIN).toContain('name="password"');
  });
});
