export interface StockWarningItem {
  productId: string;
  productName: string;
  qty: number;
  /** Önceki aktif teslimatlar düşüldükten sonra kalan araç stoğu. */
  vehicleQty: number;
  /** Bu teslimatın kalan stoğu aşan miktarı. */
  oversellQty: number;
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

interface ActiveDeliveryLike {
  id: string;
  status?: 'active' | 'cancelled';
  cancelledAt?: string | null;
  deliveredItems?: DeliveredItemLike[];
}

export const STOCK_WARNING_DURATION_MS = 4000;

export function computeStockWarnings(
  deliveredItems: DeliveredItemLike[],
  loadedItems: LoadedItemLike[],
  activeDeliveries: ActiveDeliveryLike[] = [],
  excludeDeliveryId?: string
): StockWarningItem[] {
  const previouslyDelivered: Record<string, number> = {};
  for (const delivery of activeDeliveries) {
    if (excludeDeliveryId && delivery.id === excludeDeliveryId) continue;
    if (delivery.status === 'cancelled' || delivery.cancelledAt) continue;
    for (const item of delivery.deliveredItems || []) {
      previouslyDelivered[item.productId] =
        (previouslyDelivered[item.productId] || 0) + (Number(item.quantity) || 0);
    }
  }

  return deliveredItems
    .map((item) => {
      const loaded = loadedItems.find((loadedItem) => loadedItem.productId === item.productId);
      const loadedQty = Number(loaded?.quantity) || 0;
      const remainingQty = Math.max(
        0,
        loadedQty - (previouslyDelivered[item.productId] || 0)
      );
      if (item.quantity > remainingQty) {
        return {
          productId: item.productId,
          productName: item.productName,
          qty: item.quantity,
          vehicleQty: remainingQty,
          oversellQty: item.quantity - remainingQty,
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
