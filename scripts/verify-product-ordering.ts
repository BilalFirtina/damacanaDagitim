/**
 * Ürün kategori sırası, gruplama ve arama doğrulaması.
 *
 * Run: npx tsx scripts/verify-product-ordering.ts
 */
import {
  getProductCategoryOrder,
  getProductCategoryTitle,
  filterProductsBySearch,
  groupProductsByCategory,
  sortProductsByCategory,
} from '../src/types/index.ts';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: any) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}`, detail ?? '');
  }
}

const products = [
  { id: 'p1', name: 'Su Sebili', category: 'sebil' },
  { id: 'p2', name: 'Küçük Tüp', category: 'tup' },
  { id: 'p3', name: 'Limonlu Soda', category: 'soda' },
  { id: 'p4', name: 'Karton Bardak', category: 'bardak' },
  { id: 'p5', name: 'Hayat Damacana', category: 'damacana' },
  { id: 'p6', name: 'Beypazarı Maden Suyu', category: 'soda' },
  { id: 'p7', name: 'Pet Su 0.5', category: 'pet' },
  { id: 'p8', name: 'Cam Damacana', category: 'damacana' },
  { id: 'p9', name: 'Büyük Tüp', category: 'tup' },
];

console.log('\n[1) Kategori sırası]');
const expectedOrder = ['damacana', 'pet', 'soda', 'tup', 'bardak', 'sebil'];
for (let i = 0; i < expectedOrder.length; i++) {
  const code = expectedOrder[i];
  check(
    `${code} sırası ${i + 1}`,
    getProductCategoryOrder(code) === i + 1,
    getProductCategoryOrder(code)
  );
}
check('kategori başlığı Maden Suyu / İçecek', getProductCategoryTitle('soda') === 'Maden Suyu / İçecek');
check('kategori başlığı Tüp', getProductCategoryTitle('tup') === 'Tüp');
check('kategori başlığı Su Sebili', getProductCategoryTitle('sebil') === 'Su Sebili');

console.log('\n[2) Ürün sıralaması]');
const sorted = sortProductsByCategory(products);
const sortedCodes = sorted.map((p) => p.category);
const expectedSorted = [
  'damacana',
  'damacana',
  'pet',
  'soda',
  'soda',
  'tup',
  'tup',
  'bardak',
  'sebil',
];
check('kategori sırası doğru', JSON.stringify(sortedCodes) === JSON.stringify(expectedSorted), sortedCodes);
check(
  'damacana içinde Türkçe ad sırası',
  sorted.filter((p) => p.category === 'damacana').map((p) => p.name).join('|') ===
    'Cam Damacana|Hayat Damacana'
);
check(
  'soda içinde Türkçe ad sırası',
  sorted.filter((p) => p.category === 'soda').map((p) => p.name).join('|') ===
    'Beypazarı Maden Suyu|Limonlu Soda'
);

console.log('\n[3) Kategori grupları]');
const groups = groupProductsByCategory(products);
check('grup sayısı 6', groups.length === 6, groups.length);
check(
  'grup sırası',
  groups.map((g) => g.code).join(',') === expectedOrder.join(','),
  groups.map((g) => g.code)
);
check(
  'her grupta ürünler var',
  groups.every((g) => g.products.length > 0)
);
check(
  'boş kategori üretilmez',
  groupProductsByCategory(products.filter((p) => p.category !== 'sebil')).every(
    (g) => g.code !== 'sebil'
  )
);

console.log('\n[4) Arama]');
check(
  'tüp araması iki tüpü getirir',
  filterProductsBySearch(products, 'tüp').length === 2
);
check(
  'İÇECEK araması soda ürünlerini getirir',
  filterProductsBySearch(products, 'İÇECEK').length === 2
);
check(
  'maden suyu araması soda ürünlerini getirir',
  filterProductsBySearch(products, 'maden suyu').length === 2
);
check(
  'damacana araması damacanaları getirir',
  filterProductsBySearch(products, 'damacana').length === 2
);
check('boş arama tüm ürünleri getirir', filterProductsBySearch(products, '').length === products.length);
check('olmayan ürün araması boş döner', filterProductsBySearch(products, 'xyz').length === 0);
check(
  'Türkçe büyük/küçük harf uyumu',
  filterProductsBySearch(products, 'KÜÇÜK TÜP').length === 1
);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
