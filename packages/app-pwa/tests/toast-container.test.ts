// @vitest-environment jsdom
/**
 * ToastContainer.astro (issue 04): region viva siempre presente, rol por tipo, duracion minima de
 * 6 s con pausa que conserva el tiempo restante, boton de cerrar de 44x44.
 *
 * El componente es Astro con un <script> vanilla: se extrae el markup y el script del propio fichero
 * y se ejecutan en jsdom, asi el test muerde sobre el codigo real y no sobre una copia.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SRC = readFileSync(join(process.cwd(), 'src/components/ToastContainer.astro'), 'utf8');
const markup = SRC.split('---')[2].split('<script>')[0].trim();
const script = SRC.split('<script>')[1].split('</script>')[0];
const css = SRC.split('<style>')[1].split('</style>')[0];

function boot() {
  document.body.innerHTML = markup;
  new Function(script)();
}
const toast = (detail: Record<string, unknown>) => window.dispatchEvent(new CustomEvent('gara-toast', { detail }));
const items = () => document.querySelectorAll('.toast-item');

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ToastContainer', () => {
  it('la region viva esta en el DOM desde el inicio, vacia y sin atributo hidden', () => {
    boot();
    const c = document.querySelector('[data-testid="toast-container"]')!;
    expect(c).not.toBeNull();
    expect(c.hasAttribute('hidden')).toBe(false);
    expect(c.getAttribute('aria-live')).toBe('polite');
    expect(c.getAttribute('aria-atomic')).toBe('false');
    expect(c.children.length).toBe(0);
    toast({ message: 'hola', type: 'success' });
    expect(c.hasAttribute('hidden')).toBe(false);
    expect(document.querySelectorAll('[aria-live]').length).toBe(1);
  });

  it('un error es role=alert; el resto, role=status', () => {
    boot();
    toast({ message: 'cayo', type: 'error' });
    toast({ message: 'ok', type: 'success' });
    toast({ message: 'ojo', type: 'warning' });
    toast({ message: 'fyi' });
    const roles = [...items()].map((e) => e.getAttribute('role'));
    expect(roles).toEqual(['alert', 'status', 'status', 'status']);
  });

  it('un toast con duracion dura al menos 6 s aunque se pida menos', () => {
    boot();
    toast({ message: 'x', type: 'info', duration: 4000 });
    vi.advanceTimersByTime(5900);
    expect(items().length).toBe(1);
    vi.advanceTimersByTime(200);
    expect(items().length).toBe(0);
  });

  it('duration 0 es permanente', () => {
    boot();
    toast({ message: 'x', type: 'info', duration: 0 });
    vi.advanceTimersByTime(600000);
    expect(items().length).toBe(1);
  });

  it('pasar el raton pausa el temporizador y al salir conserva el tiempo restante', () => {
    boot();
    toast({ message: 'x', type: 'info' });
    const el = document.querySelector('.toast-item')!;
    vi.advanceTimersByTime(5000);
    el.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(60000);
    expect(items().length).toBe(1);
    el.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(900); // restaban ~1000 ms, no 6000
    expect(items().length).toBe(1);
    vi.advanceTimersByTime(200);
    expect(items().length).toBe(0);
  });

  it('enfocar el toast tambien lo pausa', () => {
    boot();
    toast({ message: 'x', type: 'info' });
    const el = document.querySelector('.toast-item')!;
    vi.advanceTimersByTime(3000);
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    vi.advanceTimersByTime(60000);
    expect(items().length).toBe(1);
  });

  it('el boton de cerrar quita el toast y tiene nombre accesible', () => {
    boot();
    toast({ message: 'x', type: 'info' });
    const close = document.querySelector<HTMLButtonElement>('.toast-close')!;
    expect(close.getAttribute('aria-label')).toBe('Cerrar notificación');
    close.click();
    expect(items().length).toBe(0);
  });

  it('el boton de cerrar mide al menos 44x44 en el CSS', () => {
    const rule = css.match(/\.toast-close\)\s*\{([^}]*)\}/)![1];
    expect(rule).toMatch(/min-width:\s*44px/);
    expect(rule).toMatch(/min-height:\s*44px/);
  });
});
