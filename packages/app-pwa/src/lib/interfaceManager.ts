/**
 * interfaceManager.ts — Gestión centralizada de las 3 interfaces de usuario de GARA-G:
 * 1. 'admin': Consola administrativa estándar de gestión de flotas (/fleet).
 * 2. 'aui': Interfaz agentica generativa propia de SWAL/UI con gating para cuentas Socio.
 * 3. 'game': Vista estilo videojuego (Need for Speed garage HUD) con flag GAME_UI_ENABLED.
 */

import { domainConfig } from './domain.config';
import { isSocioActivo, type SocioBillingInfo } from './socioGate';

export type InterfaceMode = 'admin' | 'aui' | 'game';

export const INTERFACE_MODES: readonly InterfaceMode[] = ['admin', 'aui', 'game'] as const;
export const DEFAULT_INTERFACE: InterfaceMode = 'admin';
export const STORAGE_KEY = 'gara_interface_mode';
export const COOKIE_NAME = 'gara_interface_mode';
export const DEMO_SOCIO_STORAGE_KEY = 'gara_demo_socio';

/**
 * Determina si la interfaz de videojuego está habilitada mediante:
 * 1. Query override (?game_enabled=true / false) — máxima prioridad para testing y runtime
 * 2. Variable de entorno GAME_UI_ENABLED ('false' | '0' la apagan, 'true' | '1' la encienden)
 * 3. Default: true
 */
export function isGameUiEnabled(
  envFlag?: string | boolean | null,
  queryOverride?: string | null
): boolean {
  if (queryOverride !== undefined && queryOverride !== null && queryOverride !== '') {
    const q = queryOverride.toLowerCase().trim();
    if (q === 'false' || q === '0') return false;
    if (q === 'true' || q === '1') return true;
  }

  if (envFlag !== undefined && envFlag !== null) {
    if (typeof envFlag === 'boolean') return envFlag;
    const ef = String(envFlag).toLowerCase().trim();
    if (ef === 'false' || ef === '0') return false;
    if (ef === 'true' || ef === '1') return true;
  }

  try {
    if (typeof process !== 'undefined' && process.env?.GAME_UI_ENABLED !== undefined) {
      const pe = String(process.env.GAME_UI_ENABLED).toLowerCase().trim();
      if (pe === 'false' || pe === '0') return false;
      if (pe === 'true' || pe === '1') return true;
    }
  } catch {}

  try {
    // Acceso ESTÁTICO a import.meta.env (vite lo reescribe en SSR/build).
    // El acceso dinámico `(import.meta as any)?.env` revienta el stream SSR
    // en workerd ("Dynamic access of import.meta.env is not supported").
    const me = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.GAME_UI_ENABLED;
    if (me !== undefined && me !== null) {
      const mes = String(me).toLowerCase().trim();
      if (mes === 'false' || mes === '0') return false;
      if (mes === 'true' || mes === '1') return true;
    }
  } catch {}

  return true;
}

/**
 * Valida y normaliza un modo de interfaz.
 */
export function parseInterfaceMode(val: unknown): InterfaceMode | null {
  if (typeof val === 'string') {
    const clean = val.toLowerCase().trim();
    if (clean === 'admin' || clean === 'aui' || clean === 'game') {
      return clean as InterfaceMode;
    }
  }
  return null;
}

/**
 * Lee el modo de interfaz desde los query parameters (?ui=...).
 */
export function getInterfaceFromUrl(url: URL | string): InterfaceMode | null {
  try {
    const u = typeof url === 'string' ? new URL(url, 'http://localhost') : url;
    const q = u.searchParams.get('ui');
    return parseInterfaceMode(q);
  } catch {
    return null;
  }
}

/**
 * Lee el modo de interfaz desde la cabecera Cookie.
 */
export function getInterfaceFromCookie(cookieHeader?: string | null): InterfaceMode | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (match && match[1]) {
    return parseInterfaceMode(decodeURIComponent(match[1]));
  }
  return null;
}

/**
 * Obtiene el modo persistido en el cliente (localStorage > cookie > default).
 */
export function getStoredInterface(): InterfaceMode {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const parsed = parseInterfaceMode(stored);
      if (parsed) return parsed;
    } catch {}
  }

  if (typeof document !== 'undefined') {
    const fromCookie = getInterfaceFromCookie(document.cookie);
    if (fromCookie) return fromCookie;
  }

  return DEFAULT_INTERFACE;
}

