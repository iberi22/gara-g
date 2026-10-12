import * as Y from 'yjs';

export enum AlertKind {
  OVERSPEED = 'overspeed',
  GEOFENCE_ENTER = 'geofence_enter',
  GEOFENCE_EXIT = 'geofence_exit',
  MAINTENANCE = 'maintenance',
  DRIVER_HOS = 'driver_hos',
  LOW_BATTERY = 'low_battery',
  TAMPER = 'tamper',
}

export enum AlertSeverity {
  INFO = 'info',
  WARN = 'warn',
  CRITICAL = 'critical',
  DANGER = 'danger',
}

export type AlertKindType =
  | 'overspeed'
  | 'geofence_enter'
  | 'geofence_exit'
  | 'maintenance'
  | 'driver_hos'
  | 'low_battery'
  | 'tamper';

export type AlertSeverityType = 'info' | 'warn' | 'critical' | 'danger';

export interface BaseAlert {
  id: string;
  instanceId: string;
  vehicleId: string;
  fleetId: string;
  message: string;
  acknowledged: boolean;
  createdAt: number;
  ackedAt?: Date | number | string;
}

export interface OverspeedAlert extends BaseAlert {
  kind: AlertKind.OVERSPEED | 'overspeed';
  severity: AlertSeverity.WARN | AlertSeverity.DANGER | 'warn' | 'danger';
}

export interface GeofenceEnterAlert extends BaseAlert {
  kind: AlertKind.GEOFENCE_ENTER | 'geofence_enter';
  severity: AlertSeverity.INFO | 'info';
}

export interface GeofenceExitAlert extends BaseAlert {
  kind: AlertKind.GEOFENCE_EXIT | 'geofence_exit';
  severity: AlertSeverity.WARN | 'warn';
}

export interface MaintenanceAlert extends BaseAlert {
  kind: AlertKind.MAINTENANCE | 'maintenance';
  severity: AlertSeverity.INFO | AlertSeverity.WARN | 'info' | 'warn';
}

export interface DriverHosAlert extends BaseAlert {
  kind: AlertKind.DRIVER_HOS | 'driver_hos';
  severity: AlertSeverity.WARN | AlertSeverity.CRITICAL | 'warn' | 'critical';
}

export interface LowBatteryAlert extends BaseAlert {
  kind: AlertKind.LOW_BATTERY | 'low_battery';
  severity: AlertSeverity.WARN | AlertSeverity.CRITICAL | 'warn' | 'critical';
}

export interface TamperAlert extends BaseAlert {
  kind: AlertKind.TAMPER | 'tamper';
  severity: AlertSeverity.DANGER | AlertSeverity.CRITICAL | 'danger' | 'critical';
}

export type Alert =
  | OverspeedAlert
  | GeofenceEnterAlert
  | GeofenceExitAlert
  | MaintenanceAlert
  | DriverHosAlert
  | LowBatteryAlert
  | TamperAlert;

export function unreadCount(alerts: Alert[]): number {
  if (!Array.isArray(alerts)) return 0;
  return alerts.filter((alert) => alert && !alert.acknowledged).length;
}

export function acknowledge(alert: Alert): Alert {
  return {
    ...alert,
    acknowledged: true,
    ackedAt: new Date(),
  };
}

export class YjsAlertManager {
  private doc: Y.Doc;
  private instanceId: string;
  private alertsMap: Y.Map<Alert>;

  constructor(instanceId: string = 'default', doc?: Y.Doc) {
    this.instanceId = instanceId;
    this.doc = doc || new Y.Doc();
    this.alertsMap = this.doc.getMap<Alert>(`swal/gara-g/${this.instanceId}/alerts`);
  }

  public getDoc(): Y.Doc {
    return this.doc;
  }

  public getAlertsMap(): Y.Map<Alert> {
    return this.alertsMap;
  }

  public addAlert(alertData: Omit<Alert, 'createdAt' | 'acknowledged'> & { createdAt?: number; acknowledged?: boolean }): Alert {
    const now = Date.now();
    const alert: Alert = {
      ...alertData,
      acknowledged: alertData.acknowledged ?? false,
      createdAt: alertData.createdAt ?? now,
    } as Alert;

    this.doc.transact(() => {
      this.alertsMap.set(alert.id, alert);
    });

    return alert;
  }

  public getAlert(id: string): Alert | undefined {
    return this.alertsMap.get(id);
  }

  public acknowledgeAlert(id: string): Alert | undefined {
    const existing = this.alertsMap.get(id);
    if (!existing) return undefined;
    const acked = acknowledge(existing);
    this.doc.transact(() => {
      this.alertsMap.set(id, acked);
    });
    return acked;
  }

  public listAlerts(filterByVehicleId?: string): Alert[] {
    const alerts = Array.from(this.alertsMap.values());
    if (filterByVehicleId) {
      return alerts.filter((a) => a.vehicleId === filterByVehicleId);
    }
    return alerts;
  }

  public subscribe(callback: () => void): () => void {
    const observer = () => callback();
    this.alertsMap.observe(observer);
    return () => {
      this.alertsMap.unobserve(observer);
    };
  }
}

/**
 * Manager por `instanceId`: cada instancia de la pagina (y cada test) tiene SU Y.Doc.
 *
 * Antes era un singleton de modulo que ignoraba el `instanceId`: el primer id pedido se
 * quedaba con el manager para siempre y todas las instancias compartian doc, con las alertas
 * de una apareciendo en la otra. El nombre del mapa ya lleva el id
 * (`swal/gara-g/<instanceId>/alerts`), así que el aislamiento era la intencion.
 */
const managers = new Map<string, YjsAlertManager>();

export function getAlertManager(instanceId: string = 'default'): YjsAlertManager {
  let manager = managers.get(instanceId);
  if (!manager) {
    manager = new YjsAlertManager(instanceId);
    managers.set(instanceId, manager);
  }
  return manager;
}

export function createAlertStore(instanceId: string = 'default') {
  const manager = getAlertManager(instanceId);

  return {
    get alerts(): Alert[] {
      return manager.listAlerts();
    },
    listAlerts: (vehicleId?: string) => manager.listAlerts(vehicleId),
    addAlert: (data: Omit<Alert, 'createdAt' | 'acknowledged'>) => manager.addAlert(data),
    acknowledgeAlert: (id: string) => manager.acknowledgeAlert(id),
    subscribe: (callback: () => void) => manager.subscribe(callback),
    unreadCount: () => unreadCount(manager.listAlerts()),
  };
}
