// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { prefsBootstrapScript } from './bootstrap';

const run = (src: string) => new Function(src)();
const styleText = () => document.getElementById('swal-prefs-style')?.textContent ?? '';

describe('prefsBootstrapScript', () => {
  beforeEach(() => {
    localStorage.clear();
    document.getElementById('swal-prefs-style')?.remove();
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
