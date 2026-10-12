// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { enterGuestMode, leaveGuestMode } from './prefs.guest';
import { getClientMode } from './appMode';

afterEach(() => leaveGuestMode());

describe('prefs.guest: cookie de modo local', () => {
  it('enterGuestMode fija gara_mode=guest y getClientMode lo ve', () => {
    expect(getClientMode()).toBe('cloud');
    enterGuestMode();
    expect(document.cookie).toContain('gara_mode=guest');
    expect(getClientMode()).toBe('guest');
  });

  it('leaveGuestMode la borra', () => {
    enterGuestMode();
    leaveGuestMode();
    expect(document.cookie).not.toContain('gara_mode');
    expect(getClientMode()).toBe('cloud');
  });
});
