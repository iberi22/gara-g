/**
 * hudTheme.ts — Tema visual del HUD (taller claro / garaje oscuro) y su preferencia.
 *
 * La ronda 3 del HUD cambia la direccion de arte a la del configurador de producto: hoja
 * de plano clara por defecto y un tema oscuro alternativo. El tema no es solo CSS: el
 * escenario 3D tiene su propio escenario (`StageTheme` en contracts.ts, 'studio' claro /
 * 'garage' oscuro), asi que el toggle cambia AMBOS a la vez. El atributo `data-g3-theme`
 * del contenedor es lo que lee el CSS para cambiar los tokens.
 */
import type { StageTheme } from '../../garage/contracts';

export type HudTheme = StageTheme;

export interface HudThemeMeta {
  id: HudTheme;
  label: string;
  /** Texto del boton que cambia AL otro tema. */
  toggleLabel: string;
  hint: string;
}

export const HUD_THEMES: readonly HudThemeMeta[] = [
  {
    id: 'studio',
    label: 'TALLER',
    toggleLabel: 'TALLER',
    hint: 'Escenario claro de configurador con plano tecnico',
  },
  {
    id: 'garage',
    label: 'GARAJE',
    toggleLabel: 'GARAJE',
    hint: 'Escenario oscuro de juego con neones',
  },
] as const;

export const THEME_STORAGE_KEY = 'garage:theme:v1';
export const DEFAULT_THEME: HudTheme = 'studio';

export function themeMeta(theme: HudTheme): HudThemeMeta {
  return HUD_THEMES.find((t) => t.id === theme) ?? HUD_THEMES[0];
}

/** El tema contrario, para el boton del toggle. */
export function oppositeTheme(theme: HudTheme): HudTheme {
  return theme === 'studio' ? 'garage' : 'studio';
}

export function loadStoredTheme(): HudTheme {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  try {
    const theme = document.documentElement.dataset.theme;
    if (theme === 'taller-dark') return 'garage';
    return 'studio';
  } catch {
    // Sin DOM legible (render en servidor o documento raro): tema por defecto.
  }
  return DEFAULT_THEME;
}

export function saveStoredTheme(theme: HudTheme): void {
  if (typeof window === 'undefined') return;
  try {
    // @ts-expect-error window.swalTheme is injected by ThemeBootstrap.astro
    window.swalTheme?.set(theme === 'garage' ? 'dark' : 'light');
  } catch {
    // Sin ThemeBootstrap en la pagina no hay tema global que cambiar: no se rompe nada.
  }
}