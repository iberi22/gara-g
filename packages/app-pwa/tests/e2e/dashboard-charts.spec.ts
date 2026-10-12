import { test, expect } from './fixtures';

/**
 * Dashboard & Analytics SVG Charts E2E Tests.
 * Verifica presencia y visibilidad de gráficos SVG server-rendered
 * en /fleet y /fleet/analytics.
 */

test.describe('Dashboard & Analytics Charts', () => {
  test('renders km/mes SVG chart on main fleet dashboard (/fleet)', async ({ page }) => {
    await page.goto('/fleet');

    // Dashboard cargado
    await expect(page.getByTestId('fleet-dashboard')).toBeVisible();

    // Sección y gráfico de kilometraje por mes visible
    await expect(page.getByTestId('dashboard-charts')).toBeVisible();
    const kmChart = page.getByTestId('km-month-chart');
    await expect(kmChart).toBeVisible();

    // Elemento SVG con viewBox y barras presentes
    const svgNodeName = await kmChart.evaluate((el) => el.nodeName.toLowerCase());
    expect(svgNodeName).toBe('svg');

    const barsCount = await kmChart.locator('rect').count();
    expect(barsCount).toBeGreaterThan(1);
  });

  test('renders fuel timeline & cost por tipo SVG charts on analytics page (/fleet/analytics)', async ({ page }) => {
    await page.goto('/fleet/analytics');

    // Página de analítica cargada
    await expect(page.getByTestId('analytics-page')).toBeVisible();

    // Gráfico de Fuel Timeline (line chart)
    const fuelChart = page.getByTestId('fuel-timeline-chart');
    await expect(fuelChart).toBeVisible();
    const fuelSvgNodeName = await fuelChart.evaluate((el) => el.nodeName.toLowerCase());
    expect(fuelSvgNodeName).toBe('svg');

    // Path de línea presente en fuel timeline chart
    const linePathCount = await fuelChart.locator('path').count();
    expect(linePathCount).toBeGreaterThanOrEqual(1);

    // Gráfico de Costo por Tipo (bar chart)
    const costTypeChart = page.getByTestId('cost-type-chart');
    await expect(costTypeChart).toBeVisible();
    const costTypeSvgNodeName = await costTypeChart.evaluate((el) => el.nodeName.toLowerCase());
    expect(costTypeSvgNodeName).toBe('svg');

    const rectCount = await costTypeChart.locator('rect').count();
    expect(rectCount).toBeGreaterThan(1);
  });
});
