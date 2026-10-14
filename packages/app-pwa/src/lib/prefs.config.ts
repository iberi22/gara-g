/**
 * prefs.config.ts — Esquema de preferencias de GARA-G (que se puede activar, ocultar y ajustar).
 *
 * El motor (resolver, store, onboarding y ajustes) es generico y vive en lib/swal-prefs,
 * portable a @swal/ui. Este archivo solo declara lo propio de la app:
 *   - modules: las entradas del menu de FleetLayout (mismos ids que `navItems`).
 *   - panels:  los paneles del dock del Garage, los elementos del HUD y las secciones del
 *              dashboard, con sus opciones.
 *   - presets: los puntos de partida del onboarding segun el tipo de parque.
 *
 * Sube `version` solo si un cambio deja sin sentido lo guardado: las preferencias de una
 * version anterior se re-resuelven y el usuario vuelve a ver el onboarding.
 */
import type { PrefsSchema } from './swal-prefs';
import type { Need } from './swal-prefs/needs';
import { MARKET, localizeText } from './market';

export const GARA_PREFS_SCHEMA: PrefsSchema = {
  version: 1,
  modules: [
    { id: 'dashboard', label: 'Dashboard', group: 'Inicio', default: true, required: true, help: 'Resumen del parque. Siempre visible.' },
    { id: 'game', label: 'Garage', group: 'Inicio', default: true, help: 'El vehículo en 3D con su plano, su salud y su expediente.' },
    { id: 'aui', label: 'AUI Copilot', group: 'Inicio', default: true, help: 'Interfaz conversacional sobre los datos del parque.' },

    { id: 'vehicles', label: 'Vehículos', group: 'Operación', default: true },
    { id: 'fleets', label: 'Flotas', group: 'Operación', default: true, help: 'Agrupar vehículos por región o cliente.' },
    { id: 'drivers', label: 'Conductores', group: 'Operación', default: true, help: 'Licencias, vencimientos y asignación.' },
    { id: 'maintenance', label: 'Mantenimiento', group: 'Operación', default: true },
    { id: 'fuel', label: 'Combustible', group: 'Operación', default: true },
    { id: 'documents', label: 'Documentos', group: 'Operación', default: true, help: `${MARKET.documentKinds[0]}, ${MARKET.documentKinds[1]} y otros documentos con vencimiento.` },

    { id: 'tracking', label: 'Tracking', group: 'Monitoreo', default: true, help: 'Ubicación en vivo en el mapa.' },
    { id: 'geofences', label: 'Geocercas', group: 'Monitoreo', default: true },
    { id: 'alerts', label: 'Alertas', group: 'Monitoreo', default: true },

    { id: 'analytics', label: 'Analítica', group: 'Análisis', default: true },
    { id: 'catalog', label: 'Catálogo Vehicular', group: 'Análisis', default: true },
    { id: 'game-classic', label: 'Garaje clásico', group: 'Análisis', default: false, help: 'La vista de garaje anterior.' },
  ],
  panels: [
    // Garage: muelle inferior
    { id: 'state', label: 'Estado', scope: 'Garage · paneles', default: true, help: 'Salud de cada pieza.' },
    { id: 'history', label: 'Historial', scope: 'Garage · paneles', default: true, help: 'Mantenimientos registrados.' },
    { id: 'upcoming', label: 'Próximos', scope: 'Garage · paneles', default: true, help: 'Compromisos por fecha, km u horas.' },
    { id: 'wiki', label: 'Wiki', scope: 'Garage · paneles', default: true, help: 'Ficha técnica de la versión, editable.' },
    { id: 'forum', label: 'Foro', scope: 'Garage · paneles', default: true, help: 'Comunidad de dueños de la misma versión.' },
    { id: 'shop', label: 'Shop', scope: 'Garage · paneles', default: true, help: 'Repuestos y talleres sugeridos.' },

    // Garage: escenario y HUD
    {
      id: 'stage',
      label: 'Escenario 3D',
      scope: 'Garage · escenario',
      default: true,
      required: true,
      options: [
        {
          id: 'viewMode',
          label: 'Vista inicial',
          type: 'select',
          default: 'beauty',
          choices: [
            { value: 'beauty', label: 'Acabado' },
            { value: 'health', label: 'Salud' },
            { value: 'xray', label: 'Rayos X' },
          ],
        },
      ],
    },
    {
      id: 'blueprint',
      label: 'Plano técnico de fondo',
      scope: 'Garage · escenario',
      default: true,
      options: [{ id: 'startOn', label: 'Mostrar al abrir', type: 'toggle', default: true }],
    },
    { id: 'dimensions', label: 'Cotas (largo, alto, ejes)', scope: 'Garage · escenario', default: true },
    {
      id: 'callouts',
      label: 'Llamadas de piezas',
      scope: 'Garage · escenario',
      default: true,
      options: [{ id: 'max', label: 'Máximo de llamadas', type: 'number', default: 6, min: 1, max: 12, step: 1 }],
    },
    { id: 'notifier', label: 'Avisos de compromisos', scope: 'Garage · escenario', default: true },
    { id: 'specCards', label: 'Tarjetas de especificaciones', scope: 'Garage · escenario', default: true },
    { id: 'monitoring', label: 'Franja de monitoreo', scope: 'Garage · escenario', default: true, help: 'Telemetría en vivo cuando hay dispositivo.' },

    // Dashboard
    { id: 'dash-fleets', label: 'Listado de flotas', scope: 'Dashboard', default: true },
    { id: 'dash-km-chart', label: 'Gráfico de kilometraje', scope: 'Dashboard', default: true },
  ],
  presets: [
    {
      id: 'camiones',
      label: 'Flota de camiones',
      description: 'Conductores, combustible, rutas y documentos al día.',
      modules: { fleets: true, drivers: true, fuel: true, tracking: true, geofences: true, documents: true, alerts: true },
    },
    {
      id: 'maquinaria',
      label: localizeText('Maquinaria amarilla y volquetas', MARKET),
      description: 'Mantenimiento por horas de motor, documentos y alertas. Sin geocercas.',
      modules: { fleets: true, drivers: true, fuel: true, tracking: false, geofences: false, documents: true, alerts: true },
    },
    {
      id: 'personal',
      label: 'Mi vehículo',
      description: 'Una moto o un carro propio: garage, mantenimiento, manuales y asistente.',
      modules: { fleets: false, drivers: false, tracking: false, geofences: false, analytics: false, aui: false },
      panels: { 'dash-fleets': false },
    },
    {
      id: 'completo',
      label: 'Todo activado',
      description: 'Todos los módulos y paneles; luego apaga lo que no uses.',
      modules: {
        aui: true, fleets: true, drivers: true, fuel: true, documents: true, tracking: true,
        geofences: true, alerts: true, analytics: true, catalog: true,
      },
    },
  ],
};

