/**
 * Sefer bazında "Depoya İade" hesaplama testi.
 *
 * - Yüklenen − teslim edilen kalan ürünler
 * - Toplanan boş damacana/cam/tüp ve alınan sebil
 * - Sıfırların gizlenmesi
 * - Aynı şoförün iki ayrı plakası için iki ayrı blok
 *
 * Run: npx tsx scripts/verify-report-returns.ts
 */
import { buildConsolidatedReport } from '../src/services/consolidatedReportRules.ts';
import type { Customer, Delivery, Product } from '../src/types/index.ts';

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
  { id: 'p-dam', name: 'Hayat Damacana', unit: 'Adet', depositType: 'damacana', isDeposit: true },
  { id: 'p-cam', name: 'Hayat Cam Damacana', unit: 'Adet', depositType: 'cam_damacana', isDeposit: true },
  { id: 'p-tup', name: 'Büyük Tüp (12 Kg)', unit: 'Adet', depositType: 'tup_buyuk', isDeposit: true },
  { id: 'p-sebil', name: 'Su Sebili', unit: 'Adet', depositType: 'sebil', isDeposit: true },
  { id: 'p-pet', name: "Hayat 1.5 lt Pet Su (6'lı Koli)", unit: 'Koli', depositType: 'none', isDeposit: false },
] as unknown as Product[];

const customers = [
  { id: 'c1', name: 'Test Müşteri', address: '', isAccountCustomer: false, currentBalanceTL: 0 },
] as unknown as Customer[];

const delivery = (
  id: string,
  dispatchId: string,
  driverId: string,
  plate: string,
  items: Array<{ productId: string; name: string; qty: number; price: number }>,
  empties: { damacana?: number; cam?: number; tup?: number; sebil?: number }
): Delivery => {
  const deliveredItems = items.map((item) => ({
    productId: item.productId,
    productName: item.name,
    quantity: item.qty,
    unitPrice: item.price,
    lineTotal: item.qty * item.price,
  }));
  const total = deliveredItems.reduce((sum, item) => sum + item.lineTotal, 0);
  return {
    id,
    dispatchId,
    driverId,
    driverName: driverId === 'd1' ? 'Ali' : 'Veli',
    vehiclePlate: plate,
    customerId: 'c1',
    customerName: 'Test Müşteri',
    customerAddress: '',
    timestamp: '2026-11-09T08:00:00.000Z',
    deliveredItems,
    deliveredGrandTotal: total,
    collectedPayment: {
      method: 'UNPAID',
      cashAmount: 0,
      posAmount: 0,
      totalCollected: 0,
      status: 'unpaid',
      diffUncollected: total,
    },
    emptyContainersReceived: {
      damacana: empties.damacana || 0,
      camDamacana: empties.cam || 0,
      tup: 0,
      tupBuyuk: empties.tup || 0,
      tupKucuk: 0,
      sebil: empties.sebil || 0,
    },
    emptyContainersDiff: {
      damacana: 0,
      camDamacana: 0,
      tup: 0,
      tupBuyuk: 0,
      tupKucuk: 0,
      sebil: 0,
    },
    notes: '',
  } as Delivery;
};

const deliveries = [
  delivery(
    'del-1',
    'disp-1',
    'd1',
    '01 A',
    [
      { productId: 'p-dam', name: 'Hayat Damacana', qty: 4, price: 100 },
      { productId: 'p-cam', name: 'Hayat Cam Damacana', qty: 1, price: 250 },
      { productId: 'p-tup', name: 'Büyük Tüp (12 Kg)', qty: 1, price: 750 },
      { productId: 'p-sebil', name: 'Su Sebili', qty: 1, price: 0 },
      { productId: 'p-pet', name: "Hayat 1.5 lt Pet Su (6'lı Koli)", qty: 2, price: 110 },
    ],
    { damacana: 3, cam: 1, tup: 1, sebil: 1 }
  ),
  delivery(
    'del-2',
    'disp-3',
    'd2',
    '03 V',
    [{ productId: 'p-pet', name: "Hayat 1.5 lt Pet Su (6'lı Koli)", qty: 1, price: 110 }],
    {}
  ),
];

const report = buildConsolidatedReport({
  deliveries,
  payments: [],
  dispatches: [
    {
      id: 'disp-1',
      driverId: 'd1',
      driverName: 'Ali',
      vehiclePlate: '01 A',
      loadedItems: [
        { productId: 'p-dam', quantity: 10 },
        { productId: 'p-cam', quantity: 2 },
        { productId: 'p-tup', quantity: 1 },
        { productId: 'p-sebil', quantity: 1 },
        { productId: 'p-pet', quantity: 5 },
      ],
    },
    {
      id: 'disp-2',
      driverId: 'd1',
      driverName: 'Ali',
      vehiclePlate: '02 B',
      loadedItems: [{ productId: 'p-pet', quantity: 3 }],
    },
    {
      id: 'disp-3',
      driverId: 'd2',
      driverName: 'Veli',
      vehiclePlate: '03 V',
      loadedItems: [{ productId: 'p-pet', quantity: 1 }],
    },
  ],
  products,
  customers,
  drivers: [
    { id: 'd1', name: 'Ali' },
    { id: 'd2', name: 'Veli' },
  ],
});

const ali = report.drivers.find((d) => d.driverName === 'Ali')!;
const veli = report.drivers.find((d) => d.driverName === 'Veli')!;
const first = ali.returns.find((r) => r.dispatchId === 'disp-1')!;
const second = ali.returns.find((r) => r.dispatchId === 'disp-2')!;

console.log('\n[1) Sefer bazında ayrı iade blokları]');
check('Ali iki ayrı blok', ali.returns.length, 2);
check('blok plakaları', ali.returns.map((r) => r.vehiclePlate), ['01 A', '02 B']);
check('Veli için iade yok', veli.returns.length, 0);

console.log('\n[2) Toplanan boşlar]');
check(
  'boş damacana / cam / tüp / sebil',
  [
    first.emptyDamacana,
    first.emptyCamDamacana,
    first.emptyTupBuyuk,
    first.emptyTupKucuk,
    first.sebilReceived,
  ],
  [3, 1, 1, 0, 1]
);
check(
  'ikinci seferde boş yok',
  [
    second.emptyDamacana,
    second.emptyCamDamacana,
    second.emptyTupBuyuk,
    second.emptyTupKucuk,
    second.sebilReceived,
  ],
  [0, 0, 0, 0, 0]
);

console.log('\n[3) Kalan ürünler: yüklenen − teslim edilen]');
check(
  'depozitolu ve depozitosuz kalanlar',
  first.remainingProducts.map((p) => [p.productId, p.loaded, p.delivered, p.remaining, p.isDeposit]),
  [
    ['p-dam', 10, 4, 6, true],
    ['p-cam', 2, 1, 1, true],
    ['p-pet', 5, 2, 3, false],
  ]
);
check(
  'tamamen teslim edilen sebil ve tüp gösterilmez',
  first.remainingProducts.some((p) => p.productId === 'p-sebil' || p.productId === 'p-tup'),
  false
);
check(
  'teslimat yapılmayan seferde tüm yükleme kalır',
  second.remainingProducts.map((p) => [p.productId, p.loaded, p.delivered, p.remaining]),
  [['p-pet', 3, 0, 3]]
);

console.log('\n[4) Sıfır ve eski tüp davranışı]');
check('sıfır adetli ürün yok', first.remainingProducts.every((p) => p.remaining > 0), true);
check('eski tip tüp alanı üretilmez', (first as any).emptyTupLegacy, undefined);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
