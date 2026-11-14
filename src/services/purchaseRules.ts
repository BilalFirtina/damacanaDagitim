import type { Purchase, PurchaseInputItem } from '../types';

export function roundPurchaseMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function computePurchaseLineTotal(
  quantity: number,
  unitPrice: number | null | undefined
): number | null {
  if (unitPrice === null || unitPrice === undefined || !Number.isFinite(unitPrice)) {
    return null;
  }
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return roundPurchaseMoney(qty * unitPrice);
}

export function computePurchaseTotal(
  items: Array<{ quantity: number; unitPrice?: number | null }>
): number | null {
  let total = 0;
  let hasPrice = false;
  for (const item of items) {
    const line = computePurchaseLineTotal(item.quantity, item.unitPrice);
    if (line === null) continue;
    hasPrice = true;
    total += line;
  }
  return hasPrice ? roundPurchaseMoney(total) : null;
}

export function sortPurchasesNewestFirst(purchases: Purchase[]): Purchase[] {
  return [...purchases].sort(
    (a, b) =>
      b.purchasedAt.localeCompare(a.purchasedAt) || b.id.localeCompare(a.id)
  );
}

export function canManagePurchase(
  purchase: Purchase,
  user: { id: string; role: string }
): boolean {
  if (purchase.status !== 'active') return false;
  return user.role === 'admin' || purchase.createdByUserId === user.id;
}

export function normalizePurchaseInputItems(
  items: Array<{ productId: string; quantity: number; unitPrice?: number | null }>
): PurchaseInputItem[] {
  return items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    unitPrice:
      item.unitPrice === null || item.unitPrice === undefined
        ? null
        : roundPurchaseMoney(item.unitPrice),
  }));
}
