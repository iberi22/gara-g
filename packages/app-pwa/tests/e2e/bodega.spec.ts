import { test, expect } from './fixtures';

test.describe('Bodega (Guest View)', () => {
  test('como invitado puede abrir /fleet/bodega, cargar un snapshot, ver 3 filas y el badge, sin enviar red', async ({ page, baseURL }) => {
    // Record external network requests to assert offline and read-only requirement
    const externalRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (baseURL && !url.startsWith(baseURL)) {
        externalRequests.push(url);
      }
    });

    // Use baseURL for domain in cookie
    const urlObj = new URL(baseURL || 'http://localhost:4321');
    await page.context().addCookies([
      { name: 'gara_mode', value: 'guest', domain: urlObj.hostname, path: '/' }
    ]);

    await page.goto('/fleet/bodega');

    // Make sure we landed correctly
    await expect(page.locator('h1, .topbar-title').first()).toContainText('Bodega');

    // A simple mock snapshot inline
    const mockSnapshot = {
      format: 'swal-inventory-export/v1',
      source: {
        appId: 'shelf',
        instanceId: 'test-instance',
        schemaVersion: 1,
        exportedAt: new Date().toISOString()
      },
      currency: 'COP',
      locations: [{ id: 'loc-1', name: 'Bodega Principal', type: 'bodega' }],
      items: [
        { id: 'i-1', name: 'Aceite Motor', sku: 'AM-10W40', quantity: 15, unit: 'L', minStock: 5, cost: 20000, price: 30000, locationId: 'loc-1' },
        { id: 'i-2', name: 'Filtro Aire', sku: 'FA-123', quantity: 2, unit: 'u', minStock: 5, cost: 15000, price: 25000, locationId: 'loc-1' },
        { id: 'i-3', name: 'Bujía', sku: 'BU-456', quantity: 20, unit: 'u', minStock: 10, cost: 8000, price: 15000, locationId: 'loc-1' }
      ],
      movements: []
    };

    const fileBuffer = Buffer.from(JSON.stringify(mockSnapshot), 'utf-8');

    // Find the file input and upload
    const fileChooserPromise = page.waitForEvent('filechooser');
    // Using the button label since input is hidden
    await page.locator('text="Seleccionar archivo"').click();
    const fileChooser = await fileChooserPromise;

    await fileChooser.setFiles({
      name: 'inventario.json',
      mimeType: 'application/json',
      buffer: fileBuffer
    });

    // Check that we see the badge with the appid
    await expect(page.locator('.badge')).toContainText('shelf');
    await expect(page.locator('.badge')).toContainText('test-instance');

    // Check we have the 3 items rendered
    const rows = page.locator('.table-container').last().locator('tbody tr');
    await expect(rows).toHaveCount(3);

    await expect(rows.nth(0)).toContainText('Aceite Motor');
    await expect(rows.nth(1)).toContainText('Filtro Aire');
    await expect(rows.nth(2)).toContainText('Bujía');

    // Check external requests
    expect(externalRequests).toEqual([]);
  });
});
