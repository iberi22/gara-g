import { existsSync } from 'node:fs';
import { test, expect } from './fixtures';
import { gotoStable } from './helpers/navigation';
import { useAdminSession } from './helpers/auth';

/**
 * Replica de telemetria entre dos dispositivos del mismo tenant.
 *
 * Viaja por el puerto edge-mesh de la app (`getMeshPort()`, red `datos`, sala acotada por el
 * instanceId de la sesion, mensajes firmados), con el broker publico de PeerJS como senalizacion
 * y WebRTC entre los dos contextos. Antes iba por y-webrtc con servidores de senalizacion
 * publicos de Yjs que ya no existen, y esta spec no podia pasar nunca.
 *
 * Confidencialidad: la sala es `telemetry/<roomId>` y cada payload va cifrado con AES-256-GCM bajo
 * una clave que solo entrega GET /api/mesh/room-key (con sesion, y solo del tenant de la sesion).
 * Sin sesion no hay clave, asi que ese nodo no se une a la malla.
 *
 * Chromium oculta las IP locales detras de mDNS y en este sandbox los dos contextos no se
 * encuentran sin `--disable-features=WebRtcHideLocalIpsWithMdns`.
 */
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync('/run/current-system/sw/bin/chromium')
    ? '/run/current-system/sw/bin/chromium'
    : existsSync('/usr/bin/google-chrome')
    ? '/usr/bin/google-chrome'
    : undefined);
test.use({
  launchOptions: {
    ...(executablePath ? { executablePath } : {}),
    args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
  },
});

// Descubrir al otro nodo pasa por reclamar un slot en el broker (hasta 8 s) y re-sondear (10 s).
test.setTimeout(150_000);
const MESH_TIMEOUT = 60_000;

// En serie: todos los dispositivos de test son del mismo tenant (misma sala), y dos tests a la vez
// se verian entre si como pares y descuadrarian el contador de la malla.
test.describe.configure({ mode: 'serial' });

