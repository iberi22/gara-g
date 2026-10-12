// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import OnboardingWizard from './OnboardingWizard.svelte';
import { resolvePrefs } from './resolve';
import type { Preferences, PrefsSchema } from './schema';

const schema: PrefsSchema = {
  version: 1,
  modules: [
    { id: 'home', label: 'Inicio', group: 'A', default: true, required: true },
    { id: 'fuel', label: 'Combustible', group: 'A', default: true },
    { id: 'drivers', label: 'Conductores', group: 'A', default: true },
  ],
  panels: [{ id: 'p1', label: 'Panel uno', scope: 'S', default: true }],
  presets: [{ id: 'solo', label: 'Mi vehiculo', description: 'Uno', modules: { drivers: false } }],
};

let app: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = '';
});

function setup(extra: Record<string, unknown> = {}) {
  const onfinish = vi.fn();
  const value: Preferences = resolvePrefs(schema, undefined);
  app = mount(OnboardingWizard as any, { target: document.body, props: { schema, value, onfinish, ...extra } });
  flushSync();
  return { onfinish };
}
const click = (text: string) => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent?.trim().includes(text));
  if (!b) throw new Error(`no button ${text}`);
  b.click();
  flushSync();
};

describe('OnboardingWizard', () => {
  it('walks 4 steps and finishing sets onboarded with the preset applied', async () => {
    const { onfinish } = setup();
    expect(document.body.textContent).toContain('Paso 1 / 4');
    click('Mi vehiculo');
    click('Siguiente');
    expect(document.body.textContent).toContain('Paso 2 / 4');
    const drivers = document.getElementById(
      [...document.querySelectorAll('label')].find((l) => l.textContent?.includes('Conductores'))!.getAttribute('for')!,
    ) as HTMLInputElement;
    expect(drivers.checked).toBe(false);
    click('Siguiente');
    click('Siguiente');
    expect(document.body.textContent).toContain('Paso 4 / 4');
    expect(document.querySelector('[data-testid="sum-modules"]')?.textContent).toBe('2');
    click('Entrar');
    await Promise.resolve();
    const out = onfinish.mock.calls[0][0] as Preferences;
    expect(out.onboarded).toBe(true);
    expect(out.preset).toBe('solo');
    expect(out.modules.drivers).toBe(false);
    // Sin askStorage no hay eleccion de almacenamiento.
    expect(onfinish.mock.calls[0][1]).toEqual({ storage: undefined, backup: false });
  });

  it('Atras goes back and is disabled on step 1', () => {
    setup();
    const back = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Atrás')!;
    expect(back.disabled).toBe(true);
    click('Siguiente');
    click('Atrás');
    expect(document.body.textContent).toContain('Paso 1 / 4');
  });

  it('Omitir calls onskip', () => {
    const onskip = vi.fn();
    setup({ onskip });
    click('Omitir');
    expect(onskip).toHaveBeenCalledOnce();
  });
});

const features = [
  { id: 'a', title: 'Garage 3D', desc: 'Tu vehiculo' },
  { id: 'b', title: 'IA', desc: 'Asistente', badge: 'Con cuenta' },
];
const text = () => document.body.textContent ?? '';
const q = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;

describe('OnboardingWizard: bienvenida y eleccion de almacenamiento', () => {
  it('con cuenta (sin askStorage): bienvenida + perfil + menu + paneles + listo, sin elegir donde guardar', async () => {
    const { onfinish } = setup({ features, badge: '100 % gratis', welcomeLead: 'Esto ofrece' });
    expect(text()).toContain('Paso 1 / 5');
    expect(q('[data-testid="wizard-free"]').textContent).toBe('100 % gratis');
    expect(q('[data-testid="feature-a"]').textContent).toContain('Garage 3D');
    expect(q('[data-testid="feature-b"]').textContent).toContain('Con cuenta');
    expect(document.querySelector('[data-testid="step-storage"]')).toBeNull();
    for (let i = 0; i < 4; i++) click('Siguiente');
    expect(text()).toContain('Paso 5 / 5');
    click('Entrar');
    await Promise.resolve();
    expect(onfinish.mock.calls[0][1]).toEqual({ storage: undefined, backup: false });
  });

  it('sin cuenta: 6 pasos; el paso de almacenamiento muestra la advertencia y la casilla marcada', () => {
    setup({ features, askStorage: true });
    expect(text()).toContain('Paso 1 / 6');
    click('Siguiente');
    expect(text()).toContain('Paso 2 / 6');
    expect(q('[data-testid="step-storage"]')).not.toBeNull();
    expect(q('[data-testid="storage-warning"]').textContent).toContain('Solo en este navegador');
    expect(q('[data-testid="storage-warning"]').textContent).toContain('No se comparten entre dispositivos');
    const box = q<HTMLInputElement>('[data-testid="backup-checkbox"]');
    expect(box.checked).toBe(true);
    expect(text()).toContain('Activar el respaldo cifrado de extremo a extremo al terminar');
    expect(text()).toContain('si pierdes el código nadie puede recuperarlos');
    // La tarjeta de la nube lleva al login.
    expect(q<HTMLAnchorElement>('[data-testid="choose-cloud"]').getAttribute('href')).toBe('/login');
  });

  it('sin elegir donde guardar no se puede avanzar', () => {
    setup({ features, askStorage: true });
    click('Siguiente');
    const next = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Siguiente')!;
    expect(next.disabled).toBe(true);
    click('Usar en este dispositivo');
    expect(text()).toContain('Paso 3 / 6');
  });

  it('elegir este dispositivo con la casilla marcada: onfinish recibe storage local y backup', async () => {
    const { onfinish } = setup({ features, askStorage: true });
    click('Siguiente');
    click('Usar en este dispositivo');
    for (let i = 0; i < 3; i++) click('Siguiente');
    expect(text()).toContain('Paso 6 / 6');
    expect(text()).toContain('respaldo cifrado');
    click('Entrar');
    await Promise.resolve();
    expect(onfinish.mock.calls[0][1]).toEqual({ storage: 'local', backup: true });
  });

  it('desmarcar la casilla: backup false', async () => {
    const { onfinish } = setup({ features, askStorage: true });
    click('Siguiente');
    q<HTMLInputElement>('[data-testid="backup-checkbox"]').click();
    flushSync();
    click('Usar en este dispositivo');
    for (let i = 0; i < 3; i++) click('Siguiente');
    click('Entrar');
    await Promise.resolve();
    expect(onfinish.mock.calls[0][1]).toEqual({ storage: 'local', backup: false });
  });

  it('sin cuenta preselecciona el perfil por defecto, pero respeta uno ya guardado', async () => {
    const { onfinish } = setup({ askStorage: true, defaultPreset: 'solo' });
    click('Usar en este dispositivo');
    for (let i = 0; i < 3; i++) click('Siguiente');
    click('Entrar');
    await Promise.resolve();
    const out = onfinish.mock.calls[0][0] as Preferences;
    expect(out.preset).toBe('solo');
    expect(out.modules.drivers).toBe(false);
  });

  it('con cuenta no preselecciona perfil (defaultPreset solo aplica sin cuenta)', async () => {
    const { onfinish } = setup({ defaultPreset: 'solo' });
    for (let i = 0; i < 3; i++) click('Siguiente');
    click('Entrar');
    await Promise.resolve();
    expect((onfinish.mock.calls[0][0] as Preferences).preset).not.toBe('solo');
  });
});
