import { type DomainRecord, createEntity, listEntities, updateEntity } from '../../lib/domain';
import { MARKET, documentKindLabel, formatMoney } from '../../lib/market';
/**
 * wiki.ts — Wiki por version: secciones de catalogo (solo lectura) + secciones de
 * comunidad (editables, con control de revision optimista).
 *
 * La pagina se ARMA al vuelo, no se guarda entera: la mitad de las secciones sale
 * del catalogo (findModel + findModelSpec) y la otra mitad de la tabla `wikiSection`
 * de la instancia compartida. Asi una correccion en `vehicleCatalog.ts` o en
 * `modelSpecs.ts` llega a todas las wikis sin migrar nada, y las secciones de
 * comunidad sobreviven a los cambios de catalogo.
 *
 * Las secciones de comunidad son las unicas que se editan, y cada edicion guarda
 * la anterior en `wikiRevision`: la wiki es colaborativa entre sesiones, asi que
 * hace falta saber quien cambio que y poder volver atras. El control es
 * optimista: el cliente manda el `baseRevision` que tiene en pantalla; si alguien
 * escribio entre medias, se responde 409 con la version actual y el cliente
 * recarga en vez de pisar el trabajo del otro.
 *
 * La `VersionRef` se reconstruye desde la llave: se busca en el catalogo el modelo
 * cuyo `versionRefFor` produce esa llave. Si la llave no viene del catalogo (una
 * variante que el usuario escribio a mano), se arma una `VersionRef` con la misma
 * forma y una etiqueta legible derivada de la llave, para que la UI siempre tenga
 * algo que pintar.
 * El registro de "cual se puede editar" vive en sections.ts, que importa de aqui.
 */
import { COMMUNITY_INSTANCE_ID } from '../../lib/domain.config';
import { VEHICLE_CATALOG, findModel } from '../../lib/vehicleCatalog';
import type { ModelSpecEntry, VersionRef, WikiPage, WikiSection } from '../contracts';
import { versionRefFor } from '../domain/versionKey';
import { findModelSpec } from '../specs/modelSpecs';
import { CommunityError } from './errors';
import { cleanWikiSection } from './text';

const INSTANCE = COMMUNITY_INSTANCE_ID;

/**
 * Secciones de comunidad. El id es estable y va en la URL de edicion
 * (`PUT /api/garage/wiki/:versionKey/:sectionId`), asi que no se puede renombrar
 * sin romper los enlaces guardados: son parte del contrato publico.
 */
export const COMMUNITY_SECTIONS = [
  { id: 'fallas-comunes', title: 'Fallas comunes' },
  { id: 'torques-y-fluidos', title: 'Torques y fluidos' },
  { id: 'repuestos-compatibles', title: 'Repuestos compatibles' },
  { id: 'consejos', title: 'Consejos de uso y mantenimiento' },
] as const;

export type CommunitySectionId = (typeof COMMUNITY_SECTIONS)[number]['id'];

/**
 * Ids de las secciones generadas del catalogo. Nunca editables: un PUT sobre
 * ellas responde 403, porque su texto se deriva del catalogo y en cuanto alguien
 * lo edite a mano dejaria de coincidir con la ficha tecnica que lo origina.
 */
export const CATALOG_SECTIONS = [
  'especificaciones',
  'intervalos-mantenimiento',
  'repuestos-vida-util',
] as const;

/** Fila de `wikiSection`: el estado actual de una seccion editable de la comunidad. */
interface SectionBase {
  versionKey: string;
  sectionId: string;
  title: string;
  body: string;
  revision: number;
  updatedBy: string;
  updatedAt: string;
}

/**
 * Igual que en forum.ts: los helpers de `lib/domain.ts` exigen
 * `T extends Record<string, unknown>` y una interfaz no tiene indice implicito,
 * asi que la fila se cruza con `Record` para ser admisible. `New*` es la variante
 * que se escribe, sin `id` (lo genera `createEntity`).
 */
type SectionRow = SectionBase & Record<string, unknown>;
type NewSectionRow = Omit<SectionBase, never>;
type RevisionRow = Omit<SectionBase, 'title'>;
type NewRevisionRow = Omit<RevisionRow, never>;

/** Fila de `wikiSection` tal como la devuelve `listEntities`, con su id de tabla. */
type StoredSection = DomainRecord<SectionRow>;

function isStoredSection(v: unknown): v is StoredSection {
  return (
    typeof v === 'object' && v !== null && 'sectionId' in v && 'body' in v && 'versionKey' in v
  );
}

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

