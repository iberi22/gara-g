import { describe, expect, it } from 'vitest';
import { safeAuiTheme } from './aui';

describe('safeAuiTheme', () => {
  it('deja pasar colores hex y medidas validas', () => {
    expect(safeAuiTheme({ accent: '#FF6A13', bg: '#0e1116', radius: '4px' })).toEqual({ accent: '#FF6A13', bg: '#0e1116', radius: '4px' });
    expect(safeAuiTheme({ radius: '0.5rem' }).radius).toBe('0.5rem');
  });

  it('descarta todo lo que pueda cerrar la regla e inyectar CSS', () => {
    const t = safeAuiTheme({ accent: 'red;} body{display:none', bg: 'url(https://x/y.png)', radius: '4px;}*{color:red' });
    expect(t).toEqual({ accent: undefined, bg: undefined, radius: undefined });
  });

  it('entradas basura dan un tema vacio', () => {
    for (const junk of [undefined, null, 'x', 42, { accent: 7 }]) {
      const t = safeAuiTheme(junk);
      expect(t.accent ?? t.bg ?? t.radius).toBeUndefined();
    }
  });
});
