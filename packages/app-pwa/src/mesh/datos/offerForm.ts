/**
 * offerForm.ts — Del formulario del vendedor a una oferta lista para `publishOffer`.
 *
 * El formulario trabaja con textos ("Toyota, Renault", "15") y casillas; la oferta valida
 * numeros y listas. Esta conversion es pura para poder probarla sin UI. No valida: de eso se
 * encarga `parseOffer` (una sola fuente de verdad); aqui solo se convierte y se omite lo vacio.
 */
import type { NeedKey, OfferCategory, VehicleClass } from './offer';

export interface OfferDraft {
  vendor: string;
  category: OfferCategory;
  title: string;
  description: string;
  priceCop: string;
  discountPct: string;
  /** Como acordar: celular o telefono, enlace de WhatsApp o sitio web. */
  contact: string;
  acceptsSwalToken: boolean;
  region: string;
  radiusKm: string;
  /** Dias de vigencia desde ahora. */
  days: string;
  classes: VehicleClass[];
  brands: string;
  models: string;
  yearFrom: string;
  yearTo: string;
  need: NeedKey | '';
  withinKm: string;
}

export const EMPTY_DRAFT: OfferDraft = {
  vendor: '',
  category: 'lubricentro',
  title: '',
  description: '',
  priceCop: '',
  discountPct: '',
  contact: '',
  acceptsSwalToken: false,
  region: '',
  radiusKm: '15',
  days: '30',
  classes: [],
  brands: '',
  models: '',
  yearFrom: '',
  yearTo: '',
  need: '',
  withinKm: '5000',
};

const list = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Numero o undefined si esta vacio; NaN si hay texto, para que parseOffer lo rechace. */
const optNum = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s.replace(/[.\s]/g, '').replace(',', '.')));

/**
 * Lo que el vendedor escribe en "Como acordar" a la forma que `parseOffer` valida: un numero
 * ("300 123 4567", "+57 300...") pasa a `tel:`; "wa.me/57300..." o "midominio.co" ganan `https://`.
 * Lo demas va tal cual y lo rechaza `parseOffer` si no es valido.
 */
export function normalizeContactInput(input: string): string {
  const s = input.trim();
  if (/^[+\d][\d\s().-]*$/.test(s)) return `tel:${s.replace(/[\s().-]/g, '')}`;
  if (/^(wa\.me\/|[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$))/i.test(s)) return `https://${s}`;
  return s;
}

export function draftToOffer(d: OfferDraft, now: number): Record<string, unknown> {
  const target: Record<string, unknown> = { classes: d.classes, brands: list(d.brands), models: list(d.models) };
  const from = optNum(d.yearFrom);
  const to = optNum(d.yearTo);
  if (from !== undefined || to !== undefined) target.years = { from: from ?? to, to: to ?? from };
  if (d.need) {
    target.need = d.need;
    target.withinKm = optNum(d.withinKm) ?? 0;
  }
  const out: Record<string, unknown> = {
    vendor: d.vendor,
    category: d.category,
    title: d.title,
    description: d.description,
    target,
    region: d.region,
    radiusKm: optNum(d.radiusKm),
    validFrom: now,
    validUntil: now + (optNum(d.days) ?? 0) * 24 * 60 * 60 * 1000,
  };
  if (d.contact.trim()) out.contact = normalizeContactInput(d.contact);
  if (d.acceptsSwalToken) out.acceptsSwalToken = true;
  for (const [k, v] of [
    ['priceCop', optNum(d.priceCop)],
    ['discountPct', optNum(d.discountPct)],
  ] as const) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
