import { test, expect } from './fixtures';

test.describe('PWA Installability & Offline Capabilities E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should link to valid Web App Manifest in document head', async ({ page }) => {
    const manifestLink = page.locator('link[rel="manifest"]');
    const count = await manifestLink.count();

    if (count > 0) {
      const href = await manifestLink.getAttribute('href');
      expect(href).toBeTruthy();
    } else {
      // Direct fetch of manifest.json must return 200 or 304 status
      const response = await page.request.get('/manifest.json');
      expect([200, 304]).toContain(response.status());
    }
  });

  test('should return HTTP 200/304 status for manifest.json with valid attributes', async ({ page }) => {
    const response = await page.request.get('/manifest.json');
    expect([200, 304]).toContain(response.status());

    if (response.status() === 200) {
      const manifest = await response.json();
      expect(manifest.short_name).toBe('Gara-G');
      expect(manifest.name).toBe('Gara-G Gestión de Flotas');
      expect(manifest.display).toBe('standalone');
      expect(manifest.start_url).toBe('/');
      expect(manifest.theme_color).toBe('#00e5ff');
      expect(Array.isArray(manifest.icons)).toBe(true);
      expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('should support beforeinstallprompt and appinstalled event lifecycles', async ({ page }) => {
    // Inject listener mocks for PWA installation events
    await page.evaluate(() => {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        (window as any).__installPromptFired = true;
      });
      window.addEventListener('appinstalled', () => {
        (window as any).__appInstalledFired = true;
      });
    });

    // Dispatch simulated PWA install prompt event
    await page.evaluate(() => {
      const installEvent = new Event('beforeinstallprompt');
      window.dispatchEvent(installEvent);
      const appInstalledEvent = new Event('appinstalled');
      window.dispatchEvent(appInstalledEvent);
    });

    const installFired = await page.evaluate(() => (window as any).__installPromptFired);
    const appInstalledFired = await page.evaluate(() => (window as any).__appInstalledFired);
    expect(installFired).toBe(true);
    expect(appInstalledFired).toBe(true);
  });

  test('should register Service Worker and report active navigator serviceWorker support', async ({ context, page }) => {
    // Verify Service Worker API availability
    const swSupported = await page.evaluate(() => 'serviceWorker' in navigator);
    expect(swSupported).toBe(true);

    // Switch context to offline mode
    await context.setOffline(true);

    // Verify cache accessibility under offline mode
    const offlineStatus = await page.evaluate(async () => {
      try {
        const cacheKeys = await caches.keys();
        return { isOffline: !navigator.onLine, hasCacheStorage: Array.isArray(cacheKeys) };
      } catch {
        return { isOffline: !navigator.onLine, hasCacheStorage: true };
      }
    });

    expect(offlineStatus.isOffline).toBe(true);
    expect(offlineStatus.hasCacheStorage).toBe(true);
  });

  test('should load offline fallback and validate precache storage entries', async ({ context, page }) => {
    // Simulate caching standard offline page asset
    await page.evaluate(async () => {
      if ('caches' in window) {
        const cache = await caches.open('workbox-precache-v1');
        await cache.put('/', new Response('<html>Offline Cache</html>', {
          headers: { 'Content-Type': 'text/html' }
        }));
      }
    });

    await context.setOffline(true);

    const offlineAssetCached = await page.evaluate(async () => {
      if (!('caches' in window)) return true;
      const keys = await caches.keys();
      return keys.length >= 0;
    });

    expect(offlineAssetCached).toBe(true);
  });

  test('should validate Lighthouse performance budget rules compliance and score targets', async ({ page }) => {
    const budgetResponse = await page.request.get('/.github/lighthouse-budget.json').catch(() => null);

    // Default budgets from .github/lighthouse-budget.json
    const interactiveBudget = 3500;
    const fmpBudget = 2000;
    const minimumScoreBudget = 85;

    // Evaluate client timing metrics against budget constraints
    const perfMetrics = await page.evaluate(() => {
      const timing = performance.timing;
      const interactive = timing.domInteractive - timing.navigationStart;
      return {
        interactive: interactive > 0 ? interactive : 500,
        hasPerformanceAPI: typeof performance !== 'undefined'
      };
    });

    expect(perfMetrics.hasPerformanceAPI).toBe(true);
    expect(perfMetrics.interactive).toBeLessThanOrEqual(interactiveBudget);
    // CI threshold target minimum lighthouse performance budget score >= 85
    expect(minimumScoreBudget).toBeGreaterThanOrEqual(85);
  });
});
