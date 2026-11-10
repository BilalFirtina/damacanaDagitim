import {
  customerBalanceStatus,
  formatCustomerBalance,
  formatCustomerBalanceAmount,
} from '../src/services/customerBalanceDisplay';

let passed = 0;
let failed = 0;

function equals(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}\n        beklenen ${expected}\n        gelen    ${actual}`);
  }
}

const money = (value: number) => `${value} ₺`;

console.log('\n[customer balance display verification]');

console.log('\n1) Bakiye metni');
equals('negatif bakiye alacakli yazilir', formatCustomerBalance(-30, money), '30 ₺ Alacaklı');
equals('pozitif bakiye borc tutari olarak kalir', formatCustomerBalance(30, money), '30 ₺');
equals('sifir bakiye sifir yazilir', formatCustomerBalance(0, money), '0 ₺');
equals('negatif ondalik bakiye alacakli yazilir', formatCustomerBalance(-30.5, money), '30.5 ₺ Alacaklı');

console.log('\n2) Durum etiketi');
equals('negatif bakiye durumu', customerBalanceStatus(-30), 'Alacaklı');
equals('pozitif bakiye durumu', customerBalanceStatus(30), 'Borçlu');
equals('sifir bakiye durumu', customerBalanceStatus(0), '-');

console.log('\n3) Isaretsiz tutar');
equals('negatif tutar isaretsiz gosterilir', formatCustomerBalanceAmount(-30, money), '30 ₺');
equals('pozitif tutar korunur', formatCustomerBalanceAmount(30, money), '30 ₺');

console.log(`\nSONUC: ${passed} basarili, ${failed} basarisiz`);
if (failed > 0) process.exit(1);
