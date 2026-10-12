/**
 * wiki.test.ts — Wiki por version: secciones de catalogo y de comunidad.
 *
 * Lo que se protege:
 *   1. Las secciones de catalogo dicen la verdad del catalogo (motor, potencia,
 *      intervalos, repuestos) para un modelo que esta en `VEHICLE_CATALOG`.
 *   2. Las secciones de comunidad se guardan, se editan y llevan revision.
 *   3. El control de revision optimista: una `baseRevision` vieja NO pisa el trabajo
 *      de otro, devuelve conflicto con la version vigente.
 *   4. Una seccion de catalogo no se puede editar (403).
 *   5. Una llave que no viene del catalogo no rompe: se degrada a etiqueta legible.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getMemoryAdapter, listEntities, setStorageAdapter } from '../../lib/domain';
import { COMMUNITY_INSTANCE_ID } from '../../lib/domain.config';
import { versionRefFor } from '../domain/versionKey';
import {
  CATALOG_SECTIONS,
  COMMUNITY_SECTIONS,
  editCommunitySection,
  getSectionRow,
  getWikiPage,
  sectionHistory,
  versionRefFromKey,
} from './wiki';

const V_FZ16 = versionRefFor({ make: 'Yamaha', model: 'FZ16' }).key;
const V_HILUX = versionRefFor({ make: 'Toyota', model: 'Hilux' }).key;
const V_INVENTADA = 'mi-vehiculo-favorito-2020-2024';

beforeEach(() => {
  getMemoryAdapter().clear();
  setStorageAdapter(getMemoryAdapter());
});

describe('wiki: secciones de catalogo (solo lectura)', () => {
  it('trae motor, potencia, combustible y medidas de un modelo del catalogo', async () => {
    const page = await getWikiPage(V_FZ16);
    const esp = page.sections.find((s) => s.id === 'especificaciones');

    expect(esp).toBeDefined();
    expect(esp?.source).toBe('catalog');
    expect(esp?.editable).toBe(false);
    // Yamaha FZ16: 150 cc, 14 HP, gasolina.
    expect(esp?.body).toContain('150 cc');
    expect(esp?.body).toContain('14 HP');
    expect(esp?.body).toContain('gasolina');
  });

  it('trae los intervalos de mantenimiento del modelo', async () => {
    const page = await getWikiPage(V_FZ16);
    const sec = page.sections.find((s) => s.id === 'intervalos-mantenimiento');
    expect(sec?.body).toContain('Revision general: cada 4000 km');
    expect(sec?.body).toContain('Cambio de aceite: cada 4000 km');
    expect(sec?.body).toContain('Rotacion de llantas: cada 8000 km');
  });

  it('trae los repuestos con su vida util', async () => {
    const page = await getWikiPage(V_FZ16);
    const sec = page.sections.find((s) => s.id === 'repuestos-vida-util');
    expect(sec?.body).toContain('Pastillas freno');
    expect(sec?.body).toContain('25000 km');
    expect(sec?.body).toContain('Cadena + sprocket');
  });

  it('las secciones de catalogo son exactamente las tres documentadas', async () => {
    const page = await getWikiPage(V_HILUX);
    const deCatalogo = page.sections.filter((s) => s.source === 'catalog').map((s) => s.id);
    expect(deCatalogo).toEqual([...CATALOG_SECTIONS]);
  });

  it('las cuatro secciones de comunidad existen aunque esten vacias', async () => {
    const page = await getWikiPage(V_FZ16);
    const deComunidad = page.sections.filter((s) => s.source === 'community');
    expect(deComunidad.map((s) => s.id)).toEqual(COMMUNITY_SECTIONS.map((s) => s.id));
    expect(deComunidad.every((s) => s.editable && s.body === '')).toBe(true);
  });

  it('una version que no esta en el catalogo no inventa datos', async () => {
    const page = await getWikiPage(V_INVENTADA);
    const esp = page.sections.find((s) => s.id === 'especificaciones');
    expect(esp?.body).toContain('no esta en el catalogo');
    // Sin numeros de motor: la seccion no inventa una ficha tecnica que no existe.
    expect(esp?.body).not.toMatch(/Motor: \d+ cc/);
    expect(esp?.body).not.toMatch(/Potencia: \d+ HP/);
    // Y aun asi es una pagina valida con las cuatro secciones editables.
    expect(page.sections.filter((s) => s.source === 'community')).toHaveLength(4);
  });
});

describe('wiki: la VersionRef se reconstruye desde la llave', () => {
  it('encuentra el modelo del catalogo cuya llave coincide', () => {
    const ref = versionRefFromKey(V_FZ16);
    expect(ref.make).toBe('Yamaha');
    expect(ref.model).toBe('FZ16');
    expect(ref.key).toBe(V_FZ16);
    expect(ref.label).toContain('Yamaha FZ16');
    expect(ref.yearFrom).toBe(2019);
    expect(ref.yearTo).toBe(2024);
  });

  it('si no la encuentra, inventa una etiqueta legible sin fallar', () => {
    const ref = versionRefFromKey(V_INVENTADA);
    expect(ref.key).toBe(V_INVENTADA);
    expect(ref.label).toBe('Mi vehiculo favorito 2020-2024');
  });
});

describe('wiki: secciones de comunidad', () => {
  it('la primera edicion crea la seccion y sube la revision a 1', async () => {
    const out = await editCommunitySection({
      versionKey: V_FZ16,
      sectionId: 'fallas-comunes',
      body: 'A los 30 000 km se apaga la luz deereo.',
      baseRevision: 0,
      authorName: 'Piloto-aaaaaa',
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.page.revision).toBe(1);
    const sec = out.page.sections.find((s) => s.id === 'fallas-comunes');
    expect(sec?.body).toBe('A los 30 000 km se apaga la luz deereo.');
    expect(sec?.updatedBy).toBe('Piloto-aaaaaa');
    expect(sec?.updatedAt).toBeTruthy();
  });

  it('la edicion siguiente sube la revision y guarda la anterior en el historial', async () => {
    await editCommunitySection({
      versionKey: V_FZ16,
      sectionId: 'fallas-comunes',
      body: 'primera version',
      baseRevision: 0,
      authorName: 'Piloto-aaaaaa',
    });
    const out = await editCommunitySection({
      versionKey: V_FZ16,
      sectionId: 'fallas-comunes',
      body: 'segunda version',
      baseRevision: 1,
      authorName: 'Piloto-bbbbbb',
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.page.revision).toBe(2);
    expect(out.page.sections.find((s) => s.id === 'fallas-comunes')?.body).toBe('segunda version');

    const historial = await sectionHistory(V_FZ16, 'fallas-comunes');
    expect(historial).toHaveLength(1);
    expect(historial[0].body).toBe('primera version');
    expect(historial[0].revision).toBe(1);
    expect(historial[0].updatedBy).toBe('Piloto-aaaaaa');
  });

  it('baseRevision vieja da conflicto y NO pisa lo que habia', async () => {
    await editCommunitySection({
      versionKey: V_FZ16,
      sectionId: 'consejos',
      body: 'lo escribio A',
      baseRevision: 0,
      authorName: 'Piloto-aaaaaa',
    });
    // B tiene la pagina vieja en pantalla (revision 0) y escribe encima.
    const out = await editCommunitySection({
      versionKey: V_FZ16,
      sectionId: 'consejos',
      body: 'lo escribio B, sobre texto viejo',
      baseRevision: 0,
      authorName: 'Piloto-bbbbbb',
    });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.conflict).toBe(true);
    // El conflicto trae la version vigente para que el cliente resuelva.
    expect(out.current.revision).toBe(1);
    expect(out.current.sections.find((s) => s.id === 'consejos')?.body).toBe('lo escribio A');

    const fila = await getSectionRow(V_FZ16, 'consejos');
    expect(fila?.body).toBe('lo escribio A');
    expect(fila?.revision).toBe(1);
    expect(fila?.updatedBy).toBe('Piloto-aaaaaa');
  });

  it('las secciones de una version no se mezclan entre si', async () => {
    await editCommunitySection({
      versionKey: V_FZ16,
      sectionId: 'consejos',
      body: 'consejo de la FZ16',
      baseRevision: 0,
      authorName: 'Piloto-aaaaaa',
    });
    const otra = await getWikiPage(V_HILUX);
    expect(otra.sections.find((s) => s.id === 'consejos')?.body).toBe('');
    expect(otra.revision).toBe(0);
  });

  it('editar una seccion de catalogo es 403 y no crea fila', async () => {
    for (const sectionId of CATALOG_SECTIONS) {
      await expect(
        editCommunitySection({
          versionKey: V_FZ16,
          sectionId,
          body: 'texto malicioso',
          baseRevision: 0,
          authorName: 'Piloto-aaaaaa',
        }),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(await listEntities('wikiSection', COMMUNITY_INSTANCE_ID)).toHaveLength(0);
  });

  it('un sectionId inexistente es 403 tambien (no se edita lo que no existe)', async () => {
    await expect(
      editCommunitySection({
        versionKey: V_FZ16,
        sectionId: 'seccion-inventada',
        body: 'texto',
        baseRevision: 0,
        authorName: 'Piloto-aaaaaa',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('baseRevision invalido es 400', async () => {
    for (const baseRevision of [-1, 1.5, Number.NaN]) {
      await expect(
        editCommunitySection({
          versionKey: V_FZ16,
          sectionId: 'fallas-comunes',
          body: 'texto',
          baseRevision,
          authorName: 'Piloto-aaaaaa',
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it('un cuerpo de wiki de mas de 20000 caracteres es 400', async () => {
    await expect(
      editCommunitySection({
        versionKey: V_FZ16,
        sectionId: 'fallas-comunes',
        body: 'x'.repeat(20001),
        baseRevision: 0,
        authorName: 'Piloto-aaaaaa',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('la fila guardada lleva el alias y no el userId', async () => {
    await editCommunitySection({
      versionKey: V_FZ16,
      sectionId: 'torques-y-fluidos',
      body: 'Tuerca de rueda: 88 Nm',
      baseRevision: 0,
      authorName: 'Piloto-xyz123',
    });
    const filas = await listEntities('wikiSection', COMMUNITY_INSTANCE_ID);
    expect(filas).toHaveLength(1);
    expect(filas[0].updatedBy).toBe('Piloto-xyz123');
    expect(JSON.stringify(filas[0])).not.toContain('@');
  });
});
