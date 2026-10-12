/**
 * Aislamiento de `createAlertStore(instanceId)`: cada instancia tiene su propio Y.Doc.
 *
 * Bug que fija: `getAlertManager` guardaba UN manager en una variable de modulo y devolvia
 * siempre el mismo, ignorando el `instanceId`. El primer `instanceId` que se pidiera se
 * quedaba con el manager para toda la sesion, asi que dos instancias (dos AlertFeed en la
 * pagina, o dos tests) compartian doc y se veian las alertas del otro. Como el mapa ya
 * lleva el instanceId en su nombre (`swal/gara-g/<instanceId>/alerts`), la ruptura de
 * aislamiento era un accidente del singleton, no la intencion.
 *
 * Ademas hace determinista la suite: el resultado de los tests de AlertFeed no depende del
 * orden en que se ejecuten.
 */
import { describe, expect, it } from 'vitest';
import { AlertKind, AlertSeverity, createAlertStore, getAlertManager } from '../alert.js';

const alert = (id: string, instanceId: string) =>
  ({
    id,
    instanceId,
    vehicleId: 'v',
    fleetId: 'f',
    kind: AlertKind.OVERSPEED,
    severity: AlertSeverity.WARN,
    message: 'm',
    createdAt: 1,
    acknowledged: false,
  }) as Parameters<ReturnType<typeof createAlertStore>['addAlert']>[0];

describe('createAlertStore: una instancia no ve los datos de otra', () => {
  it('dos instanceId distintos tienen doc y alertas separados', () => {
    const a = createAlertStore('inst-a');
    const b = createAlertStore('inst-b');
    expect(getAlertManager('inst-a')).not.toBe(getAlertManager('inst-b'));
    expect(getAlertManager('inst-a').getDoc()).not.toBe(getAlertManager('inst-b').getDoc());

    a.addAlert(alert('a1', 'inst-a'));
    expect(a.listAlerts().map((x) => x.id)).toEqual(['a1']);
    expect(b.listAlerts()).toEqual([]);
  });

  it('el mismo instanceId devuelve el mismo manager (una sola fuente por instancia)', () => {
    expect(getAlertManager('inst-a')).toBe(getAlertManager('inst-a'));
  });

  it('avisar en una instancia no dispara la suscripcion de la otra', () => {
    const a = createAlertStore('inst-c');
    const b = createAlertStore('inst-d');
    let bLlamadas = 0;
    b.subscribe(() => bLlamadas++);
    a.addAlert(alert('c1', 'inst-c'));
    expect(bLlamadas).toBe(0);
  });
});
