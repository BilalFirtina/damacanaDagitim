import type { Dispatch, Product } from '../types';
import { sortItemsByProductCategory } from '../types';

export interface RecentEndOfDayProduct {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
}

export interface RecentEndOfDayEmpty {
  label: string;
  quantity: number;
}

export interface RecentEndOfDayReport {
  dispatchId: string;
  date: string;
  driverName: string;
  vehiclePlate: string;
  closedAt: string | null;
  closedByUserName: string | null;
  hasReconciliation: boolean;
  products: RecentEndOfDayProduct[];
  empties: RecentEndOfDayEmpty[];
  cash: number;
  pos: number;
  total: number;
}

/** UTC takvim gününü gün ekleyerek kaydırır (YYYY-MM-DD). */
export function shiftUtcDate(dateStr: string, days: number): string {
  const base = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

/**
 * Gün sonu sekmesinin altında gösterilecek son 2 günün kapanmış
 * seferlerini üretir. Bugün hariçtir; en yeni tarih ve en son kapanan
 * sefer en üstte olacak şekilde sıralanır.
 */
export function buildRecentEndOfDayReports(params: {
  dispatches: Dispatch[];
  products: Product[];
  today: string;
}): RecentEndOfDayReport[] {
  const { dispatches, products, today } = params;
  const targetDates = new Set([shiftUtcDate(today, -1), shiftUtcDate(today, -2)]);
  const productById = new Map(products.map((product) => [product.id, product]));

  const reports = dispatches
    .filter(
      (dispatch) =>
        dispatch.status === 'completed' &&
        targetDates.has(dispatch.date)
    )
    .map((dispatch): RecentEndOfDayReport => {
      const recon = dispatch.endOfDayReconciliation;
      const closedAt = recon?.closedAt || null;
      if (!recon) {
        return {
          dispatchId: dispatch.id,
          date: dispatch.date,
          driverName: dispatch.driverName,
          vehiclePlate: dispatch.vehiclePlate,
          closedAt,
          closedByUserName: null,
          hasReconciliation: false,
          products: [],
          empties: [],
          cash: 0,
          pos: 0,
          total: 0,
        };
      }

      const counted =
        Object.keys(recon.remainingFullCounted || {}).length > 0
          ? recon.remainingFullCounted
          : recon.remainingFullExpected || {};

      const productsToReturn: RecentEndOfDayProduct[] = [];
      const sortedLoaded = sortItemsByProductCategory(
        dispatch.loadedItems || [],
        products
      );
      for (const loaded of sortedLoaded) {
        const quantity = Number(counted[loaded.productId]) || 0;
        if (quantity <= 0) continue;
        const product = productById.get(loaded.productId);
        productsToReturn.push({
          productId: loaded.productId,
          name: product?.name || loaded.productId,
          unit: product?.unit || 'Adet',
          quantity,
        });
      }

      const emptyCandidates: Array<[string, number]> = [
        ['Boş Damacana', Number(recon.collectedEmptyDamacana) || 0],
        ['Boş Cam Damacana', Number(recon.collectedEmptyCamDamacana) || 0],
        ['Boş Büyük Tüp', Number(recon.collectedEmptyTupBuyuk) || 0],
        ['Boş Küçük Tüp', Number(recon.collectedEmptyTupKucuk) || 0],
        ['Su Sebili', Number(recon.collectedEmptySebil) || 0],
      ];
      const empties = emptyCandidates
        .filter(([, quantity]) => quantity > 0)
        .map(([label, quantity]) => ({ label, quantity }));

      const cash = Number(recon.actualCashInPocket) || 0;
      const pos = Number(recon.actualPosSlipsTotal) || 0;

      return {
        dispatchId: dispatch.id,
        date: dispatch.date,
        driverName: dispatch.driverName,
        vehiclePlate: dispatch.vehiclePlate,
        closedAt,
        closedByUserName: recon.closedByUserName || null,
        hasReconciliation: true,
        products: productsToReturn,
        empties,
        cash,
        pos,
        total: cash + pos,
      };
    });

  return reports.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    const aTime = a.closedAt ? Date.parse(a.closedAt) : 0;
    const bTime = b.closedAt ? Date.parse(b.closedAt) : 0;
    return bTime - aTime;
  });
}
