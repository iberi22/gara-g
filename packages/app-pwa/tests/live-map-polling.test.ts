// @vitest-environment jsdom
/**
 * tests/live-map-polling.test.ts — wave-32/23 (fitBounds/marcadores) y wave-32/10 (error de carga)
 * sobre LiveMap: se monta de verdad en jsdom con fetch simulado.
 *
 * - Un ciclo de polling no destruye los marcadores ni vuelve a encuadrar: el popup abierto y el
 *   zoom del usuario sobreviven (antes: remove()+addTo() y fitBounds en cada ciclo de 5 s).
 * - Un fallo de carga no se pinta como "no hay posiciones": estado degradado + role=alert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LiveMap from '../src/components/tracking/LiveMap.svelte';

const row = (vin: string, plate: string, lat: number, lng: number, speed = 40) => ({
  vin,
  plate,
  latitude: lat,
  longitude: lng,
  timestamp: Date.now(),
  formattedSpeed: `${speed} km/h`,
  formattedRpm: '2000',
  formattedTemp: '90°C',
  formattedFuel: '70%',
  formattedLat: String(lat),
  formattedLng: String(lng),
});

/**
 * Deja correr los microtasks/macrotasks reales que necesita el componente: import dinamico
 * de leaflet, fetch simulado y render de Svelte.
 *
 * Antes eran 8 x 15 ms fijos (120 ms). Es un presupuesto de reloj, no una condicion: con la
 * maquina cargada (suite completa, 12 workers) el mapa aun no habia terminado de montarse y el
 * test fallaba con "expected fitBounds to be called 1 times, but got 0" sin que el codigo
 * cambiara. Ahora se espera a que `cond` sea cierta. El techo de 2 s es solo la red de
 * seguridad para que una condicion mal escrita falle en vez de colgar la suite: en una maquina
 * sana la condicion se cumple en decenas de ms.
 */
const flush = async (cond?: () => boolean, timeoutMs = 2_000) => {
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 10));
    flushSync();
    if (cond?.()) return;
    if (Date.now() - started >= timeoutMs) return;
  }
};

let app: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LiveMap: ciclos de polling', () => {
  it('reutiliza los marcadores, mantiene el popup abierto y encuadra solo la primera vez', async () => {
    const L: any = await import('leaflet');
    const fit = vi.spyOn(L.Map.prototype, 'fitBounds');
    const removeMarker = vi.spyOn(L.Marker.prototype, 'remove');
    let speed = 40;
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: [row('V1', 'AAA111', 4.6, -74.08, speed), row('V2', 'BBB222', 4.7, -74.0, speed)] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    app = mount(LiveMap as any, { target: document.body, props: { initialRows: [] } });
    // El mapa monta y encuadra una sola vez. Se espera a lo que se afirma (el encuadre), no a
    // algo que parezca equivalente: los marcadores se anaden antes de fitBounds.
    await flush(() => fit.mock.calls.length >= 1);

    expect(fit).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.leaflet-marker-icon')).toHaveLength(2);

    // El usuario abre un popup...
    const markerEls = [...document.querySelectorAll('.leaflet-marker-icon')] as HTMLElement[];
    markerEls[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush(() => document.querySelector('.leaflet-popup') !== null);
    expect(document.querySelector('.leaflet-popup')).not.toBeNull();
    expect(document.querySelector('.leaflet-popup')!.textContent).toContain('40 km/h');

    // ...y llega el siguiente ciclo con datos nuevos.
    speed = 77;
    vi.advanceTimersByTime(5000);
    await flush(() => document.querySelector('.leaflet-popup')?.textContent?.includes('77 km/h') === true);

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(removeMarker).not.toHaveBeenCalled();
    expect(fit).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.leaflet-popup')).not.toBeNull();
    expect(document.querySelector('.leaflet-popup')!.textContent).toContain('77 km/h');
  });
});

describe('LiveMap: error de carga', () => {
  it('un 500 no se presenta como flota vacia: alerta con el motivo, indicador degradado y reintento', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    app = mount(LiveMap as any, { target: document.body, props: { initialRows: [] } });
    await flush(() => document.querySelector('[data-testid="tracking-load-error"]') !== null);

    const alert = document.querySelector('[data-testid="tracking-load-error"]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('HTTP 500');
    expect(document.body.textContent).not.toContain('No se encontraron posiciones recientes');
    expect(document.querySelector('[data-testid="tracking-degraded"]')!.textContent).toContain('Sin conexión desde');
    expect(document.querySelector('.live-dot')!.classList.contains('pulsing')).toBe(false);

    // Reintentar: el siguiente ciclo bueno limpia el error.
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [row('V1', 'AAA111', 4.6, -74.08)] }), { status: 200 }));
    (document.querySelector('button.bg-muted') as HTMLButtonElement | null)?.click();
    await flush(() => document.querySelector('[data-testid="tracking-load-error"]') === null);
    expect(document.querySelector('[data-testid="tracking-load-error"]')).toBeNull();
    expect(document.querySelector('[data-testid="tracking-degraded"]')).toBeNull();
  });

  it('una lista vacia de verdad sigue diciendo que no hay posiciones (sin alerta)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));
    app = mount(LiveMap as any, { target: document.body, props: { initialRows: [] } });
    await flush(() => (document.body.textContent ?? '').includes('No se encontraron posiciones recientes'));
    expect(document.body.textContent).toContain('No se encontraron posiciones recientes');
    expect(document.querySelector('[data-testid="tracking-load-error"]')).toBeNull();
  });
});