/**
 * Reconstruye la `VersionRef` desde la llave de la URL.
 *
 * Recorre el catalogo buscando el modelo cuya `versionRefFor` cae en esa llave
 * (make + model + rango de años). Si lo encuentra, devuelve la referencia real.
 * Si no, arma una con la etiqueta legible de la llave: "yamaha-fz16-2018-2024" se
 * presenta como "yamaha fz16 2018 2024", que es mejor que un error en la cabecera.
 */
export function versionRefFromKey(versionKey: string): VersionRef {
  for (const make of VEHICLE_CATALOG) {
    for (const model of make.models) {
      const ref = versionRefFor({ make: make.name, model: model.model });
      if (ref.key === versionKey) return ref;
    }
  }
  return { key: versionKey, make: '', model: '', label: readableKeyLabel(versionKey) };
}

/**
 * Etiqueta legible de una llave que no viene del catalogo: "mi-vehiculo-favorito-2020"
 * → "Mi vehiculo favorito 2020-2024".
 *
 * Solo la PRIMERA letra va en mayuscula (subir la palabra entera daria "MI vehiculo",
 * que parece un grito) y el rango de años del final se reagrupa con su guion, que es
 * como lo presenta `versionRefFor` para los modelos del catalogo ("2019-2024"). Unir
 * esas partes con espacio daria "2020 2024", que se lee como dos años sueltos.
 */
function readableKeyLabel(key: string): string {
  const words = key.split('-').filter(Boolean);
  if (!words.length) return key;

  // El rango de generacion es la cola de grupos de 4 digitos: 1 (un solo año) o 2
  // (rango). Se separa del resto porque es un dato, no una palabra de la marca.
  let fin = words.length;
  while (fin > 1 && /^\d{4}$/.test(words[fin - 1])) fin--;
  const rango = words.slice(fin);
  const resto = words.slice(0, fin);

  const [first, ...rest] = resto;
  const base =
    first.charAt(0).toUpperCase() + first.slice(1) + (rest.length ? ` ${rest.join(' ')}` : '');
  return rango.length ? `${base} ${rango.join('-')}` : base;
}

// ---------------------------------------------------------------------------
// Secciones de catalogo (solo lectura)
// ---------------------------------------------------------------------------

function mm(n: number | undefined): string {
  return n === undefined ? '—' : `${(n / 1000).toFixed(2)} m`;
}

/** "205/55R16" desde el TireSize del contrato. */
function tire(size: { widthMm: number; aspectPct: number; rimIn: number }): string {
  return `${size.widthMm}/${size.aspectPct}R${size.rimIn}`;
}

const FUEL_ES: Record<string, string> = {
  gasoline: 'gasolina',
  diesel: 'diésel',
  electric: 'eléctrica',
  hybrid: 'híbrida',
  gas: 'gas',
};

function catalogSection(id: string, title: string, body: string): WikiSection {
  return { id, title, body, source: 'catalog', editable: false };
}

/**
 * Secciones que salen del catalogo. Si el modelo no esta en `findModel` (una
 * version escrita a mano) no se inventan datos: solo se emite la de medidas si
 * hay ficha, y el resto quedan con un cuerpo que lo explica.
 */
