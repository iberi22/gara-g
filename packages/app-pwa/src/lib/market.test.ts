/**
 * market.test.ts — El mercado es un dato, no constantes repartidas por la interfaz.
 *
 * Fija las dos cosas que se rompieron en la entrega a Chile: que el mercado por defecto sea
 * `es-CL`/CLP (sin decimales) y que el vocabulario legal se traduzca sin tocar el dato
 * guardado. El otro mercado (Colombia) se comprueba a proposito: cambiar de pais debe ser
 * una variable de entorno, no un reemplazo de codigo.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MARKET_ID,
  LITERS_PER_GALLON,
  MARKETS,
  MARKET,
  documentKindLabel,
  efficiencyFor,
  formatDate,
  formatDateTime,
  formatDecimal,
  formatMoney,
  formatNumber,
  formatVolume,
  formatEfficiency,
  marketFor,
  normalizeKindKey,
  resolveMarketId,
  volumeFieldsFor,
  volumeLiters,
} from './market';

describe('mercado activo', () => {
  it('sin configuracion, el mercado es Chile (es-CL, CLP) y CLP no lleva decimales', () => {
    expect(DEFAULT_MARKET_ID).toBe('CL');
    expect(MARKET.id).toBe('CL');
    expect(MARKET.locale).toBe('es-CL');
    expect(MARKET.currency).toBe('CLP');
    expect(MARKET.currencyDecimals).toBe(0);
    expect(MARKET.volumeUnit).toBe('L');
    expect(MARKET.volumeUnitName).toBe('Litros');
    expect(MARKET.efficiencyUnit).toBe('km/L');
  });

  it('resolveMarketId entiende CO y cae a Chile con cualquier otra cosa', () => {
    expect(resolveMarketId('CO')).toBe('CO');
    expect(resolveMarketId('es-CO')).toBe('CO');
    expect(resolveMarketId('colombia')).toBe('CO');
    expect(resolveMarketId('CL')).toBe('CL');
    expect(resolveMarketId('')).toBe('CL');
    expect(resolveMarketId(undefined)).toBe('CL');
    expect(resolveMarketId('peru')).toBe('CL');
  });

  it('marketFor devuelve la configuracion completa de cada mercado', () => {
    expect(marketFor('CO').currency).toBe('COP');
    expect(marketFor('CO').volumeUnit).toBe('gal');
    expect(marketFor('CO').vehicleIdLabel).toBe('Placa');
    expect(marketFor('CL').vehicleIdLabel).toBe('Patente');
    expect(marketFor('CL').driverIdLabel).toBe('RUT');
    expect(marketFor('CO').driverIdLabel).toBe('Cédula');
  });
});

describe('formateadores', () => {
  it('formatNumber usa los separadores del mercado', () => {
    expect(formatNumber(28450, MARKETS.CL)).toBe('28.450');
    expect(formatNumber(28450, MARKETS.CO)).toBe('28.450');
    expect(formatNumber(null, MARKETS.CL)).toBe('—');
  });

  it('formatMoney no escribe decimales en CLP (ni en COP)', () => {
    expect(formatMoney(186000, MARKETS.CL)).toBe('$186.000');
    expect(formatMoney(1234567, MARKETS.CL)).toBe('$1.234.567');
    expect(formatMoney(-12000, MARKETS.CL)).toBe('−$12.000');
    expect(formatMoney(null, MARKETS.CL)).toBe('—');
  });

  it('formatDecimal usa la coma decimal de es-CL', () => {
    expect(formatDecimal(1234.5, 1, MARKETS.CL)).toBe('1.234,5');
    expect(formatDecimal(6.94, 1, MARKETS.CL)).toBe('6,9');
  });

  it('formatVolume y formatEfficiency llevan la unidad del mercado', () => {
    expect(formatVolume(1234.5, MARKETS.CL)).toBe('1.234,5 L');
    expect(formatVolume(10, MARKETS.CO)).toBe('10,0 gal');
    expect(formatVolume(null, MARKETS.CL)).toBe('—');
    expect(formatEfficiency(2.8, MARKETS.CL)).toBe('2,8 km/L');
    expect(formatEfficiency(null, MARKETS.CL)).toBe('—');
  });

  it('formatDate/formatDateTime no inventan fechas', () => {
    expect(formatDate('', MARKETS.CL)).toBe('—');
    expect(formatDate('no-es-fecha', MARKETS.CL)).toBe('—');
    expect(formatDateTime(null, MARKETS.CL)).toBe('—');
    expect(formatDate('2026-10-17', MARKETS.CL)).toContain('2026');
  });
})

describe('unidades de combustible', () => {
  it('volumeLiters acepta la fila en litros o en galones', () => {
    expect(volumeLiters({ liters: 100 })).toBe(100);
    expect(volumeLiters({ gallons: 10 })).toBeCloseTo(10 * LITERS_PER_GALLON, 9);
    // Con las dos, mandan los litros.
    expect(volumeLiters({ liters: 100, gallons: 999 })).toBe(100);
    expect(volumeLiters({})).toBeNull();
  });

  it('volumeFieldsFor guarda las dos unidades sin perder el valor del mercado', () => {
    const cl = volumeFieldsFor(100, MARKETS.CL);
    expect(cl.liters).toBe(100);
    expect(cl.gallons).toBeCloseTo(100 / LITERS_PER_GALLON, 2);
    const co = volumeFieldsFor(10, MARKETS.CO);
    expect(co.gallons).toBe(10);
    expect(co.liters).toBeCloseTo(10 * LITERS_PER_GALLON, 2);
  });

  it('efficiencyFor convierte km/L a la unidad del mercado', () => {
    expect(efficiencyFor(10, MARKETS.CL)).toBe(10);
    expect(efficiencyFor(10, MARKETS.CO)).toBeCloseTo(10 * LITERS_PER_GALLON, 9);
    expect(efficiencyFor(null, MARKETS.CL)).toBeNull();
  });
})

describe('vocabulario legal', () => {
  it('normalizeKindKey quita tildes y mayusculas', () => {
    expect(normalizeKindKey('Tecnomecánica')).toBe('tecnomecanica');
    expect(normalizeKindKey('  Revisión   Técnica ')).toBe('revision tecnica');
  });

  it('en Chile el dato guardado en Colombia se lee en chileno', () => {
    expect(documentKindLabel('SOAT', MARKETS.CL)).toBe('SOAP');
    expect(documentKindLabel('Tecnomecánica', MARKETS.CL)).toBe('Revisión Técnica (PRT)');
    expect(documentKindLabel('Tecno', MARKETS.CL)).toBe('Revisión Técnica (PRT)');
    expect(documentKindLabel('Tarjeta de propiedad', MARKETS.CL)).toBe('Permiso de Circulación');
    expect(documentKindLabel('Póliza todo riesgo', MARKETS.CL)).toBe('Póliza de seguro');
  });

  it('en Colombia el dato guardado en Chile se lee en colombiano', () => {
    expect(documentKindLabel('SOAP', MARKETS.CO)).toBe('SOAT');
    expect(documentKindLabel('Revisión Técnica (PRT)', MARKETS.CO)).toBe('Tecnomecánica');
    expect(documentKindLabel('Permiso de Circulación', MARKETS.CO)).toBe('Tarjeta de propiedad');
  });

  it('un tipo que no esta en el mapa se muestra tal cual: nunca se inventa', () => {
    expect(documentKindLabel('Permiso de Circulación Especial', MARKETS.CL)).toBe(
      'Permiso de Circulación Especial',
    );
    expect(documentKindLabel('', MARKETS.CL)).toBe('—');
    expect(documentKindLabel(undefined, MARKETS.CL)).toBe('—');
  });

  it('el vocabulario legal de cada mercado es el suyo', () => {
    expect(MARKETS.CL.documentKinds[0]).toBe('SOAP');
    expect(MARKETS.CO.documentKinds[0]).toBe('SOAT');
    expect(MARKETS.CL.truckLicenseClass).toBe('A5');
    expect(MARKETS.CL.licenseClasses.map((c) => c.value)).toContain('A5');
    expect(MARKETS.CO.licenseClasses.map((c) => c.value)).toContain('C3');
  });

  it('los ejemplos de relleno no son de otro pais', () => {
    expect(MARKETS.CL.fuelStationPlaceholder).toBe('Copec Calama');
    expect(MARKETS.CL.cityPlaceholder).toContain('Antofagasta');
    expect(MARKETS.CL.vehicleIdPlaceholder).toBe('ABCD-12');
    expect(MARKETS.CO.cityPlaceholder).toContain('Bogotá');
  });
})
