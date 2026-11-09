// Sefer durum geçişleri ve mutlak müşteri bakiyesi yazımları için saf
// (yan etkisiz) iş kuralları. Sunucu bu yardımcıları kullanır; testler de
// doğrudan içe aktarır.

import type { DispatchStatus, LoadedItem } from '../types';

export type DispatchRuleCode =
  | 'NOT_AUTHORIZED'
  | 'INVALID_STATE'
  | 'DISPATCH_ALREADY_COMPLETED'
  | 'DISPATCH_CLOSED'
  | 'FORBIDDEN_FIELD'
  | 'NO_FIELDS'
  | 'INVALID_LOAD_ITEMS'
  | 'DELIVERIES_EXIST'
  | 'PAYMENTS_EXIST'
  | 'REASON_REQUIRED'
  | 'EXPECTATION_REQUIRED'
  | 'BALANCE_CONFLICT'
  | 'EMPTY_CONFLICT'
  | 'VALIDATION_ERROR';

export interface DispatchRuleResult<T = undefined> {
  ok: boolean;
  errorCode?: DispatchRuleCode;
  message?: string;
  value?: T;
}

export interface DispatchUpdateContext {
  role?: string | null;
  status: DispatchStatus | string;
  hasActiveDeliveries?: boolean;
  hasLinkedPayments?: boolean;
}

export interface DispatchUpdateResult extends DispatchRuleResult<{ loadedItems: LoadedItem[] }> {
  updates?: { loadedItems: LoadedItem[] };
}

function fail<T>(errorCode: DispatchRuleCode, message: string): DispatchRuleResult<T> {
  return { ok: false, errorCode, message };
}

// PUT /api/dispatches/:id yalnızca yükleme kalemlerini değiştirebilir.
// Durum, mutabakat ve kapatan kullanıcı alanları bu uçtan ASLA yazılamaz.
// Yükleme düzeltmesi yalnızca depo yöneticisine açıktır.
export function validateDispatchUpdate(
  body: any,
  ctx: DispatchUpdateContext
): DispatchUpdateResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('VALIDATION_ERROR', 'Geçersiz sefer güncelleme isteği.');
  }

  const keys = Object.keys(body);
  if (keys.length === 0) {
    return fail('NO_FIELDS', 'Güncellenecek alan belirtilmedi.');
  }

  const forbidden = keys.filter((key) => key !== 'loadedItems');
  if (forbidden.length > 0) {
    return fail(
      'FORBIDDEN_FIELD',
      'Sefer durumu ve mutabakat bilgileri bu uçtan değiştirilemez. Yalnızca yükleme kalemleri güncellenebilir.'
    );
  }

  if (ctx.role !== 'admin') {
    return fail(
      'NOT_AUTHORIZED',
      'Yükleme düzeltmesi yalnızca depo yöneticisi tarafından yapılabilir.'
    );
  }

  if (ctx.status === 'completed') {
    return fail(
      'DISPATCH_ALREADY_COMPLETED',
      'Kapatılmış sefer değiştirilemez ve yeniden açılamaz.'
    );
  }

  if (ctx.status !== 'pending_confirmation' && ctx.status !== 'in_transit') {
    return fail('INVALID_STATE', 'Sefer bu durumda yükleme düzeltmesine uygun değil.');
  }

  if (ctx.hasActiveDeliveries) {
    return fail(
      'DELIVERIES_EXIST',
      'Teslimat başladığı için yükleme düzeltilemez. Önce teslimatları iptal edin.'
    );
  }

  if (ctx.hasLinkedPayments) {
    return fail(
      'PAYMENTS_EXIST',
      'Sefere bağlı tahsilat olduğu için yükleme düzeltilemez.'
    );
  }

  const rawItems = (body as any).loadedItems;
  if (!Array.isArray(rawItems) || rawItems.length > 200) {
    return fail('INVALID_LOAD_ITEMS', 'Yükleme kalemleri geçersiz.');
  }

  const seen = new Set<string>();
  const loadedItems: LoadedItem[] = [];
  for (const item of rawItems) {
    const productId = typeof item?.productId === 'string' ? item.productId.trim() : '';
    const quantity = Number(item?.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity < 0) {
      return fail('INVALID_LOAD_ITEMS', 'Yükleme kalemlerinde geçersiz ürün veya miktar var.');
    }
    if (seen.has(productId)) {
      return fail('INVALID_LOAD_ITEMS', 'Aynı ürün yükleme listesinde birden fazla kez yer alamaz.');
    }
    seen.add(productId);
    loadedItems.push({ productId, quantity });
  }

  return { ok: true, value: { loadedItems }, updates: { loadedItems } };
}

export interface DispatchCancelContext {
  role?: string | null;
  status: DispatchStatus | string;
  hasActiveDeliveries?: boolean;
  hasLinkedPayments?: boolean;
  reason?: string | null;
}

export interface DispatchCancelResult extends DispatchRuleResult<{ reason: string }> {}

// Yükleme iptali yalnızca depo yöneticisine açıktır. Fiziksel silme
// sunucu/DB tarafında denetim kaydıyla birlikte yapılır.
export function validateDispatchCancel(
  ctx: DispatchCancelContext
): DispatchCancelResult {
  if (ctx.role !== 'admin') {
    return fail(
      'NOT_AUTHORIZED',
      'Yükleme iptali yalnızca depo yöneticisi tarafından yapılabilir.'
    );
  }

  if (ctx.status === 'completed') {
    return fail(
      'DISPATCH_ALREADY_COMPLETED',
      'Kapatılmış sefer iptal edilemez ve yeniden açılamaz.'
    );
  }

  if (ctx.status !== 'pending_confirmation' && ctx.status !== 'in_transit') {
    return fail('INVALID_STATE', 'Sefer bu durumda iptal edilemez.');
  }

  if (ctx.hasActiveDeliveries) {
    return fail(
      'DELIVERIES_EXIST',
      'Teslimat başladığı için yükleme iptal edilemez. Önce teslimatları iptal edin.'
    );
  }

  if (ctx.hasLinkedPayments) {
    return fail(
      'PAYMENTS_EXIST',
      'Sefere bağlı tahsilat olduğu için yükleme iptal edilemez.'
    );
  }

  const reason = String(ctx.reason || '').trim();
  if (reason.length < 3) {
    return fail('REASON_REQUIRED', 'Yükleme iptali için en az 3 karakterlik gerekçe girin.');
  }

  return { ok: true, value: { reason } };
}

