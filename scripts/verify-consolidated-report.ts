/**
 * Konsolide gün sonu raporu hesaplama doğrulaması.
 *
 * Senaryo: iki şoför, aynı peşin müşteriye iki şoförden ziyaret, faturalı
 * müşteri, yalnızca tahsilat yapılan müşteri, yönetici tahsilatı ve eski
 * TRANSFER kaydı. Toplamların birbiriyle ve teslimat kayıtlarıyla uyumu kontrol edilir.
 *
 * Run:  npx tsx scripts/verify-consolidated-report.ts
 */
import {
  buildConsolidatedReport,
  rowCash,
  rowPos,
  type ReportPayment,
} from '../src/services/consolidatedReportRules.ts';
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
  { id: 'p-dam', name: 'Hayat Damacana', unit: 'Adet', depositType: 'damacana' },
  { id: 'p-cam', name: 'Hayat Cam Damacana', unit: 'Adet', depositType: 'cam_damacana' },
  { id: 'p-tup', name: 'Büyük Tüp (12 Kg)', unit: 'Adet', depositType: 'tup_buyuk' },
  { id: 'p-tup-kucuk', name: 'Küçük Tüp (2 Kg)', unit: 'Adet', depositType: 'tup_kucuk' },
  { id: 'p-sebil', name: 'Su Sebili', unit: 'Adet', depositType: 'sebil' },
  { id: 'p-pet', name: "Hayat 1.5 lt Pet Su (6'lı Koli)", unit: 'Koli', depositType: 'none' },
] as unknown as Product[];

const customers = [
  { id: 'c-fat', name: 'Şenbayrak', address: 'Hal', isAccountCustomer: true, currentBalanceTL: 0 },
  { id: 'c-pes', name: 'Yılmaz Market', address: 'Cadde', isAccountCustomer: false, currentBalanceTL: 450 },
  { id: 'c-avans', name: 'ABC Gıda', address: 'Kavşak', isAccountCustomer: false, currentBalanceTL: -100 },
] as unknown as Customer[];

const drivers = [
  { id: 'd1', name: 'Ali' },
  { id: 'd2', name: 'Veli' },
];

const deliveries = [
  {
    id: 'del-1',
    driverId: 'd1',
    driverName: 'Ali',
    vehiclePlate: '34 A 1',
    customerId: 'c-pes',
    customerName: 'Yılmaz Market',
    timestamp: '2026-11-07T09:00:00.000Z',
    deliveredItems: [
      { productId: 'p-dam', productName: 'Hayat Damacana', quantity: 2, unitPrice: 70, lineTotal: 140 },
      { productId: 'p-cam', productName: 'Hayat Cam Damacana', quantity: 1, unitPrice: 90, lineTotal: 90 },
      { productId: 'p-pet', productName: "Hayat 1.5 lt Pet Su (6'lı Koli)", quantity: 1, unitPrice: 110, lineTotal: 110 },
    ],
    deliveredGrandTotal: 340,
    collectedPayment: { method: 'CASH', cashAmount: 300, posAmount: 0, totalCollected: 300, diffUncollected: 40 },
    emptyContainersReceived: { damacana: 2, camDamacana: 1, tup: 0, sebil: 0 },
    notes: '3. kat',
  },
  {
    id: 'del-2',
    driverId: 'd1',
    driverName: 'Ali',
    vehiclePlate: '34 A 1',
    customerId: 'c-pes',
    customerName: 'Yılmaz Market',
    timestamp: '2026-11-07T10:00:00.000Z',
    deliveredItems: [{ productId: 'p-dam', productName: 'Hayat Damacana', quantity: 1, unitPrice: 70, lineTotal: 70 }],
    deliveredGrandTotal: 70,
    collectedPayment: { method: 'POS', cashAmount: 0, posAmount: 70, totalCollected: 70, diffUncollected: 0 },
    emptyContainersReceived: { damacana: 1, camDamacana: 0, tup: 0, sebil: 0 },
    notes: '3. kat',
  },
  {
    id: 'del-3',
    driverId: 'd1',
    driverName: 'Ali',
    vehiclePlate: '34 A 1',
    customerId: 'c-fat',
    customerName: 'Şenbayrak',
    isAccountCustomer: true,
    timestamp: '2026-11-07T11:00:00.000Z',
    deliveredItems: [{ productId: 'p-dam', productName: 'Hayat Damacana', quantity: 3, unitPrice: 70, lineTotal: 210 }],
    deliveredGrandTotal: 210,
    collectedPayment: { method: 'UNPAID', cashAmount: 0, posAmount: 0, totalCollected: 0, diffUncollected: 210 },
    emptyContainersReceived: { damacana: 3, camDamacana: 0, tup: 0, sebil: 0 },
    notes: '',
  },
  {
    id: 'del-4',
    driverId: 'd2',
    driverName: 'Veli',
    vehiclePlate: '34 V 2',
    customerId: 'c-pes',
    customerName: 'Yılmaz Market',
    timestamp: '2026-11-07T09:30:00.000Z',
    deliveredItems: [
      { productId: 'p-tup', productName: 'Büyük Tüp (12 Kg)', quantity: 1, unitPrice: 750, lineTotal: 750 },
      { productId: 'p-tup-kucuk', productName: 'Küçük Tüp (2 Kg)', quantity: 2, unitPrice: 160, lineTotal: 320 },
      { productId: 'p-sebil', productName: 'Su Sebili', quantity: 1, unitPrice: 0, lineTotal: 0 },
    ],
    deliveredGrandTotal: 1070,
    collectedPayment: { method: 'UNPAID', cashAmount: 0, posAmount: 0, totalCollected: 0, diffUncollected: 1070 },
    emptyContainersReceived: {
      damacana: 0,
      camDamacana: 0,
      tup: 2,
      tupBuyuk: 1,
      tupKucuk: 1,
      sebil: 1,
    },
    notes: '',
  },
] as unknown as Delivery[];

