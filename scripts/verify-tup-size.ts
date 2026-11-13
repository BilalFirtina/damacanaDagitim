/**
 * Büyük/küçük tüp depozito ayrımı doğrulaması.
 *
 * Run:  npx tsx scripts/verify-tup-size.ts
 */
import {
  computeDeliveredDeposits,
  computeEmptyContainersDiff,
  totalTupEmpty,
} from '../src/services/depositRules.ts';
import type { Product } from '../src/types/index.ts';

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}\n        beklenen ${e}\n        gelen    ${a}`);
  }
}

const products = [
  { id: 'big', name: 'Büyük Tüp', depositType: 'tup_buyuk' },
  { id: 'small', name: 'Küçük Tüp', depositType: 'tup_kucuk' },
  { id: 'dam', name: 'Damacana', depositType: 'damacana' },
] as unknown as Product[];

console.log('\n[1) Verilen dolu tüp boyutları ayrı sayılır]');
const delivered = computeDeliveredDeposits(
  [
    { productId: 'big', quantity: 2 },
    { productId: 'small', quantity: 3 },
    { productId: 'dam', quantity: 4 },
  ],
  products
);
check('büyük tüp', delivered.tupBuyuk, 2);
check('küçük tüp', delivered.tupKucuk, 3);
check('damacana etkilenmez', delivered.damacana, 4);

console.log('\n[2) Boş tüp iadeleri boyuta göre ayrılır]');
const diff = computeEmptyContainersDiff(delivered, {
  tupBuyuk: 1,
  tupKucuk: 1,
});
check('büyük tüp kalan', diff.tupBuyuk, 1);
check('küçük tüp kalan', diff.tupKucuk, 2);
check('damacana kovası karışmaz', diff.damacana, 4);

console.log('\n[3) Boyutlar birbirini götürmez]');
const cross = computeEmptyContainersDiff(
  { damacana: 0, camDamacana: 0, sebil: 0, tupBuyuk: 2, tupKucuk: 0 },
  { tupKucuk: 3 }
);
check('büyük tüp 2 kalır', cross.tupBuyuk, 2);
check('küçük tüp -3 olur', cross.tupKucuk, -3);

console.log('\n[4) Toplu boş tüp sayısı]');
check(
  'büyük + küçük',
  totalTupEmpty({ tupBuyuk: 2, tupKucuk: 3 }),
  5
);
check('sadece büyük', totalTupEmpty({ tupBuyuk: 4 }), 4);
check('boş kayıt', totalTupEmpty({}), 0);

console.log(`\nSONUC: ${passed} basarili, ${failed} basarisiz`);
if (failed > 0) process.exit(1);
