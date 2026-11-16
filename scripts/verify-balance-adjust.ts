import assert from 'node:assert/strict';
import { parseBalanceInput } from '../src/services/balanceAdjustRules.ts';

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected);
  passed++;
  console.log(`ok - ${name}`);
}

check('tam sayı', parseBalanceInput('1250'), 1250);
check('Türkçe ondalık', parseBalanceInput('1250,50'), 1250.5);
check('Türkçe binlik + ondalık', parseBalanceInput('1.250,50'), 1250.5);
check('nokta ondalık', parseBalanceInput('1250.50'), 1250.5);
check('Türkçe binlik', parseBalanceInput('1.250'), 1250);
check('milyon binlik', parseBalanceInput('1.250.000'), 1250000);
check('negatif avans', parseBalanceInput('-250,75'), -250.75);
check('negatif binlik avans', parseBalanceInput('-1.250'), -1250);
check('sıfır', parseBalanceInput('0,00'), 0);
check('TL işareti ve boşluk', parseBalanceInput(' 1.250,50 ₺ '), 1250.5);
check('boş değer', parseBalanceInput(''), null);
check('geçersiz metin', parseBalanceInput('abc'), null);
check('yalnızca nokta', parseBalanceInput('.'), null);
check('sonsuz değer', parseBalanceInput('Infinity'), null);

console.log(`\nverify-balance-adjust: ${passed} checks passed`);
