/**
 * tests/fleet-shell-a11y.test.ts — invariantes del armazon (FleetLayout + InterfaceSwitcher).
 *
 * Test de ESTRUCTURA sobre el fuente (no arranca navegador; el comportamiento esta en
 * tests/e2e/sidebar-foco, interface-switcher, cls-skeleton y navigation).
 * Cubre las issues wave-32 05, 06, 17, 24 y 25 (lado FleetLayout).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const layout = read('src/layouts/FleetLayout.astro');
const switcher = read('src/components/InterfaceSwitcher.astro');
const fleetList = read('src/components/FleetList.astro');
const style = (src: string) => src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

describe('05 InterfaceSwitcher: nombre accesible y estado', () => {
  it('cada boton lleva aria-label propio y aria-pressed', () => {
    expect((switcher.match(/aria-pressed=/g) ?? []).length).toBe(3);
    expect((switcher.match(/aria-label=/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((switcher.match(/aria-hidden="true"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it('el boton de juego se declara aria-disabled', () => {
    expect(switcher).toMatch(/aria-disabled=\{/);
  });
  it('area tactil de 44px', () => {
    expect(style(switcher)).toMatch(/pointer:\s*coarse[\s\S]*min-height:\s*44px/);
  });
  it('la etiqueta se oculta a la vista, nunca con display:none (el nombre sobrevive)', () => {
    expect(style(switcher)).not.toMatch(/\.mode-label\s*\{[^}]*display:\s*none/);
    expect(style(layout)).not.toMatch(/:global\(\.(mode|theme)-label\)[^{]*\{[^}]*display:\s*none/);
    expect(style(layout)).toMatch(/:global\(\.mode-label\)[\s\S]*clip:\s*rect\(0, 0, 0, 0\)/);
  });
});

describe('06 drawer: foco y teclado', () => {
  it('hamburguesa enlazada con el panel desde el SSR', () => {
    expect(layout).toMatch(/aria-controls="fleet-sidebar"/);
    expect(layout).toMatch(/aria-expanded="false"/);
    expect(layout).toMatch(/id="fleet-sidebar"/);
  });
  it('cerrado en movil el drawer es inert', () => {
    expect(layout).toMatch(/sidebar\.inert\s*=\s*mobile && !sidebarIsOpen\(\)/);
  });
  it('mueve el foco al abrir y lo devuelve al cerrar; Escape y trampa de Tab', () => {
    expect((layout.match(/\.focus\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(layout).toMatch(/closeBtn\.focus/);
    expect(layout).toMatch(/hamburger\.focus/);
    expect(layout).toMatch(/e\.key === 'Escape'/);
    expect(layout).toMatch(/e\.key === 'Tab'/);
  });
  it('areas tactiles de 44px', () => {
    const css = style(layout);
    expect(css).toMatch(/\.hamburger \{[^}]*width: 44px;[^}]*height: 44px/);
    expect(css).toMatch(/pointer: coarse\)[\s\S]*\.nav-item \{\s*min-height: 44px/);
  });
  it('campana y badge son reglas de primer nivel (no anidadas en .topbar-right)', () => {
    const m = style(layout).match(/\.topbar-right \{[^}]*\}/);
    expect(m?.[0]).not.toMatch(/notif-bell|notif-badge/);
    expect(style(layout)).toMatch(/^\s*\.notif-bell \{ position: relative/m);
  });
});

describe('17 skeleton sin CLS', () => {
  it('oculta por defecto, sin .loaded ni temporizador de 150 ms', () => {
    expect(style(layout)).toMatch(/\.fleet-skeleton \{\s*display: none;/);
    expect(layout).not.toMatch(/fleet-skeleton\.loaded|classList\.add\('loaded'\)/);
    expect(layout).not.toMatch(/setTimeout\(/);
  });
  it('al aparecer va superpuesta (no empuja el contenido) y conserva el testid', () => {
    expect(style(layout)).toMatch(/\.fleet-skeleton\.pending \{[^}]*position: absolute/);
    expect((layout.match(/class="fleet-skeleton" data-testid="loading-skeleton"/g) ?? []).length).toBe(1);
  });
});

describe('24 menu: sin duplicados, con Mercado y Radar, aria-current', () => {
  const ids = [...layout.matchAll(/\{ id: '([a-z-]+)', label: '([^']+)', href: '([^']+)'/g)].map((m) => ({
    id: m[1], label: m[2], href: m[3],
  }));
  it('ids y destinos unicos', () => {
    expect(ids.length).toBeGreaterThanOrEqual(15);
    expect(new Set(ids.map((i) => i.id)).size).toBe(ids.length);
    expect(new Set(ids.map((i) => i.href)).size).toBe(ids.length);
    expect(new Set(ids.map((i) => i.label)).size).toBe(ids.length);
  });
  it('incluye Mercado y Radar V2V', () => {
    expect(ids.find((i) => i.id === 'mercado')?.href).toBe('/fleet/mercado');
    expect(ids.find((i) => i.id === 'radar')?.label).toBe('Radar V2V');
  });
  it('la entrada activa lleva aria-current="page" (incluido Ajustes)', () => {
    expect((layout.match(/aria-current=\{/g) ?? []).length).toBe(2);
  });
  it('sin CSS muerto', () => {
    expect(style(layout)).not.toMatch(/stats-grid|stats-secondary/);
    expect(fleetList).not.toMatch(/\.page-header|\.page-title|\.page-sub|\.badge-pro|\.stats-grid/);
  });
});

describe('25 FleetLayout usa el tema, no copias', () => {
  it('el punto de estado es .g-status-dot y no hay @keyframes pulse local', () => {
    expect(layout).toMatch(/class="g-status-dot"/);
    expect(layout).not.toMatch(/class="status-dot"|@keyframes pulse/);
  });
  it('sin colores hex literales ni radios en px sueltos', () => {
    const css = style(layout);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/border-radius:\s*(4|6)px/);
  });
});
