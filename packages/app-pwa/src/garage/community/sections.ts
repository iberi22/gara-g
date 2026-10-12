/**
 * sections.ts — Registro de secciones de la wiki por version.
 *
 * Vive aparte de wiki.ts por una razon concreta: las rutas y la UI necesitan
 * responder DOS preguntas distintas sobre un `sectionId` —
 *   1. ¿esta seccion existe en la pagina?      → isKnownSection()
 *   2. ¿el usuario tiene permiso para editarla? → isCommunitySection()
 * Un id de catalogo existe pero no se edita: por eso la pregunta 1 y la 2 no son
 * la misma y el "editar esta seccion" se decide con la segunda.
 *
 * Los ids son parte del contrato publico (van en la URL de edicion), asi que
 * anadir una seccion es anadir una linea aqui, y cambiarla es romper enlaces.
 */
import { CATALOG_SECTIONS, COMMUNITY_SECTIONS, type CommunitySectionId } from './wiki';

/** Secciones editables por la comunidad, con el titulo que ve el usuario. */
export const COMMUNITY_SECTION_DEFS = COMMUNITY_SECTIONS;

/** Ids de las secciones generadas del catalogo (solo lectura). */
export const CATALOG_SECTION_IDS = CATALOG_SECTIONS;

/** Titulo de una seccion de comunidad por su id. */
export function communityTitle(id: string): string {
  return COMMUNITY_SECTIONS.find((s) => s.id === id)?.title ?? id;
}

/** `true` si el id es el de una seccion editable por la comunidad. */
export function isCommunitySection(id: string): id is CommunitySectionId {
  return COMMUNITY_SECTIONS.some((s) => s.id === id);
}

/** `true` si el id es el de una seccion generada del catalogo. */
export function isCatalogSection(id: string): boolean {
  return (CATALOG_SECTIONS as readonly string[]).includes(id);
}

/** `true` si el id corresponde a alguna seccion de la wiki (de catalogo o no). */
export function isKnownSection(id: string): boolean {
  return isCommunitySection(id) || isCatalogSection(id);
}

export type { CommunitySectionId };
export { CATALOG_SECTIONS, COMMUNITY_SECTIONS };
