/**
 * Yükleme günü konsolide rapor mutabakat testi.
 *
 * Amaç: bir sonraki güne kayan teslimat ve tahsilatların, yükleme günü
 * raporunda eksiksiz yer aldığını ve sefer EOD toplamlarıyla uyuştuğunu
 * kullanıcıya uyarı göstermeden CI'da doğrulamak.
 *
 * Run: npx tsx scripts/verify-report-reconciliation.ts
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

function check(name: string, ok: boolean, detail?: any) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}`, detail ?? '');
  }
}

function section(title: string) {
  console.log(`\n[${title}]`);
}

const customer = (id: string, name: string, isAccount = false): Customer =>
  ({
    id,
    name,
    phone: '',
    address: '',
    emails: [],
    isAccountCustomer: isAccount,
    currentBalanceTL: 0,
    emptyDepositBalance: { damacana: 0, camDamacana: 0, tup: 0, sebil: 0 },
    customPrices: {},
    createdDate: '2026-11-04',
  }) as Customer;

const product: Product = {
  id: 'prod_damacana',
  name: 'Damacana',
  category: 'damacana',
  defaultUnitPrice: 100,
  isDeposit: true,
  depositType: 'damacana',
  unit: 'Adet',
  description: '',
};

const delivery = (
  id: string,
  customerId: string,
  customerName: string,
  timestamp: string,
  isLateDelivery: boolean,
  amount = 100,
  cash = 0
): Delivery => ({
  id,
  dispatchId: 'disp_cross_day',
  driverId: 'u_driver',
  driverName: 'Ergün Orak',
  vehiclePlate: '01 FV 823',
  customerId,
  customerName,
  customerAddress: '',
  timestamp,
  deliveredItems: [
    {
      productId: product.id,
      productName: product.name,
      quantity: 1,
      unitPrice: amount,
      lineTotal: amount,
    },
  ],
  deliveredGrandTotal: amount,
  collectedPayment: {
    method: cash > 0 ? 'CASH' : 'UNPAID',
    cashAmount: cash,
    posAmount: 0,
    totalCollected: cash,
    status: cash >= amount ? 'paid_full' : 'unpaid',
    diffUncollected: Math.max(0, amount - cash),
  },
  emptyContainersReceived: { damacana: 1, camDamacana: 0, tup: 0, sebil: 0 },
  emptyContainersDiff: { damacana: 0, camDamacana: 0, tup: 0, sebil: 0 },
  notes: '',
  isLateDelivery,
});

section('1) Yükleme günü raporu bir sonraki günün teslimatını içerir');

const crossDayDelivery = delivery(
  'del_next_day',
  'c_next',
  'Saat Saat Real AVM',
  '2026-11-05T04:56:11.000Z',
  true,
  100,
  0
);
const sameDayDelivery = delivery(
  'del_same_day',
  'c_same',
  'Sancak Ecza Deposu',
  '2026-11-04T13:44:04.000Z',
  false,
  100,
  0
);
const payment: ReportPayment = {
  id: 'pay_next_day',
  customerId: 'c_payment',
  customerName: 'Tahsilat Müşterisi',
  amount: 1000,
  method: 'CASH',
  note: '',
  collectedByUserId: 'u_driver',
  collectedByUserName: 'Ergün Orak',
  collectedAt: '2026-11-05T04:54:37.000Z',
};

const report = buildConsolidatedReport({
  deliveries: [sameDayDelivery, crossDayDelivery],
  payments: [payment],
  dispatches: [
    {
      driverId: 'u_driver',
      driverName: 'Ergün Orak',
      vehiclePlate: '01 FV 823',
      date: '2026-11-04',
    } as any,
  ],
  products: [product],
  customers: [
    customer('c_same', 'Sancak Ecza Deposu'),
    customer('c_next', 'Saat Saat Real AVM'),
    customer('c_payment', 'Tahsilat Müşterisi'),
  ],
  drivers: [{ id: 'u_driver', name: 'Ergün Orak' }],
});

check('iki teslimat rapora girdi', report.icmal.deliveryCount === 2, report.icmal.deliveryCount);
check('peşin ciro 200 TL', report.icmal.pesinCiro === 200, report.icmal.pesinCiro);
check(
  'teslimat dışı tahsilat 1.000 TL',
  report.icmal.standaloneCash === 1000,
  report.icmal.standaloneCash
);
check(
  'genel tahsilat 1.000 TL',
  report.icmal.collectionTotal === 1000,
  report.icmal.collectionTotal
);
check('tek şoför bölümü', report.drivers.length === 1, report.drivers.length);

const driverRows = report.drivers[0]?.rows || [];
const sameDayRow = driverRows.find((row) => row.customerId === 'c_same');
const nextDayRow = driverRows.find((row) => row.customerId === 'c_next');
const paymentRow = driverRows.find((row) => row.customerId === 'c_payment');

check('aynı gün müşterisi var', !!sameDayRow);
check('sonraki gün müşterisi var', !!nextDayRow);
check('tahsilat müşterisi var', !!paymentRow);
check(
  'sonraki gün teslimatı "Geç Teslimat" işaretli',
  nextDayRow?.hasLateDelivery === true
);
check(
  'aynı gün teslimatı "Geç Teslimat" değil',
  sameDayRow?.hasLateDelivery === false
);
check(
  'sonraki gün müşterisinin saati raporda',
  (nextDayRow?.times.length || 0) === 1
);
check(
  'tahsilat satırı nakit 1.000 TL',
  rowCash(paymentRow!) === 1000 && rowPos(paymentRow!) === 0
);
check(
  'tahsilat kaynağı Teslimat Dışı',
  report.customerPayments.some(
    (row) => row.customerName === 'Tahsilat Müşterisi' && row.source === 'Teslimat Dışı'
  )
);

section('2) Sefer EOD toplamları ile rapor toplamları uyuşur');

const eod = {
  totalDeliveredValue: 200,
  totalCashCollected: 1000,
  totalPosCollected: 0,
};
const reportDeliveredValue = report.icmal.pesinCiro;
const reportCash = report.icmal.deliveryCash + report.icmal.standaloneCash;
const reportPos = report.icmal.deliveryPos + report.icmal.standalonePos;

check(
  'mal bedeli EOD = rapor',
  reportDeliveredValue === eod.totalDeliveredValue,
  `${reportDeliveredValue} / ${eod.totalDeliveredValue}`
);
check(
  'nakit EOD = rapor',
  reportCash === eod.totalCashCollected,
  `${reportCash} / ${eod.totalCashCollected}`
);
check(
  'POS EOD = rapor',
  reportPos === eod.totalPosCollected,
  `${reportPos} / ${eod.totalPosCollected}`
);

section('3) Faturalı tutar ekranda görünmez, iç toplamda ayrı kalır');

const accountDelivery = delivery(
  'del_account',
  'c_account',
  'Faturalı Müşteri',
  '2026-11-04T15:00:00.000Z',
  false,
  500,
  0
);
// Faturalı bayrağı raporda müşteri kaydından türetilir.
const accountReport = buildConsolidatedReport({
  deliveries: [accountDelivery],
  payments: [],
  dispatches: [
    {
      driverId: 'u_driver',
      driverName: 'Ergün Orak',
      vehiclePlate: '01 FV 823',
      date: '2026-11-04',
    } as any,
  ],
  products: [product],
  customers: [customer('c_account', 'Faturalı Müşteri', true)],
  drivers: [{ id: 'u_driver', name: 'Ergün Orak' }],
});
const accountRow = accountReport.drivers[0]?.rows[0];
check('faturalı satırı işaretli', accountRow?.isAccount === true);
check('faturalı tutar peşin ciroya yazılmadı', accountReport.icmal.pesinCiro === 0);
check('faturalı satır tutarı 0', accountRow?.deliveredAmount === 0);
check(
  'faturalı ürün toplamı FATURALI olarak işaretli',
  accountReport.products[0]?.hasAccountAmount === true
);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
