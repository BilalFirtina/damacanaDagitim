import type { Dispatch, Product } from '../src/types';
import {
  buildRecentEndOfDayReports,
  shiftUtcDate,
} from '../src/services/recentEndOfDayReports';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
    return;
  }
  failed += 1;
  console.log(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
}

function dispatch(overrides: Partial<Dispatch> & Pick<Dispatch, 'id' | 'date'>): Dispatch {
  return {
    driverId: 'u1',
    driverName: 'Şoför',
    vehiclePlate: '34 TEST 1',
    loadedByUserId: 'a1',
    loadedByUserName: 'Yönetici',
    driverConfirmedAt: null,
    status: 'completed',
    loadedItems: [],
    createdAt: '',
    ...overrides,
  } as Dispatch;
}

const products: Product[] = [
  {
    id: 'p1',
    name: 'Damacana Su',
    category: 'damacana',
    unit: 'Adet',
    defaultUnitPrice: 100,
    isDeposit: false,
    depositType: 'none',
    isActive: true,
  } as Product,
  {
    id: 'p2',
    name: 'Tüp',
    category: 'tup',
    unit: 'Adet',
    defaultUnitPrice: 300,
    isDeposit: false,
    depositType: 'none',
    isActive: true,
  } as Product,
];

const dispatches: Dispatch[] = [
  dispatch({ id: 'today', date: '2026-11-26' }),
  dispatch({
    id: 't1-new',
    date: '2026-11-25',
    driverName: 'Ali',
    vehiclePlate: '34 A 1',
    loadedItems: [
      { productId: 'p1', quantity: 10 },
      { productId: 'p2', quantity: 2 },
    ],
    endOfDayReconciliation: {
      closedAt: '2026-11-25T12:00:00.000Z',
      closedByUserId: 'u1',
      closedByUserName: 'Ali',
      remainingFullCounted: { p1: 2, p2: 0 },
      remainingFullExpected: { p1: 3, p2: 1 },
      collectedEmptyDamacana: 4,
      collectedEmptyCamDamacana: 0,
      collectedEmptyTupBuyuk: 1,
      collectedEmptyTupKucuk: 0,
      collectedEmptySebil: 1,
      actualCashInPocket: 1000,
      actualPosSlipsTotal: 500,
      totalDeliveredValue: 5000,
      totalCashCollected: 1000,
      totalPosCollected: 500,
      totalCreditAdded: 0,
    },
  }),
  dispatch({
    id: 't1-old',
    date: '2026-11-25',
    driverName: 'Veli',
    vehiclePlate: '34 B 2',
    loadedItems: [{ productId: 'p1', quantity: 5 }],
    endOfDayReconciliation: {
      closedAt: '2026-11-25T10:00:00.000Z',
      closedByUserId: 'u2',
      closedByUserName: 'Veli',
      remainingFullCounted: { p1: 5 },
      remainingFullExpected: { p1: 5 },
      collectedEmptyDamacana: 0,
      collectedEmptyCamDamacana: 2,
      collectedEmptyTupBuyuk: 0,
      collectedEmptyTupKucuk: 0,
      collectedEmptySebil: 0,
      actualCashInPocket: 200,
      actualPosSlipsTotal: 0,
      totalDeliveredValue: 0,
      totalCashCollected: 200,
      totalPosCollected: 0,
      totalCreditAdded: 0,
    },
  }),
  dispatch({
    id: 't2',
    date: '2026-11-24',
    driverName: 'Ayşe',
    vehiclePlate: '34 C 3',
    loadedItems: [{ productId: 'p1', quantity: 8 }],
    endOfDayReconciliation: {
      closedAt: '2026-11-24T18:00:00.000Z',
      closedByUserId: 'u3',
      closedByUserName: 'Ayşe',
      remainingFullCounted: {},
      remainingFullExpected: { p1: 3 },
      collectedEmptyDamacana: 0,
      collectedEmptyCamDamacana: 0,
      collectedEmptyTupBuyuk: 0,
      collectedEmptyTupKucuk: 2,
      collectedEmptySebil: 0,
      actualCashInPocket: 0,
      actualPosSlipsTotal: 250,
      totalDeliveredValue: 0,
      totalCashCollected: 0,
      totalPosCollected: 250,
      totalCreditAdded: 0,
    },
  }),
  dispatch({ id: 't3', date: '2026-11-23' }),
  dispatch({ id: 'open', date: '2026-11-25', status: 'in_transit' }),
];

console.log('\n[son 2 gün gün sonu raporları]\n');

check('tarih kaydırma ay sınırını geçer', shiftUtcDate('2026-11-01', -1) === '2026-10-31');
check('tarih kaydırma yıl sınırını geçer', shiftUtcDate('2026-01-01', -1) === '2025-12-31');

const reports = buildRecentEndOfDayReports({
  dispatches,
  products,
  today: '2026-11-26',
});

check('yalnızca 2 gün ve kapanmış seferler', reports.length === 3, `len=${reports.length}`);
check(
  'en yeni tarih ve en son kapanan en üstte',
  reports.map((r) => r.dispatchId).join(',') === 't1-new,t1-old,t2',
  reports.map((r) => r.dispatchId).join(',')
);
check('bugün hariç', !reports.some((r) => r.dispatchId === 'today'));
check('3 gün önce hariç', !reports.some((r) => r.dispatchId === 't3'));
check('açık sefer hariç', !reports.some((r) => r.dispatchId === 'open'));

const newest = reports[0];
check('sayılan ürün miktarı kullanılır', newest.products.find((p) => p.productId === 'p1')?.quantity === 2);
check('sıfır ürün listeye girmez', !newest.products.some((p) => p.productId === 'p2'));
check(
  'ürün adı ve birimi eşlenir',
  newest.products.find((p) => p.productId === 'p1')?.name === 'Damacana Su' &&
    newest.products.find((p) => p.productId === 'p1')?.unit === 'Adet'
);
check(
  'boş kaplar yalnızca sıfırdan büyük',
  newest.empties.length === 3 &&
    newest.empties.find((e) => e.label === 'Damacana')?.quantity === 4 &&
    newest.empties.find((e) => e.label === 'Sebil')?.quantity === 1
);
check('nakit ve POS ayrı', newest.cash === 1000 && newest.pos === 500);
check('toplam tahsilat', newest.total === 1500);

const oldest = reports[2];
check(
  'sayılan yoksa beklenen miktar kullanılır',
  oldest.products.find((p) => p.productId === 'p1')?.quantity === 3
);
check('POS tahsilatı okunur', oldest.pos === 250 && oldest.cash === 0);

console.log(`\nSonuç: ${passed} başarılı, ${failed} başarısız`);
if (failed > 0) process.exit(1);
