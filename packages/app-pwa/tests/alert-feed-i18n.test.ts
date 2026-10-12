// @vitest-environment jsdom
/** AlertFeed (issue 21): el texto de interfaz esta en espanol; los valores guardados no cambian. */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import AlertFeed from '../src/components/alert/AlertFeed.svelte';
import { createAlertStore, AlertKind, AlertSeverity } from '../src/lib/alert.js';

let app: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = '';
});

describe('AlertFeed i18n', () => {
  it('sin alertas, el vacio y los controles estan en espanol', async () => {
    app = mount(AlertFeed as any, { target: document.body, props: { instanceId: 'i18n-empty' } });
    flushSync();
    await tick();
    const text = document.body.textContent!;
    expect(text).toContain('Alertas');
    expect(text).toContain('sin leer');
    expect(text).toContain('Severidad');
    expect(text).toContain('Todas las severidades');
    expect(text).toContain('No hay alertas');
    expect(text).not.toMatch(/Alert Feed|Unread|Severity|All Severities|No active alerts/);
    // los valores de las opciones (contrato) siguen siendo los de siempre
    const values = [...document.querySelectorAll('#severity-filter option')].map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(['all', 'info', 'warn', 'critical', 'danger']);
  });

  it('una alerta pendiente muestra "Reconocer" y, al reconocerla, "Reconocida"', async () => {
    const store = createAlertStore('i18n-one');
    store.addAlert({
      id: 'a1', instanceId: 'i18n-one', vehicleId: 'v', fleetId: 'f',
      kind: AlertKind.OVERSPEED, severity: AlertSeverity.WARN, message: 'm', acknowledged: false, createdAt: Date.now(),
    } as any);
    app = mount(AlertFeed as any, { target: document.body, props: { instanceId: 'i18n-one' } });
    flushSync();
    await tick();
    const btn = document.querySelector<HTMLButtonElement>('[data-testid="ack-btn"]')!;
    expect(btn.textContent!.trim()).toBe('Reconocer');
    expect(document.querySelector('[data-testid="severity-badge"]')!.textContent!.trim()).toBe('Aviso');
    btn.click();
    flushSync();
    await tick();
    expect(document.body.textContent).toContain('Reconocida');
    expect(document.body.textContent).not.toMatch(/Acknowledge|Acked/);
  });
});
