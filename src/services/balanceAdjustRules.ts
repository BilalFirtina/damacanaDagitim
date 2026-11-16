/**
 * Yönetici cari bakiye düzeltmesi için güvenli sayı ayrıştırma.
 *
 * Türk kullanıcılar hem "1.250,50" hem "1250.50" yazabilir. Negatif değer
 * müşteri avansı anlamına gelir; bu nedenle korunur.
 */
export function parseBalanceInput(raw: string): number | null {
  let value = String(raw ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/₺/g, '');

  if (!value) return null;

  if (value.includes(',')) {
    // "1.250,50" -> "1250.50"
    value = value.replace(/\./g, '').replace(',', '.');
  } else {
    const parts = value.split('.');
    if (parts.length > 2) {
      // "1.250.000" -> "1250000"
      value = parts.join('');
    } else if (parts.length === 2 && parts[1].length === 3) {
      // Türkçe binlik ayırıcı: "1.250" -> "1250"
      value = parts.join('');
    }
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}
