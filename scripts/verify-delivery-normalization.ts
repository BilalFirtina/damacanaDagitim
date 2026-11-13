/**
 * normalizeDelivery alan koruma testi.
 *
 * Özellikle sebil ve cam_damacana alanlarının istemci state'ine
 * taşınmasını doğrular; EOD "Alınan Sebil" kartının sıfır kalmasını önler.
 *
 * Run: npx tsx scripts/verify-delivery-normalization.ts
 */
// api.ts modülü tarayıcı fetch'ini top-level bağlar; Node testinde küçük bir
// window stub'ı verilir. normalizeDelivery saf bir fonksiyondur.
(globalThis as any).window = { fetch: globalThis.fetch };
const { normalizeDelivery } = await import('../src/services/api.ts');

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

const input = {
  id: 'del_normalize_test',
  dispatchId: 'disp_test',
  driverId: 'u_driver',
  driverName: 'Test Şoför',
  vehiclePlate: '01 TEST 01',
  customerId: 'c_test',
  customerName: 'Test Müşteri',
  timestamp: '2026-11-09T08:00:00.000Z',
  deliveredItems: [
    {
      productId: 'prod_sebil',
      productName: 'Su Sebili',
      quantity: 1,
      unitPrice: 0,
      lineTotal: 0,
    },
  ],
  deliveredGrandTotal: 0,
  collectedPayment: {
    method: 'UNPAID',
    cashAmount: 0,
    posAmount: 0,
    totalCollected: 0,
    status: 'unpaid',
    diffUncollected: 0,
  },
  emptyContainersReceived: {
    damacana: 3,
    cam_damacana: 2,
    tupBuyuk: 1,
    tupKucuk: 4,
    sebil: 1,
  },
  emptyContainersDiff: {
    damacana: 0,
    cam_damacana: 1,
    tupBuyuk: 0,
    tupKucuk: 0,
    sebil: 2,
  },
};

const normalized = normalizeDelivery(input, true);

console.log('\n[1) Boş kap alanları korunuyor]');
check('boş damacana korundu', normalized.emptyContainersReceived.damacana === 3);
check(
  'cam_damacana aliası camDamacana alanına taşındı',
  normalized.emptyContainersReceived.camDamacana === 2 &&
    normalized.emptyContainersReceived.cam_damacana === 2
);
check('büyük tüp korundu', normalized.emptyContainersReceived.tupBuyuk === 1);
check('küçük tüp korundu', normalized.emptyContainersReceived.tupKucuk === 4);
check('sebil korundu', normalized.emptyContainersReceived.sebil === 1);

console.log('\n[2) Boş kap fark alanları korunuyor]');
check(
  'cam farkı aliasla korundu',
  normalized.emptyContainersDiff.camDamacana === 1 &&
    normalized.emptyContainersDiff.cam_damacana === 1
);
check('sebil farkı korundu', normalized.emptyContainersDiff.sebil === 2);
check('damacana farkı korundu', normalized.emptyContainersDiff.damacana === 0);

console.log('\n[3) Eski davranış korunuyor]');
check('teslimat kalemleri korundu', normalized.deliveredItems.length === 1);
check('sevk kimliği korundu', normalized.dispatchId === 'disp_test');
check('offline işareti korundu', normalized.isOfflineSync === true);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
