import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isGameUiEnabled,
  parseInterfaceMode,
  getInterfaceFromUrl,
  getInterfaceFromCookie,
  getStoredInterface,
  setStoredInterface,
  resolveActiveInterface,
  INTERFACE_MODES,
  COOKIE_NAME,
  STORAGE_KEY,
} from '../../src/lib/interfaceManager.js';

describe('Interface Manager Unit Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('isGameUiEnabled', () => {
    it('returns true by default when no flags or overrides exist', () => {
      expect(isGameUiEnabled()).toBe(true);
    });

    it('respects query overrides over env flags', () => {
      expect(isGameUiEnabled('false', 'true')).toBe(true);
      expect(isGameUiEnabled('true', 'false')).toBe(false);
      expect(isGameUiEnabled(true, '0')).toBe(false);
      expect(isGameUiEnabled(false, '1')).toBe(true);
    });

    it('handles boolean and string env flags correctly', () => {
      expect(isGameUiEnabled(false)).toBe(false);
      expect(isGameUiEnabled('false')).toBe(false);
      expect(isGameUiEnabled('0')).toBe(false);
      expect(isGameUiEnabled(true)).toBe(true);
      expect(isGameUiEnabled('true')).toBe(true);
      expect(isGameUiEnabled('1')).toBe(true);
    });
  });

  describe('parseInterfaceMode', () => {
    it('parses valid interface modes', () => {
      expect(parseInterfaceMode('admin')).toBe('admin');
      expect(parseInterfaceMode('AUI')).toBe('aui');
      expect(parseInterfaceMode(' Game ')).toBe('game');
    });

    it('returns null for unknown modes or invalid types', () => {
      expect(parseInterfaceMode('invalid')).toBeNull();
      expect(parseInterfaceMode('')).toBeNull();
      expect(parseInterfaceMode(null)).toBeNull();
      expect(parseInterfaceMode(123)).toBeNull();
    });
  });

  describe('getInterfaceFromUrl', () => {
    it('extracts interface mode from URL search params', () => {
      expect(getInterfaceFromUrl(new URL('https://domain.tld/fleet?ui=aui'))).toBe('aui');
      expect(getInterfaceFromUrl('https://domain.tld/fleet?ui=game')).toBe('game');
      expect(getInterfaceFromUrl('/fleet?ui=admin')).toBe('admin');
    });

    it('returns null when param is absent or invalid', () => {
      expect(getInterfaceFromUrl('/fleet')).toBeNull();
      expect(getInterfaceFromUrl('/fleet?ui=unknown')).toBeNull();
    });
  });

  describe('getInterfaceFromCookie', () => {
    it('extracts interface mode from cookie string', () => {
      const header = 'other=val; gara_interface_mode=game; session=xyz';
      expect(getInterfaceFromCookie(header)).toBe('game');
    });

    it('returns null if cookie is missing or invalid', () => {
      expect(getInterfaceFromCookie('other=val; session=xyz')).toBeNull();
      expect(getInterfaceFromCookie(null)).toBeNull();
      expect(getInterfaceFromCookie('')).toBeNull();
    });
  });

  describe('resolveActiveInterface', () => {
    it('prioritizes query param over cookie and default', () => {
      const res = resolveActiveInterface({
        url: 'https://domain.tld/fleet?ui=aui',
        cookieHeader: 'gara_interface_mode=admin',
      });
      expect(res.mode).toBe('aui');
      expect(res.requestedMode).toBe('aui');
      expect(res.source).toBe('query');
    });

    it('falls back to cookie when no query param is present', () => {
      const res = resolveActiveInterface({
        url: 'https://domain.tld/fleet',
        cookieHeader: 'gara_interface_mode=game',
      });
      expect(res.mode).toBe('game');
      expect(res.source).toBe('cookie');
    });

    it('falls back to admin when game is requested but GAME_UI_ENABLED is false', () => {
      const res = resolveActiveInterface({
        url: 'https://domain.tld/fleet?ui=game&game_enabled=false',
      });
      expect(res.requestedMode).toBe('game');
      expect(res.gameEnabled).toBe(false);
      expect(res.mode).toBe('admin'); // Fallback safe to admin
    });
  });

  describe('sin planes ni tiers', () => {
    it('el modulo ya no expone deteccion de socio', async () => {
      const mod = await import('../../src/lib/interfaceManager.js');
      expect('isSocioUser' in mod).toBe(false);
      expect('setDemoSocioStatus' in mod).toBe(false);
      expect('DEMO_SOCIO_STORAGE_KEY' in mod).toBe(false);
    });

    it('conmutar de interfaz sigue siendo una preferencia del usuario, sin gating', () => {
      expect(INTERFACE_MODES).toEqual(['admin', 'aui', 'game']);
      expect(STORAGE_KEY).toBe('gara_interface_mode');
      expect(COOKIE_NAME).toBe('gara_interface_mode');
      expect(resolveActiveInterface({ url: '/fleet?ui=aui' }).mode).toBe('aui');
    });
  });
});
