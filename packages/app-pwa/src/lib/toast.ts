/**
 * toast.ts — Sistema de notificaciones toast ligero y reactivo para GARA-G.
 * Funciona offline-first y despacha eventos para integración limpia en Astro/Svelte.
 */

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastMessage {
  id: string;
  title?: string;
  message: string;
  type: ToastType;
  duration?: number;
}

type ToastListener = (toasts: ToastMessage[]) => void;

class ToastManager {
  private toasts: ToastMessage[] = [];
  private listeners: Set<ToastListener> = new Set();

  subscribe(listener: ToastListener): () => void {
    this.listeners.add(listener);
    listener([...this.toasts]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener([...this.toasts]);
    }
  }

  show(message: string, options: { title?: string; type?: ToastType; duration?: number } = {}): string {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const toast: ToastMessage = {
      id,
      title: options.title,
      message,
      type: options.type ?? 'info',
      duration: options.duration ?? 4000,
    };

    this.toasts.push(toast);
    this.notify();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('gara-toast', {
          detail: toast,
        })
      );
    }

    if (toast.duration && toast.duration > 0) {
      setTimeout(() => {
        this.dismiss(id);
      }, toast.duration);
    }

    return id;
  }

  dismiss(id: string): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.notify();
  }

  clear(): void {
    this.toasts = [];
    this.notify();
  }
}

export const toast = new ToastManager();
