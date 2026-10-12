import { describe, expect, it } from 'vitest';
import { GARA_PREFS_SCHEMA } from '../../lib/prefs.config';
import { resolvePrefs } from '../../lib/swal-prefs';
import { garageView } from './garagePrefs';

const view = (panels: Record<string, unknown> = {}) => garageView(resolvePrefs(GARA_PREFS_SCHEMA, { panels }));

describe('garageView', () => {
  it('por defecto muestra todo', () => {
    const v = view();
    expect(v.dockPanels).toEqual(['state', 'history', 'upcoming', 'wiki', 'forum', 'shop']);
    expect(v.maxCallouts).toBe(6);
    expect(v.initialViewMode).toBe('beauty');
    expect(v.showBlueprintAvailable && v.blueprintStartOn && v.showDimensions && v.showNotifier).toBe(true);
    expect(v.showSpecCards && v.showMonitoring && v.showCallouts).toBe(true);
  });
  it('quitar shop y foro los saca del dock', () => {
    expect(view({ shop: { enabled: false }, forum: { enabled: false } }).dockPanels).toEqual(['state', 'history', 'upcoming', 'wiki']);
  });
  it('plano desactivado', () => {
    expect(view({ blueprint: { enabled: false } }).showBlueprintAvailable).toBe(false);
    expect(view({ blueprint: { enabled: true, options: { startOn: false } } }).blueprintStartOn).toBe(false);
  });
  it('acota el maximo de llamadas', () => {
    expect(view({ callouts: { enabled: true, options: { max: 99 } } }).maxCallouts).toBe(12);
    expect(view({ callouts: { enabled: true, options: { max: 0 } } }).maxCallouts).toBe(1);
    expect(view({ callouts: { enabled: false } }).showCallouts).toBe(false);
  });
  it('respeta la vista inicial', () => {
    expect(view({ stage: { enabled: true, options: { viewMode: 'xray' } } }).initialViewMode).toBe('xray');
  });
});
