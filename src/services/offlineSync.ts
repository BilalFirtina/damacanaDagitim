// Çevrimdışı teslimat kuyruğu için saf (yan etkisiz) yardımcılar.
// Bu modül bilerek window/localStorage'a dokunmaz; testlerde doğrudan
// içe aktarılabilir.

import type { Delivery } from '../types';

export const DISPATCH_CLOSED_CODE = 'DISPATCH_CLOSED';
export const ID_CONFLICT_CODE = 'ID_CONFLICT';

export type DeliverySyncAction = 'synced' | 'conflict' | 'pending';

export interface DeliverySyncErrorBody {
  error?: string;
  code?: string;
}

export interface DeliverySyncClassification {
  action: DeliverySyncAction;
  retain: boolean;
  errorCode?: string;
  errorMessage?: string;
}

// Sefer yeni teslimat kabul ediyor mu?
// Yalnızca hazırlık/dağıtım durumları kabul edilir; kapatılmış sefer reddedilir.
export function isDispatchOpenForDelivery(status: string | null | undefined): boolean {
  return status === 'pending_confirmation' || status === 'in_transit';
}

// Sunucu yanıtını kuyruk davranışına çevirir.
// 2xx -> kuyruktan çıkar; 409 ve diğer 4xx -> çakışma olarak SAKLA;
// 5xx/ağ -> beklemede olarak SAKLA. Hiçbir durumda sessizce silinmez.
export function classifyDeliverySyncResponse(
  status: number,
  body?: DeliverySyncErrorBody | null
): DeliverySyncClassification {
  if (status >= 200 && status < 300) {
    return { action: 'synced', retain: false };
  }

  const code = body?.code;
  const message = body?.error;

  // Oturum süresi/geçersiz token geçici bir durumdur; kayıt "pending" kalır.
  if (status === 401) {
    return {
      action: 'pending',
      retain: true,
      errorCode: code || 'AUTH_REQUIRED',
      errorMessage: message || 'Oturum yenilenmeli; kayıt kuyrukta tutuluyor.',
    };
  }

  if (status === 409) {
    return {
      action: 'conflict',
      retain: true,
      errorCode: code || 'CONFLICT',
      errorMessage: message || 'Kayıt çakışması nedeniyle uygulanamadı.',
    };
  }

  // 408 (istek zaman aşımı), 425 (çok erken) ve 429 (hız sınırı) kalıcı
  // red değildir; kayıt çakışma olarak işaretlenmeden beklemede tutulur.
  if (status === 408 || status === 425 || status === 429) {
    return {
      action: 'pending',
      retain: true,
      errorCode: code || `HTTP_${status}`,
      errorMessage: message || 'Sunucu isteği geçici olarak kabul edemedi; kayıt kuyrukta tutuluyor.',
    };
  }

  if (status >= 400 && status < 500) {
    return {
      action: 'conflict',
      retain: true,
      errorCode: code || `HTTP_${status}`,
      errorMessage: message || 'Kayıt sunucu tarafından reddedildi.',
    };
  }

  return {
    action: 'pending',
    retain: true,
    errorCode: code || `HTTP_${status}`,
    errorMessage: message || 'Sunucuya ulaşılamadı; kayıt kuyrukta tutuluyor.',
  };
}

export function isConflictQueueItem(item: any): boolean {
  return item?.syncStatus === 'conflict';
}

// Otomatik senkron çakışmaları atlar; açık kullanıcı eylemi (includeConflicts)
// ile yeniden denenebilir.
export function shouldAttemptSync(item: any, includeConflicts: boolean): boolean {
  return includeConflicts || !isConflictQueueItem(item);
}

// Senkron sonrası kuyruk kaydının yeni hâli. `null` yalnızca sunucu kaydı
// başarıyla kabul ettiğinde döner; diğer tüm durumlarda kayıt KORUNUR.
export function buildQueueItemAfterSync(
  item: any,
  classification: DeliverySyncClassification,
  attemptedAt: string = new Date().toISOString()
): any | null {
  if (classification.action === 'synced' || !classification.retain) return null;

  return {
    ...item,
    syncStatus: classification.action,
    errorCode: classification.errorCode,
    lastError: classification.errorMessage,
    lastAttemptAt: attemptedAt,
  };
}

// Kuyruk kimliği sunucu tarafından kabul edilen kararlı biçimde mi?
export function isValidQueueId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 100 &&
    /^(del_|offline_)[A-Za-z0-9_-]+$/.test(id)
  );
}

