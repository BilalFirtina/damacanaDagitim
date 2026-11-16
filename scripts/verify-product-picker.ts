import assert from 'node:assert/strict';
import { filterPickerProducts } from '../src/services/productPickerRules.ts';

const products = [
  { id: 'd1', name: 'Hayat Damacana', category: 'damacana' },
  { id: 'd2', name: 'Sırma Damacana', category: 'damacana' },
  { id: 'd3', name: 'Hayat Cam Damacana', category: 'damacana' },
  { id: 'p1', name: "Hayat 1.5 lt Pet Su (6'lı Paket)", category: 'pet' },
  { id: 't1', name: 'Büyük Tüp (12 Kg)', category: 'tup' },
  { id: 't2', name: 'Küçük Tüp (2 Kg)', category: 'tup' },
  { id: 'c1', name: 'Karton Bardak 6.5 oz', category: 'bardak' },
];

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected);
  passed++;
  console.log(`ok - ${name}`);
}

check(
  'filtresiz tüm ürünler',
  filterPickerProducts(products, '', null).map((p) => p.id),
  products.map((p) => p.id)
);
check(
  'Türkçe karakter sadeleştirme: sirma',
  filterPickerProducts(products, 'sirma', null).map((p) => p.id),
  ['d2']
);
check(
  'Türkçe karakter sadeleştirme: cam',
  filterPickerProducts(products, 'CAM', null).map((p) => p.id),
  ['d3']
);
check(
  'kategori koduyla arama',
  filterPickerProducts(products, 'tup', null).map((p) => p.id),
  ['t1', 't2']
);
check(
  'kategori filtresi',
  filterPickerProducts(products, '', 'damacana').map((p) => p.id),
  ['d1', 'd2', 'd3']
);
check(
  'kategori + arama birlikte',
  filterPickerProducts(products, 'sirma', 'damacana').map((p) => p.id),
  ['d2']
);
check(
  'kategori dışındaki arama boş döner',
  filterPickerProducts(products, 'bardak', 'tup'),
  []
);
check(
  'boşluklu arama',
  filterPickerProducts(products, '  büyük  ', null).map((p) => p.id),
  ['t1']
);

console.log(`\nverify-product-picker: ${passed} checks passed`);
