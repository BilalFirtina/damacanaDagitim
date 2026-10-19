// "Gün" tanımı ve tarih sınırı yardımcıları.
//
// Sistemde bir iş günü, UTC takvim günüdür (YYYY-MM-DD). İstemci, sunucu ve
// veritabanı sorguları bu tek tanımı kullanır; böylece sefer tarihi, teslimat
// gün filtresi ve raporlar arasında gün sınırı kayması oluşmaz.

// Operasyonel veri saklama süresi (gün). TEK kaynak: saklama temizliği ve
// durum raporları bu sabiti kullanır. Değiştirilecekse yalnızca burası.
export const RETENTION_DAYS = 60;

export function todayUtcDateStr(now: Date = new Date()): string {
  return now.toISOString().split('T')[0];
}

// Saklama eşiği: bu tarihten (dahil değil) önceki günler temizlenebilir.
export function retentionCutoffDate(now: Date = new Date()): string {
  return new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];
}

// Saklama eşiğinin UTC gece yarısı anı (ISO). timestamp karşılaştırmalarında
// saat dilimi kaymasını önlemek için kullanılır.
export function retentionCutoffInstant(now: Date = new Date()): string {
  return `${retentionCutoffDate(now)}T00:00:00.000Z`;
}


// Verilen bir UTC günü için sunucu tarafı sorgu penceresi. Yerel saat dilimi
// farkları (en fazla ±14 saat) göz önünde bulundurularak bir gün geriye, iki
// gün ileriye genişletilir. Kesin gün eşleşmesi çağıran tarafta doğrulanır;
// bu pencere yalnızca tüm geçmişin çekilmesini engeller.
export function utcDayQueryWindow(dateStr: string): { lower: string; upper: string } | null {
  const dayStart = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  if (Number.isNaN(dayStart)) return null;
  const DAY_MS = 24 * 60 * 60 * 1000;
  return {
    lower: new Date(dayStart - DAY_MS).toISOString(),
    upper: new Date(dayStart + 2 * DAY_MS).toISOString(),
  };
}

// Bir zaman damgasının verilen UTC gününe ait olup olmadığını gösterir.
export function isSameUtcDate(timestamp: string, dateStr: string): boolean {
  return typeof timestamp === 'string' && timestamp.startsWith(dateStr);
}
