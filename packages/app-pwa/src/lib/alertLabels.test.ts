import { describe, it, expect } from 'vitest';
import {
  alertKindLabel,
  geofenceTypeLabel,
  notificationTitleLabel,
  severityLabel,
} from './alertLabels';
import { alertToNotification } from './notifications';

describe('alertLabels — lo que se ve va en español, lo guardado no cambia', () => {
  it('traduce severidad, tipo de alerta y tipo de geocerca', () => {
    expect(severityLabel('high')).toBe('Alta');
    expect(severityLabel('critical')).toBe('Crítica');
    expect(alertKindLabel('speed')).toBe('Exceso de velocidad');
    expect(geofenceTypeLabel('depot')).toBe('Depósito');
  });

  it('un valor desconocido se muestra tal cual, no se esconde', () => {
    expect(severityLabel('raro')).toBe('raro');
    expect(alertKindLabel(undefined)).toBe('');
    expect(geofenceTypeLabel('otro')).toBe('otro');
  });

  it('el título de la notificación de una alerta sale en español', () => {
    const n = alertToNotification({ kind: 'document', severity: 'low' });
    expect(n.title).toContain('document'); // lo guardado no se toca
    expect(notificationTitleLabel(n.title)).toBe('Alerta de documento — severidad baja');
  });

  it('otro título se devuelve sin tocar', () => {
    expect(notificationTitleLabel('Mantenimiento próximo')).toBe('Mantenimiento próximo');
  });
});
