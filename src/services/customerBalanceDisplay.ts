// Müşteri cari bakiyesi gösterimi.
//
// Pozitif bakiye müşterinin bize borcunu, negatif bakiye müşterinin
// alacağını ifade eder. Hesaplama yapılmaz; yalnızca işaretli tutar
// kullanıcıya dönük metne çevrilir. Raporlar bu yardımcıyı kullanır.

export type MoneyFormatter = (value: number) => string;

export function formatCustomerBalance(
  balance: number,
  formatMoney: MoneyFormatter
): string {
  const value = Number(balance) || 0;
  if (value < 0) return `${formatMoney(Math.abs(value))} Alacaklı`;
  return formatMoney(value);
}

// Tutarı işaretsiz gösterir; "Borçlu / Alacaklı" durumu ayrı etiketlenir.
export function formatCustomerBalanceAmount(
  balance: number,
  formatMoney: MoneyFormatter
): string {
  return formatMoney(Math.abs(Number(balance) || 0));
}

export function customerBalanceStatus(
  balance: number
): 'Borçlu' | 'Alacaklı' | '-' {
  const value = Number(balance) || 0;
  if (value > 0) return 'Borçlu';
  if (value < 0) return 'Alacaklı';
  return '-';
}
