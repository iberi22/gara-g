import { test, expect, type Page } from './fixtures';

/**
 * wave-32/23 — Los mapas se pintan sin CDN, la vista no salta en cada ciclo de polling y las
 * lineas de Chart.js llevan un color concreto del tema.
 *
 * "Sin red" aqui es: unpkg.com y los tiles de OSM abortados. Antes los tres mapas pedian
 * leaflet.css a unpkg, asi que sin red .leaflet-pane no era `position:absolute` y el mapa salia crudo.
 */

async function blockCdn(page: Page, requested: string[]) {
  await page.route(/unpkg\.com|tile\.openstreetmap\.org/, (route) => {
    requested.push(route.request().url());
    return route.abort('internetdisconnected');
  });
}

async function expectLeafletStyled(page: Page) {
  await expect(page.locator('.leaflet-container').first()).toBeVisible();
  await expect(page.locator('.leaflet-control-zoom').first()).toBeVisible();
  // leaflet.css: los paneles se posicionan en absoluto; sin la hoja son bloques estaticos.
  const pos = await page.evaluate(() => getComputedStyle(document.querySelector('.leaflet-pane')!).position);
  expect(pos).toBe('absolute');
}

const unpkg = (urls: string[]) => urls.filter((u) => u.includes('unpkg.com'));

test.describe('Leaflet empaquetado: mapas con estilos sin CDN', () => {
  test('/fleet/tracking', async ({ page }) => {
    const requested: string[] = [];
    await blockCdn(page, requested);
    await page.goto('/fleet/tracking');
    await expectLeafletStyled(page);
    expect(unpkg(requested)).toEqual([]);
  });

  test('/geofences', async ({ page }) => {
    const requested: string[] = [];
    await blockCdn(page, requested);
    await page.goto('/geofences');
    await expectLeafletStyled(page);
    expect(unpkg(requested)).toEqual([]);
  });

  test('/fleet/geofences (mapa tras "Ver mapa")', async ({ page }) => {
    const requested: string[] = [];
    await blockCdn(page, requested);
    await page.goto('/fleet/geofences');
    await page.getByTestId('toggle-map-view').click();
    await expect(page.locator('#geofence-map .leaflet-container, #geofence-map.leaflet-container').first()).toBeVisible();
    await expectLeafletStyled(page);
    expect(unpkg(requested)).toEqual([]);
  });
});

test.describe('LiveMap: el polling no cierra el popup ni resetea el zoom', () => {
  test('popup abierto y zoom del usuario sobreviven a un ciclo de 5 s', async ({ page }) => {
    let speed = 40;
    await page.route('**/api/fleet/telemetry**', (route) => {
      const row = (vin: string, plate: string, lat: number, lng: number) => ({
        vin, plate, latitude: lat, longitude: lng, timestamp: Date.now(),
        formattedSpeed: `${speed} km/h`, formattedRpm: '2000', formattedTemp: '90°C', formattedFuel: '70%',
        formattedLat: String(lat), formattedLng: String(lng),
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [row('VIN-A', 'AAA111', 4.6, -74.08), row('VIN-B', 'BBB222', 4.7, -74.0)] }),
      });
    });
    await blockCdn(page, []);
    await page.goto('/fleet/tracking');
    const markers = page.locator('.leaflet-marker-icon');
    await expect(markers).toHaveCount(2);

    // El usuario hace zoom y abre el popup de un vehiculo.
    await page.locator('.leaflet-control-zoom-in').click();
    await page.waitForTimeout(500);
    const gap = async () => {
      const [a, b] = await markers.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x));
      return Math.abs(a - b);
    };
    const gapBefore = await gap();
    await markers.first().click();
    await expect(page.locator('.leaflet-popup')).toContainText('40 km/h');

    speed = 88;
    await page.waitForTimeout(6500); // un ciclo de polling (5 s) completo

    await expect(page.locator('.leaflet-popup')).toBeVisible();
    await expect(page.locator('.leaflet-popup')).toContainText('88 km/h'); // se actualizo en sitio
    expect(Math.abs((await gap()) - gapBefore)).toBeLessThan(2); // mismo zoom/encuadre
  });
});

test.describe('LiveChart: las lineas llevan color concreto', () => {
  test('/telemetry: los canvas tienen pixeles del color de acento del tema (no var())', async ({ page }) => {
    await page.goto('/telemetry');
    await page.waitForSelector('[data-testid="ingest-sample-btn"]');
    for (let i = 0; i < 6; i++) await page.getByTestId('ingest-sample-btn').click();
    await page.waitForTimeout(800);

    const found = await page.evaluate(() => {
      // El color que Chart.js debe haber recibido: el token resuelto a rgb por el navegador.
      const probe = document.createElement('i');
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--swal-accent').trim();
      document.body.append(probe);
      const m = getComputedStyle(probe).color.match(/\d+/g)!.map(Number);
      probe.remove();
      let best = 0;
      for (const c of document.querySelectorAll('canvas')) {
        const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 200 && Math.abs(data[i] - m[0]) < 16 && Math.abs(data[i + 1] - m[1]) < 16 && Math.abs(data[i + 2] - m[2]) < 16) n++;
        }
        best = Math.max(best, n);
      }
      return { accent: m, best };
    });
    expect(found.best, `ningun pixel del acento ${found.accent}`).toBeGreaterThan(20);
  });
});