const payments: ReportPayment[] = [
  {
    id: 'pay-1',
    customerId: 'c-avans',
    amount: 100,
    method: 'CASH',
    note: 'Geçen hafta',
    collectedByUserId: 'd1',
    collectedByUserName: 'Ali',
    collectedAt: '2026-11-07T12:00:00.000Z',
  },
  {
    id: 'pay-2',
    customerId: 'c-pes',
    amount: 50,
    method: 'POS',
    note: '',
    collectedByUserId: 'd1',
    collectedByUserName: 'Ali',
    collectedAt: '2026-11-07T13:00:00.000Z',
  },
  {
    id: 'pay-3',
    customerId: 'c-pes',
    amount: 200,
    method: 'CASH',
    note: '',
    collectedByUserId: 'a1',
    collectedByUserName: 'Uğur Fırtına',
    collectedAt: '2026-11-07T14:00:00.000Z',
  },
  {
    id: 'pay-4',
    customerId: 'c-avans',
    amount: 300,
    method: 'TRANSFER',
    note: 'eski kayıt',
    collectedByUserId: 'd2',
    collectedByUserName: 'Veli',
    collectedAt: '2026-11-07T15:00:00.000Z',
  },
];

const report = buildConsolidatedReport({
  deliveries,
  payments,
  dispatches: [
    { driverId: 'd1', driverName: 'Ali', vehiclePlate: '34 A 1' },
    { driverId: 'd2', driverName: 'Veli', vehiclePlate: '34 V 2' },
  ],
  products,
  customers,
  drivers,
});

const ali = report.drivers.find((d) => d.driverName === 'Ali')!;
const veli = report.drivers.find((d) => d.driverName === 'Veli')!;
const aliPesin = ali.rows.find((r) => r.customerId === 'c-pes')!;
const aliFatura = ali.rows.find((r) => r.customerId === 'c-fat')!;
const aliAvans = ali.rows.find((r) => r.customerId === 'c-avans')!;
const veliPesin = veli.rows.find((r) => r.customerId === 'c-pes')!;

console.log('\n[1) Şoför bölümleri ve sıralama]');
check('şoför sırası alfabetik', report.drivers.map((d) => d.driverName), ['Ali', 'Veli']);
check(
  'Ali satır sırası ilk kayda göre',
  ali.rows.map((r) => r.customerId),
  ['c-pes', 'c-fat', 'c-avans']
);
check('Veli yalnızca kendi ziyaretini görür', veli.rows.map((r) => r.customerId), ['c-pes']);

console.log('\n[2) Müşteri başına tek satır (aynı şoför)]');
check('Ali / Yılmaz Market iki teslimatı tek satırda', aliPesin.deliveryCount, 2);
check('Ali / Yılmaz Market dolu damacana toplamı', aliPesin.damacanaFull, 3);
check('Ali / Yılmaz Market cam dolu ayrı tutulur', aliPesin.camDamacanaFull, 1);
check('Ali / Yılmaz Market boş damacana toplamı', aliPesin.damacanaEmpty, 3);
check('Ali / Yılmaz Market cam boş ayrı tutulur', aliPesin.camDamacanaEmpty, 1);
check('ürün satırı pet suyu', aliPesin.productLines.map((l) => [l.name, l.quantity]), [
  ["Hayat 1.5 lt Pet Su (6'lı Koli)", 1],
]);