/**
 * Necesidades del onboarding ("que necesitas") → modulos y paneles. Los ids son los de arriba.
 * Lo que una necesidad reclama y el usuario no elige se apaga; `GARA_CORE_MODULES` nunca se apaga
 * por esto. Solo se mapea lo que la app ya hace: nada de PIN, boveda familiar, IA local ni inventario.
 */
export const GARA_NEEDS: Need[] = [
  { id: 'own', label: 'Mi vehículo propio', desc: 'Garage, mantenimiento y manuales de una moto o un carro.', modules: ['game', 'maintenance', 'catalog'], panels: ['state', 'history', 'wiki'] },
  { id: 'fleet', label: 'Una flota', desc: 'Varios vehículos agrupados por región o cliente, con analítica.', modules: ['fleets', 'analytics'], panels: ['dash-fleets', 'dash-km-chart'] },
  { id: 'drivers', label: 'Conductores', desc: 'Licencias, vencimientos y asignación.', modules: ['drivers'] },
  { id: 'fuel', label: 'Combustible y mantenimiento', desc: 'Cargas, rendimiento y compromisos por km, horas o fecha.', modules: ['fuel', 'maintenance'], panels: ['upcoming', 'notifier'] },
  { id: 'docs', label: 'Documentos con vencimiento', desc: 'Seguros, licencias y permisos con aviso antes de vencer.', modules: ['documents', 'alerts'], panels: ['notifier'] },
  { id: 'live', label: 'Rastreo en vivo', desc: 'Ubicación en el mapa y geocercas.', modules: ['tracking', 'geofences'], panels: ['monitoring'] },
];
/** Modulos que las necesidades nunca apagan (el inicio y el garage siempre estan). */
export const GARA_CORE_MODULES = ['dashboard', 'game', 'aui', 'vehicles', 'maintenance', 'catalog'];

/** Ruta del onboarding y de los ajustes (el middleware y el menu las usan). */
export const ONBOARDING_PATH = '/fleet/bienvenida';
export const SETTINGS_PATH = '/fleet/ajustes';
export const PREFS_ENDPOINT = '/api/prefs';
export const PREFS_STORAGE_KEY = 'gara:prefs';
/** Cookie con el userId que ya hizo el onboarding en este navegador (ver middleware.ts). */
export const ONBOARDED_COOKIE = 'gara_onb';
