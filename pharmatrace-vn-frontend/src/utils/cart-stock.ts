export interface StockCheckItem {
  id: string;
  medicineName: string;
  unitName: string;
  quantity: number;
  /** Units that can still be supplied, as reported by the server; unknown for items not yet synced. */
  availableStock?: number | null;
}

export interface StockIssue {
  id: string;
  medicineName: string;
  unitName: string;
  quantity: number;
  available: number;
  message: string;
}

/**
 * Cart lines asking for more than can be supplied. Items whose availability is not known are never reported:
 * the final check still happens when the order is placed.
 */
export function findStockIssues(items: StockCheckItem[]): StockIssue[] {
  const issues: StockIssue[] = [];
  for (const item of items) {
    if (typeof item.availableStock !== 'number' || item.quantity <= item.availableStock) continue;
    const label = `${item.medicineName} (${item.unitName})`;
    issues.push({
      id: item.id,
      medicineName: item.medicineName,
      unitName: item.unitName,
      quantity: item.quantity,
      available: item.availableStock,
      message: item.availableStock <= 0
        ? `${label} is out of stock. Remove it to continue.`
        : `Only ${item.availableStock} of ${label} available; you have ${item.quantity}. Reduce the quantity to continue.`,
    });
  }
  return issues;
}

/** Clamps a requested quantity to the available stock when that is known and positive. */
export function capToAvailable(requested: number, availableStock?: number | null): number {
  if (typeof availableStock !== 'number' || availableStock <= 0) return requested;
  return Math.min(requested, availableStock);
}
