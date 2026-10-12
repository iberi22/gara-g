/**
 * csvExport.ts — Generador de CSV compatible con RFC4180 y Excel (UTF-8 BOM).
 */

export interface CSVColumn<T = Record<string, unknown>> {
  key: keyof T | string;
  label: string;
}

export interface CSVOptions {
  /** Delimitador de columnas (';' por defecto para compatibilidad Excel en es-CO / Latinoamérica, or ',') */
  delimiter?: ',' | ';';
  /** Incluir UTF-8 BOM (\uFEFF) para visualización de tildes y caracteres especiales en Excel */
  includeBOM?: boolean;
}

/**
 * Escapa una celda de texto según especificación RFC4180.
 * Si contiene comillas, saltos de línea o el delimitador, se encierra entre comillas
 * y cualquier comilla doble interior se duplica ("" -> ").
 */
export function escapeCSVCell(value: unknown, delimiter: ',' | ';' = ';'): string {
  if (value === null || value === undefined) {
    return '';
  }

  let str: string;
  if (typeof value === 'object') {
    if (value instanceof Date) {
      str = value.toISOString();
    } else {
      str = JSON.stringify(value);
    }
  } else {
    str = String(value);
  }

  const needsQuotes =
    str.includes(delimiter) ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r');

  if (needsQuotes) {
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return str;
}

/**
 * Convierte un arreglo de filas y definición de columnas a string CSV RFC4180.
 */
export function toCSV<T extends Record<string, unknown> = Record<string, unknown>>(
  rows: T[],
  columns: CSVColumn<T>[],
  options: CSVOptions = {}
): string {
  const delimiter = options.delimiter ?? ';';
  const includeBOM = options.includeBOM ?? true;

  const headerRow = columns
    .map((col) => escapeCSVCell(col.label, delimiter))
    .join(delimiter);

  const dataRows = rows.map((row) =>
    columns
      .map((col) => {
        const val = (row as Record<string, unknown>)[col.key as string];
        return escapeCSVCell(val, delimiter);
      })
      .join(delimiter)
  );

  const csvBody = [headerRow, ...dataRows].join('\r\n');

  return includeBOM ? `\uFEFF${csvBody}` : csvBody;
}

/**
 * Genera un Blob y fuerza la descarga del archivo CSV en el navegador del cliente.
 */
export function downloadCSV(filename: string, csvContent: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const cleanFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', cleanFilename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
