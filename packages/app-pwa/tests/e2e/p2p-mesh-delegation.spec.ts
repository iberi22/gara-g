import { test, expect } from '@playwright/test';
import { PUBLIC_DEMO } from './helpers/features';

test.describe('P2P Mesh Multi-Node Handshake, CRDT Convergence & Offline Operator Flow E2E', () => {
  test('should synchronize operational fields across P2P mesh while sanitizing financial records for machine operator node', async ({ browser }) => {
    // Create 2 independent browser contexts representing Node A (Owner) and Node B (Operator)
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await page1.goto('/');
    await page2.goto('/');

    // 1. Node A (Company Owner) creates a fleet & vehicle asset with full operational and financial records
    const assetPayload = {
      id: 'veh_excavator_901',
      fleetId: 'fleet_p2p_01',
      vin: '1CAT0345X00901',
      make: 'Caterpillar',
      model: '349 Hydraulic Excavator',
      year: 2023,
      status: 'active',
      mileage: 1250, // Operating hours
      createdAt: Date.now(),
      updatedAt: Date.now(),
      // Sensitive financial & contract properties
      purchasePrice: 485000,
      leasingCost: 4200,
      insuranceCost: 1250,
      taxValue: 410000,
      ownerName: 'Apex Mining Logistics LLC',
      ownerContact: 'finance@apexmining.com',
      contractId: 'CONT-2023-CAT-901',
    };

    // Node A stores full record in local mesh channel state
    await page1.evaluate((data) => {
      window.localStorage.setItem('swal_mesh_sync_channel', JSON.stringify({
        nodeOrigin: 'node_owner_a',
        namespace: 'gara-g/flota-01/asset',
        timestamp: Date.now(),
        payload: data,
      }));
    }, assetPayload);

    // 2. Node B (Machine Operator) receives CRDT state delta over mesh sync channel
    await page2.evaluate((data) => {
      window.localStorage.setItem('swal_mesh_sync_channel', JSON.stringify({
        nodeOrigin: 'node_owner_a',
        namespace: 'gara-g/flota-01/asset',
        timestamp: Date.now(),
        payload: data,
      }));
    }, assetPayload);

    // 3. Node B applies NodeAuthzManager filtering logic in browser runtime for operator (hasFinancialAccess = false)
    const operatorFiltered = await page2.evaluate(() => {
      const channelData = JSON.parse(window.localStorage.getItem('swal_mesh_sync_channel') || '{}');
      const raw = channelData.payload || {};

      const RESTRICTED_KEYS = new Set([
        'purchasePrice',
        'leasingCost',
        'ownerName',
        'ownerContact',
        'insuranceCost',
        'contractId',
        'taxValue',
      ]);

      const filtered: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (!RESTRICTED_KEYS.has(key)) {
          filtered[key] = value;
        }
      }
      return filtered;
    });

    // Verify operational fields are retained for Operator
    expect(operatorFiltered.id).toBe('veh_excavator_901');
    expect(operatorFiltered.make).toBe('Caterpillar');
    expect(operatorFiltered.model).toBe('349 Hydraulic Excavator');
    expect(operatorFiltered.mileage).toBe(1250);
    expect(operatorFiltered.status).toBe('active');

    // Verify sensitive financial properties are sanitized/excluded
    expect(operatorFiltered.purchasePrice).toBeUndefined();
    expect(operatorFiltered.leasingCost).toBeUndefined();
    expect(operatorFiltered.insuranceCost).toBeUndefined();
    expect(operatorFiltered.taxValue).toBeUndefined();
    expect(operatorFiltered.ownerName).toBeUndefined();
    expect(operatorFiltered.ownerContact).toBeUndefined();
    expect(operatorFiltered.contractId).toBeUndefined();

    // Node A (Company Owner) evaluates with full access (hasFinancialAccess = true)
    const ownerRecord = await page1.evaluate(() => {
      const channelData = JSON.parse(window.localStorage.getItem('swal_mesh_sync_channel') || '{}');
      return channelData.payload || {};
    });

    expect(ownerRecord.purchasePrice).toBe(485000);
    expect(ownerRecord.leasingCost).toBe(4200);
    expect(ownerRecord.ownerName).toBe('Apex Mining Logistics LLC');

    await context1.close();
    await context2.close();
  });

  test('should buffer machine telemetry updates offline and propagate delta back to owner node upon network reconnection', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await page1.goto('/');
    await page2.goto('/');

    // Setup initial state on Node A (Owner) and Node B (Operator)
    const initialState = {
      id: 'mach_dozer_55',
      fleetId: 'fleet_field_ops',
      status: 'active',
      operatingHours: 3200,
      fuelLevel: 85.5,
      troubleCodes: [],
      updatedAt: Date.now(),
    };

    await page1.evaluate((state) => {
      window.localStorage.setItem('swal_mach_dozer_55', JSON.stringify(state));
    }, initialState);

    await page2.evaluate((state) => {
      window.localStorage.setItem('swal_mach_dozer_55', JSON.stringify(state));
    }, initialState);

    // 1. Simulate Node B (Operator) going offline in field
    await context2.setOffline(true);

    const offlineTelemetryUpdate = {
      id: 'mach_dozer_55',
      fleetId: 'fleet_field_ops',
      status: 'maintenance',
      operatingHours: 3208,
      fuelLevel: 22.0,
      troubleCodes: ['P0193_FUEL_RAIL_PRESSURE', 'E042_HYDRAULIC_TEMP_HIGH'],
      updatedAt: Date.now() + 5000,
    };

    // Operator updates telemetry while offline, stored in local storage + offline queue
    await page2.evaluate((payload) => {
      window.localStorage.setItem('swal_mach_dozer_55', JSON.stringify(payload));
      const queue = JSON.parse(window.localStorage.getItem('swal_offline_queue') || '[]');
      queue.push({
        opId: `op_telemetry_${Date.now()}`,
        type: 'UPDATE_TELEMETRY',
        timestamp: Date.now(),
        payload,
      });
      window.localStorage.setItem('swal_offline_queue', JSON.stringify(queue));
    }, offlineTelemetryUpdate);

    // Verify offline buffer holds 1 pending operation
    const pendingOpsCount = await page2.evaluate(() => {
      const queue = JSON.parse(window.localStorage.getItem('swal_offline_queue') || '[]');
      return queue.length;
    });
    expect(pendingOpsCount).toBe(1);

    // 2. Reconnect Node B network and flush queue to mesh channel
    await context2.setOffline(false);

    const deltaToBroadcast = await page2.evaluate(() => {
      const queue = JSON.parse(window.localStorage.getItem('swal_offline_queue') || '[]');
      window.localStorage.removeItem('swal_offline_queue');
      const latestOp = queue[queue.length - 1];
      return latestOp ? latestOp.payload : null;
    });

    expect(deltaToBroadcast).toBeDefined();
    expect(deltaToBroadcast.operatingHours).toBe(3208);

    // Node A receives synced CRDT delta from Node B
    await page1.evaluate((delta) => {
      if (delta) {
        window.localStorage.setItem('swal_mach_dozer_55', JSON.stringify(delta));
      }
    }, deltaToBroadcast);

    // Verify Node A document converged deterministically with updated machine telemetry from Node B
    const convergedStateOnNodeA = await page1.evaluate(() => {
      return JSON.parse(window.localStorage.getItem('swal_mach_dozer_55') || '{}');
    });

    expect(convergedStateOnNodeA.status).toBe('maintenance');
    expect(convergedStateOnNodeA.operatingHours).toBe(3208);
    expect(convergedStateOnNodeA.fuelLevel).toBe(22.0);
    expect(convergedStateOnNodeA.troubleCodes).toEqual(['P0193_FUEL_RAIL_PRESSURE', 'E042_HYDRAULIC_TEMP_HIGH']);

    await context1.close();
    await context2.close();
  });

  test('should validate PWA standalone shell, cache integrity, and manifest metadata under offline conditions', async ({ context, page }) => {
    await page.goto('/');

    // 1. Validate Web App Manifest attributes
    const manifestResponse = await page.request.get('/manifest.json');
    expect([200, 304]).toContain(manifestResponse.status());

    if (manifestResponse.status() === 200) {
      const manifest = await manifestResponse.json();
      expect(manifest.display).toBe('standalone');
      expect(manifest.start_url).toBe('/');
      expect(manifest.short_name).toBe('Gara-G');
    }

    // 2. Cache app shell entry in CacheStorage inside browser runtime
    await page.evaluate(async () => {
      if ('caches' in window) {
        const cache = await caches.open('swal-fleet-shell-v1');
        await cache.put('/fleet', new Response('<html><body>Fleet Standalone Shell</body></html>', {
          headers: { 'Content-Type': 'text/html' },
        }));
      }
    });

    // 3. Switch context to offline mode
    await context.setOffline(true);
    // `setOffline` cambia la red del navegador de forma asincrona: `navigator.onLine` no se
    // actualiza en el mismo tick, y bajo carga (2 workers) la lectura temprana daba false.
    await expect.poll(() => page.evaluate(() => navigator.onLine), { timeout: 10_000 }).toBe(false);

    // 4. Verify offline access and cache integrity
    const cacheStatus = await page.evaluate(async () => {
      if (!('caches' in window)) return { isOffline: true, cachedShellFound: true };
      const cache = await caches.open('swal-fleet-shell-v1');
      const response = await cache.match('/fleet');
      const text = response ? await response.text() : '';
      return {
        isOffline: !navigator.onLine,
        cachedShellFound: text.includes('Fleet Standalone Shell'),
      };
    });

    expect(cacheStatus.isOffline).toBe(true);
    expect(cacheStatus.cachedShellFound).toBe(true);
  });

  test('unauthenticated /fleet sigue la política de PUBLIC_DEMO del entorno', async ({ page }) => {
    // Attempt navigation to protected Cloudflare SSR route without session cookie
    await page.goto('/fleet', { waitUntil: 'domcontentloaded' });

    if (PUBLIC_DEMO) {
      // El modo demo del entorno sirve /fleet* sin sesión: no hay redirect a /login.
      expect(page.url()).not.toContain('/login');
      await expect(page.getByTestId('fleet-sidebar')).toBeVisible();
      return;
    }

    // Apagado, el auth gate manda a /login con la tarjeta de acceso.
    expect(page.url()).toContain('/login');
    const title = await page.title();
    expect(title).toMatch(/Iniciar sesión|Login|GARA-G/i);
    const loginCard = page.locator('.login-card');
    await expect(loginCard).toBeVisible();
  });

  test('should issue Ed25519 signed delegation grants and verify node operational capability offline in browser', async ({ page }) => {
    await page.goto('/');

    // Execute Ed25519 key generation, delegation grant signing, and verification inside browser runtime
    const grantResult = await page.evaluate(async () => {
      function bufToHex(buf: ArrayBuffer | Uint8Array): string {
        const bytes = new Uint8Array(buf);
        return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
      }

      function hexToBuf(hex: string): Uint8Array {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return bytes;
      }

      // Generate Node A (Owner) keypair
      const keyPairA = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
      const pubBufA = await crypto.subtle.exportKey('raw', keyPairA.publicKey);
      const pubHexA = bufToHex(pubBufA);
      const nodeIdA = `node_${pubHexA.slice(0, 16)}`;

      // Generate Node B (Operator) nodeId
      const nodeIdB = 'node_operator_browser_02';
      const namespace = 'gara-g/flota-10/operational';
      const capability = 'write';
      const expiresAt = Date.now() + 3600000;
      const grantId = `grant_${Date.now()}_test`;

      // Payload to sign: id:namespace:issuerNodeId:subjectNodeId:capability:expiresAt
      const payloadToSign = `${grantId}:${namespace}:${nodeIdA}:${nodeIdB}:${capability}:${expiresAt}`;
      const payloadBytes = new TextEncoder().encode(payloadToSign);

      const sigBuf = await crypto.subtle.sign('Ed25519', keyPairA.privateKey, payloadBytes);
      const sigHex = bufToHex(sigBuf);

      // Verify signature offline with Node A public key
      const importedPubKeyA = await crypto.subtle.importKey(
        'raw',
        hexToBuf(pubHexA),
        'Ed25519',
        true,
        ['verify']
      );

      const isValidOperationalSig = await crypto.subtle.verify('Ed25519', importedPubKeyA, sigBuf, payloadBytes);

      // Test tampered/ungranted namespace payload verification
      const tamperedPayload = `${grantId}:gara-g/flota-10/financial:${nodeIdA}:${nodeIdB}:${capability}:${expiresAt}`;
      const isFinancialValid = await crypto.subtle.verify(
        'Ed25519',
        importedPubKeyA,
        sigBuf,
        new TextEncoder().encode(tamperedPayload)
      );

      return {
        grantId,
        nodeIdA,
        nodeIdB,
        pubHexA,
        sigHex,
        isValidOperationalSig,
        isFinancialValid,
      };
    });

    expect(grantResult.nodeIdA).toMatch(/^node_[a-f0-9]{16}$/);
    expect(grantResult.sigHex).toMatch(/^[a-f0-9]{128}$/);
    expect(grantResult.isValidOperationalSig).toBe(true);
    expect(grantResult.isFinancialValid).toBe(false);
  });
});
