export function isLowStock(quantity: number, minStock: number): boolean {
  if (minStock <= 0) return false;
  return quantity <= minStock;
}

export function filterRows<T extends { name: string; sku?: string }>(rows: T[], search: string): T[] {
  if (!search) return rows;
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(r =>
    r.name.toLowerCase().includes(q) ||
    (r.sku && r.sku.toLowerCase().includes(q))
  );
}

export function ageInDays(exportedAt: string, now: Date = new Date()): number {
  const d = new Date(exportedAt);
  if (isNaN(d.getTime())) return 0;
  const diffMs = now.getTime() - d.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
