// @vitest-environment jsdom
/**
 * tests/mercado-conexion.test.ts — GARA-G conecta, no cobra: el mercado dice como acordar con
 * el prestador (contacto validado, nunca HTML crudo), avisa que no procesa pagos, y la seccion
 * "Todo para tus vehiculos" muestra lo que cada vehiculo puede necesitar.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import OfferCard from '../src/components/mercado/OfferCard.svelte';
import OfferForm from '../src/components/mercado/OfferForm.svelte';
import PaymentsNotice from '../src/components/mercado/PaymentsNotice.svelte';
import ConsentPanel from '../src/components/mercado/ConsentPanel.svelte';
import TodoVehiculos from '../src/components/mercado/TodoVehiculos.svelte';
import { DEFAULT_MARKET_PREFS } from '../src/mesh/datos/market';
import { PAYMENTS_NOTICE } from '../src/mesh/datos/offer';
import { EMPTY_DRAFT } from '../src/mesh/datos/offerForm';
import { BOGOTA, hilux, moto, offer } from '../src/mesh/datos/testkit';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

let app: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = '';
});
function show(C: unknown, props: Record<string, unknown>) {
  app = mount(C as any, { target: document.body, props });
  flushSync();
  return document.body;
}

describe('aviso de pagos', () => {
  it('dice que GARA-G no cobra ni procesa pagos entre clientes y prestadores', () => {
    const el = show(PaymentsNotice, {}).querySelector('[data-testid="payments-notice"]')!;
    expect(el.getAttribute('role')).toBe('note');
    expect(el.textContent).toBe(
      'GARA-G no cobra ni procesa pagos entre clientes y prestadores: los conecta. El pago se acuerda directamente o con el token de la red SWAL.',
    );
    expect(PAYMENTS_NOTICE).toBe(el.textContent);
  });

  it('esta en /fleet/mercado, en el vendedor y en la invitacion de /vender', () => {
    expect(src('src/components/mercado/MercadoApp.svelte')).toContain('<PaymentsNotice />');
    expect(src('src/components/mercado/VenderApp.svelte')).toContain('<PaymentsNotice />');
    expect(src('src/pages/fleet/mercado/vender.astro')).toContain('PAYMENTS_NOTICE');
  });
});

describe('OfferCard: acordar con el prestador', () => {
  const contactLink = () => document.querySelector<HTMLAnchorElement>('[data-testid="offer-contact"]');

  it('un WhatsApp valido es un enlace seguro (https, sin opener ni referrer)', () => {
    show(OfferCard, { offer: offer({ contact: 'https://wa.me/573001234567' }) });
    expect(document.querySelector('[data-testid="offer-deal"]')!.textContent).toContain('Acordar con el prestador');
    const a = contactLink()!;
    expect(a.getAttribute('href')).toBe('https://wa.me/573001234567');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(a.textContent).toContain('WhatsApp');
    expect(a.textContent).toContain('573001234567');
  });

  it('un telefono es tel: y un sitio muestra solo el dominio', () => {
    show(OfferCard, { offer: offer({ contact: 'tel:+573001234567' }) });
    expect(contactLink()!.getAttribute('href')).toBe('tel:+573001234567');
    expect(contactLink()!.hasAttribute('target')).toBe(false);
    unmount(app!);
    show(OfferCard, { offer: offer({ contact: 'https://tutaller.co/contacto?x=1' }) });
    expect(contactLink()!.textContent).toContain('tutaller.co');
    expect(contactLink()!.textContent).not.toContain('?x=1');
  });

  it('un contacto peligroso que llegara por la malla NO se vuelve enlace ni HTML', () => {
    for (const evil of ['javascript:alert(1)', 'data:text/html,<img src=x onerror=alert(1)>', 'https://a.co/"><img src=x onerror=alert(1)>']) {
      show(OfferCard, { offer: offer({ contact: evil }) });
      expect(contactLink()).toBeNull();
      expect(document.querySelector('a[href^="javascript"]')).toBeNull();
      expect(document.querySelector('img')).toBeNull();
      expect(document.querySelector('[data-testid="offer-no-contact"]')).not.toBeNull();
      unmount(app!);
    }
    app = undefined;
  });

  it('sin contacto lo dice; el token SWAL es solo una etiqueta; ya no se muestra payoutGara', () => {
    show(OfferCard, { offer: offer({ acceptsSwalToken: true, payoutGara: 50 }) });
    expect(document.querySelector('[data-testid="offer-no-contact"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="offer-swal"]')!.textContent).toBe('Acepta token SWAL');
    expect(document.body.textContent).not.toMatch(/50 GARA|Reconoce/);
    expect(document.body.textContent).toContain('GARA-G no cobra');
  });

  it('sin la marca de token no la muestra', () => {
    show(OfferCard, { offer: offer({ contact: 'tel:3001234567' }) });
    expect(document.querySelector('[data-testid="offer-swal"]')).toBeNull();
  });
});

describe('formulario del vendedor y consentimiento', () => {
  it('pide contacto y la marca del token, y ya no pide "pago al dueño en GARA"', () => {
    show(OfferForm, { draft: { ...EMPTY_DRAFT }, cities: [{ name: 'Bogotá', cell: BOGOTA }], onsubmit: () => {} });
    expect(document.querySelector<HTMLInputElement>('[data-testid="contact-input"]')!.closest('label')!.textContent).toContain('Contacto');
    expect(document.querySelector<HTMLInputElement>('[data-testid="swal-token"]')!.type).toBe('checkbox');
    expect(document.body.textContent).not.toMatch(/Pago al dueño|payout/i);
    expect(document.body.textContent).toContain('GARA-G solo conecta');
  });

  it('el panel de consentimiento ya no ofrece un "pago minimo en GARA"', () => {
    show(ConsentPanel, { prefs: DEFAULT_MARKET_PREFS, demandEnabled: false, demandDetail: 'basic', preview: [], available: true, onprefs: () => {}, ondemand: () => {} });
    expect(document.body.textContent).not.toMatch(/Pago m[ií]nimo/);
  });
});

describe('Todo para tus vehiculos', () => {
  const props = (over: Record<string, unknown> = {}) => ({
    vehicles: [hilux(), moto()],
    inbox: [] as unknown[],
    region: BOGOTA,
    prefs: {
      ...DEFAULT_MARKET_PREFS,
      enabled: true,
      categories: ['offer:lubricentro', 'offer:repuestos', 'offer:taller', 'offer:llanteria', 'offer:revision', 'offer:seguro']
    },
    ...over,
  });
  const asInbox = (...os: ReturnType<typeof offer>[]) => os.map((o) => ({ offer: o, score: 1, why: 'Porque sí.', reasons: ['Porque sí.'], distanceKm: 0, from: 'abcdef1234567890' }));

  it('un bloque por vehiculo, con encabezado y lista de rubros', () => {
    show(TodoVehiculos, props());
    const blocks = document.querySelectorAll('[data-testid="tv-vehicle"]');
    expect(blocks).toHaveLength(2);
    for (const b of blocks) {
      const h = b.querySelector('h3')!;
      expect(b.getAttribute('aria-labelledby')).toBe(h.id);
      expect(b.querySelectorAll('ul > li').length).toBeGreaterThan(5);
    }
    expect(blocks[0].querySelector('h3')!.textContent).toContain('Toyota Hilux 2018');
    // accesorios propios de cada clase
    expect(blocks[1].textContent).toContain('Casco y protecciones');
    expect(blocks[0].textContent).not.toContain('Casco y protecciones');
    expect(blocks[0].textContent).toContain('Kit de carretera');
  });

  it('lo que vence pronto va primero y esta marcado', () => {
    show(TodoVehiculos, props({ vehicles: [hilux()] }));
    const items = [...document.querySelectorAll('[data-testid="tv-vehicle"] ul > li')];
    expect(items[0].getAttribute('data-testid')).toBe('tv-item-soon');
    expect(items[0].textContent).toContain('Cambio de aceite');
    expect(items[0].textContent).toContain('Vence en ~800 km');
    expect(items[1].getAttribute('data-testid')).toBe('tv-item');
  });

  it('muestra las ofertas recibidas que le sirven al vehiculo, bajo su rubro', () => {
    const o = offer({ id: 'aceite-0001', title: 'Aceite 20W50 para Toyota', target: { classes: [], brands: ['toyota'], models: [] } });
    show(TodoVehiculos, props({ inbox: asInbox(o) }));
    const [hiluxBlock, motoBlock] = document.querySelectorAll('[data-testid="tv-vehicle"]');
    const first = hiluxBlock.querySelector('ul > li')!;
    expect(first.querySelector('[data-testid="offer-card"]')!.textContent).toContain('Aceite 20W50 para Toyota');
    expect(motoBlock.textContent).not.toContain('Aceite 20W50 para Toyota');
    expect(motoBlock.textContent).toContain('Sin ofertas por ahora');
  });

  it('sin ciudad no hay ofertas pero si rubros, y avisa; sin vehiculos invita al garage', () => {
    show(TodoVehiculos, props({ region: null, inbox: asInbox(offer()) }));
    expect(document.querySelectorAll('[data-testid="offer-card"]')).toHaveLength(0);
    expect(document.body.textContent).toContain('Elige tu ciudad');
    unmount(app!);
    show(TodoVehiculos, props({ vehicles: [] }));
    expect(document.querySelector('[data-testid="tv-empty"]')!.querySelector('a')!.getAttribute('href')).toBe('/fleet/garage');
  });

  it('mientras carga no dice que no hay vehiculos', () => {
    show(TodoVehiculos, props({ vehicles: [], loaded: false }));
    expect(document.querySelector('[data-testid="tv-empty"]')).toBeNull();
  });

  it('CSS: sin colores fijos fuera de los var(--swal-*), y los enlaces miden 44 px', () => {
    const css = src('src/components/mercado/TodoVehiculos.svelte').split('<style>')[1];
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![^)]*\))/);
    expect(css).toMatch(/a \{[^}]*min-height: 44px/);
    expect(src('src/components/mercado/MercadoApp.svelte')).toMatch(/role="tablist"/);
  });
});
