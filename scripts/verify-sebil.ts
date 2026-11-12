/**
 * AGENTS.md Bölüm 7 — Su sebili emanet takibi doğrulaması.
 *
 * Su sebili fiyatsız, iade edilebilir bir kalemdir; araçla taşınır ve
 * müşteride kalan adet olarak izlenir.
 *
 * Run:  npx tsx scripts/verify-sebil.ts
 */
import {
  computeDeliveredDeposits,
  computeEmptyContainersDiff,
} from '../src/services/depositRules.ts';
import {
  DeliveryInputError,
  normalizeDispenserGivenDetails,
} from '../src/server/deliveryInput.ts';
import { PRODUCT_CATEGORY_DEFAULTS } from '../src/types/index.ts';
import fs from 'node:fs';

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

const PRODUCTS = [
  { id: 'p_damacana', depositType: 'damacana' },
  { id: 'p_sebil', depositType: 'sebil' },
  { id: 'p_tup', depositType: 'tup' },
  { id: 'p_su', depositType: 'none' },
];

console.log('1) Sebil teslimi emanet bakiyesine yazılır');
{
  const result = computeDeliveredDeposits([{ productId: 'p_sebil', quantity: 2 }], PRODUCTS);
  check('2 sebil teslim edildi', result.sebil, 2);
  check('damacana etkilenmez', result.damacana, 0);
  check('tüp etkilenmez', result.tup, 0);
}

console.log('2) Sebil geri alımı bakiyeyi düşürür');
{
  const delivered = computeDeliveredDeposits([{ productId: 'p_sebil', quantity: 3 }], PRODUCTS);
  const diff = computeEmptyContainersDiff(delivered, { sebil: 1 });
  check('kalan sebil 2', diff.sebil, 2);
  check('damacana 0', diff.damacana, 0);
}

console.log('3) Fazla sebil iadesi negatif bakiye üretir (borcumuz)');
{
  const delivered = computeDeliveredDeposits([{ productId: 'p_sebil', quantity: 1 }], PRODUCTS);
  const diff = computeEmptyContainersDiff(delivered, { sebil: 3 });
  check('sebil -2', diff.sebil, -2);
}

console.log('4) Sebil diğer kalemlerle karışmaz');
{
  const delivered = computeDeliveredDeposits(
    [
      { productId: 'p_damacana', quantity: 5 },
      { productId: 'p_sebil', quantity: 2 },
      { productId: 'p_tup', quantity: 4 },
    ],
    PRODUCTS
  );
  check('damacana 5', delivered.damacana, 5);
  check('sebil 2', delivered.sebil, 2);
  check('tüp 4', delivered.tup, 4);

  const diff = computeEmptyContainersDiff(delivered, { damacana: 5, sebil: 2, tup: 4 });
  check('tüm bakiyeler kapandı', diff, {
    damacana: 0,
    camDamacana: 0,
    tup: 0,
    sebil: 0,
  });
}

console.log('5) Migration deposit_type kısıtı sebil değerini kabul eder');
{
  const sql = fs.readFileSync('migrations/20261103_sebil_returnable.sql', 'utf8');
  check(
    'products_deposit_type_check sebil içerir',
    /CHECK\s*\(deposit_type\s+IN\s*\([^)]*'sebil'[^)]*\)\)/i.test(sql),
    true
  );
}

console.log('6) Kategori varsayılanı sebil için fiyatsız emanet');
{
  check('sebil kategorisi emanet', PRODUCT_CATEGORY_DEFAULTS.sebil.isDeposit, true);
  check('sebil depositType', PRODUCT_CATEGORY_DEFAULTS.sebil.depositType, 'sebil');
  check('sebil birimi adet', PRODUCT_CATEGORY_DEFAULTS.sebil.unit, 'Adet');
}

console.log('7) Verilen sebil detayları doğrulanır');
{
  const details = normalizeDispenserGivenDetails(
    [
      { brand: 'Vestel', note: 'Mutfak', quantity: 1 },
      { brand: 'Aux', quantity: 1 },
    ],
    2
  );
  check('iki detay kabul edildi', details.length, 2);
  check(
    'toplam adet 2',
    details.reduce((sum, detail) => sum + detail.quantity, 0),
    2
  );

  const grouped = normalizeDispenserGivenDetails(
    [{ brand: 'Vestel', quantity: 2 }],
    2
  );
  check('gruplu adet korunur', grouped, [
    { brand: 'Vestel', model: '', quantity: 2, note: null },
  ]);

  check(
    'teslim edilenden fazla detay reddedilir',
    (() => {
      try {
        normalizeDispenserGivenDetails([{ brand: 'Vestel', quantity: 2 }], 1);
        return 'hata yok';
      } catch (e) {
        return e instanceof DeliveryInputError
          ? e.code || 'DELIVERY_INPUT_ERROR'
          : 'yanlis hata';
      }
    })(),
    'DISPENSER_DETAIL_COUNT_MISMATCH'
  );

  check(
    'geçersiz adet reddedilir',
    (() => {
      try {
        normalizeDispenserGivenDetails([{ brand: 'Vestel', quantity: 0 }], 1);
        return 'hata yok';
      } catch (e) {
        return e instanceof DeliveryInputError ? 'DeliveryInputError' : 'yanlis hata';
      }
    })(),
    'DeliveryInputError'
  );

  check(
    'boş detay listesi kabul edilir',
    normalizeDispenserGivenDetails(undefined, 1),
    []
  );

  check(
    'dizi olmayan detay reddedilir',
    (() => {
      try {
        normalizeDispenserGivenDetails({ brand: 'Vestel' }, 1);
        return 'hata yok';
      } catch (e) {
        return e instanceof DeliveryInputError ? 'DeliveryInputError' : 'yanlis hata';
      }
    })(),
    'DeliveryInputError'
  );
}

console.log(`\nSonuç: ${passed} başarılı, ${failed} başarısız`);
if (failed > 0) process.exit(1);
