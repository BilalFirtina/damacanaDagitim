// Sefer durum geçişleri ve mutlak müşteri bakiyesi yazımları için saf
// (yan etkisiz) iş kuralları. Sunucu bu yardımcıları kullanır; testler de
// doğrudan içe aktarır.

import type { DispatchStatus, LoadedItem } from '../types';

export const DISPATCH_ALLOWED_UPDATE_FIELDS = ['loadedItems'] as const;

export type DispatchRuleCode =
  | 'NOT_AUTHORIZED'
  | 'INVALID_STATE'
  | 'DISPATCH_ALREADY_COMPLETED'
  | 'DISPATCH_CLOSED'
  | 'FORBIDDEN_FIELD'
  | 'NO_FIELDS'
  | 'INVALID_LOAD_ITEMS'
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
  canLoadVehicle?: boolean;
  status: DispatchStatus | string;
}

export interface DispatchUpdateResult extends DispatchRuleResult<{ loadedItems: LoadedItem[] }> {
  updates?: { loadedItems: LoadedItem[] };
}

function fail<T>(errorCode: DispatchRuleCode, message: string): DispatchRuleResult<T> {
  return { ok: false, errorCode, message };
}

// PUT /api/dispatches/:id yalnızca yükleme kalemlerini değiştirebilir.
// Durum, mutabakat ve kapatan kullanıcı alanları bu uçtan ASLA yazılamaz.
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

  if (ctx.status === 'completed') {
    return fail(
      'DISPATCH_ALREADY_COMPLETED',
      'Kapatılmış sefer değiştirilemez. Yönetici seferi yeniden açmalıdır.'
    );
  }

  if (ctx.status !== 'pending_confirmation') {
    return fail(
      'INVALID_STATE',
      'Yükleme kalemleri yalnızca şoför onayından önce değiştirilebilir.'
    );
  }

  if (!(ctx.role === 'admin' || ctx.canLoadVehicle)) {
    return fail('NOT_AUTHORIZED', 'Bu seferin yükleme kalemlerini değiştirme yetkiniz yok.');
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

export function validateReopenTransition(status: string): TransitionResult {
  if (status === 'completed') return { ok: true };
  return fail('INVALID_STATE', 'Yalnızca kapatılmış seferler yeniden açılabilir.');
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
