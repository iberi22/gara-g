import { describe, expect, it } from 'vitest';
import { LIMITS, RateLimiter, offerTags, parseContact, parseOffer } from './offer';
import { DAY, NOW, offer } from './testkit';

const ok = (o: unknown) => parseOffer(o, NOW);

describe('parseOffer', () => {
  it('acepta una oferta valida y la devuelve normalizada', () => {
    const r = ok(offer({ target: { classes: ['moto'], brands: ['Toyota '], models: [] }, title: '  Aceite  ' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.offer.title).toBe('Aceite');
      expect(r.offer.target.brands).toEqual(['toyota']);
    }
  });

  it('ignora campos desconocidos: no devuelve el objeto recibido', () => {
    const raw = { ...offer(), evil: '<script>', target: { classes: [], brands: [], models: [], x: 1 } };
    const r = ok(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.offer).not.toBe(raw);
      expect(JSON.stringify(r.offer)).not.toContain('evil');
    }
  });

  it('rechaza una oferta que pasa el tamano maximo', () => {
    const r = ok({ ...offer(), extra: 'x'.repeat(LIMITS.maxBytes) });
    expect(r).toMatchObject({ ok: false, error: 'tamano' });
  });

  it('rechaza textos demasiado largos en vez de truncarlos', () => {
    expect(ok(offer({ title: 'x'.repeat(LIMITS.title + 1) }))).toMatchObject({ ok: false, error: 'texto' });
    expect(ok(offer({ description: 'x'.repeat(LIMITS.description + 1) }))).toMatchObject({ ok: false, error: 'texto' });
  });

  it('rechaza categoria fuera de la lista', () => {
    expect(ok({ ...offer(), category: 'criptomonedas' })).toMatchObject({ ok: false, error: 'categoria' });
  });

  it('rechaza una oferta vencida', () => {
    expect(ok(offer({ validFrom: NOW - 3 * DAY, validUntil: NOW - DAY }))).toMatchObject({ ok: false, error: 'expirada' });
  });

  it('rechaza vigencias absurdas (mas de 90 dias, o fin antes del inicio)', () => {
    expect(ok(offer({ validUntil: NOW + 400 * DAY }))).toMatchObject({ ok: false, error: 'vigencia' });
    expect(ok(offer({ validFrom: NOW + 2 * DAY, validUntil: NOW + DAY }))).toMatchObject({ ok: false, error: 'vigencia' });
  });

  it('rechaza region, radio, precio y descuento invalidos', () => {
    expect(ok(offer({ region: 'aaaa' }))).toMatchObject({ ok: false, error: 'region' });
    expect(ok(offer({ region: 'd2g' }))).toMatchObject({ ok: false, error: 'region' });
    expect(ok(offer({ radiusKm: 5000 }))).toMatchObject({ ok: false, error: 'region' });
    expect(ok(offer({ priceCop: -5 }))).toMatchObject({ ok: false, error: 'precio' });
    expect(ok(offer({ discountPct: 150 }))).toMatchObject({ ok: false, error: 'precio' });
    expect(ok(offer({ payoutGara: Number.NaN }))).toMatchObject({ ok: false, error: 'precio' });
  });

  it('rechaza ids con caracteres raros y segmentacion invalida', () => {
    expect(ok(offer({ id: 'a b/c' }))).toMatchObject({ ok: false, error: 'id' });
    expect(ok({ ...offer(), target: { classes: ['barco'], brands: [], models: [] } })).toMatchObject({ ok: false, error: 'targeting' });
    expect(ok({ ...offer(), target: { classes: [], brands: [], models: [], withinKm: 5000 } })).toMatchObject({ ok: false, error: 'targeting' });
    expect(ok({ ...offer(), target: { classes: [], brands: [], models: [], years: { from: 2020, to: 2010 } } })).toMatchObject({ ok: false, error: 'targeting' });
  });

  it('no revienta con basura', () => {
    for (const bad of [null, 'x', 3, [], undefined, { id: 1 }]) expect(ok(bad).ok).toBe(false);
  });

  it('offerTags da etiquetas planas para mapear a DataOffer', () => {
    const r = ok(offer({ target: { classes: ['moto'], brands: ['yamaha'], models: [], need: 'aceite', withinKm: 5000 } }));
    if (!r.ok) throw new Error('debia ser valida');
    expect(offerTags(r.offer)).toEqual(['cat:lubricentro', 'cls:moto', 'brand:yamaha', 'need:aceite']);
  });
});