function buildCatalogSections(versionKey: string): WikiSection[] {
  const ref = versionRefFromKey(versionKey);
  const model = ref.make && ref.model ? findModel(ref.make, ref.model) : undefined;
  const spec: ModelSpecEntry | undefined = findModelSpec(
    ref.make || undefined,
    ref.model || undefined,
  );

  const sections: WikiSection[] = [];

  // --- Especificaciones: motor, potencia, combustible, medidas y llantas ---
  if (model) {
    const lines: string[] = [];
    lines.push(`Motor: ${model.engineCC} cc`);
    lines.push(`Potencia: ${model.powerHP} HP`);
    lines.push(`Combustible: ${FUEL_ES[model.fuelType] ?? model.fuelType}`);
    if (model.payloadKg) lines.push(`Payload: ${model.payloadKg} kg`);
    if (spec) {
      lines.push('');
      lines.push(
        `Medidas: ${mm(spec.dims.lengthMm)} largo x ${mm(spec.dims.widthMm)} ancho x ${mm(spec.dims.heightMm)} alto`,
      );
      lines.push(`Entre ejes: ${mm(spec.dims.wheelbaseMm)}`);
      if (spec.dims.seatHeightMm) lines.push(`Altura del sillin: ${mm(spec.dims.seatHeightMm)}`);
      if (spec.dims.groundClearanceMm)
        lines.push(`Despeje del suelo: ${mm(spec.dims.groundClearanceMm)}`);
      lines.push(`Llanta delantera: ${tire(spec.tireFront)}`);
      lines.push(`Llanta trasera: ${tire(spec.tireRear)}`);
      if (spec.sources.length > 0) {
        lines.push('');
        lines.push(`Fuentes: ${spec.sources.join(', ')}`);
      }
    } else {
      lines.push('');
      lines.push('Medidas publicas: no hay ficha tecnica para esta version en modelSpecs.ts.');
    }
    sections.push(catalogSection('especificaciones', 'Especificaciones', lines.join('\n')));
  } else {
    sections.push(
      catalogSection(
        'especificaciones',
        'Especificaciones',
        [
          `Esta version (${readableKeyLabel(versionKey)}) no esta en el catalogo, asi que no hay`,
          'especificaciones oficiales para mostrar. Los duenos pueden documentarla en las',
          'secciones de comunidad de abajo.',
        ].join('\n'),
      ),
    );
  }

  // --- Intervalos de mantenimiento ---
  if (model) {
    sections.push(
      catalogSection(
        'intervalos-mantenimiento',
        'Intervalos de mantenimiento',
        [
          `Revision general: cada ${model.revisionPeriodKm} km`,
          `Cambio de aceite: cada ${model.oilChangeKm} km`,
          `Rotacion de llantas: cada ${model.tireRotationKm} km`,
          '',
          `${documentKindLabel('SOAT', MARKET)} anual estimado: ${formatMoney(model.soatDefaultCOP, MARKET)}`,
          `${documentKindLabel('Tecnomecánica', MARKET)} estimada: ${formatMoney(model.tecnoManualCOP, MARKET)}`,
        ].join('\n'),
      ),
    );
  } else {
    sections.push(
      catalogSection(
        'intervalos-mantenimiento',
        'Intervalos de mantenimiento',
        'Sin ficha en el catalogo no hay intervalos oficiales. Usa los del manual de tu unidad.',
      ),
    );
  }

  // --- Repuestos y vida util ---
  if (model) {
    const lines = model.commonParts.map(
      (p) =>
        `${p.name} (${p.category}): cada ${p.lifeKm} km — ${formatMoney(p.avgCostCOP, MARKET)}`,
    );
    sections.push(
      catalogSection(
        'repuestos-vida-util',
        'Repuestos y vida util',
        lines.length ? lines.join('\n') : 'Sin repuestos registrados para este modelo.',
      ),
    );
  } else {
    sections.push(
      catalogSection(
        'repuestos-vida-util',
        'Repuestos y vida util',
        'Sin ficha en el catalogo no hay lista de repuestos de referencia.',
      ),
    );
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Secciones de comunidad
// ---------------------------------------------------------------------------

/** Estado guardado de las secciones de comunidad de una version. */
async function loadCommunityRows(versionKey: string): Promise<StoredSection[]> {
  const all = await listEntities<unknown>('wikiSection', INSTANCE);
  return all.filter(isStoredSection).filter((r) => r.versionKey === versionKey);
}

/** Revisiones de una seccion, mas reciente primero (para el historial). */
export async function sectionHistory(
  versionKey: string,
  sectionId: string,
): Promise<RevisionRow[]> {
  const all = await listEntities<unknown>('wikiRevision', INSTANCE);
  return all
    .filter(isStoredSection)
    .filter((r) => r.versionKey === versionKey && r.sectionId === sectionId)
    .sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0))
    .map(({ id: _id, instance_id: _iid, created_at: _ca, updated_at: _ua, ...rest }) => rest);
}

/**
 * Arma la pagina completa: secciones de catalogo primero (son el bloque de
 * referencia) y luego las de comunidad, en el orden fijo de `COMMUNITY_SECTIONS`
 * aunque aun no tengan texto.
 *
 * `revision` de la pagina es el maximo de las revisiones de sus secciones de
 * comunidad: es el numero que el cliente manda de vuelta al editar.
 */
export async function getWikiPage(versionKey: string): Promise<WikiPage> {
  const version = versionRefFromKey(versionKey);
  const catalog = buildCatalogSections(versionKey);
  const rows = await loadCommunityRows(versionKey);
  const byId = new Map(rows.map((r) => [r.sectionId, r]));

  const community: WikiSection[] = COMMUNITY_SECTIONS.map((def) => {
    const row = byId.get(def.id);
    return {
      id: def.id,
      title: def.title,
      body: row?.body ?? '',
      source: 'community',
      editable: true,
      updatedAt: row?.updatedAt,
      // `updatedBy` es el alias, no el userId: en la wiki compartida tampoco viaja
      // la identidad real.
      updatedBy: row?.updatedBy,
    };
  });

  const maxRev = rows.reduce((max, r) => Math.max(max, r.revision ?? 0), 0);
  const latest = rows.reduce((max, r) => (r.updatedAt > max ? r.updatedAt : max), '');

  return {
    versionKey,
    version,
    sections: [...catalog, ...community],
    revision: maxRev,
    updatedAt: latest || new Date(0).toISOString(),
  };
}

