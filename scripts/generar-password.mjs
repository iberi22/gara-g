#!/usr/bin/env node
/**
 * generar-password.mjs — genera una contraseña con la MISMA logica que
 * SWAL Vault (lib/ui/password_generator.dart).
 *
 * El objetivo es que el primer admin de GARA-G tenga una contrasena creada con el
 * mismo generador que usa el vault del ecosistema, no con una regla inventada aqui.
 * Se replican sus pools de caracteres, el Random.secure() y el filtro de ambiguos.
 *
 * Uso:
 *   node generar-password.mjs                # 24 chars, todo activado
 *   node generar-password.mjs --length 32
 *   node generar-password.mjs --no-symbols --no-ambiguous
 *   node generar-password.mjs --check 'laPassword' 'elHashGuardado'
 */
import { randomInt } from 'node:crypto';

// --- pools: identicos a password_generator.dart -----------------------------
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?/';
const AMBIGUOUS = 'lI1o0O|';

// --- flags ------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name, dflt = true) => {
  if (argv.includes(`--${name}`)) return true;
  if (argv.includes(`--no-${name}`)) return false;
  return dflt;
};
const lengthArg = argv.indexOf('--length');
const length = lengthArg >= 0 ? Number(argv[lengthArg + 1]) : 24;

if (length < 8 || length > 64) {
  console.error('Length must be between 8 and 64.');
  process.exit(1);
}

const pools = [];
if (flag('uppercase')) pools.push(UPPER);
if (flag('lowercase')) pools.push(LOWER);
if (flag('digits')) pools.push(DIGITS);
if (flag('symbols')) pools.push(SYMBOLS);
if (pools.length === 0) {
  console.error('At least one character set must be selected.');
  process.exit(1);
}

const excludeAmbiguous = flag('ambiguous', false);
const filtered = pools
  .map((p) => (excludeAmbiguous ? [...p].filter((c) => !AMBIGUOUS.includes(c)).join('') : p))
  .filter((p) => p.length > 0);
if (filtered.length === 0) {
  console.error('Every pool became empty after filtering ambiguous characters.');
  process.exit(1);
}

// --- generacion: un caracter de cada pool garantizado, luego relleno ---------
const chars = [];
for (const pool of filtered) {
  chars.push(pool[randomInt(pool.length)]);
}
const all = filtered.join('');
while (chars.length < length) {
  chars.push(all[randomInt(all.length)]);
}

// Mezcla con Fisher-Yates sobre un RNG criptografico, igual que el vault.
for (let i = chars.length - 1; i > 0; i--) {
  const j = randomInt(i + 1);
  [chars[i], chars[j]] = [chars[j], chars[i]];
}

const password = chars.join('');

// --- modo --check: verificar contra el hash PBKDF2 del bootstrap ------------
const checkIndex = argv.indexOf('--check');
if (checkIndex >= 0) {
  const candidate = argv[checkIndex + 1];
  const stored = argv[checkIndex + 2];
  const [saltB64, hashB64] = String(stored).split(':');
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const { pbkdf2Sync } = await import('node:crypto');
  const got = pbkdf2Sync(candidate, salt, 100000, expected.length, 'sha256');
  const ok = got.length === expected.length && got.equals(expected);
  console.log(ok ? 'verifica: true' : 'verifica: false');
  process.exit(ok ? 0 : 1);
}

console.log(password);
