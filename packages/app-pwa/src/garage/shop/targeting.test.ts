/**
 * targeting.test.ts — Compatibilidad y relevancia.
 *
 * El caso que mas importa aqui es el de las tildes y las mayusculas: el anunciante
 * escribe "BMW" y el catalogo puede decir "bmw", o "Kawasaki" contra "kawasaki". Si la
 * comparacion falla ahi, el anunciante paga y nunca aparece, que es la peor falla posible
 * en un sistema de pujas porque nadie se da cuenta.
 */
import { describe, expect, it } from 'vitest';
import type { AdContext } from '../contracts';
import { isCompatible, normalizeText, relevanceScore } from './targeting';

function ctx(patch: Partial<AdContext> = {}): AdContext {
  return {
    slot: 'shop_feed',
    family: 'moto',
    body: 'naked',
    make: 'Yamaha',
    model: 'FZ16',
    versionKey: 'yamaha-fz16-2018-2024',
    city: 'Bogotá',
    userHash: 'u1',
    ...patch,
  };
}

describe('normalizeText', () => {
  it('quita mayúsculas, tildes y espacios de sobra', () => {
    expect(normalizeText('  Bogotá  ')).toBe('bogota');
    expect(normalizeText('AÉREO')).toBe('aereo');
  });

  it('trata vacío y null igual', () => {
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText(null)).toBe('');
  });
});

describe('isCompatible: lo que no coincide, no se sirve', () => {
  it('una campaña sin segmentación es compatible con cualquiera', () => {
    expect(isCompatible({}, ctx())).toBe(true);
  });

  it('filtra por familia', () => {
    expect(isCompatible({ families: ['moto'] }, ctx())).toBe(true);
    expect(isCompatible({ families: ['car'] }, ctx())).toBe(false);
  });

  it('filtra por marca ignorando mayúsculas y tildes', () => {
    expect(isCompatible({ makes: ['YAMAHA'] }, ctx())).toBe(true);
    expect(isCompatible({ makes: ['yamaha'] }, ctx())).toBe(true);
    expect(isCompatible({ makes: ['Honda'] }, ctx())).toBe(false);
  });

  it('filtra por modelo sin tildes', () => {
    expect(isCompatible({ models: ['fz16'] }, ctx())).toBe(true);
    expect(isCompatible({ models: ['FZ 16'] }, ctx())).toBe(false);
  });

  it('filtra por versionKey exacta', () => {
    expect(isCompatible({ versionKeys: ['yamaha-fz16-2018-2024'] }, ctx())).toBe(true);
    expect(isCompatible({ versionKeys: ['yamaha-fz16-2010-2015'] }, ctx())).toBe(false);
  });

  it('filtra por carrocería', () => {
    expect(isCompatible({ bodies: ['naked'] }, ctx())).toBe(true);
    expect(isCompatible({ bodies: ['sedan'] }, ctx())).toBe(false);
  });

  it('filtra por categoría de pieza solo si el contexto la trae', () => {
    expect(isCompatible({ partCategories: ['frenos'] }, ctx({ partCategory: 'frenos' }))).toBe(true);
    expect(isCompatible({ partCategories: ['frenos'] }, ctx())).toBe(false);
  });

  it('si una sola dimensión no coincide, la campaña entera no se sirve', () => {
    expect(isCompatible({ makes: ['Yamaha'], families: ['car'] }, ctx())).toBe(false);
  });

  it('acumula varias marcas: basta con que coincida una', () => {
    expect(isCompatible({ makes: ['Honda', 'Yamaha'] }, ctx())).toBe(true);
  });
});

describe('relevanceScore: manda la segmentación más específica', () => {
  it('versionKey pesa más que modelo, marca, carrocería y familia', () => {
    expect(relevanceScore({ versionKeys: ['yamaha-fz16-2018-2024'] }, ctx()).score).toBe(1.0);
    expect(relevanceScore({ models: ['FZ16'] }, ctx()).score).toBe(0.9);
    expect(relevanceScore({ makes: ['yamaha'] }, ctx()).score).toBe(0.8);
    expect(relevanceScore({ bodies: ['naked'] }, ctx()).score).toBe(0.7);
    expect(relevanceScore({ families: ['moto'] }, ctx()).score).toBe(0.6);
    expect(relevanceScore({}, ctx()).score).toBe(0.5);
  });

  it('si segmenta por varias, gana la coincidencia más específica', () => {
    const r = relevanceScore({ families: ['moto'], makes: ['Yamaha'], versionKeys: ['yamaha-fz16-2018-2024'] }, ctx());
    expect(r.score).toBe(1.0);
    expect(r.matchedOn).toBe('versionKey');
  });

  it('sin coincidencia en lo que sí segmenta, vale como no segmentada', () => {
    // isCompatible ya lo habría descartado; aquí se prueba el puntaje por si acaso.
    const r = relevanceScore({ makes: ['Honda'] }, ctx());
    expect(r.score).toBe(0.5);
    expect(r.matchedOn).toBe('none');
  });

  it('x1.25 cuando coincide la categoría de pieza', () => {
    const r = relevanceScore({ makes: ['Yamaha'], partCategories: ['frenos'] }, ctx({ partCategory: 'frenos' }));
    expect(r.baseScore).toBe(0.8);
    expect(r.score).toBeCloseTo(1.0, 9);
    expect(r.matchedOn).toBe('partCategory');
  });

  it('la categoría de pieza también sube a una campaña sin segmentar', () => {
    const r = relevanceScore({ partCategories: ['llantas'] }, ctx({ partCategory: 'llantas' }));
    expect(r.score).toBeCloseTo(0.5 * 1.25, 9);
  });

  it('la ciudad es tan específica como la carrocería', () => {
    expect(relevanceScore({ cities: ['bogotá'] }, ctx()).score).toBe(0.7);
  });

  it('la categoría de pieza que no coincide no penaliza ni sube', () => {
    const r = relevanceScore({ makes: ['Yamaha'], partCategories: ['frenos'] }, ctx({ partCategory: 'motor' }));
    expect(r.score).toBe(0.8);
  });
});