test.describe('Mesh Telemetry Real-Time Ingest & Sync E2E (edge-mesh)', () => {
  test('room-key: sin sesion 401; con sesion sala+clave del tenant (ignora ?instanceId=) y sin instanceId en la respuesta', async ({ browser }) => {
    const anon = await browser.newContext();
    const denied = await anon.request.get('/api/mesh/room-key');
    expect(denied.status()).toBe(401);
    expect(await denied.text()).not.toMatch(/"key"/);
    await anon.close();

    const ctx = await browser.newContext();
    await useAdminSession(ctx);
    const ok = await ctx.request.get('/api/mesh/room-key');
    expect(ok.status()).toBe(200);
    expect(ok.headers()['cache-control']).toBe('no-store');
    const body = await ok.json();
    expect(body.roomId).toMatch(/^[0-9a-f]{32}$/);
    expect(body.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const spoofed = await (await ctx.request.get('/api/mesh/room-key?instanceId=otro-tenant')).json();
    expect(spoofed.roomId).toBe(body.roomId);
    expect(spoofed.key).toBe(body.key);
    await ctx.close();
  });

  test('si el servidor niega la clave la grafica no abre la malla: queda en local, sin sala sin cifrar', async ({ browser }) => {
    // Con la ruta de la clave denegada (401/503) la grafica debe quedar en local.
    const ctx = await browser.newContext();
    await useAdminSession(ctx);
    await ctx.route('**/api/mesh/room-key', (route) => route.fulfill({ status: 503, body: '{"ok":false}', contentType: 'application/json' }));
    const page = await ctx.newPage();
    await gotoStable(page, '/telemetry');
    await expect(page.getByTestId('peer-status')).toHaveText(/Malla no disponible \(solo local\)/, { timeout: 30_000 });
    await page.getByTestId('ingest-sample-btn').click(); // y la grafica sigue funcionando en local
    await ctx.close();
  });

  test('2 browser contexts navigate to /telemetry, context A ingests OBD2 record VIN-V1, context B observes it replicated over the mesh without localStorage', async ({ browser }) => {
    // Prohibited check: NO localStorage usage for sync
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    // /telemetry exige sesion (middleware): cada nodo entra como admin.
    await useAdminSession(contextA);
    await useAdminSession(contextB);

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // Both navigate to telemetry dashboard page
    await gotoStable(pageA, '/telemetry');
    await gotoStable(pageB, '/telemetry');

    // Wait for pages to load UI elements
    await pageA.waitForSelector('[data-testid="ingest-sample-btn"]');
    await pageB.waitForSelector('[data-testid="vin-selector"]');

    // Los dos nodos se ven por el mesh (si no, lo que sigue seria una espera a ciegas).
    await expect(pageA.getByTestId('peer-status')).toHaveText(/Malla activa \(1 par\)/, { timeout: MESH_TIMEOUT });
    await expect(pageB.getByTestId('peer-status')).toHaveText(/Malla activa \(1 par\)/, { timeout: MESH_TIMEOUT });

    // Context A ingests a specific record via page evaluation onto Yjs TelemetryIngestManager stream
    await pageA.evaluate(() => {
      // @ts-ignore
      const manager = (window as any).telemetryManager;
      if (manager) {
        manager.ingestOBD2Data({
          vin: 'VIN-V1',
          timestamp: Date.now(),
          speed: 95,
          rpm: 3100,
          coolantTemp: 89,
          fuelLevel: 82,
          latitude: 4.6097,
          longitude: -74.0817,
          troubleCodes: [],
          odometer: 142000,
        });
      } else {
        // Fallback: click sample button if global manager is unattached
        const btn = document.querySelector('[data-testid="ingest-sample-btn"]') as HTMLButtonElement;
        if (btn) btn.click();
      }
    });

    // Context B selects VIN-V1 or checks synced state via Y.Doc stream
    await expect.poll(async () => {
      return pageB.evaluate(() => {
        const selector = document.querySelector('[data-testid="vin-selector"]') as HTMLSelectElement;
        if (!selector) return false;
        const options = Array.from(selector.options).map(o => o.value);
        return options.includes('VIN-V1');
      });
    }, { timeout: 30000, intervals: [500] }).toBe(true);

    // Context B verifies the odometer from the replicated record (selecting VIN-V1)
    await pageB.getByTestId('vin-selector').selectOption('VIN-V1');
    await expect(pageB.locator('[data-testid="odometer-value"]')).toHaveText(/142[.,]?000/);

    await contextA.close();
    await contextB.close();
  });

  test('Trouble codes propagation: context A ingests with troubleCodes P0420 and P0171, context B observes those codes in the DOM', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    // /telemetry exige sesion (middleware): cada nodo entra como admin.
    await useAdminSession(contextA);
    await useAdminSession(contextB);

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await gotoStable(pageA, '/telemetry');
    await gotoStable(pageB, '/telemetry');

    await pageA.waitForSelector('[data-testid="ingest-sample-btn"]');
    await pageB.waitForSelector('[data-testid="trouble-codes-list"]');
    await expect(pageA.getByTestId('peer-status')).toHaveText(/Malla activa \(1 par\)/, { timeout: MESH_TIMEOUT });
    await expect(pageB.getByTestId('peer-status')).toHaveText(/Malla activa \(1 par\)/, { timeout: MESH_TIMEOUT });

    // Context A ingests DTC record with P0420 and P0171
    await pageA.evaluate(() => {
      // Trigger Y.Doc update in page context
      const ev = new CustomEvent('ingest-obd2-record', {
        detail: {
          vin: 'VIN-DTC-TEST',
          timestamp: Date.now(),
          speed: 55,
          rpm: 2200,
          coolantTemp: 95,
          fuelLevel: 45,
          latitude: 6.2442,
          longitude: -75.5812,
          troubleCodes: ['P0420', 'P0171'],
          odometer: 88900,
        },
      });
      window.dispatchEvent(ev);
    });

    // In case event isn't hooked to custom event, evaluate directly on manager
    await pageA.evaluate(() => {
      // @ts-ignore
      const doc = (window as any).yDoc || (window as any).telemetryDoc;
      if (doc) {
        const stream = doc.getArray('telemetry_stream');
        stream.push([{
          vin: 'VIN-DTC-TEST',
          timestamp: Date.now(),
          speed: 55,
          rpm: 2200,
          coolantTemp: 95,
          fuelLevel: 45,
          latitude: 6.2442,
          longitude: -75.5812,
          troubleCodes: ['P0420', 'P0171'],
          odometer: 88900,
        }]);
      }
    });

    // Verify Context B sees P0420 and P0171 trouble code items rendered in DOM
    await expect.poll(async () => {
      return pageB.evaluate(() => {
        const codesContainer = document.querySelector('[data-testid="trouble-codes-list"]');
        if (!codesContainer) return [];
        const items = Array.from(codesContainer.querySelectorAll('[data-testid="trouble-code-item"]'));
        return items.map(el => el.textContent?.trim() || '');
      });
    }, { timeout: 30000, intervals: [500] }).toEqual(
      expect.arrayContaining([
        expect.stringContaining('P0420'),
        expect.stringContaining('P0171'),
      ])
    );

    await contextA.close();
    await contextB.close();
  });
});
