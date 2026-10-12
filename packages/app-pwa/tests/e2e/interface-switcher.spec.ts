import { test, expect } from './fixtures';

/**
 * E2E Spec: Selector de Interfaz Persistido
 * Cobertura:
 * - Renderiza el selector de interfaz (Admin, AUI, Garaje)
 * - Cambia de interfaz y persiste en localStorage/cookie
 * - Carga la interfaz correspondiente
 */

test.describe('Selector de Interfaz Persistido', () => {
  test('switches between admin, aui and game interfaces seamlessly', async ({ page }) => {
    await page.goto('/fleet');

    // Selector visible en topbar o contenedor
    const switcher = page.getByTestId('interface-switcher').first();
    await expect(switcher).toBeVisible();

    const btnAdmin = page.getByTestId('switch-btn-admin').first();
    const btnAui = page.getByTestId('switch-btn-aui').first();
    const btnGame = page.getByTestId('switch-btn-game').first();

    await expect(btnAdmin).toBeVisible();
    await expect(btnAui).toBeVisible();
    await expect(btnGame).toBeVisible();

    // 1. Inicialmente modo admin activo
    await expect(page.getByTestId('interface-admin-view')).toBeVisible();

    // 2. Cambiar a modo AUI
    await Promise.all([
      page.waitForURL(/.*\/fleet\/aui/),
      btnAui.click(),
    ]);
    await expect(page.getByTestId('interface-aui-view')).toBeVisible();

    // Verificar persistencia en localStorage
    const storedAfterAui = await page.evaluate(() => localStorage.getItem('gara_interface_mode'));
    expect(storedAfterAui).toBe('aui');

    // 3. Cambiar a modo Game (Garaje NFS)
    const btnGameOnAui = page.getByTestId('switch-btn-game').first();
    await Promise.all([
      // El modo Garaje lleva a /fleet/garage (HUD 3D); /fleet/game es el garaje clasico.
      page.waitForURL(/.*\/fleet\/garage/),
      btnGameOnAui.click(),
    ]);
    await expect(page.getByTestId('garage-game-hud')).toBeVisible({ timeout: 30_000 });

    const storedAfterGame = await page.evaluate(() => localStorage.getItem('gara_interface_mode'));
    expect(storedAfterGame).toBe('game');

    // 4. Regresar a modo Admin
    const btnAdminOnGame = page.getByTestId('switch-btn-admin').first();
    await Promise.all([
      page.waitForURL(/.*\/fleet/),
      btnAdminOnGame.click(),
    ]);
    await expect(page.getByTestId('interface-admin-view')).toBeVisible();

    const storedAfterAdmin = await page.evaluate(() => localStorage.getItem('gara_interface_mode'));
    expect(storedAfterAdmin).toBe('admin');
  });

  // Issue 05 (P0-7): el nombre accesible no depende de si la etiqueta se ve, y el estado se declara.
  test('cada boton declara su estado con aria-pressed segun el modo activo', async ({ page }) => {
    await page.goto('/fleet');
    const admin = page.getByRole('button', { name: /Consola Administrativa/ });
    const aui = page.getByRole('button', { name: /AUI Copilot/ });
    const game = page.getByRole('button', { name: /Garaje NFS/ });
    await expect(admin).toHaveAttribute('aria-pressed', 'true');
    await expect(aui).toHaveAttribute('aria-pressed', 'false');
    await expect(game).toHaveAttribute('aria-pressed', 'false');

    await page.goto('/fleet/aui');
    await expect(page.getByTestId('interface-switcher').first()).toHaveAttribute('data-active-mode', 'aui');
    await expect(page.getByRole('button', { name: /AUI Copilot/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /Consola Administrativa/ })).toHaveAttribute('aria-pressed', 'false');
  });

  test('con el modo juego apagado el boton es aria-disabled y pulsarlo no cambia de modo', async ({ page }) => {
    await page.goto('/fleet?game_enabled=false');
    const switcher = page.getByTestId('interface-switcher').first();
    const game = page.getByTestId('switch-btn-game').first();
    await expect(game).toHaveAttribute('aria-disabled', 'true');
    await expect(game).toHaveAccessibleName(/no disponible/);
    await game.click({ force: true });
    await expect(switcher).toHaveAttribute('data-active-mode', 'admin');
    await expect(page).toHaveURL(/\/fleet\?game_enabled=false/);
  });

  test('el nombre accesible es el mismo con la etiqueta visible y con ella oculta', async ({ page }) => {
    const nameAt = async (width: number) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/fleet');
      const names: string[] = [];
      for (const id of ['admin', 'aui', 'game']) {
        const btn = page.getByTestId(`switch-btn-${id}`).first();
        await expect(btn).toHaveAttribute('aria-label', /.+/);
        names.push((await btn.getAttribute('aria-label')) ?? '');
      }
      return names;
    };
    const wide = await nameAt(1280);
    const label = page.getByTestId('switch-btn-admin').first().locator('.mode-label');
    expect(await label.evaluate((el) => getComputedStyle(el).display)).not.toBe('none');
    // 768: la regla de tablet esconde las etiquetas; antes era display:none (el nombre pasaba a ser el emoji)
    const tablet = await nameAt(768);
    const tabletLabel = page.getByTestId('switch-btn-admin').first().locator('.mode-label');
    expect(await tabletLabel.evaluate((el) => getComputedStyle(el).display)).not.toBe('none');
    expect((await tabletLabel.boundingBox())?.width ?? 99).toBeLessThanOrEqual(1);
    expect(tablet).toEqual(wide);
    await expect(page.getByTestId('switch-btn-admin').first()).toHaveAccessibleName('Consola Administrativa');
    const phone = await nameAt(375);
    expect(phone).toEqual(wide);
  });

  test.describe('tactil', () => {
    test.use({ hasTouch: true, viewport: { width: 1280, height: 800 } });
    test('los botones miden al menos 44px de alto', async ({ page }) => {
      await page.goto('/fleet');
      for (const id of ['admin', 'aui', 'game']) {
        const box = await page.getByTestId(`switch-btn-${id}`).first().boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    });
  });
});
