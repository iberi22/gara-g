import { describe, expect, it } from 'vitest';
import { parseOffer } from './offer';
import { EMPTY_DRAFT, draftToOffer, normalizeContactInput } from './offerForm';
import { BOGOTA, NOW } from './testkit';

describe('draftToOffer', () => {
  const draft = { ...EMPTY_DRAFT, vendor: 'Llantas Pepe', category: 'llanteria' as const, title: 'Alineacion gratis', region: BOGOTA };

  it('convierte textos a una oferta que parseOffer acepta', () => {
    const raw = {
      ...draftToOffer({ ...draft, priceCop: '120.000', discountPct: '15', brands: 'Toyota, Renault', yearFrom: '2010', yearTo: '2020', classes: ['liviano'], need: 'llantas' }, NOW),
      id: 'of_abcdef12',
      createdAt: NOW,
      active: true,
    };
    const r = parseOffer(raw, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.offer.priceCop).toBe(120000);
      expect(r.offer.target.brands).toEqual(['toyota', 'renault']);
      expect(r.offer.target.years).toEqual({ from: 2010, to: 2020 });
      expect(r.offer.validUntil - r.offer.validFrom).toBe(30 * 86_400_000);
    }
  });

  it('omite lo vacio y deja que parseOffer rechace el texto basura', () => {
    const base = draftToOffer(draft, NOW);
    expect(base).not.toHaveProperty('priceCop');
    const bad = { ...draftToOffer({ ...draft, priceCop: 'mucho' }, NOW), id: 'of_abcdef12', createdAt: NOW, active: true };
    expect(parseOffer(bad, NOW)).toMatchObject({ ok: false, error: 'precio' });
  });
});

describe('contacto en el formulario', () => {
  const draft = { ...EMPTY_DRAFT, vendor: 'Llantas Pepe', category: 'llanteria' as const, title: 'Alineacion gratis', region: BOGOTA };
  const parse = (d: typeof draft) => parseOffer({ ...draftToOffer(d, NOW), id: 'of_abcdef12', createdAt: NOW, active: true }, NOW);

  it.each([
    ['300 123 4567', 'tel:3001234567'],
    ['+57 (300) 123-4567', 'tel:+573001234567'],
    ['wa.me/573001234567', 'https://wa.me/573001234567'],
    ['https://wa.me/573001234567', 'https://wa.me/573001234567'],
    ['tutaller.co', 'https://tutaller.co/'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeContactInput(input)).toBeTruthy();
    const r = parse({ ...draft, contact: input });
    expect(r.ok && r.offer.contact).toBe(expected);
  });

  it('un contacto peligroso llega tal cual y parseOffer lo rechaza', () => {
    expect(normalizeContactInput('javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(parse({ ...draft, contact: 'javascript:alert(1)' })).toMatchObject({ ok: false, error: 'contacto' });
  });

  it('sin contacto no se manda el campo; el token SWAL solo si se marca; ya no hay payoutGara', () => {
    const base = draftToOffer(draft, NOW);
    expect(base).not.toHaveProperty('contact');
    expect(base).not.toHaveProperty('acceptsSwalToken');
    expect(base).not.toHaveProperty('payoutGara');
    expect(draftToOffer({ ...draft, acceptsSwalToken: true }, NOW)).toMatchObject({ acceptsSwalToken: true });
  });
});
