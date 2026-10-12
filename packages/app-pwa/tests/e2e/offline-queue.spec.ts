import { test, expect } from './fixtures';

test.describe('PWA Offline Queue E2E & Idempotency', () => {
  test('creates vehicle/fleet offline, reconnects, flushes outbox, and persists without duplicates', async ({ page, context }) => {
    // 1. Navigate to /fleets page
    await page.goto('/fleets');
    await page.waitForLoadState('networkidle');

    // Precargar los módulos ANTES de ir offline (offline no hay red
    // ni para el dev-server: los imports dinámicos fallarían)
    await page.evaluate(async () => {
      // @ts-ignore: URLs de módulo solo resolubles por el dev-server en runtime
      const m = await import('/src/lib/fleetStore.ts');
      // @ts-ignore: URLs de módulo solo resolubles por el dev-server en runtime
      const oq = await import('/src/lib/offlineQueue.ts');
      (window as any).__fleetStoreModule = m;
      (window as any).__offlineQueueModule = oq;
    });

    // 2. Go offline
    await context.setOffline(true);

    // 3. Perform offline mutation via UI (+ Nueva flota)
    await page.click('button:has-text("+ Nueva flota")');
    await page.fill('input[name="name"]', 'Offline Fleet Alpha');
    await page.fill('input[name="organizationId"]', 'org-off-1');
    await page.fill('input[name="region"]', 'US-Offline');
    await page.fill('input[name="tags"]', 'offline, depin');
    await page.click('button[type="submit"]');

    // 4. Verify local row appears immediately in UI while offline
    const tbody = page.locator('tbody');
    await expect(tbody).toBeVisible();
    await expect(tbody).toContainText('Offline Fleet Alpha');

    // 5. Encolar creación de vehículo offline (vía outbox: el feature real —
    // un addVehicle directo bypasea la cola y nunca llega al servidor)
    const vehId = await page.evaluate(async () => {
      const { enqueue } = (window as any).__offlineQueueModule;
      const op = await enqueue({
        entity: 'vehicle',
        action: 'create',
        entityId: 'v_offline_99',
        idempotencyKey: 'e2e-veh-v_offline_99',
        data: {
          id: 'v_offline_99',
          fleetId: 'fleet_off_1',
          vin: '1HGCR2F83HA999999',
          make: 'Tesla',
          model: 'Cybertruck',
          year: 2024,
          status: 'active',
          mileage: 500,
        },
      });
      return op.entityId;
    });

    expect(vehId).toBe('v_offline_99');

    // 6. Go back online
    await context.setOffline(false);

    // 7. Trigger online event & flush
    await page.evaluate(async () => {
      window.dispatchEvent(new Event('online'));
      const { createFleetStore } = (window as any).__fleetStoreModule;
      const store = createFleetStore('gara-g-default-instance');
      await store.flushOutbox();
    });

    // 8. Verify persistence across page reload
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(tbody).toContainText('Offline Fleet Alpha');

    // Re-precargar el módulo (el reload limpió window)
    await page.evaluate(async () => {
      // @ts-ignore: URL de módulo solo resoluble por el dev-server en runtime
      const m = await import('/src/lib/fleetStore.ts');
      (window as any).__fleetStoreModule = m;
    });

    // 9. Verify idempotency: run flush 2 times and ensure vehicle count & fleet count have no duplicates
    // La persistencia Yjs→IndexedDB es asíncrona: esperar con poll, no leer una vez
    await page.evaluate(async () => {
      const { createFleetStore } = (window as any).__fleetStoreModule;
      const store = createFleetStore('gara-g-default-instance');

      // Flush 1st time
      await store.flushOutbox();
      // Flush 2nd time
      await store.flushOutbox();
    });

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const { createFleetStore } = (window as any).__fleetStoreModule;
            const store = createFleetStore('gara-g-default-instance');
            return {
              fleetCount: store
                .listFleets()
                .filter((f: any) => f.name === 'Offline Fleet Alpha').length,
              vehicleCount: store
                .listVehicles()
                .filter((v: any) => v.id === 'v_offline_99').length,
            };
          }),
        { timeout: 15000 }
      )
      .toEqual({ fleetCount: 1, vehicleCount: 1 });
  });
});