/**
 * Guarda el modo de interfaz en el cliente (localStorage + cookie).
 */
export function setStoredInterface(mode: InterfaceMode): void {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {}
  }

  if (typeof document !== 'undefined') {
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(mode)}; path=/; max-age=31536000; SameSite=Lax`;
  }
}

/**
 * Resuelve el modo activo combinando URL query, cookies, storage y la flag de videojuego.
 */
export function resolveActiveInterface(options: {
  url?: URL | string;
  cookieHeader?: string | null;
  envFlag?: string | boolean | null;
} = {}): {
  mode: InterfaceMode;
  requestedMode: InterfaceMode;
  gameEnabled: boolean;
  source: 'query' | 'cookie' | 'storage' | 'default';
} {
  let urlObj: URL | undefined;
  let gameQueryOverride: string | null = null;
  let queryMode: InterfaceMode | null = null;

  if (options.url) {
    try {
      urlObj = typeof options.url === 'string' ? new URL(options.url, 'http://localhost') : options.url;
      gameQueryOverride = urlObj.searchParams.get('game_enabled');
      queryMode = getInterfaceFromUrl(urlObj);
    } catch {}
  }

  const gameEnabled = isGameUiEnabled(options.envFlag, gameQueryOverride);

  let requestedMode: InterfaceMode = DEFAULT_INTERFACE;
  let source: 'query' | 'cookie' | 'storage' | 'default' = 'default';

  if (queryMode) {
    requestedMode = queryMode;
    source = 'query';
  } else if (options.cookieHeader) {
    const cookieMode = getInterfaceFromCookie(options.cookieHeader);
    if (cookieMode) {
      requestedMode = cookieMode;
      source = 'cookie';
    }
  } else {
    const stored = getStoredInterface();
    if (stored) {
      requestedMode = stored;
      source = stored === DEFAULT_INTERFACE ? 'default' : 'storage';
    }
  }

  // Si se solicitó la interfaz de juego pero está deshabilitada, se recurre a 'admin'
  let activeMode = requestedMode;
  if (requestedMode === 'game' && !gameEnabled) {
    activeMode = 'admin';
  }

  return {
    mode: activeMode,
    requestedMode,
    gameEnabled,
    source,
  };
}

/**
 * Verifica si la cuenta actual tiene privilegios de Socio para activar la AUI.
 * Toma en cuenta:
 * 1. Simulación demo en localStorage (gara_demo_socio)
 * 2. Billing de Stripe activo (isSocioActivo)
 * 3. Tier configurado en domainConfig.billing.tier ('payg', 'payg-managed', 'socio')
 */
export function isSocioUser(
  billing?: SocioBillingInfo | null,
  tierOverride?: string | null
): boolean {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const demoVal = localStorage.getItem(DEMO_SOCIO_STORAGE_KEY);
      if (demoVal === 'true') return true;
      if (demoVal === 'false') return false;
    } catch {}
  }

  if (tierOverride) {
    const clean = tierOverride.toLowerCase().trim();
    if (
      clean === 'payg' ||
      clean === 'payg-managed' ||
      clean === 'socio' ||
      clean === 'socio-managed' ||
      clean === 'socio_infra' ||
      clean === 'pro'
    ) {
      return true;
    }
    if (clean === 'free' || clean === 'mesh-only') {
      return false;
    }
  }

  if (billing) {
    if (isSocioActivo(billing)) return true;
    if (billing.planTier === 'socio_infra' || billing.planTier === 'pro') return true;
    if (billing.status === 'canceled' || billing.status === 'past_due' || billing.status === 'inactive') {
      return false;
    }
  }

  const defaultTier = (domainConfig as any)?.billing?.tier;
  if (defaultTier === 'payg' || defaultTier === 'payg-managed' || defaultTier === 'socio') {
    return true;
  }

  return false;
}

/**
 * Helper para alternar el estado demo de Socio en el navegador.
 */
export function setDemoSocioStatus(active: boolean): void {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(DEMO_SOCIO_STORAGE_KEY, active ? 'true' : 'false');
    } catch {}
  }
}
