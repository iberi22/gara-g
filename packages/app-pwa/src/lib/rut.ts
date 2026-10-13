/**
 * rut.ts — RUT chileno (RUN): normalizacion, digito verificador (modulo 11) y validacion.
 *
 * Es la unica implementacion de la matematica del RUT. `lib/demoChile.ts` la reusa para la
 * semilla ficticia en vez de repetir el modulo 11 (dos copias divergen: una se arregla y la
 * otra se queda con el bug).
 *
 * Modulo 11: de derecha a izquierda se multiplica cada digito del cuerpo por 2,3,4,5,6,7,2,…
 * se suman los productos y el DV es `11 - (suma mod 11)`, con 11 -> "0" y 10 -> "K".
 *
 *   computeRutDv(12345678) === '5'   ->  12.345.678-5
 *
 * El RUT se escribe con puntos de miles y guion: `12.345.678-5`. El DV puede ser K. Acepta
 * el valor tal como lo teclee una persona (con o sin puntos, con o sin guion, en minusculas)
 * porque de eso se encarga la normalizacion.
 *
 * Este modulo NO importa nada (ni el mercado): asi lo puede cargar el script de semilla con
 * Node a pelo, y los tests lo pueden usar sin montar el pipeline de Astro.
 */

/** Cuerpo y digito verificador ya separados. */
export interface RutParts {
  /** Solo digitos, sin puntos. */
  body: string;
  /** Un caracter: 0-9 o K (mayuscula). */
  dv: string;
}

/** Digito verificador de un cuerpo de RUT (modulo 11). */
export function computeRutDv(body: string | number): string {
  const digits = String(body).replace(/\D/g, '');
  if (digits === '') return '';
  let sum = 0;
  let mul = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const r = 11 - (sum % 11);
  return r === 11 ? '0' : r === 10 ? 'K' : String(r);
}

/**
 * Deja el valor en la forma `cuerpo-dv` sin puntos, o `''` si no hay digitos.
 * Trata el ULTIMO caracter como digito verificador: un RUT sin DV no es un RUT.
 */
export function cleanRut(input: unknown): string {
  if (typeof input !== 'string' && typeof input !== 'number') return '';
  const raw = String(input)
    .replace(/[^0-9kK]/g, '')
    .toUpperCase();
  if (raw.length < 2) return '';
  return `${raw.slice(0, -1)}-${raw.slice(-1)}`;
}

/** Separa cuerpo y DV. `null` si no se puede leer. */
export function parseRut(input: unknown): RutParts | null {
  const clean = cleanRut(input);
  if (clean === '') return null;
  const [body, dv] = clean.split('-');
  if (!/^\d{1,9}$/.test(body)) return null;
  return { body, dv };
}

/**
 * ¿Es un RUT valido? Comprueba cuerpo numerico, largo razonable y digito verificador.
 *
 * Ojo: un RUT valido matematicamente puede no existir (el DV no dice nada sobre si el RUN
 * fue emitido). Para validar identidad de verdad hace falta el Registro Civil.
 */
export function isValidRut(input: unknown): boolean {
  const parts = parseRut(input);
  if (!parts) return false;
  return computeRutDv(parts.body) === parts.dv;
}

/** `12.345.678-5`. Cadena vacia si el valor no se puede leer. */
export function formatRut(input: unknown): string {
  const parts = parseRut(input);
  if (!parts) return '';
  return `${groupBody(parts.body)}-${parts.dv}`;
}

/**
 * Formatea un cuerpo calculando su DV: `12345678` -> `12.345.678-5`.
 * Es lo que usa la semilla de la demo, que parte de un numero.
 */
export function formatRutBody(body: string | number): string {
  const digits = String(body).replace(/\D/g, '');
  if (digits === '') return '';
  return `${groupBody(digits)}-${computeRutDv(digits)}`;
}

/**
 * Formatea lo que se lleva tecleado en un campo, sin exigir que ya este completo.
 * `1234` -> `12.34`; sirve para dar retroalimentacion mientras se escribe.
 */
export function formatRutInput(input: unknown): string {
  if (typeof input !== 'string' && typeof input !== 'number') return '';
  const raw = String(input)
    .replace(/[^0-9kK]/g, '')
    .toUpperCase();
  if (raw === '') return '';
  if (raw.length === 1) return raw;
  return `${groupBody(raw.slice(0, -1))}-${raw.slice(-1)}`;
}

function groupBody(body: string): string {
  return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