export interface EditSectionInput {
  versionKey: string;
  sectionId: string;
  body: string;
  /** Revision que el cliente tiene en pantalla. */
  baseRevision: number;
  /** Alias del autor (nunca el userId). */
  authorName: string;
}

export type EditOutcome =
  | { ok: true; page: WikiPage }
  | { ok: false; conflict: true; current: WikiPage };

/**
 * Edita una seccion de comunidad con control de revision optimista.
 *
 * Si `baseRevision` no es la revision vigente, NO se escribe nada y se devuelve el
 * 409 con la pagina actual: el cliente puede ensenar los dos textos y decidir.
 * Antes de sobrescribir se copia la version anterior a `wikiRevision`, que es lo
 * que hace que la edicion sea recuperable.
 */
export async function editCommunitySection(input: EditSectionInput): Promise<EditOutcome> {
  const isCommunity = (COMMUNITY_SECTIONS as readonly { id: string }[]).some(
    (s) => s.id === input.sectionId,
  );
  if (!isCommunity) {
    // Las de catalogo y cualquier id inventado caen aqui. La ruta distingue el 403
    // (seccion de catalogo) del 404 (no existe) mirando CATALOG_SECTIONS.
    throw new CommunityError(`La seccion "${input.sectionId}" no es editable`, 403);
  }
  if (!Number.isInteger(input.baseRevision) || input.baseRevision < 0) {
    throw new CommunityError('baseRevision debe ser un entero >= 0', 400);
  }
  const body = cleanWikiSection(input.body);
  if (!body.ok) throw new CommunityError(body.error, 400);

  const existing = (await loadCommunityRows(input.versionKey)).find(
    (r) => r.sectionId === input.sectionId,
  );
  const currentRevision = existing?.revision ?? 0;

  if (input.baseRevision !== currentRevision) {
    return { ok: false, conflict: true, current: await getWikiPage(input.versionKey) };
  }

  const now = new Date().toISOString();
  const nextRevision = currentRevision + 1;

  // Historial: la version que se va a pisar queda guardada con SU revision, para
  // poder deshacer y para auditar quien cambio que.
  if (existing) {
    await createEntity<NewRevisionRow>(
      'wikiRevision',
      {
        versionKey: input.versionKey,
        sectionId: input.sectionId,
        revision: existing.revision,
        body: existing.body,
        updatedBy: existing.updatedBy,
        updatedAt: existing.updatedAt,
      },
      INSTANCE,
    );
  }

  if (existing) {
    await updateEntity<SectionRow>(
      'wikiSection',
      existing.id,
      { body: body.value, revision: nextRevision, updatedBy: input.authorName, updatedAt: now },
      INSTANCE,
    );
  } else {
    await createEntity<NewSectionRow>(
      'wikiSection',
      {
        versionKey: input.versionKey,
        sectionId: input.sectionId,
        title: COMMUNITY_SECTIONS.find((s) => s.id === input.sectionId)?.title ?? input.sectionId,
        body: body.value,
        revision: nextRevision,
        updatedBy: input.authorName,
        updatedAt: now,
      },
      INSTANCE,
    );
  }

  return { ok: true, page: await getWikiPage(input.versionKey) };
}

/** Una sola seccion por id, tal como aparece en la pagina. 404 si no existe. */
export async function getSection(versionKey: string, sectionId: string): Promise<WikiSection> {
  const page = await getWikiPage(versionKey);
  const section = page.sections.find((s) => s.id === sectionId);
  if (!section) throw new CommunityError(`Seccion "${sectionId}" no encontrada`, 404);
  return section;
}

/**
 * Estado guardado de una seccion de comunidad, o null si nunca se escribio (la
 * seccion existe en la pagina con cuerpo vacio, pero no tiene fila todavia).
 */
export async function getSectionRow(
  versionKey: string,
  sectionId: string,
): Promise<SectionRow | null> {
  const all = await listEntities<unknown>('wikiSection', INSTANCE);
  const found = all
    .filter(isStoredSection)
    .find((r) => r.versionKey === versionKey && r.sectionId === sectionId);
  if (!found) return null;
  const { id: _id, instance_id: _iid, created_at: _ca, updated_at: _ua, ...rest } = found;
  return rest;
}
