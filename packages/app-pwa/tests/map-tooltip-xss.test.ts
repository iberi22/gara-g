// @vitest-environment jsdom
/**
 * tests/map-tooltip-xss.test.ts — los textos que van a un tooltip, popup o icono
 * de Leaflet se escapan antes de convertirse en HTML.
 *
 * Leaflet NO escapa: `bindTooltip`, `bindPopup` y `divIcon({html})` reciben una
 * cadena y la interpretan como marcado. Los nombres de geocerca, las placas y
 * los VIN los introduce un usuario, asi que interpolarlos sin escapar es un XSS
 * almacenado que se ejecuta en el navegador de cualquiera que abra el mapa.
 *
 * Estos casos EJECUTAN `escapeHtml` y comprueban que el resultado, metido en un
 * div real del DOM, no crea nodos ni dispara manejadores. No comprueban el
 * texto del fuente de los componentes: comprueban el comportamiento del helper
 * que los componentes usan.
 */
import { describe, expect, it } from 'vitest';

import { escapeHtml } from '../src/lib/html.js';

/** Monta el resultado como lo haria Leaflet y devuelve lo que el DOM crearia. */
function asHtml(value: unknown): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = escapeHtml(value);
  return host;
}

describe('escapeHtml neutraliza el marcado', () => {
  it('una etiqueta con onerror no crea un elemento ni dispara el manejador', () => {
    let disparado = false;
    const img = document.createElement('img');
    img.addEventListener('error', () => {
      disparado = true;
    });
    document.body.append(img);

    const host = asHtml('<img src=x onerror="window.__xss=1">');

    expect(host.querySelector('img'), 'no debe crearse ningun elemento img').toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=');
    expect((window as unknown as Record<string, unknown>).__xss).toBeUndefined();
    img.remove();
  });

  it('un script inyectado no crea un elemento script', () => {
    const host = asHtml('<script>window.__xss2=1</script>');
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('<script>');
  });

  it('un svg con onload tampoco', () => {
    const host = asHtml('<svg><g onload="window.__xss3=1"></g></svg>');
    expect(host.querySelector('svg')).toBeNull();
    expect(host.querySelector('g')).toBeNull();
  });

  it('escapa tambien el apostrofe, que es lo que rompe un atributo entre comillas simples', () => {
    // La copia de magic-link.ts no escapaba el apostrofo: por eso existe este caso.
    expect(escapeHtml("it's")).toBe('it&#39;s');
    expect(escapeHtml('"doblado"')).toBe('&quot;doblado&quot;');
  });

  it('el ampersand se escapa el primero, no se corrompe el resto', () => {
    // Si se reemplazara & al final, "&lt;" pasaria a "&amp;lt;".
    expect(escapeHtml('<b>')).toBe('&lt;b&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('deja intacto el texto normal, incluidos tildes y emojis', () => {
    expect(escapeHtml('Zona centro — Bogotá 🏙')).toBe('Zona centro — Bogotá 🏙');
    expect(escapeHtml('ABC-123')).toBe('ABC-123');
  });

  it('no rompe con null, undefined ni numeros', () => {
    // Un VIN ausente no puede producir "undefined" literal en el popup.
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(0)).toBe('0');
  });
});

describe('los mapas de la app escapan lo que interpolan', () => {
  it('el popup de la geocerca muestra el payload como texto', () => {
    // Reproduce la interpolacion de GeofenceMap.svelte con un nombre hostil.
    const nombre = '<img src=x onerror=alert(1)>';
    const tooltip = `<div><strong>${escapeHtml(nombre)}</strong></div>`;

    const host = document.createElement('div');
    host.innerHTML = tooltip;
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('strong')?.textContent).toBe(nombre);
  });

  it('el icono del vehiculo escapa la placa', () => {
    const plate = '"><script>alert(1)</script>';
    const icon = `<div>🚗 ${escapeHtml(plate)}</div>`;

    const host = document.createElement('div');
    host.innerHTML = icon;
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('🚗');
  });
});
