import {
  isDispatchOpenForDelivery,
  classifyDeliverySyncResponse,
  buildQueueItemAfterSync,
  shouldAttemptSync,
  isConflictQueueItem,
  validateReopenRequest,
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
// 1. Kapatılmış sefer kontrolü
// ---------------------------------------------------------------------------
section('1) Completed dispatch rejection');
check('pending_confirmation kabul edilir', isDispatchOpenForDelivery('pending_confirmation'));
check('in_transit kabul edilir', isDispatchOpenForDelivery('in_transit'));
check('completed reddedilir', !isDispatchOpenForDelivery('completed'));
check('bilinmeyen/boş durum reddedilir', !isDispatchOpenForDelivery('') && !isDispatchOpenForDelivery(undefined));

const closedResponse = classifyDeliverySyncResponse(409, {
  error: 'Sefer kapatılmış.',
  code: 'DISPATCH_CLOSED',
});
check('409 DISPATCH_CLOSED -> conflict', closedResponse.action === 'conflict' && closedResponse.retain);
check('409 kodu korunur', closedResponse.errorCode === 'DISPATCH_CLOSED');

// ---------------------------------------------------------------------------
// 2. Kuyruk kaydı ASLA sessizce silinmez
// ---------------------------------------------------------------------------
section('2) Queue conflict retention');
const queued = {
  id: 'offline_1712345678901',
  customerId: 'cust_1',
  deliveredGrandTotal: 300,
  syncStatus: 'pending',
};

const retained = buildQueueItemAfterSync(queued, closedResponse, '2026-10-19T10:00:00.000Z');
check('reddedilen kayıt kuyrukta kalır', retained !== null);
check('aynı teslimat ID korunur', retained?.id === queued.id, retained);
check('syncStatus=conflict işaretlenir', retained?.syncStatus === 'conflict', retained);
check('son hata ve deneme zamanı saklanır', !!retained?.lastError && !!retained?.lastAttemptAt);

const pendingResponse = classifyDeliverySyncResponse(500, { error: 'Sunucu hatası' });
const stillPending = buildQueueItemAfterSync(queued, pendingResponse);
check('5xx -> pending olarak korunur', stillPending?.syncStatus === 'pending');

const authResponse = classifyDeliverySyncResponse(401, { error: 'Oturum süresi doldu' });
check('401 -> conflict değil, pending', authResponse.action === 'pending' && authResponse.retain);
check('otomatik senkron çakışmayı atlar', !shouldAttemptSync(retained, false));
check('manuel senkron çakışmayı dener', shouldAttemptSync(retained, true));
check('çakışma tespiti doğru', isConflictQueueItem(retained) && !isConflictQueueItem(queued));

// ---------------------------------------------------------------------------
// 3. Duplicate retry (idempotency contract modeli)
// ---------------------------------------------------------------------------
section('3) Duplicate retry idempotency');
let balance = 0;
const applied = new Set<string>();

function applyDeliveryModel(id: string, delta: number): { duplicate: boolean } {
  if (applied.has(id)) return { duplicate: true };
  applied.add(id);
  balance += delta;
  return { duplicate: false };
}

const first = applyDeliveryModel('del_100_abc', 250);
const second = applyDeliveryModel('del_100_abc', 250);
check('ilk istek uygulanır', first.duplicate === false);
check('ikinci istek duplicate döner', second.duplicate === true);
check('bakiye yalnızca bir kez artar', balance === 250, balance);

// ---------------------------------------------------------------------------
// 4. Midway failure -> rollback contract modeli
// ---------------------------------------------------------------------------
section('4) Midway failure rollback');
let committedBalance = 0;
let committedIds = new Set<string>();

function applyDeliveryTxModel(
  id: string,
  delta: number,
  failAfterReserve: boolean
): { duplicate: boolean } {
  if (committedIds.has(id)) return { duplicate: true };

  // Transaction kopyası: hata olursa commit edilmez.
  const txIds = new Set(committedIds);
  let txBalance = committedBalance;
  txIds.add(id);

  if (failAfterReserve) {
    throw new Error('injected failure');
  }

  txBalance += delta;
  committedIds = txIds;
  committedBalance = txBalance;
  return { duplicate: false };
}

let threw = false;
try {
  applyDeliveryTxModel('del_200_def', 400, true);
} catch {
  threw = true;
}
check('ortada hata fırlatılır', threw);
check('başarısız işlem bakiyeyi değiştirmez', committedBalance === 0, committedBalance);
check('başarısız işlem ID rezervasyonu bırakmaz', !committedIds.has('del_200_def'));

const retried = applyDeliveryTxModel('del_200_def', 400, false);
check('hata sonrası retry başarılı olur', retried.duplicate === false);
check('retry bakiyeyi yalnızca bir kez uygular', committedBalance === 400, committedBalance);

// ---------------------------------------------------------------------------
// 5. Yeniden açma yetkisi / gerekçe
// ---------------------------------------------------------------------------
section('5) Manager-only reopen validation');
check(
  'yönetici + gerekçe kabul',
  validateReopenRequest({ role: 'admin', reason: 'Kapanış sonrası geç senkron' }).ok
);
check(
  'şoför reddedilir',
  validateReopenRequest({ role: 'driver', reason: 'geç senkron' }).errorCode === 'NOT_AUTHORIZED'
);
check(
  'boş gerekçe reddedilir',
  validateReopenRequest({ role: 'admin', reason: '   ' }).errorCode === 'REASON_REQUIRED'
);
check(
  'kısa gerekçe reddedilir',
  validateReopenRequest({ role: 'admin', reason: 'ok' }).errorCode === 'REASON_REQUIRED'
);

// ---------------------------------------------------------------------------
// 6. Yeniden açma sonrası aynı ID ile senkron
// ---------------------------------------------------------------------------
section('6) Sync after reopen');
const conflictItem = retained!;
const afterReopenResponse = classifyDeliverySyncResponse(200);
check('yeniden açma sonrası 200 -> synced', afterReopenResponse.action === 'synced');
check('başarılı senkron kaydı kuyruktan çıkarır', buildQueueItemAfterSync(conflictItem, afterReopenResponse) === null);
check('gönderilen ID değişmez', conflictItem.id === queued.id);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
