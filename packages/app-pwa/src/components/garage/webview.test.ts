/**
 * webview.test.ts — Pruebas unitarias para la detección del modo WebView de la app nativa.
 */
import { describe, expect, it } from 'vitest';
import { isWebViewMode } from './webview';

describe('isWebViewMode', () => {
  it('detecta modo WebView por parámetro de consulta ?embed=app', () => {
    expect(isWebViewMode('?embed=app', null)).toBe(true);
    expect(isWebViewMode('embed=app', null)).toBe(true);
    expect(isWebViewMode(new URLSearchParams('embed=app'), null)).toBe(true);
    expect(isWebViewMode(new URLSearchParams('foo=bar&embed=app'), null)).toBe(true);
  });

  it('no activa modo WebView si embed tiene otro valor', () => {
    expect(isWebViewMode('?embed=web', null)).toBe(false);
    expect(isWebViewMode(new URLSearchParams('embed=false'), null)).toBe(false);
  });

  it('detecta modo WebView por User-Agent que contiene GaraGApp', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14) GaraGApp/1.0.0 Mobile';
    expect(isWebViewMode('', ua)).toBe(true);
  });

  it('retorna false para un navegador estándar sin parámetros ni firma', () => {
    const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
    expect(isWebViewMode('', chromeUA)).toBe(false);
    expect(isWebViewMode(null, null)).toBe(false);
  });
});
