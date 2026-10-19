// 60 günlük saklama (retention) karar kuralları — saf (yan etkisiz) fonksiyonlar.
//
// Bu modül, hangi seferlerin ve teslimatların temizleme kapsamına girdiğini
// belirleyen TEK uygulama kaynağıdır. Sunucu tarafındaki SQL fonksiyonu
// (public.purge_retention) aynı koşulları savunma amaçlı yeniden doğrular.
//
// Kurallar:
//   * Yalnızca TAMAMLANMIŞ, KAPATILMIŞ (closedAt dolu) ve eşikten eski sefer.
//   * Açık (pending_confirmation / in_transit) seferler ASLA silinmez.
//   * Bir sefer silinirse, o sefere ait TÜM teslimatlar (tarihinden bağımsız)
//     birlikte silinir; böylece cascade olmayan FK ihlali oluşmaz.
//   * Tamamlanmamış bir sefere ait teslimat ASLA silinmez.
//   * Sahipsiz (dispatchId boş) ve eşikten eski teslimatlar silinir.
//   * Müşteriler, kullanıcılar, ürünler, bakiyeler ve boş kap miktarları HİÇBİR
//     zaman bu kapsama girmez.

import { Dispatch, Delivery } from '../types/index.ts';

export interface RetentionSelection {
  dispatchIds: string[];
  deliveryIds: string[];
}

export function isDispatchPurgeEligible(dispatch: Dispatch, cutoffDate: string): boolean {
  return (
    dispatch?.status === 'completed' &&
    Boolean(dispatch.endOfDayReconciliation?.closedAt) &&
    typeof dispatch.date === 'string' &&
    dispatch.date < cutoffDate
  );
}

// Verilen sefer/teslimat kümelerinden silinecek kimlikleri seçer.
// `cutoffDate`: 'YYYY-MM-DD' (bu tarihe eşit olanlar korunur).
// `cutoffInstant`: `${cutoffDate}T00:00:00.000Z` (sahipsiz teslimatlar için).
export function selectRetentionIds(
  dispatches: Dispatch[],
  deliveries: Delivery[],
  cutoffDate: string,
  cutoffInstant: string
): RetentionSelection {
  const dispatchIds = dispatches
    .filter((d) => isDispatchPurgeEligible(d, cutoffDate))
    .map((d) => d.id);
  const eligibleDispatches = new Set(dispatchIds);
  const deliveryIds = deliveries
    .filter((del) => {
      if (!del) return false;
      if (del.dispatchId && eligibleDispatches.has(del.dispatchId)) return true;
      return (
        !del.dispatchId &&
        typeof del.timestamp === 'string' &&
        del.timestamp < cutoffInstant
      );
    })
    .map((del) => del.id);
  return { dispatchIds, deliveryIds };
}

// Bir bakiyeye (müşteri finansal borcu) veya boş kap miktarına erişmediğini
// kanıtlamak için temizliği yalnızca sefer/teslimat dizileri üzerinde uygular.
export interface LocalRetentionResult {
  dispatches: Dispatch[];
  deliveries: Delivery[];
  archivedDispatches: Dispatch[];
  archivedDeliveries: Delivery[];
}

export function applyRetentionToLocal(
  dispatches: Dispatch[],
  deliveries: Delivery[],
  cutoffDate: string,
  cutoffInstant: string
): LocalRetentionResult {
  const { dispatchIds, deliveryIds } = selectRetentionIds(
    dispatches,
    deliveries,
    cutoffDate,
    cutoffInstant
  );
  const dropDispatches = new Set(dispatchIds);
  const dropDeliveries = new Set(deliveryIds);
  return {
    dispatches: dispatches.filter((d) => !dropDispatches.has(d.id)),
    deliveries: deliveries.filter((d) => !dropDeliveries.has(d.id)),
    archivedDispatches: dispatches.filter((d) => dropDispatches.has(d.id)),
    archivedDeliveries: deliveries.filter((d) => dropDeliveries.has(d.id)),
  };
}
