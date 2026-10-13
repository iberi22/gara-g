/**
 * rut.test.ts — RUT chileno: digito verificador (modulo 11), formato y validacion.
 *
 * Los casos "de la vida real" (12345678-5, 10000013-K) y los bordes (cuerpo de un digito,
 * RUT con puntos y sin guion, DV en minuscula, basura) fijan el contrato del helper que usan
 * la semilla de la demo y el formulario de conductores.
 */
import { describe, expect, it } from 'vitest';
import {
  cleanRut,
  computeRutDv,
  formatRut,
  formatRutBody,
  formatRutInput,
  isValidRut,
  parseRut,
} from './rut';

describe('computeRutDv (modulo 11)', () => {
  it('calcula el digito verificador de RUT conocidos', () => {
    expect(computeRutDv(12345678)).toBe('5'); // 12.345.678-5
    expect(computeRutDv(11111111)).toBe('1'); // 11.111.111-1
    expect(computeRutDv(10000013)).toBe('K'); // 10.000.013-K
    expect(computeRutDv(30111201)).toBe('7'); // 30.111.201-7 (rango ficticio de la demo)
  });

  it('devuelve "0" cuando el resto da 11 y "K" cuando da 10', () => {
    // 8 -> 11 - (8*2 % 11) = 11 - 5 = 6
    expect(computeRutDv(8)).toBe('6');
    // 6 -> 11 - (6*2 % 11) = 11 - 1 = 10 -> K
    expect(computeRutDv(6)).toBe('K');
    // 5 -> 11 - (5*2 % 11) = 11 - 10 = 1
    expect(computeRutDv(5)).toBe('1');
  });

  it('acepta el cuerpo como texto y como numero, e ignora lo que no sea digito', () => {
    expect(computeRutDv('12.345.678')).toBe('5');
    expect(computeRutDv(12345678)).toBe('5');
    expect(computeRutDv('')).toBe('');
  });
});

describe('parseRut / cleanRut', () => {
  it('lee las formas en que la gente escribe el RUT', () => {
    for (const raw of ['12.345.678-5', '12345678-5', '123456785', '12.345.678-k']) {
      const parts = parseRut(raw);
      expect(parts?.body, raw).toBe('12345678');
    }
    expect(parseRut('12.345.678-5')?.dv).toBe('5');
    expect(parseRut('12.345.678-k')?.dv).toBe('K');
  });

  it('trata el ultimo caracter como digito verificador: un RUT sin DV no es un RUT', () => {
    expect(cleanRut('12345678')).toBe('1234567-8');
    expect(parseRut('12.345.678')).toEqual({ body: '1234567', dv: '8' });
  });

  it('no acepta basura ni cuerpos imposibles', () => {
    expect(parseRut('')).toBeNull();
    expect(parseRut('   ')).toBeNull();
    expect(parseRut('K')).toBeNull();
    expect(parseRut('abc-def')).toBeNull();
    expect(parseRut('1234567890123-4')).toBeNull(); // mas de 9 digitos
    expect(cleanRut(null)).toBe('');
    expect(cleanRut(undefined)).toBe('');
  });
});

describe('isValidRut', () => {
  it('acepta RUT validos con o sin puntos', () => {
    expect(isValidRut('12.345.678-5')).toBe(true);
    expect(isValidRut('12345678-5')).toBe(true);
    expect(isValidRut('123456785')).toBe(true);
    expect(isValidRut('10.000.013-K')).toBe(true);
    expect(isValidRut('10000013k')).toBe(true);
  });

  it('rechaza un digito verificador equivocado', () => {
    expect(isValidRut('12.345.678-4')).toBe(false);
    expect(isValidRut('12.345.678-6')).toBe(false);
    expect(isValidRut('10.000.013-0')).toBe(false);
  });

  it('rechaza vacios, basura y numeros que no son RUT', () => {
    expect(isValidRut('')).toBe(false);
    expect(isValidRut('123')).toBe(false); // 12-3: el DV de 12 es K
    expect(isValidRut('55')).toBe(false); // 5-5: el DV de 5 es 1
    expect(isValidRut('cedula-colombiana')).toBe(false);
    expect(isValidRut(null)).toBe(false);
    expect(isValidRut(undefined)).toBe(false);
  });
});

describe('formatRut / formatRutBody / formatRutInput', () => {
  it('agrupa con puntos y guion', () => {
    expect(formatRut('123456785')).toBe('12.345.678-5');
    expect(formatRut('12345678-5')).toBe('12.345.678-5');
    expect(formatRut('10000013-K')).toBe('10.000.013-K');
    expect(formatRut('1234')).toBe('123-4');
  });

  it('formatRutBody calcula el DV a partir del cuerpo', () => {
    expect(formatRutBody(12345678)).toBe('12.345.678-5');
    expect(formatRutBody('30111201')).toBe('30.111.201-7');
    expect(formatRutBody('')).toBe('');
  });

  it('devuelve cadena vacia si el valor no se puede leer', () => {
    expect(formatRut('')).toBe('');
    expect(formatRut('basura')).toBe('');
    expect(formatRut(null)).toBe('');
  });

  it('formatRutInput da retroalimentacion mientras se escribe, sin exigir DV valido', () => {
    expect(formatRutInput('1234')).toBe('123-4');
    // El ultimo caracter ya se lee como DV: 1234567-8.
    expect(formatRutInput('12345678')).toBe('1.234.567-8');
    expect(formatRutInput('123456785')).toBe('12.345.678-5');
    expect(formatRutInput('1')).toBe('1');
    expect(formatRutInput('')).toBe('');
  });
});