// Eski kuyruk kayıtlarında kimlik eksik/geçersizse kalıcı bir kimlik atar.
// Atama sunucuya göndermeden ÖNCE yapılır; böylece yeniden denemeler aynı
// kimliği kullanır ve çift kayıt oluşmaz.
export function assignMissingQueueIds(
  queue: any[],
  genId: () => string
): { queue: any[]; changed: boolean } {
  const source = Array.isArray(queue) ? queue : [];
  const used = new Set(source.map((item) => item?.id).filter(isValidQueueId));
  let changed = false;

  const next = source.map((item) => {
    // Boş olmayan bir kimlik KORUNUR. Aynı kimlikle gelen kayıtlar sunucuda
    // içerik karşılaştırmasına girer: aynı içerik idempotent başarı, farklı
    // içerik 409 ID_CONFLICT olur. Burada yeni kimlik atamak, aynı teslimatın
    // iki kez borçlandırılmasına yol açabilir.
    if (item && typeof item.id === 'string' && item.id.length > 0) return item;
    let id = genId();
    let guard = 0;
    while (used.has(id) && guard++ < 20) id = genId();
    used.add(id);
    changed = true;
    return { ...(item || {}), id };
  });

  return { queue: next, changed };
}

function roundMoney(value: unknown): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeEmpties(value: any): { damacana: number; camDamacana: number; tup: number } {
  return {
    damacana: Number(value?.damacana) || 0,
    camDamacana: Number(value?.camDamacana ?? value?.cam_damacana) || 0,
    tup: Number(value?.tup) || 0,
  };
}

// Aynı teslimat kimliğiyle gelen isteğin içeriğini karşılaştırmak için
// kanonik (sıra/ biçim bağımsız) bir gösterim üretir. Zaman damgası, çevrimdışı
// bayrağı ve görünen adlar bilerek dışarıda bırakılır; bunlar iş anlamı taşımaz.
export function canonicalDeliveryPayload(del: Partial<Delivery> | any): string {
  const items = (Array.isArray(del?.deliveredItems) ? del.deliveredItems : [])
    .map((item: any) => ({
      productId: String(item?.productId || ''),
      quantity: Number(item?.quantity) || 0,
      unitPrice: roundMoney(item?.unitPrice),
      lineTotal: roundMoney(item?.lineTotal),
    }))
    .sort(
      (a: any, b: any) =>
        a.productId.localeCompare(b.productId) ||
        a.unitPrice - b.unitPrice ||
        a.quantity - b.quantity
    );

  const payment = del?.collectedPayment || {};

  return JSON.stringify({
    dispatchId: String(del?.dispatchId || ''),
    driverId: String(del?.driverId || ''),
    customerId: String(del?.customerId || ''),
    deliveredGrandTotal: roundMoney(del?.deliveredGrandTotal),
    items,
    payment: {
      method: payment.method || 'UNPAID',
      cashAmount: roundMoney(payment.cashAmount),
      posAmount: roundMoney(payment.posAmount),
      totalCollected: roundMoney(payment.totalCollected),
      status: payment.status || 'unpaid',
      diffUncollected: roundMoney(payment.diffUncollected),
    },
    emptiesReceived: normalizeEmpties(del?.emptyContainersReceived),
    emptiesDiff: normalizeEmpties(del?.emptyContainersDiff),
    notes: typeof del?.notes === 'string' ? del.notes.trim() : '',
  });
}

export function deliveryPayloadsMatch(a: Partial<Delivery> | any, b: Partial<Delivery> | any): boolean {
  return canonicalDeliveryPayload(a) === canonicalDeliveryPayload(b);
}

export interface ReopenValidationInput {
  role?: string | null;
  reason?: string | null;
}

export interface ReopenValidationResult {
  ok: boolean;
  errorCode?: 'NOT_AUTHORIZED' | 'REASON_REQUIRED';
  reason?: string;
}

// Sunucu uç noktası ve testler için ortak yeniden açma doğrulaması.
// Gerçek yetki ayrıca requireAdmin middleware'i ve DB fonksiyonu tarafından
// uygulanır; burada yalnızca erken/tek tip doğrulama yapılır.
export function validateReopenRequest(input: ReopenValidationInput): ReopenValidationResult {
  if (input.role !== 'admin') {
    return { ok: false, errorCode: 'NOT_AUTHORIZED' };
  }
  const reason = (input.reason || '').trim();
  if (reason.length < 3) {
    return { ok: false, errorCode: 'REASON_REQUIRED' };
  }
  return { ok: true, reason };
}
