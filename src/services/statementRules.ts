// Müşteri cari hesap ekstresi hesaplama kuralları — AGENTS.md Bölüm 10.1.
//
// Tüm hesaplama burada, saf fonksiyonlarda yapılır; sunucu yalnızca veriyi
// toplar, arayüz yalnızca gösterir. Böylece "tek doğruluk kaynağı" korunur ve
// kural scripts/verify-statement.ts ile test edilebilir.
//
// Bakiye işareti: pozitif = müşteri bize borçlu, negatif = müşteri alacaklı.
// Bir teslimat iki hareket üretir: satış (borcu artırır) ve tahsilat (borcu
// azaltır). Ödenmemiş kısım bu ikisinin farkı olarak kendiliğinden görünür.

export interface StatementDeliveryInput {
  id: string;
  timestamp: string;
  deliveredGrandTotal: number;
  collectedPayment: {
    totalCollected: number;
    cashAmount: number;
    posAmount: number;
  };
  deliveredItems: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
}

export interface StatementAuditInput {
  id?: string | number;
  changedAt: string;
  changedByUserName: string;
  reason: string;
  previousBalance: number | null;
  newBalance: number | null;
}

export type StatementEntryType = 'sale' | 'payment' | 'adjustment';

export interface StatementEntry {
  id: string;
  timestamp: string;
  type: StatementEntryType;
  description: string;
  items: StatementDeliveryInput['deliveredItems'];
  /** Borcu artıran tutar (satış). */
  debit: number;
  /** Borcu azaltan tutar (tahsilat). */
  credit: number;
  /** Bakiyeye etkisi: +debit -credit. */
  balanceDelta: number;
  /** Bu hareketten sonraki bakiye. */
  balanceAfter: number;
  actor?: string;
}

export interface CustomerStatementResult {
  from: string;
  to: string;
  openingBalance: number;
  closingBalance: number;
  totalSales: number;
  totalPayments: number;
  totalAdjustments: number;
  entries: StatementEntry[];
}

const EPSILON = 0.005;

function money(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function dayOf(timestamp: string): string {
  // Tüm uygulamada iş günü UTC takvim günüdür (src/services/dateWindow.ts).
  return String(timestamp || '').slice(0, 10);
}

function isInRange(timestamp: string, from: string, to: string): boolean {
  const day = dayOf(timestamp);
  if (!day) return false;
  return day >= from && day <= to;
}

/**
 * Seçilen tarih aralığı için cari hesap ekstresi üretir.
 *
 * Açılış bakiyesi, güncel bakiyeden aralık başlangıcından sonraki tüm
 * hareketler çıkarılarak bulunur; böylece aralık öncesi geçmiş (ödeme yapılmış
 * eski satışlar dahil) doğru şekilde açılışa yansır.
 */
export function buildCustomerStatement(params: {
  currentBalance: number;
  deliveries: StatementDeliveryInput[];
  audits: StatementAuditInput[];
  from: string;
  to: string;
}): CustomerStatementResult {
  const { currentBalance, deliveries, audits, from, to } = params;

  const allEntries: StatementEntry[] = [];

  for (const delivery of deliveries) {
    const sale = Number(delivery.deliveredGrandTotal) || 0;
    if (sale !== 0) {
      const itemText = delivery.deliveredItems
        .map((i) => `${i.productName} - ${i.quantity}`)
        .join(', ');
      allEntries.push({
        id: `sale_${delivery.id}`,
        timestamp: delivery.timestamp,
        type: 'sale',
        description: itemText || 'Ürün satışı',
        items: delivery.deliveredItems,
        debit: money(sale),
        credit: 0,
        balanceDelta: money(sale),
        balanceAfter: 0,
      });
    }

    const collected = Number(delivery.collectedPayment?.totalCollected) || 0;
    if (collected !== 0) {
      const parts: string[] = [];
      if (Number(delivery.collectedPayment?.cashAmount) > 0) parts.push('Nakit');
      if (Number(delivery.collectedPayment?.posAmount) > 0) parts.push('POS');
      allEntries.push({
        id: `payment_${delivery.id}`,
        timestamp: delivery.timestamp,
        type: 'payment',
        description: `Tahsilat${parts.length ? ` (${parts.join(' + ')})` : ''}`,
        items: [],
        debit: 0,
        credit: money(collected),
        balanceDelta: money(-collected),
        balanceAfter: 0,
      });
    }
  }

  for (const audit of audits) {
    if (audit.previousBalance === null || audit.newBalance === null) continue;
    const delta = money(Number(audit.newBalance) - Number(audit.previousBalance));
    if (Math.abs(delta) < EPSILON) continue;
    // Teslimat dışı tahsilatlar da denetim tablosuna yazılır; ekstrede doğru
    // türde (tahsilat) görünmeleri için gerekçeden ayrıştırılır.
    const isStandalonePayment = /^tahsilat\b/i.test(audit.reason || '');
    allEntries.push({
      id: `adjustment_${audit.id ?? audit.changedAt}`,
      timestamp: audit.changedAt,
      type: isStandalonePayment ? 'payment' : 'adjustment',
      description: audit.reason || 'Yetkili bakiye düzeltmesi',
      items: [],
      debit: delta > 0 ? delta : 0,
      credit: delta < 0 ? -delta : 0,
      balanceDelta: delta,
      balanceAfter: 0,
      actor: audit.changedByUserName,
    });
  }

  allEntries.sort((a, b) => {
    const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (diff !== 0) return diff;
    // Aynı anda kaydedilen satış, tahsilattan önce gösterilir.
    return a.type === 'sale' ? -1 : b.type === 'sale' ? 1 : 0;
  });

  // Açılış: güncel bakiye, aralık başından sonraki tüm hareketler geri alınarak.
  const deltasAfterFrom = allEntries
    .filter((e) => dayOf(e.timestamp) >= from)
    .reduce((sum, e) => sum + e.balanceDelta, 0);
  const openingBalance = money(currentBalance - deltasAfterFrom);

  const entries: StatementEntry[] = [];
  let running = openingBalance;
  let totalSales = 0;
  let totalPayments = 0;
  let totalAdjustments = 0;

  for (const entry of allEntries) {
    if (!isInRange(entry.timestamp, from, to)) continue;
    running = money(running + entry.balanceDelta);
    entries.push({ ...entry, balanceAfter: running });
    if (entry.type === 'sale') totalSales += entry.debit;
    else if (entry.type === 'payment') totalPayments += entry.credit;
    else totalAdjustments += entry.balanceDelta;
  }

  return {
    from,
    to,
    openingBalance,
    closingBalance: money(running),
    totalSales: money(totalSales),
    totalPayments: money(totalPayments),
    totalAdjustments: money(totalAdjustments),
    entries,
  };
}
