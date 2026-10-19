import {
  validateDispatchUpdate,
  validateConfirmTransition,
  validateCloseTransition,
  validateReopenTransition,
  compareExpectedBalance,
  compareExpectedQuantity,
} from '../src/services/dispatchRules.ts';
import {
  classifyDeliverySyncResponse,
  assignMissingQueueIds,
  deliveryPayloadsMatch,
  canonicalDeliveryPayload,
} from '../src/services/offlineSync.ts';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: any) {
  if (condition) {
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

// ---------------------------------------------------------------------------
// 1. PUT /api/dispatches/:id alan ve durum kısıtları
// ---------------------------------------------------------------------------
section('1) Dispatch update restrictions');
const pendingCtx = { role: 'admin', canLoadVehicle: false, status: 'pending_confirmation' };
const loaded = [{ productId: 'prod_1', quantity: 5 }];

check(
  'admin yükleme kalemlerini güncelleyebilir',
  validateDispatchUpdate({ loadedItems: loaded }, pendingCtx).ok
);
check(
  'yükleyici rolü güncelleyebilir',
  validateDispatchUpdate({ loadedItems: loaded }, { ...pendingCtx, role: 'driver', canLoadVehicle: true }).ok
);
check(
  'yükleme yetkisi olmayan şoför reddedilir',
  validateDispatchUpdate({ loadedItems: loaded }, { ...pendingCtx, role: 'driver' }).errorCode ===
    'NOT_AUTHORIZED'
);
check(
  'status alanı yasak',
  validateDispatchUpdate({ status: 'in_transit' }, pendingCtx).errorCode === 'FORBIDDEN_FIELD'
);
check(
  'mutabakat alanı yasak',
  validateDispatchUpdate(
    { endOfDayReconciliation: { totalDeliveredValue: 999 } },
    pendingCtx
  ).errorCode === 'FORBIDDEN_FIELD'
);
check(
  'closedBy alanı yasak',
  validateDispatchUpdate({ closedByUserId: 'usr_admin' }, pendingCtx).errorCode ===
    'FORBIDDEN_FIELD'
);
check(
  'kapatılmış sefer güncellenemez',
  validateDispatchUpdate({ loadedItems: loaded }, { ...pendingCtx, status: 'completed' }).errorCode ===
    'DISPATCH_ALREADY_COMPLETED'
);
check(
  'onay sonrası yükleme değiştirilemez',
  validateDispatchUpdate({ loadedItems: loaded }, { ...pendingCtx, status: 'in_transit' }).errorCode ===
    'INVALID_STATE'
);
check(
  'boş gövde reddedilir',
  validateDispatchUpdate({}, pendingCtx).errorCode === 'NO_FIELDS'
);
check(
  'aynı ürün iki kez gönderilemez',
  validateDispatchUpdate(
    { loadedItems: [loaded[0], loaded[0]] },
    pendingCtx
  ).errorCode === 'INVALID_LOAD_ITEMS'
);

// ---------------------------------------------------------------------------
// 2. Durum geçişleri
// ---------------------------------------------------------------------------
section('2) Dispatch transitions');
check('onay: pending -> in_transit', validateConfirmTransition('pending_confirmation').ok);
check(
  'onay: in_transit idempotent',
  validateConfirmTransition('in_transit').ok && validateConfirmTransition('in_transit').alreadyConfirmed === true
);
check(
  'onay: completed reddedilir',
  validateConfirmTransition('completed').errorCode === 'DISPATCH_ALREADY_COMPLETED'
);
check('kapatma: in_transit kabul', validateCloseTransition('in_transit').ok);
check('kapatma: pending reddedilir', validateCloseTransition('pending_confirmation').errorCode === 'INVALID_STATE');
check(
  'kapatma: completed reddedilir',
  validateCloseTransition('completed').errorCode === 'DISPATCH_ALREADY_COMPLETED'
);
check('yeniden açma: completed kabul', validateReopenTransition('completed').ok);
check('yeniden açma: in_transit reddedilir', validateReopenTransition('in_transit').errorCode === 'INVALID_STATE');

// ---------------------------------------------------------------------------
// 3. Beklenen değer kontrollü mutlak yazım
// ---------------------------------------------------------------------------
section('3) Expected-value guarded writes');
check('bakiye eşleşirse kabul', compareExpectedBalance(500, 500).ok);
check('bakiye farklıysa reddedilir', compareExpectedBalance(500, 300).errorCode === 'BALANCE_CONFLICT');
check(
  'bakiye çakışmasında güncel değer döner',
  compareExpectedBalance(500, 300).current === 500
);
check(
  'bakiye beklenen değer yoksa reddedilir',
  compareExpectedBalance(500, undefined).errorCode === 'EXPECTATION_REQUIRED'
);
check('kuruş toleransı kabul', compareExpectedBalance(500.004, 500).ok);
check('boş kap eşleşirse kabul', compareExpectedQuantity(3, 3).ok);
check('boş kap farklıysa reddedilir', compareExpectedQuantity(3, 2).errorCode === 'EMPTY_CONFLICT');
check(
  'boş kap çakışmasında güncel değer döner',
  compareExpectedQuantity(3, 2).current === 3
);

// ---------------------------------------------------------------------------
// 4. 408 / 425 / 429 geçici hata sınıflandırması
// ---------------------------------------------------------------------------
section('4) Transient status classification');
for (const status of [408, 425, 429]) {
  const result = classifyDeliverySyncResponse(status, { error: 'geçici' });
  check(`${status} -> pending`, result.action === 'pending' && result.retain);
}
check('400 -> conflict', classifyDeliverySyncResponse(400, { error: 'geçersiz' }).action === 'conflict');
check('403 -> conflict', classifyDeliverySyncResponse(403, { error: 'yasak' }).action === 'conflict');

// ---------------------------------------------------------------------------
// 5. Eski kuyruk kimliklerinin atanması
// ---------------------------------------------------------------------------
section('5) Legacy queue ID assignment');
let counter = 0;
const genId = () => `offline_fixed_${++counter}`;
const legacyQueue = [
  { customerId: 'cust_1' },
  { id: '', customerId: 'cust_2' },
  { id: 'not-valid', customerId: 'cust_3' },
  { id: 'del_123_abc', customerId: 'cust_4' },
  { id: 'del_123_abc', customerId: 'cust_5' },
];
const assigned = assignMissingQueueIds(legacyQueue, genId);
check('atama yapıldı', assigned.changed === true);
check('geçerli kimlik korunur', assigned.queue[3].id === 'del_123_abc');
check(
  'eksik/boş kimlikler geçerli biçimde atandı',
  /^(del_|offline_)[A-Za-z0-9_-]+$/.test(assigned.queue[0].id) &&
    /^(del_|offline_)[A-Za-z0-9_-]+$/.test(assigned.queue[1].id)
);
check(
  'boş olmayan geçersiz kimlik korunur (çift kayıt riski yok)',
  assigned.queue[2].id === 'not-valid'
);
check(
  'yinelenen geçerli kimlik korunur (sunucu içerik karşılaştırması yapar)',
  assigned.queue[3].id === 'del_123_abc' && assigned.queue[4].id === 'del_123_abc'
);
check(
  'eksik kimliklerin atananları benzersiz',
  new Set([assigned.queue[0].id, assigned.queue[1].id]).size === 2
);
const repeated = assignMissingQueueIds(assigned.queue, genId);
check('ikinci çağrı değişiklik yapmaz', repeated.changed === false);

// ---------------------------------------------------------------------------
// 6. Aynı ID ile farklı içerik tespiti
// ---------------------------------------------------------------------------
section('6) Duplicate payload comparison');
const baseDelivery: any = {
  id: 'offline_1',
  dispatchId: 'disp_1',
  driverId: 'usr_driver_1',
  customerId: 'cust_1',
  timestamp: '2026-10-19T10:00:00.000Z',
  deliveredGrandTotal: 300,
  deliveredItems: [
    { productId: 'prod_1', productName: 'Damacana', quantity: 2, unitPrice: 100, lineTotal: 200 },
    { productId: 'prod_2', productName: 'Pet', quantity: 1, unitPrice: 100, lineTotal: 100 },
  ],
  collectedPayment: {
    method: 'MIXED',
    cashAmount: 150,
    posAmount: 100,
    totalCollected: 250,
    status: 'partial',
    diffUncollected: 50,
  },
  emptyContainersReceived: { damacana: 2, camDamacana: 0, tup: 0 },
  emptyContainersDiff: { damacana: 0, camDamacana: 0, tup: 0 },
  notes: '  kapıda bırakıldı  ',
  isOfflineSync: false,
};

const reordered: any = {
  ...baseDelivery,
  timestamp: '2026-10-19T11:00:00.000Z',
  isOfflineSync: true,
  driverName: 'Farklı görünen ad',
  deliveredItems: [baseDelivery.deliveredItems[1], baseDelivery.deliveredItems[0]],
  notes: 'kapıda bırakıldı',
};
check('sıra/zaman/görünen ad farkı eşleşir', deliveryPayloadsMatch(baseDelivery, reordered));

const changedQty: any = {
  ...baseDelivery,
  deliveredItems: [
    { ...baseDelivery.deliveredItems[0], quantity: 3, lineTotal: 300 },
    baseDelivery.deliveredItems[1],
  ],
  deliveredGrandTotal: 400,
};
check('miktar farkı eşleşmez', !deliveryPayloadsMatch(baseDelivery, changedQty));

const changedPayment: any = {
  ...baseDelivery,
  collectedPayment: { ...baseDelivery.collectedPayment, cashAmount: 200, diffUncollected: 0 },
};
check('ödeme farkı eşleşmez', !deliveryPayloadsMatch(baseDelivery, changedPayment));

const legacyCam: any = {
  ...baseDelivery,
  emptyContainersReceived: { damacana: 2, cam_damacana: 0, tup: 0 },
  emptyContainersDiff: { damacana: 0, cam_damacana: 0, tup: 0 },
};
check('cam_damacana takma adı eşleşir', deliveryPayloadsMatch(baseDelivery, legacyCam));

const changedDispatch = { ...baseDelivery, dispatchId: 'disp_2' };
check('sefer farkı eşleşmez', !deliveryPayloadsMatch(baseDelivery, changedDispatch));

check(
  'kanonik gösterim deterministik',
  canonicalDeliveryPayload(baseDelivery) === canonicalDeliveryPayload(reordered)
);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
