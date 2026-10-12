/**
 * versionKey.ts — Identidad de "version" de un vehiculo: la llave del foro y la wiki.
 *
 * Version = marca + modelo + variante + generacion (rango de años). Dos dueños del mismo
 * modelo pero de generaciones distintas caen en espacios distintos. El rango sale, en
 * este orden, de la tabla de medidas (specs/modelSpecs.ts), de los años del catalogo
 * (lib/vehicleCatalog.ts) o, si no hay nada, del año solo.
 */
import type { VersionRef } from '../contracts';
import { findModel } from '../../lib/vehicleCatalog';
import { findModelSpec } from '../specs/modelSpecs';

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const title = (s: string) => s.trim().replace(/\s+/g, ' ');

export interface VersionInput {
  make?: string;
  model?: string;
  year?: number;
  variant?: string;
}

/** Llave estable de version. Sin marca o modelo devuelve la version generica `sin-version`. */
export function versionRefFor(v: VersionInput): VersionRef {
  if (!v.make || !v.model) {
    return { key: 'sin-version', make: v.make ?? '', model: v.model ?? '', label: 'Vehículo sin marca/modelo' };
  }
  const make = title(v.make);
  const model = title(v.model);
  const variant = v.variant ? title(v.variant) : undefined;

  let yearFrom: number | undefined;
  let yearTo: number | undefined;
  const spec = findModelSpec(make, model, v.year);
  if (spec?.yearFrom && spec.yearTo && (v.year === undefined || (spec.yearFrom <= v.year && v.year <= spec.yearTo))) {
    yearFrom = spec.yearFrom;
    yearTo = spec.yearTo;
  } else {
    const years = findModel(make, model)?.yearsAvailable ?? [];
    if (years.length && (v.year === undefined || years.includes(v.year))) {
      yearFrom = Math.min(...years);
      yearTo = Math.max(...years);
    } else if (v.year !== undefined) {
      yearFrom = v.year;
      yearTo = v.year;
    }
  }

  const range = yearFrom !== undefined ? (yearFrom === yearTo ? `${yearFrom}` : `${yearFrom}-${yearTo}`) : '';
  const key = slugify([make, model, variant, range].filter(Boolean).join(' '));
  const rangeLabel = yearFrom !== undefined ? (yearFrom === yearTo ? ` (${yearFrom})` : ` (${yearFrom}–${yearTo})`) : '';
  return {
    key,
    make,
    model,
    yearFrom,
    yearTo,
    variant,
    label: `${make} ${model}${variant ? ` ${variant}` : ''}${rangeLabel}`,
  };
}

/** Valida una llave que llega por URL: solo slug (minusculas, digitos y guiones), ≤ 120. */
export function isValidVersionKey(key: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) && key.length <= 120;
}
