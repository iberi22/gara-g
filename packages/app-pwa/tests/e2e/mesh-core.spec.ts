import { test, expect, type Page } from '@playwright/test';

/**
 * M1 — nodo edge-mesh real en el navegador. Dos contextos (dos "dispositivos") cargan
 * `getMeshPort()` (src/mesh/node.ts, via el servidor de Vite del modo dev), se unen a la
 * misma sala por el servidor de senalizacion PeerJS y se mandan un mensaje firmado.
 *
 * Necesita internet (broker publico 0.peerjs.com y STUN de Google) o un servidor propio en
 * PUBLIC_MESH_SIGNAL_URL. Sin red el test se salta, no pasa en falso.
 */
test.setTimeout(120_000);
// Chromium oculta las IP locales con mDNS (.local) y en un entorno sin mDNS el ICE no conecta.
test.use({ launchOptions: { args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] } });

async function boot(page: Page, room: string) {
  // Pagina en blanco con el origen de la app: no depende del SSR, solo del servidor de modulos.
  await page.route('**/__mesh-blank', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>mesh</title>' }));
  await page.goto('/__mesh-blank', { waitUntil: 'domcontentloaded' });
  return page.evaluate(async (r) => {
    const w = window as any;
    const { getMeshPort } = await import(/* @vite-ignore */ '/src/mesh/node.ts');
    const port = await getMeshPort();
    w.__port = port;
    w.__got = [];
    port.subscribe('datos', 'ping', (m: unknown) => w.__got.push(m));
    await port.join('datos', r);
    return port.nodeId as string;
  }, room);
}

test('dos navegadores se ven y se pasan un mensaje firmado verificado', async ({ browser }) => {
  const room = `e2e-${Date.now()}`;
  const [ctxA, ctxB] = [await browser.newContext(), await browser.newContext()];
  const [a, b] = [await ctxA.newPage(), await ctxB.newPage()];

  const [idA, idB] = await Promise.all([boot(a, room), boot(b, room)]);
  expect(idA).toMatch(/^[0-9a-f]{32}$/);
  expect(idA).not.toBe(idB);

  const peers = (p: Page) => p.evaluate((r) => (window as any).__port.peerCount('datos', r), room);
  try {
    await expect.poll(() => peers(a), { timeout: 45_000, intervals: [1000] }).toBeGreaterThanOrEqual(1);
  } catch {
    test.skip(true, 'sin senalizacion PeerJS alcanzable (sin internet): no se pudo emparejar');
  }

  await a.evaluate((r) => (window as any).__port.publish('datos', r, 'ping', { hola: 'b' }, { sign: true }), room);
  await expect
    .poll(() => b.evaluate(() => (window as any).__got.length), { timeout: 20_000 })
    .toBe(1);
  const msg = await b.evaluate(() => (window as any).__got[0]);
  expect(msg).toMatchObject({ network: 'datos', room, topic: 'ping', from: idA, verified: true, payload: { hola: 'b' } });

  await ctxA.close();
  await ctxB.close();
});
