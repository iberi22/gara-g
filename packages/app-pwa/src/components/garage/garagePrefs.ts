/**
 * garagePrefs.ts — Que muestra el Garage segun las preferencias de interfaz del usuario.
 *
 * Funcion pura (sin Svelte) para probar la logica sin montar el componente. Los ids son los
 * paneles `Garage · paneles` y `Garage · escenario` de `prefs.config.ts`.
 */
import type { Preferences } from '../../lib/swal-prefs';
import { isPanelEnabled, panelOption } from '../../lib/swal-prefs';
import type { ViewMode } from '../../garage/contracts';
import type { ActivePanel } from './BottomDock.svelte';

/** Paneles del dock en su orden. */
export const DOCK_ORDER: readonly Exclude<ActivePanel, null>[] = ['state', 'history', 'upcoming', 'wiki', 'forum', 'shop'];

const VIEW_MODES: readonly ViewMode[] = ['beauty', 'health', 'xray'];

export interface GarageView {
  dockPanels: Exclude<ActivePanel, null>[];
  showBlueprintAvailable: boolean;
  blueprintStartOn: boolean;
  showDimensions: boolean;
  showCallouts: boolean;
  maxCallouts: number;
  showNotifier: boolean;
  showSpecCards: boolean;
  showMonitoring: boolean;
  initialViewMode: ViewMode;
}

export function garageView(prefs: Preferences): GarageView {
  const max = panelOption(prefs, 'callouts', 'max', 6);
  const mode = panelOption(prefs, 'stage', 'viewMode', 'beauty');
  return {
    dockPanels: DOCK_ORDER.filter((id) => isPanelEnabled(prefs, id)),
    showBlueprintAvailable: isPanelEnabled(prefs, 'blueprint'),
    blueprintStartOn: panelOption(prefs, 'blueprint', 'startOn', true),
    showDimensions: isPanelEnabled(prefs, 'dimensions'),
    showCallouts: isPanelEnabled(prefs, 'callouts'),
    maxCallouts: Number.isFinite(max) ? Math.min(12, Math.max(1, Math.round(max))) : 6,
    showNotifier: isPanelEnabled(prefs, 'notifier'),
    showSpecCards: isPanelEnabled(prefs, 'specCards'),
    showMonitoring: isPanelEnabled(prefs, 'monitoring'),
    initialViewMode: (VIEW_MODES as readonly string[]).includes(mode) ? (mode as ViewMode) : 'beauty',
  };
}
