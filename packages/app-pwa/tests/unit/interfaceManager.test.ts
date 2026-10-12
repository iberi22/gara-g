import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isGameUiEnabled,
  parseInterfaceMode,
  getInterfaceFromUrl,
  getInterfaceFromCookie,
  getStoredInterface,
  setStoredInterface,
  resolveActiveInterface,
  isSocioUser,
  setDemoSocioStatus,
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

  describe('isSocioUser', () => {
    it('recognizes active Stripe socio billing', () => {
      expect(isSocioUser({ customerId: 'c1', status: 'active', planTier: 'socio_infra' })).toBe(true);
      expect(isSocioUser({ customerId: 'c2', status: 'canceled' })).toBe(false);
    });

    it('respects tier overrides', () => {
      expect(isSocioUser(null, 'payg')).toBe(true);
      expect(isSocioUser(null, 'free')).toBe(false);
      expect(isSocioUser(null, 'mesh-only')).toBe(false);
    });
  });
});
