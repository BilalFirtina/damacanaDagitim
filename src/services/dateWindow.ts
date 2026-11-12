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

// Tarih inputlarında gelecek tarih seçimini engeller. `max` attribute'u
// tarayıcıya bağlı olduğu için (özellikle iOS/PWA) state'e yazmadan önce
// bu kontrol uygulanır. Boş değer olduğu gibi bırakılır.
export function clampDateToToday(
  value: string,
  today: string = todayUtcDateStr()
): string {
  if (!value) return value;
  return value > today ? today : value;
}

// YYYY-MM-DD tarihini Türkçe gg.aa.yyyy biçiminde gösterir. Geçersiz veya boş
// değer uydurulmaz; olduğu gibi döndürülür.
export function formatDateTr(dateStr: string): string {
  const [year, month, day] = String(dateStr || '').split('-');
  if (!year || !month || !day) return dateStr;
  return `${day}.${month}.${year}`;
}

// ISO zaman damgasını Türkçe gg.aa.yyyy ss:dd biçiminde gösterir.
// Geçersiz değer uydurulmaz; olduğu gibi döndürülür.
export function formatDateTimeTr(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Türkiye sabit UTC+3'tür (2016'dan beri yaz saati uygulaması yok).
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;

// Bir sonraki 23:00 Türkiye saatini UTC zaman damgası olarak döndürür.
// Sunucu hangi saat diliminde çalışırsa çalışsın sonuç aynıdır.
export function getNext2300Time(now: Date = new Date()): {
  nextDate: Date;
  msUntil: number;
  formatted: string;
} {
  const trNowMs = now.getTime() + TR_OFFSET_MS;
  const trNow = new Date(trNowMs);

  // Türkiye duvar saatiyle bugünün 23:00'ı (UTC alanlarına yazılmış gibi).
  let targetTrMs = Date.UTC(
    trNow.getUTCFullYear(),
    trNow.getUTCMonth(),
    trNow.getUTCDate(),
    23,
    0,
    0,
    0
  );
  if (trNowMs >= targetTrMs) targetTrMs += 24 * 60 * 60 * 1000;

  const targetUtcMs = targetTrMs - TR_OFFSET_MS;
  const target = new Date(targetUtcMs);
  const msUntil = targetUtcMs - now.getTime();

  const totalMinutes = Math.max(0, Math.round(msUntil / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const trDateStr = new Date(targetTrMs).toISOString().slice(0, 10);
  const formatted = `${trDateStr} 23:00 (Türkiye saati) (${hours} saat ${minutes} dk sonra)`;

  return { nextDate: target, msUntil, formatted };
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
