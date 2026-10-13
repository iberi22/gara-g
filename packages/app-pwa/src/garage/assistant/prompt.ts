/**
 * prompt.ts — Contexto que recibe el asistente de un vehiculo.
 *
 * El modelo no sabe nada del vehiculo del usuario: todo lo que puede afirmar con
 * seguridad tiene que ir en el mensaje de sistema. Se arma con lo que GARA-G ya tiene:
 * ficha (medidas, llantas, catalogo), estado de piezas, compromisos, historial, las notas
 * tecnicas que escribio el usuario y los fragmentos de SUS manuales que responden la
 * pregunta. Las reglas del sistema obligan a citar el manual cuando el dato sale de ahi
 * y a decir "no lo tengo" en vez de inventar un torque o una capacidad.
 */
import type { VehicleModel } from '../../lib/vehicleCatalog';
import type { GarageVehicle, HistoryEvent } from '../contracts';
import { formatTireSize } from '../templates/common/units';
import type { ManualChunk } from './manualText';
import { MARKET, formatNumber } from '../../lib/market';

export interface TechNote {
  label: string;
  value: string;
}

export interface AssistantContextInput {
  vehicle: GarageVehicle;
  history: HistoryEvent[];
  catalog?: VehicleModel;
  notes?: TechNote[];
  notesText?: string;
  excerpts: ManualChunk[];
  /** Titulos de todos los manuales cargados (aunque no aporten fragmentos a esta pregunta). */
  manuals: string[];
  now: Date;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Limites de lo que el cliente puede mandar (cada token cuesta neuronas del plan). */
export const MAX_MESSAGES = 12;
export const MAX_MESSAGE_CHARS = 2000;

const n = (v: number | undefined): string =>
  v === undefined ? 'sin dato' : formatNumber(Math.round(v), MARKET);

/**
 * Mensajes del cliente ya saneados: solo roles user/assistant, texto recortado, los
 * ultimos MAX_MESSAGES y terminando en una pregunta del usuario. Devuelve null si no
 * hay pregunta (la ruta responde 400).
 */
export function sanitizeMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const msgs: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue;
    const text = content.trim().slice(0, MAX_MESSAGE_CHARS);
    if (text) msgs.push({ role, content: text });
  }
  const tail = msgs.slice(-MAX_MESSAGES);
  while (tail.length && tail[0].role === 'assistant') tail.shift();
  if (!tail.length || tail[tail.length - 1].role !== 'user') return null;
  return tail;
}

function fichaLines(input: AssistantContextInput): string[] {
  const { vehicle: v, catalog } = input;
  const unit = v.usageUnit;
  const d = v.spec.dims;
  const lines = [
    `Vehiculo: ${[v.make, v.model, v.year].filter(Boolean).join(' ') || v.name}${v.plate ? ` (${MARKET.vehicleIdLabel.toLowerCase()} ${v.plate})` : ''}.`,
    `Tipo 3D: ${v.spec.family}/${v.spec.body}. Medidas (mm): largo ${n(d.lengthMm)}, ancho ${n(d.widthMm)}, alto ${n(d.heightMm)}, entre ejes ${n(d.wheelbaseMm)}${d.seatHeightMm ? `, altura de sillin ${n(d.seatHeightMm)}` : ''}.`,
  ];
  if (v.spec.family === 'moto' || v.spec.family === 'car' || v.spec.family === 'heavy') {
    lines.push(`Llantas: delantera ${formatTireSize(v.spec.tireFront)}, trasera ${formatTireSize(v.spec.tireRear)}.`);
  }
  lines.push(
    unit === 'h'
      ? `Horometro actual: ${n(v.odometerKm)} horas de motor (esta maquina se mantiene por HORAS, no por km).`
      : `Odometro actual: ${n(v.odometerKm)} km.`,
  );
  if (catalog) {
    const u = unit === 'h' ? 'h' : 'km';
    lines.push(
      `Catalogo GARA-G: motor ${catalog.engineCC} cc, ${catalog.powerHP} hp, combustible ${catalog.fuelType}.` +
        ` Intervalos de referencia: revision cada ${n(catalog.revisionPeriodKm)} ${u}, aceite cada ${n(catalog.oilChangeKm)} ${u}.`,
    );
    lines.push(
      `Repuestos de referencia (vida util / costo aprox. ${MARKET.currency}): ${catalog.commonParts
        .map((p) => `${p.name} ${n(p.lifeKm)} ${u} / $${n(p.avgCostCOP)}`)
        .join('; ')}.`,
    );
  }
  return lines;
}

