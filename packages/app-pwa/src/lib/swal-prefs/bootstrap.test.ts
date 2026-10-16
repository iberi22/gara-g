// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { prefsBootstrapScript } from './bootstrap';

const run = (src: string) => new Function(src)();
const styleText = () => document.getElementById('swal-prefs-style')?.textContent ?? '';

describe('prefsBootstrapScript', () => {
  beforeEach(() => {
    localStorage.clear();
    document.getElementById('swal-prefs-style')?.remove();
    delete (window as { __swalPrefsSheet?: unknown }).__swalPrefsSheet;
  });

  it('oculta los modulos y paneles apagados guardados', () => {
    localStorage.setItem('k', JSON.stringify({ modules: { fuel: false, maps: true }, panels: { shop: { enabled: false }, wiki: { enabled: true } } }));
    run(prefsBootstrapScript({ storageKey: 'k' }));
    expect(styleText()).toBe('[data-pref-module="fuel"],[data-pref-panel="shop"]{display:none!important}');
  });

  it('sin nada guardado no oculta nada', () => {
    run(prefsBootstrapScript({ storageKey: 'k' }));
    expect(styleText()).toBe('');
  });

  it('JSON roto no rompe la pagina', () => {
    localStorage.setItem('k', '{nope');
    expect(() => run(prefsBootstrapScript({ storageKey: 'k' }))).not.toThrow();
    expect(styleText()).toBe('');
  });

  it('se re-aplica con swal:prefschange y escapa comillas en los ids', () => {
    run(prefsBootstrapScript({ storageKey: 'k' }));
    document.dispatchEvent(new CustomEvent('swal:prefschange', { detail: { modules: { 'a"]{}x': false } } }));
    expect(styleText()).toBe('[data-pref-module="a\\"]{}x"]{display:none!important}');
  });
});

describe('prefsBootstrapScript con hojas construidas (navegador con CSP)', () => {
  // jsdom no trae CSSStyleSheet construible ni adoptedStyleSheets: se simulan los dos.
  class FakeSheet {
    text = '';
    replaceSync(t: string) {
      this.text = t;
    }
  }
  const doc = document as unknown as { adoptedStyleSheets?: FakeSheet[] };
  const g = globalThis as unknown as { CSSStyleSheet: unknown };
  let original: unknown;

  beforeEach(() => {
    localStorage.clear();
    document.getElementById('swal-prefs-style')?.remove();
    delete (window as { __swalPrefsSheet?: unknown }).__swalPrefsSheet;
    original = g.CSSStyleSheet;
    g.CSSStyleSheet = FakeSheet;
    doc.adoptedStyleSheets = [];
    return () => {
      g.CSSStyleSheet = original;
      delete doc.adoptedStyleSheets;
    };
  });

  it('no crea <style> (la CSP lo bloquearia) y adopta una sola hoja', () => {
    localStorage.setItem('k', JSON.stringify({ modules: { fuel: false } }));
    run(prefsBootstrapScript({ storageKey: 'k' }));
    // Una re-ejecucion (ClientRouter) reutiliza la misma hoja.
    run(prefsBootstrapScript({ storageKey: 'k' }));
    document.dispatchEvent(new CustomEvent('astro:after-swap'));
    expect(document.getElementById('swal-prefs-style')).toBeNull();
    expect(doc.adoptedStyleSheets).toHaveLength(1);
    expect(doc.adoptedStyleSheets?.[0].text).toBe('[data-pref-module="fuel"]{display:none!important}');
  });
});
