// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const mocks = vi.hoisted(() => ({
  unlock: vi.fn(),
  resetPinAfterRecovery: vi.fn()
}));

vi.mock('../src/lib/local/deviceLock', () => ({
  getLockSnapshot: vi.fn(async () => ({ state: 'locked', hasPasskey: false })),
  subscribeLockChanges: vi.fn(() => () => {}),
  unlock: mocks.unlock,
  resetPinAfterRecovery: mocks.resetPinAfterRecovery
}));

import LockGate from '../src/components/prefs/LockGate.svelte';

const q = <T extends Element>(sel: string) => document.querySelector<T>(sel);
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await tick();
    flushSync();
  }
};
const type = async (el: HTMLInputElement, v: string) => {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
};
const submit = async (sel: string) => {
  q<HTMLFormElement>(sel)!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
};

describe('LockGate: recuperar PIN olvidado', () => {
  let cmp: ReturnType<typeof mount>;
  beforeEach(async () => {
    mocks.unlock.mockReset().mockResolvedValue(undefined);
    mocks.resetPinAfterRecovery.mockReset().mockResolvedValue(undefined);
    cmp = mount(LockGate, { target: document.body });
    await settle();
  });
  afterEach(() => {
    unmount(cmp);
    document.body.innerHTML = '';
  });

  it('muestra el enlace "Olvidé mi PIN" y abre el código de recuperación', async () => {
    const link = q<HTMLButtonElement>('[data-testid="lock-gate-forgot-pin"]');
    expect(link?.textContent).toContain('Olvidé mi PIN');
    link!.click();
    await settle();
    expect(q('#lock-gate-recovery')).not.toBeNull();
  });

  it('tras canjear el código obliga a fijar un PIN nuevo antes de abrir', async () => {
    q<HTMLButtonElement>('[data-testid="lock-gate-forgot-pin"]')!.click();
    await settle();
    await type(q<HTMLInputElement>('#lock-gate-recovery')!, ' CODE-123 ');
    await submit('#lock-gate-recovery-form');
    expect(mocks.unlock).toHaveBeenCalledWith('recovery', 'CODE-123');
    // Sigue bloqueado: pide PIN nuevo.
    expect(q('[data-testid="lock-gate"]')).not.toBeNull();
    expect(q('#lock-gate-new-pin')).not.toBeNull();

    await type(q<HTMLInputElement>('#lock-gate-new-pin')!, '123456');
    await type(q<HTMLInputElement>('#lock-gate-new-pin2')!, '123456');
    await submit('#lock-gate-newpin-form');
    expect(mocks.resetPinAfterRecovery).toHaveBeenCalledWith('123456');
    expect(q('[data-testid="lock-gate"]')).toBeNull();
  });

  it('rechaza PIN nuevo que no coincide sin llamar a resetPinAfterRecovery', async () => {
    q<HTMLButtonElement>('[data-testid="lock-gate-forgot-pin"]')!.click();
    await settle();
    await type(q<HTMLInputElement>('#lock-gate-recovery')!, 'abc');
    await submit('#lock-gate-recovery-form');
    await type(q<HTMLInputElement>('#lock-gate-new-pin')!, '123456');
    await type(q<HTMLInputElement>('#lock-gate-new-pin2')!, '654321');
    await submit('#lock-gate-newpin-form');
    expect(mocks.resetPinAfterRecovery).not.toHaveBeenCalled();
    expect(q('[role="alert"]')?.textContent).toContain('no coinciden');
    expect(q('[data-testid="lock-gate"]')).not.toBeNull();
  });
});
