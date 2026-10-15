// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installConfirmSubmit } from './confirmSubmit';

function form(confirmText?: string) {
  const f = document.createElement('form');
  if (confirmText) f.setAttribute('data-confirm', confirmText);
  document.body.appendChild(f);
  const later = vi.fn();
  f.addEventListener('submit', later);
  const ev = new Event('submit', { bubbles: true, cancelable: true });
  f.dispatchEvent(ev);
  return { ev, later };
}

describe('installConfirmSubmit', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('cancelar en el confirm() impide el envio y corta los demas listeners', () => {
    installConfirmSubmit();
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { ev, later } = form('¿Eliminar este registro?');
    expect(ask).toHaveBeenCalledWith('¿Eliminar este registro?');
    expect(ev.defaultPrevented).toBe(true);
    expect(later).not.toHaveBeenCalled();
  });

  it('aceptar deja seguir el envio', () => {
    installConfirmSubmit();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { ev, later } = form('¿Eliminar?');
    expect(ev.defaultPrevented).toBe(false);
    expect(later).toHaveBeenCalledOnce();
  });

  it('sin data-confirm no pregunta, e instalarlo dos veces pregunta una sola', () => {
    installConfirmSubmit();
    installConfirmSubmit();
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    form();
    expect(ask).not.toHaveBeenCalled();
    form('¿Seguro?');
    expect(ask).toHaveBeenCalledOnce();
  });
});
