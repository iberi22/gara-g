// notifications.test.ts — Tests del centro de notificaciones (P1.2, issue #917).
import { describe, it, expect } from 'vitest';
import {
  alertToNotification,
  unreadOnly,
  unreadCount,
  sortNewestFirst,
  markRead,
} from './notifications.js';

describe('alertToNotification', () => {
  it('construye payload desde alerta', () => {
    const n = alertToNotification(
      { kind: 'geofence', severity: 'high', message: 'Salió de zona' },
      '2026-09-05T00:00:00.000Z',
    );
    expect(n.kind).toBe('alert');
    expect(n.title).toContain('geofence');
    expect(n.severity).toBe('high');
    expect(n.readAt).toBeNull();
    expect(n.createdAt).toBe('2026-09-05T00:00:00.000Z');
  });
  it('tolerante a alerta vacía', () => {
    const n = alertToNotification({});
    expect(n.title).toContain('general');
    expect(n.severity).toBe('info');
  });
});

describe('unreadOnly / unreadCount', () => {
  const rows = [
    { id: '1', readAt: null },
    { id: '2', readAt: '2026-01-01' },
    { id: '3' },
  ];
  it('filtra no leídas', () => {
    expect(unreadOnly(rows).map((r) => r.id)).toEqual(['1', '3']);
  });
  it('cuenta no leídas', () => {
    expect(unreadCount(rows)).toBe(2);
  });
  it('cero cuando todo leído', () => {
    expect(unreadCount([{ readAt: 'x' }])).toBe(0);
  });
});

describe('sortNewestFirst', () => {
  it('ordena descendente por createdAt', () => {
    const rows = [
      { createdAt: '2026-01-01' },
      { createdAt: '2026-03-01' },
      { createdAt: '2026-02-01' },
    ];
    expect(sortNewestFirst(rows)[0].createdAt).toBe('2026-03-01');
  });
});

describe('markRead', () => {
  it('retorna copia con readAt sin mutar', () => {
    const row = { id: '1', readAt: null as unknown };
    const marked = markRead(row, '2026-09-05T00:00:00.000Z');
    expect(marked.readAt).toBe('2026-09-05T00:00:00.000Z');
    expect(row.readAt).toBeNull();
  });
});