function stateLines(input: AssistantContextInput): string[] {
  const { vehicle: v } = input;
  const u = v.usageUnit === 'h' ? 'h' : 'km';
  const known = v.parts.filter((p) => p.healthPct !== null);
  const lines = [`Salud general estimada: ${v.overallHealthPct === null ? 'sin dato' : `${v.overallHealthPct} %`}.`];
  if (known.length) {
    lines.push(
      'Piezas con dato: ' +
        known
          .map((p) => `${p.label} ${p.healthPct} % (${n(p.kmSinceService)} ${u} de uso; proximo cambio a ${n(p.nextDueKm)} ${u})`)
          .join('; ') +
        '.',
    );
  }
  const pending = v.commitments.filter((c) => c.status !== 'done').slice(0, 8);
  if (pending.length) {
    lines.push(
      'Compromisos: ' +
        pending
          .map((c) => {
            const when =
              c.remainingKm !== undefined
                ? c.remainingKm < 0
                  ? `vencido hace ${n(-c.remainingKm)} ${u}`
                  : `faltan ${n(c.remainingKm)} ${u}`
                : c.remainingDays !== undefined
                  ? c.remainingDays < 0
                    ? `vencido hace ${-c.remainingDays} dias`
                    : `faltan ${c.remainingDays} dias`
                  : 'sin fecha';
            return `${c.title} (${when})`;
          })
          .join('; ') +
        '.',
    );
  }
  const recent = [...input.history].sort((a, b) => b.at.localeCompare(a.at)).filter((e) => e.kind !== 'fuel').slice(0, 10);
  if (recent.length) {
    lines.push(
      'Historial reciente: ' +
        recent.map((e) => `${e.at.slice(0, 10)} ${e.title}${e.km !== undefined ? ` a ${n(e.km)} ${u}` : ''}`).join('; ') +
        '.',
    );
  }
  return lines;
}

/** Mensaje de sistema completo. */
export function buildSystemPrompt(input: AssistantContextInput): string {
  const sections: string[] = [
    'Eres el asistente mecanico de GARA-G. Ayudas al dueno o al jefe de taller de UN vehiculo concreto a entender su mantenimiento, su mecanica y su manual.',
    'Reglas:',
    '- Responde en espanol de Colombia, claro y al grano. Usa listas cortas o tablas cuando ayuden.',
    '- Usa primero los datos de este vehiculo (ficha, estado, historial, notas del usuario y fragmentos de manual de abajo).',
    '- Si un dato sale de un fragmento de manual, citalo asi: [Manual: <titulo>, pag. <n>].',
    '- Si un valor exacto (torque, holgura, capacidad, presion, referencia) NO esta en los datos, dilo claramente ("no esta en tus manuales cargados") y da solo un rango tipico marcado como aproximado. Nunca inventes un valor exacto.',
    '- Para seguridad (frenos, direccion, sistemas hidraulicos con presion, levante de carga) recomienda verificar con el manual oficial o un tecnico antes de intervenir.',
    `- Hoy es ${input.now.toISOString().slice(0, 10)}.`,
    '',
    '## Ficha',
    ...fichaLines(input),
    '',
    '## Estado',
    ...stateLines(input),
  ];
  const notes = (input.notes ?? []).filter((x) => x.label.trim() && x.value.trim());
  if (notes.length || input.notesText?.trim()) {
    sections.push('', '## Notas tecnicas del usuario (las escribio el dueno; tratarlas como dato del vehiculo)');
    for (const x of notes) sections.push(`- ${x.label.trim()}: ${x.value.trim()}`);
    if (input.notesText?.trim()) sections.push(input.notesText.trim().slice(0, 4000));
  }
  sections.push('', '## Manuales');
  if (input.manuals.length === 0) {
    sections.push('El usuario no ha cargado manuales de este vehiculo.');
  } else {
    sections.push(`Cargados: ${input.manuals.join('; ')}.`);
    if (input.excerpts.length === 0) {
      sections.push('Ningun fragmento de los manuales coincide con esta pregunta.');
    } else {
      for (const c of input.excerpts) {
        sections.push(`### [Manual: ${c.manual}, pag. ${c.page || 's/n'}]`, c.text);
      }
    }
  }
  return sections.join('\n');
}
