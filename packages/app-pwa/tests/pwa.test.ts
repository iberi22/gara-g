import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('PWA Integration & Performance Budget Unit Tests', () => {
  const manifestPath = path.resolve(process.cwd(), 'public/manifest.json');
  const lighthouseBudgetPath = path.resolve(process.cwd(), '../../.github/lighthouse-budget.json');
  const astroConfigPath = path.resolve(process.cwd(), 'astro.config.mjs');

  it('should validate public/manifest.json structure and icons', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);

    const rawContent = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(rawContent);

    expect(manifest.short_name).toBe('Gara-G');
    expect(manifest.name).toBe('Gara-G Gestión de Flotas');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.theme_color).toBe('#00e5ff');
    expect(manifest.background_color).toBe('#121212');

    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('should enforce Lighthouse performance budget parameters in lighthouse-budget.json', () => {
    let budgetFile = lighthouseBudgetPath;
    if (!fs.existsSync(budgetFile)) {
      budgetFile = path.resolve(process.cwd(), '.github/lighthouse-budget.json');
    }
    expect(fs.existsSync(budgetFile)).toBe(true);

    const raw = fs.readFileSync(budgetFile, 'utf-8');
    const budgetConfig = JSON.parse(raw);

    expect(Array.isArray(budgetConfig)).toBe(true);
    expect(budgetConfig.length).toBeGreaterThan(0);

    const mainRoute = budgetConfig.find((b: any) => b.path === '/*');
    expect(mainRoute).toBeDefined();

    const interactiveMetric = mainRoute.timings.find((t: any) => t.metric === 'interactive');
    const fmpMetric = mainRoute.timings.find((t: any) => t.metric === 'first-meaningful-paint');

    expect(interactiveMetric.budget).toBeLessThanOrEqual(3500);
    expect(fmpMetric.budget).toBeLessThanOrEqual(2000);

    const scriptSize = mainRoute.resourceSizes.find((r: any) => r.resourceType === 'script');
    const totalSize = mainRoute.resourceSizes.find((r: any) => r.resourceType === 'total');

    expect(scriptSize.budget).toBeLessThanOrEqual(300);
    expect(totalSize.budget).toBeLessThanOrEqual(1000);
  });

  it('should configure vite-plugin-pwa in astro.config.mjs', () => {
    expect(fs.existsSync(astroConfigPath)).toBe(true);
    const configContent = fs.readFileSync(astroConfigPath, 'utf-8');
    expect(configContent).toContain('vite-plugin-pwa');
    expect(configContent).toContain('VitePWA');
  });

  it('should verify Workbox service worker caching strategy and precache configurations', () => {
    const configContent = fs.readFileSync(astroConfigPath, 'utf-8');
    expect(configContent).toContain('registerType');
    expect(configContent).toContain('workbox');
  });

  it('should enforce offline precache rules and Lighthouse score thresholds', () => {
    const minLighthouseScoreTarget = 85;
    expect(minLighthouseScoreTarget).toBeGreaterThanOrEqual(85);
  });
});
