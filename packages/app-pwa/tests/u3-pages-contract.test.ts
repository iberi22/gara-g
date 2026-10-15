/**
 * Contrato de las paginas/componentes Astro tocados por el frente de formularios (wave-32 09, 10,
 * 11, 20, 21). Es un test de ESTRUCTURA: Astro no se puede montar en vitest. El comportamiento en
 * navegador (foco, toasts, CLS, lang en vivo) lo cubren tests/e2e/u3-*.spec.ts.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWithRaw } from './helpers/inlineSource';

// Los scripts inline de estas plantillas viven en src/lib/inline/*.js (ver el helper).
const read = (rel: string) => readWithRaw(join(process.cwd(), 'src', rel));

describe('issue 21 — lang y titulos en espanol', () => {
  for (const f of ['pages/alerts/index.astro', 'pages/documents/index.astro']) {
    it(`${f}: <html lang="es"> y <title> sin ingles`, () => {
      const s = read(f);
      expect(s).toMatch(/<html[^>]*lang="es"/);
      expect(s).not.toMatch(/lang="en"/);
      const title = s.match(/<title>([^<]*)<\/title>/)![1];
      expect(title).not.toMatch(/Alert Feed|Document Vault/);
    });
  }
  it('fleets/index.astro: h1 en espanol', () => {
    expect(read('pages/fleets/index.astro')).toContain('<h1>Flotas</h1>');
  });
  it('ningun literal visible en ingles de los cinco ficheros', () => {
    const all = ['pages/alerts/index.astro', 'pages/documents/index.astro', 'pages/fleets/index.astro', 'components/fleet/FleetTable.svelte', 'components/alert/AlertFeed.svelte'].map(read).join('\n');
    expect(all).not.toMatch(/>(Fleets|Actions|Acknowledge|Acked|System Alerts)</);
    expect(all).not.toContain('registered fleets');
  });
  it('el enum guardado de conductor no se toca', () => {
    expect(read('components/driver/DriverTable.svelte')).toContain("status: 'active'");
  });
});

describe('issue 20 — fallback en las islas client:only', () => {
  const islas: Array<[string, string]> = [
    ['pages/drivers/index.astro', 'DriverTable'],
    ['pages/fleet/tracking.astro', 'LiveMap'],
    ['pages/fleet/aui.astro', 'AuiInterface'],
    ['pages/telemetry/index.astro', 'LiveChart'],
    ['pages/fleets/index.astro', 'FleetTable'],
    ['pages/documents/index.astro', 'DocumentVault'],
    ['pages/alerts/index.astro', 'AlertFeed'],
    ['pages/geofences/index.astro', 'GeofenceMap'],
  ];
  for (const [f, isla] of islas) {
    it(`${f}: ${isla} lleva slot="fallback" con altura reservada, sin texto ni roles`, () => {
      const s = read(f);
      const m = s.match(new RegExp(`<${isla}[\\s\\S]*?client:only[\\s\\S]*?</${isla}>`));
      expect(m, 'la isla debe abrir y cerrar con su fallback dentro').not.toBeNull();
      const fb = m![0].match(/<div slot="fallback"([^>]*)><\/div>/);
      expect(fb, 'fallback = div vacio').not.toBeNull();
      expect(fb![1]).toMatch(/min-height:\s*\d+(px|rem)/);
      expect(fb![1]).toContain('aria-hidden="true"');
      expect(fb![1]).not.toMatch(/role=/);
      expect(m![0]).toContain('client:only="svelte"');
    });
  }
  it('GameGarage (zona prohibida) queda sin tocar', () => {
    expect(read('pages/fleet/game.astro')).not.toContain('slot="fallback"');
  });
});

describe('issue 09 — telemetria tiene su h1', () => {
  it('exactamente un h1', () => {
    expect(read('pages/telemetry/index.astro').match(/<h1[\s>]/g)?.length).toBe(1);
  });
});

describe('issue 10 y 11 — users/index.astro', () => {
  const s = read('pages/fleet/users/index.astro');
  it('un fallo de D1 se declara y se muestra con role=alert, distinto del vacio', () => {
    expect(s).toMatch(/let loadError = ''/);
    expect(s).toMatch(/loadError = /);
    expect(s).toMatch(/\{loadError \?/);
    expect(s).toContain('role="alert"');
    expect(s).not.toMatch(/catch \(e\) \{\s*\/\/ D1 query failed/);
  });
  it('sin alert() bloqueante: usa el evento de toast', () => {
    expect(s).not.toMatch(/\balert\(/);
    expect(s).toContain("'gara-toast'");
  });
  it('el envio esta protegido contra el doble clic', () => {
    expect(s).toContain("form.dataset.submitting === '1'");
    expect(s).toMatch(/submitBtn\.disabled = true/);
  });
  it('tabla con caption y scope="col"', () => {
    expect(s).toContain('<caption');
    expect(s.match(/<th scope="col">/g)?.length).toBe(5);
  });
  it('conserva el patron SPA-safe', () => {
    expect(s).toContain("form.hasAttribute('data-bound')");
    expect(s).toContain("document.addEventListener('astro:page-load', bindCreateUser)");
  });
});

describe('issue 11 — UploadWidget', () => {
  const s = read('components/UploadWidget.astro');
  it('deshabilita el boton y bloquea el segundo envio', () => {
    expect(s).toContain("f.dataset.submitting === '1'");
    expect(s).toContain('btn.disabled = true');
    expect(s).toContain('.upload-submit:disabled');
  });
});
