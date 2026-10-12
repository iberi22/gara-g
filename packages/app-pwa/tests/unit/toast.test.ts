import { describe, it, expect, vi } from 'vitest';
import { toast } from '../../src/lib/toast.js';

describe('Toast Manager Unit Tests', () => {
  it('adds and notifies subscribers when a toast is shown', () => {
    let captured: any[] = [];
    const unsubscribe = toast.subscribe((toasts) => {
      captured = toasts;
    });

    const id = toast.show('Operación completada con éxito', { type: 'success', duration: 0 });
    expect(captured.length).toBeGreaterThan(0);
    const lastToast = captured.find((t) => t.id === id);
    expect(lastToast).toBeDefined();
    expect(lastToast?.type).toBe('success');
    expect(lastToast?.message).toContain('éxito');

    toast.dismiss(id);
    expect(captured.find((t) => t.id === id)).toBeUndefined();

    unsubscribe();
  });

  it('clears all toasts cleanly', () => {
    toast.show('Msg 1', { duration: 0 });
    toast.show('Msg 2', { duration: 0 });
    toast.clear();

    let count = 0;
    const unsub = toast.subscribe((toasts) => {
      count = toasts.length;
    });
    expect(count).toBe(0);
    unsub();
  });
});
