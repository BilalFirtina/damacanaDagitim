export interface StockWarningItem {
  productId: string;
  productName: string;
  qty: number;
  vehicleQty: number;
}

interface DeliveredItemLike {
  productId: string;
  productName: string;
  quantity: number;
}

interface LoadedItemLike {
  productId: string;
  quantity: number;
}

export const STOCK_WARNING_DURATION_MS = 4000;

export function computeStockWarnings(
  deliveredItems: DeliveredItemLike[],
  loadedItems: LoadedItemLike[]
): StockWarningItem[] {
  return deliveredItems
    .map((item) => {
      const loaded = loadedItems.find((loadedItem) => loadedItem.productId === item.productId);
      const vehicleQty = loaded ? loaded.quantity : 0;
      if (item.quantity > vehicleQty) {
        return {
          productId: item.productId,
          productName: item.productName,
          qty: item.quantity,
          vehicleQty,
        };
      }
      return null;
    })
    .filter((warning): warning is StockWarningItem => warning !== null);
}

export function getStockWarningSignature(warnings: StockWarningItem[]): string {
  return warnings
    .map((warning) => `${warning.productId}:${warning.qty}:${warning.vehicleQty}`)
    .sort()
    .join('|');
}

export interface StockWarningVisibilityInput {
  warnings: StockWarningItem[];
  dismissedSignature: string | null;
  expiresAt: number | null;
  now: number;
}

export function shouldShowStockWarning({
  warnings,
  dismissedSignature,
  expiresAt,
  now,
}: StockWarningVisibilityInput): boolean {
  if (warnings.length === 0) return false;

  const signature = getStockWarningSignature(warnings);
  if (dismissedSignature === signature) return false;
  if (expiresAt === null) return true;

  return now < expiresAt;
}
