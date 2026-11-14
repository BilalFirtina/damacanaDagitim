import type { Purchase } from '../src/types';
import fs from 'node:fs';
import path from 'node:path';
import {
  canManagePurchase,
  computePurchaseLineTotal,
  computePurchaseTotal,
  sortPurchasesNewestFirst,
} from '../src/services/purchaseRules';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}`, detail ?? '');
  }
}

function equals(name: string, actual: unknown, expected: unknown): void {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), {
    actual,
    expected,
  });
}

console.log('\n[satın alım kuralları doğrulaması]');

console.log('\n1) Satır toplamı ve opsiyonel fiyat');
equals('miktar × birim fiyat', computePurchaseLineTotal(5, 120), 600);
equals('ondalık fiyat', computePurchaseLineTotal(3, 12.5), 37.5);
equals('fiyat yoksa boş', computePurchaseLineTotal(5, null), null);
equals('fiyat tanımsızsa boş', computePurchaseLineTotal(5, undefined), null);
equals('geçersiz miktar', computePurchaseLineTotal(0, 100), null);

console.log('\n2) Toplam');
equals(
  'fiyatlı satırlar toplanır',
  computePurchaseTotal([
    { quantity: 5, unitPrice: 120 },
    { quantity: 5, unitPrice: 150 },
  ]),
  1350
);
equals(
  'fiyatsız satır toplamı etkilemez',
  computePurchaseTotal([
    { quantity: 5, unitPrice: 120 },
    { quantity: 4, unitPrice: null },
  ]),
  600
);
equals(
  'hiç fiyat yoksa toplam boş',
  computePurchaseTotal([
    { quantity: 5, unitPrice: null },
    { quantity: 4, unitPrice: null },
  ]),
  null
);

console.log('\n3) Sıralama');
const purchases: Purchase[] = [
  {
    id: 'pur_1',
    purchasedAt: '2026-11-14T09:00:00.000Z',
    supplierId: 'sup_1',
    supplierName: 'A',
    description: null,
    status: 'active',
    totalAmount: null,
    createdByUserId: 'usr_1',
    createdByUserName: 'Ali',
    dispatchId: null,
    dispatchPlate: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancelledByUserName: null,
    createdAt: '',
    updatedAt: '',
    items: [],
  },
  {
    id: 'pur_2',
    purchasedAt: '2026-11-14T11:00:00.000Z',
    supplierId: 'sup_1',
    supplierName: 'B',
    description: null,
    status: 'active',
    totalAmount: null,
    createdByUserId: 'usr_2',
    createdByUserName: 'Veli',
    dispatchId: null,
    dispatchPlate: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancelledByUserName: null,
    createdAt: '',
    updatedAt: '',
    items: [],
  },
];
equals(
  'en yeni en üstte',
  sortPurchasesNewestFirst(purchases).map((p) => p.id),
  ['pur_2', 'pur_1']
);

console.log('\n4) Düzeltme/iptal yetkisi');
check(
  'şoför kendi kaydını yönetir',
  canManagePurchase(purchases[0], { id: 'usr_1', role: 'driver' }) === true
);
check(
  'şoför başkasının kaydını yönetemez',
  canManagePurchase(purchases[0], { id: 'usr_2', role: 'driver' }) === false
);
check(
  'admin tüm kayıtları yönetir',
  canManagePurchase(purchases[0], { id: 'usr_2', role: 'admin' }) === true
);
check(
  'iptal edilen kayıt yönetilemez',
  canManagePurchase(
    { ...purchases[0], status: 'cancelled' },
    { id: 'usr_1', role: 'admin' }
  ) === false
);

console.log('\n5) Migration ve temizlik kuralları');
const schemaSql = fs.readFileSync(
  path.join(process.cwd(), 'migrations/20261114_purchases.sql'),
  'utf8'
);
const retentionSql = fs.readFileSync(
  path.join(process.cwd(), 'migrations/20261114_purchases_retention.sql'),
  'utf8'
);
check('suppliers tablosu var', /CREATE TABLE IF NOT EXISTS public\.suppliers/.test(schemaSql));
check('purchases tablosu var', /CREATE TABLE IF NOT EXISTS public\.purchases/.test(schemaSql));
check('purchase_items tablosu var', /CREATE TABLE IF NOT EXISTS public\.purchase_items/.test(schemaSql));
check('purchase_audit tablosu var', /CREATE TABLE IF NOT EXISTS public\.purchase_audit/.test(schemaSql));
check('create_purchase RPC var', /FUNCTION public\.create_purchase/.test(schemaSql));
check('update_purchase RPC var', /FUNCTION public\.update_purchase/.test(schemaSql));
check('cancel_purchase RPC var', /FUNCTION public\.cancel_purchase/.test(schemaSql));
check(
  '60 gün temizliği alımları siler',
  /DELETE FROM public\.purchases WHERE purchased_at < v_cutoff_ts/.test(retentionSql)
);
check(
  'temizlik alım kalemleri ve denetimini sayar',
  /'purchase_items', v_pitem/.test(retentionSql) &&
    /'purchase_audit', v_paudit/.test(retentionSql)
);
check(
  'toptancı tanımları temizlikte silinmez',
  !/DELETE FROM public\.suppliers/.test(retentionSql)
);

console.log(`\nSONUÇ: ${passed} geçti, ${failed} başarısız`);
if (failed > 0) process.exit(1);