describe('RateLimiter', () => {
  it('limita por clave y se libera al pasar la ventana (reloj inyectado)', () => {
    let t = 0;
    const rl = new RateLimiter(2, 1000, () => t);
    expect(rl.allow('a')).toBe(true);
    expect(rl.allow('a')).toBe(true);
    expect(rl.allow('a')).toBe(false);
    expect(rl.allow('b')).toBe(true);
    t = 1001;
    expect(rl.allow('a')).toBe(true);
  });
});

describe('contacto del prestador', () => {
  const withContact = (c: unknown) => ok(offer({ contact: c as string }));

  it('acepta tel:, wa.me y https, y devuelve la forma canonica', () => {
    expect(parseContact('tel:+573001234567')).toEqual({ value: 'tel:+573001234567', kind: 'tel' });
    expect(parseContact('https://wa.me/573001234567')).toEqual({ value: 'https://wa.me/573001234567', kind: 'whatsapp' });
    // el texto prellenado de wa.me no viaja
    expect(parseContact('https://wa.me/573001234567?text=hola')).toEqual({ value: 'https://wa.me/573001234567?text=hola'.split('?')[0], kind: 'whatsapp' });
    expect(parseContact('https://tutaller.co/contacto')).toEqual({ value: 'https://tutaller.co/contacto', kind: 'web' });
    const r = withContact('https://wa.me/573001234567');
    expect(r.ok && r.offer.contact).toBe('https://wa.me/573001234567');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://tutaller.co',
    'https://user:pass@tutaller.co',
    'https://tutaller.co:8443/x',
    'https://localhost/x',
    'https://tutaller.co/ x',
    'https://tutaller.co/"onmouseover="x',
    'https://tutaller.co/<b>',
    'tel:123',
    'tel:+57 300 123 4567',
    'tel:javascript:1',
    'https://wa.me/abc',
    'https://wa.me/573001234567/extra',
    'mailto:a@b.co',
    '//tutaller.co',
    '',
    '   ',
  ])('rechaza %j', (c) => {
    expect(withContact(c)).toMatchObject({ ok: false, error: 'contacto' });
  });

  it('rechaza un contacto que no es texto o que pasa el limite de largo', () => {
    expect(withContact(12345)).toMatchObject({ ok: false, error: 'contacto' });
    expect(withContact({ href: 'https://a.co' })).toMatchObject({ ok: false, error: 'contacto' });
    expect(withContact(`https://tutaller.co/${'a'.repeat(LIMITS.contact)}`)).toMatchObject({ ok: false, error: 'contacto' });
  });

  it('acceptsSwalToken es un aviso booleano; otra cosa se rechaza y false no se guarda', () => {
    const t = ok(offer({ acceptsSwalToken: true }));
    expect(t.ok && t.offer.acceptsSwalToken).toBe(true);
    const f = ok(offer({ acceptsSwalToken: false }));
    expect(f.ok && 'acceptsSwalToken' in f.offer).toBe(false);
    expect(ok(offer({ acceptsSwalToken: 'si' as unknown as boolean }))).toMatchObject({ ok: false, error: 'forma' });
  });

  it('una oferta vieja con payoutGara se sigue leyendo (compatibilidad)', () => {
    const r = ok(offer({ payoutGara: 25 }));
    expect(r.ok && r.offer.payoutGara).toBe(25);
    expect(r.ok && r.offer.contact).toBeUndefined();
  });
});