console.log('\n[3) Farklı şoförler aynı müşteriyi ayrı satırda gösterir]');
check('Veli / Yılmaz Market ayrı satır', veliPesin.driverName, 'Veli');
check('Veli sebil verildi', veliPesin.sebilGiven, 1);
check('Veli sebil alındı', veliPesin.sebilReceived, 1);
check('Veli büyük tüp boş alındı', veliPesin.tupBuyukEmpty, 1);
check('Veli küçük tüp boş alındı', veliPesin.tupKucukEmpty, 1);
check('Veli büyük tüp dolu', veliPesin.tupBuyukFull, 1);
check('Veli küçük tüp dolu', veliPesin.tupKucukFull, 2);

console.log('\n[4) Tutar ve faturalı ayrımı]');
check('peşin tutar toplamı (teslimat)', aliPesin.deliveredAmount, 410);
check('faturalı teslimat tutara girmez', aliFatura.deliveredAmount, 0);
check('faturalı satır işaretli', aliFatura.isAccount, true);
check('tahsilat yalnızca müşteri satırında', aliAvans.deliveryCount, 0);
check('tahsilat-only satırda teslimat tutarı yok', aliAvans.deliveredAmount, 0);

console.log('\n[5) Tahsilat: teslimat + teslimat dışı + yönetici]');
check('Ali nakit (teslimat 300 + teslimat dışı 100)', rowCash(aliPesin) + rowCash(aliAvans), 400);
check('Ali POS (teslimat 70 + teslimat dışı 50)', rowPos(aliPesin), 120);
check('Ali toplam tahsilat', ali.cash + ali.pos, 520);
check('Veli tahsilat yok', veli.cash + veli.pos, 0);
check('yönetici tahsilatı ayrı', [report.adminCash, report.adminPos, report.adminCount], [200, 0, 1]);
check(
  'müşteri tahsilat dökümü kaynakları',
  report.customerPayments.map((r) => [r.driverName, r.customerName, r.source, r.cash, r.pos]),
  [
    ['Ali', 'ABC Gıda', 'Teslimat Dışı', 100, 0],
    ['Ali', 'Yılmaz Market', 'Teslimat + Tahsilat', 300, 120],
  ]
);

console.log('\n[6) Genel icmal ile şoför toplamlarının uyumu]');
const driverCollections = report.drivers.reduce((sum, d) => sum + d.cash + d.pos, 0);
check(
  'şoför toplamı + yönetici = genel tahsilat',
  driverCollections + report.adminCash + report.adminPos,
  report.icmal.collectionTotal
);
check('genel tahsilat toplamı', report.icmal.collectionTotal, 720);
check('TRANSFER kayıtları hariç (nakit)', report.icmal.standaloneCash, 300);
check('TRANSFER kayıtları hariç (POS)', report.icmal.standalonePos, 50);
check('peşin ciro faturalıyı içermez', report.icmal.pesinCiro, 1480);
check('cariye kalan (peşin)', report.icmal.creditAdded, 1110);
check('işlem gören tekil müşteri', report.icmal.visitedCustomerCount, 3);
check('dolu damacana toplamı', report.icmal.damacanaFull, 6);
check('dolu cam damacana toplamı', report.icmal.camDamacanaFull, 1);
check('dolu tüp toplamı', report.icmal.tupFull, 3);
check('dolu büyük tüp', report.icmal.tupBuyukFull, 1);
check('dolu küçük tüp', report.icmal.tupKucukFull, 2);
check('boş damacana toplamı', report.icmal.damacanaEmpty, 6);
check('boş cam toplamı', report.icmal.camDamacanaEmpty, 1);
check('boş büyük tüp', report.icmal.tupBuyukEmpty, 1);
check('boş küçük tüp', report.icmal.tupKucukEmpty, 1);
check('sebil verildi', report.icmal.sebilGiven, 1);
check('sebil alındı', report.icmal.sebilReceived, 1);

console.log('\n[7) Ürün dökümü faturalıyı tutara katmaz]');
const damacanaLine = report.products.find((p) => p.productId === 'p-dam')!;
check('damacana adedi tüm teslimatlar', damacanaLine.quantity, 6);
check('damacana tutarı yalnız peşin', damacanaLine.amount, 210);
check('damacana faturalı kalem işareti', damacanaLine.hasAccountAmount, true);

console.log(`\nSONUC: ${passed} basarili, ${failed} basarisiz`);
if (failed > 0) process.exit(1);