export interface TransitionResult extends DispatchRuleResult {
  alreadyConfirmed?: boolean;
}

export function validateConfirmTransition(status: string): TransitionResult {
  if (status === 'pending_confirmation') return { ok: true };
  if (status === 'in_transit') return { ok: true, alreadyConfirmed: true };
  if (status === 'completed') {
    return fail(
      'DISPATCH_ALREADY_COMPLETED',
      'Sefer kapatılmış. Yeniden açmadan şoför onayı verilemez.'
    );
  }
  return fail('INVALID_STATE', 'Sefer bu durumda şoför onayına uygun değil.');
}

export function validateCloseTransition(status: string): TransitionResult {
  if (status === 'in_transit') return { ok: true };
  if (status === 'completed') {
    return fail(
      'DISPATCH_ALREADY_COMPLETED',
      'Sefer zaten kapatılmış. Değişiklik için yönetici seferi yeniden açmalıdır.'
    );
  }
  if (status === 'pending_confirmation') {
    return fail(
      'INVALID_STATE',
      'Şoför onayı verilmeden sefer kapatılamaz. Önce dağıtımı başlatın.'
    );
  }
  return fail('INVALID_STATE', 'Sefer bu durumda kapatılamaz.');
}

export interface ExpectedValueResult extends DispatchRuleResult {
  current?: number;
}

// Mutlak bakiye yazımı, çağıranın gördüğü değerin hâlâ güncel olduğunu
// doğrular. Eşzamanlı bir teslimat bakiyeyi değiştirdiyse yazım reddedilir.
export function compareExpectedBalance(
  current: number | null | undefined,
  expected: number | null | undefined
): ExpectedValueResult {
  if (expected === null || expected === undefined || !Number.isFinite(Number(expected))) {
    return fail('EXPECTATION_REQUIRED', 'Bakiye güncellemesi için beklenen güncel değer zorunludur.');
  }
  const currentNum = Number(current) || 0;
  if (Math.abs(currentNum - Number(expected)) > 0.005) {
    return {
      ...fail('BALANCE_CONFLICT', 'Müşteri bakiyesi bu sırada değişti. Sayfayı yenileyip tekrar deneyin.'),
      current: currentNum,
    };
  }
  return { ok: true, current: currentNum };
}

// ---------------------------------------------------------------------------
// Sonlandırılmamış (açık kalmış) sefer tespiti — AGENTS.md Bölüm 9.1
// ---------------------------------------------------------------------------
// Tarih alanı YYYY-MM-DD biçiminde olduğundan düz metin karşılaştırması
// kronolojik karşılaştırmayla aynı sonucu verir. Bugünün açık seferi "eski"
// sayılmaz; kapatılmış seferler hiçbir zaman uyarı üretmez.

export interface StaleDispatchCandidate {
  date: string;
  driverId: string;
  status: string;
}

export function isStaleDispatch(
  dispatch: StaleDispatchCandidate | null | undefined,
  todayStr: string
): boolean {
  if (!dispatch) return false;
  return dispatch.status !== 'completed' && dispatch.date < todayStr;
}

// Şoförün tarihi geçmiş ve hâlâ açık olan en eski seferini döndürür.
// Birden fazla açık sefer varsa en eskisi önceliklidir; yoksa null.
export function findStaleOpenDispatch<T extends StaleDispatchCandidate>(
  dispatches: T[],
  driverId: string,
  todayStr: string
): T | null {
  let oldest: T | null = null;
  for (const dispatch of dispatches) {
    if (dispatch.driverId !== driverId) continue;
    if (!isStaleDispatch(dispatch, todayStr)) continue;
    if (!oldest || dispatch.date < oldest.date) oldest = dispatch;
  }
  return oldest;
}

// Yönetici görünümü için: tüm şoförler arasında en eski açık kalmış sefer.
export function findOldestStaleOpenDispatch<T extends StaleDispatchCandidate>(
  dispatches: T[],
  todayStr: string
): T | null {
  let oldest: T | null = null;
  for (const dispatch of dispatches) {
    if (!isStaleDispatch(dispatch, todayStr)) continue;
    if (!oldest || dispatch.date < oldest.date) oldest = dispatch;
  }
  return oldest;
}

export function compareExpectedQuantity(
  current: number | null | undefined,
  expected: number | null | undefined,
  code: 'EMPTY_CONFLICT' | 'BALANCE_CONFLICT' = 'EMPTY_CONFLICT'
): ExpectedValueResult {
  if (expected === null || expected === undefined || !Number.isInteger(Number(expected))) {
    return fail('EXPECTATION_REQUIRED', 'Boş kap güncellemesi için beklenen güncel değer zorunludur.');
  }
  const currentNum = Number(current) || 0;
  if (currentNum !== Number(expected)) {
    return {
      ...fail(code, 'Boş kap bakiyesi bu sırada değişti. Sayfayı yenileyip tekrar deneyin.'),
      current: currentNum,
    };
  }
  return { ok: true, current: currentNum };
}
