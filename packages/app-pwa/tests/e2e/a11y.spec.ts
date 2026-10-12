import { test, expect } from './fixtures';

/**
 * [W13.8] feat-a11y-baseline — E2E Accessibility Audit Suite.
 *
 * Cobertura de a11y en 5 páginas clave:
 * 1. /fleet (Dashboard)
 * 2. /fleet/vehicles (Vehículos)
 * 3. /fleet/maintenance (Mantenimiento)
 * 4. /fleet/notifications (Notificaciones)
 * 5. /fleet/game (Game Console & Garaje)
 *
 * Criterios de aceptación:
 * - 0 inputs/selects/textareas sin label asociado (label[for], label padre, o aria-label)
 * - 0 botones sin nombre accesible (texto, aria-label, o title)
 * - skip-link o h1 presente en cada página
 * - Foco visible verificable por teclado (Tab activa elemento visible)
 */

const targetPages = [
  { name: 'fleet', path: '/fleet' },
  { name: 'vehicles', path: '/fleet/vehicles' },
  { name: 'maintenance', path: '/fleet/maintenance' },
  { name: 'notifications', path: '/fleet/notifications' },
  { name: 'game', path: '/fleet/game' },
  { name: 'drivers', path: '/drivers' },
];

test.describe('A11y Baseline E2E Suite', () => {
  for (const target of targetPages) {
    test(`a11y audit on ${target.name} (${target.path})`, async ({ page }) => {
      await page.goto(target.path);

      // 1. Heading h1 o skip-link presente
      const h1OrSkip = page.locator('h1, a.skip-link');
      await expect(h1OrSkip.first()).toBeAttached();
      const countHeader = await h1OrSkip.count();
      expect(countHeader).toBeGreaterThan(0);

      // 2. 0 inputs sin label asociado
      const unlabeledInputs = await page.evaluate(() => {
        const inputs = Array.from(
          document.querySelectorAll('input:not([type="hidden"]), select, textarea'),
        );
        const missing: Array<{ tag: string; id: string; outerHTML: string }> = [];
        for (const input of inputs) {
          const id = input.getAttribute('id');
          const hasLabelFor = id
            ? !!document.querySelector(`label[for="${CSS.escape(id)}"]`)
            : false;
          const hasParentLabel = !!input.closest('label');
          const hasAriaLabel = !!(
            input.getAttribute('aria-label') ||
            input.getAttribute('aria-labelledby')
          );
          const hasTitle = !!input.getAttribute('title');

          if (!hasLabelFor && !hasParentLabel && !hasAriaLabel && !hasTitle) {
            missing.push({
              tag: input.tagName,
              id: id || '',
              outerHTML: input.outerHTML.slice(0, 100),
            });
          }
        }
        return missing;
      });

      expect(
        unlabeledInputs,
        `Página ${target.path} tiene inputs sin label: ${JSON.stringify(unlabeledInputs)}`,
      ).toEqual([]);

      // 3. 0 buttons sin nombre accesible
      const unnamedButtons = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        const missing: Array<{ tag: string; id: string; outerHTML: string }> = [];
        for (const btn of buttons) {
          const text = (btn.textContent || '').trim();
          const ariaLabel = (btn.getAttribute('aria-label') || '').trim();
          const ariaLabelledBy = btn.getAttribute('aria-labelledby');
          let labelledByText = '';
          if (ariaLabelledBy) {
            const el = document.getElementById(ariaLabelledBy);
            if (el) labelledByText = (el.textContent || '').trim();
          }
          const title = (btn.getAttribute('title') || '').trim();
          const imgAlt = (btn.querySelector('img')?.getAttribute('alt') || '').trim();
          const svgAria = (btn.querySelector('svg')?.getAttribute('aria-label') || '').trim();

          const hasName =
            text.length > 0 ||
            ariaLabel.length > 0 ||
            labelledByText.length > 0 ||
            title.length > 0 ||
            imgAlt.length > 0 ||
            svgAria.length > 0;

          if (!hasName) {
            missing.push({
              tag: btn.tagName,
              id: btn.id || '',
              outerHTML: btn.outerHTML.slice(0, 100),
            });
          }
        }
        return missing;
      });

      expect(
        unnamedButtons,
        `Página ${target.path} tiene botones sin nombre accesible: ${JSON.stringify(unnamedButtons)}`,
      ).toEqual([]);

      // 4. Foco visible verificable por teclado (Tab)
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return null;
        const rect = active.getBoundingClientRect();
        const style = window.getComputedStyle(active);
        const isVisible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none';
        return {
          tagName: active.tagName,
          id: active.id,
          testId: active.getAttribute('data-testid'),
          isVisible,
        };
      });

      expect(focused).not.toBeNull();
      expect(focused?.isVisible).toBe(true);
    });
  }
});

// P0-9 (wave-32.08): los botones de glifo de DriverTable (✓ ✕ ✏️) tienen texto, asi que el barrido
// generico no los detecta; el nombre accesible debe llevar el sujeto (el conductor concreto).
test.describe('A11y — DriverTable botones de glifo', () => {
  test('asignar/guardar/cancelar vehiculo se nombran con el conductor', async ({ page }) => {
    await page.goto('/drivers');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('add-driver-btn').click();
    await page.getByTestId('input-name').fill('Ana Ruiz A11y');
    await page.getByTestId('input-cedula').fill('1234567');
    await page.getByTestId('submit-driver-btn').click();
    const row = page.getByTestId('driver-row').filter({ hasText: 'Ana Ruiz A11y' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Asignar vehículo a Ana Ruiz A11y' }).click();
    await expect(row.getByRole('button', { name: 'Guardar vehículo de Ana Ruiz A11y' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Cancelar asignación de Ana Ruiz A11y' })).toBeVisible();
    // limpieza (Eliminar confirma)
    page.once('dialog', (d) => d.accept());
    await row.getByTestId('delete-driver-btn').click();
    await expect(row).toHaveCount(0);
  });
});

