import {
  User,
  Product,
  Customer,
  Dispatch,
  Delivery,
  ProductCategoryInfo,
  CleanupStatus,
  DatabaseStatus,
  PaymentStatus,
} from '../types';
import {
  classifyDeliverySyncResponse,
  isConflictQueueItem,
  shouldAttemptSync,
  buildQueueItemAfterSync,
  assignMissingQueueIds,
  DeliverySyncClassification,
} from './offlineSync';

const OFFLINE_QUEUE_KEY = 'sudagitim_offline_deliveries_queue';
// Şema yenilendiğinde eski (geçersiz ürün ID'li) önbellek dışlanır.
const CACHED_DATA_KEY = 'sudagitim_cached_local_data_v2';
const AUTH_TOKEN_KEY = 'sudagitim_auth_token';

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null) {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {}
}

const nativeFetch = window.fetch.bind(window);

async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await nativeFetch(input, { ...init, headers });

  if (res.status === 401 && token) {
    setAuthToken(null);
    try {
      window.dispatchEvent(new CustomEvent('auth_expired'));
    } catch {}
  }
  return res;
}

// Sunucunun Türkçe hata mesajını ve işlem kodunu koruyarak hata üretir.
async function throwServerError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  const error: any = new Error(data.error || fallback);
  error.code = data.code;
  error.details = data.details;
  throw error;
}

// Helper to manage offline queue
export function getOfflineQueue(): any[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveOfflineQueue(queue: any[]) {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('Failed to save offline queue', e);
  }
}

let queueIdCounter = 0;

function makeQueueId(): string {
  queueIdCounter = (queueIdCounter + 1) % 1_000_000;
  return `offline_${Date.now()}_${queueIdCounter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export function saveCache(key: string, data: any) {
  try {
    const existing = localStorage.getItem(CACHED_DATA_KEY);
    const parsed = existing ? JSON.parse(existing) : {};
    parsed[key] = { data, timestamp: Date.now() };
    localStorage.setItem(CACHED_DATA_KEY, JSON.stringify(parsed));
  } catch {}
}

export function getCache(key: string): any | null {
  try {
    const existing = localStorage.getItem(CACHED_DATA_KEY);
    if (!existing) return null;
    const parsed = JSON.parse(existing);
    return parsed[key]?.data || null;
  } catch {
    return null;
  }
}

// REST API Methods
export async function loginUser(username: string, pin: string): Promise<User> {
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, pin }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Hatalı kullanıcı adı veya şifre');
  }
  const json = await res.json();
  if (json.token) setAuthToken(json.token);
  return json.user;
}

export async function logoutUser(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {}
  setAuthToken(null);
}

export async function fetchUsers(): Promise<User[]> {
  try {
    const res = await apiFetch('/api/users');
    if (!res.ok) throw new Error('Kullanıcılar alınamadı');
    const json = await res.json();
    saveCache('users', json.users);
    return json.users;
  } catch (err) {
    const cached = getCache('users');
    if (cached) return cached;
    throw err;
  }
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User> {
  const res = await apiFetch(`/api/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Kullanıcı güncellenemedi');
  const json = await res.json();
  return json.user;
}

export async function fetchProducts(): Promise<Product[]> {
  try {
    const res = await apiFetch('/api/products');
    if (!res.ok) throw new Error('Ürünler alınamadı');
    const json = await res.json();
    saveCache('products', json.products);
    return json.products;
  } catch (err) {
    const cached = getCache('products');
    if (cached) return cached;
    throw err;
  }
}

export async function fetchCategories(): Promise<ProductCategoryInfo[]> {
  try {
    const res = await apiFetch('/api/product-categories');
    if (!res.ok) throw new Error('Kategoriler alınamadı');
    const json = await res.json();
    saveCache('categories', json.categories);
    return json.categories;
  } catch (err) {
    const cached = getCache('categories');
    if (cached) return cached;
    throw err;
  }
}

export async function updateProduct(id: string, updates: Partial<Product>): Promise<Product> {
  const res = await apiFetch(`/api/products/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Ürün güncellenemedi');
  const json = await res.json();
  return json.product;
}

export async function createProduct(product: Partial<Product>): Promise<Product> {
  const res = await apiFetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(product),
  });
  if (!res.ok) throw new Error('Ürün oluşturulamadı');
  const json = await res.json();
  return json.product;
}

export async function deleteProduct(id: string): Promise<boolean> {
  const res = await apiFetch(`/api/products/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Ürün silinemedi');
  return true;
}

export async function fetchCustomers(): Promise<Customer[]> {
  try {
    const res = await apiFetch('/api/customers');
    if (!res.ok) throw new Error('Müşteriler alınamadı');
    const json = await res.json();
    saveCache('customers', json.customers);
    return json.customers;
  } catch (err) {
    const cached = getCache('customers');
    if (cached) return cached;
    throw err;
  }
}

export async function createCustomer(customer: Partial<Customer>): Promise<Customer> {
  const res = await apiFetch('/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(customer),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Müşteri oluşturulamadı');
  }
  const json = await res.json();
  return json.customer;
}

export type CustomerUpdate = Partial<Customer> & {
  expectedBalanceTL?: number;
  expectedEmptyDepositBalance?: Customer['emptyDepositBalance'];
};

export async function updateCustomer(id: string, updates: CustomerUpdate): Promise<Customer> {
  const res = await apiFetch(`/api/customers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const error: any = new Error(errData.error || 'Müşteri güncellenemedi');
    error.code = errData.code;
    error.details = errData.details;
    throw error;
  }
  const json = await res.json();
  return json.customer;
}

export async function fetchDispatches(date?: string): Promise<Dispatch[]> {
  try {
    const url = date ? `/api/dispatches?date=${encodeURIComponent(date)}` : '/api/dispatches';
    const res = await apiFetch(url);
    if (!res.ok) throw new Error('Seferler alınamadı');
    const json = await res.json();
    saveCache(`dispatches_${date || 'all'}`, json.dispatches);
    return json.dispatches;
  } catch (err) {
    const cached = getCache(`dispatches_${date || 'all'}`);
    if (cached) return cached;
    throw err;
  }
}

export async function createDispatch(dispatch: Partial<Dispatch> & { loadedByUserId: string; loadedByUserName: string; driverConfirmed?: boolean }): Promise<Dispatch> {
  const res = await apiFetch('/api/dispatches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dispatch),
  });
  if (!res.ok) throw new Error('Yükleme oluşturulamadı');
  const json = await res.json();
  return json.dispatch;
}

export async function updateDispatch(id: string, updates: Partial<Dispatch>): Promise<Dispatch> {
  const res = await apiFetch(`/api/dispatches/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) await throwServerError(res, 'Sefer güncellenemedi');
  const json = await res.json();
  return json.dispatch;
}

export async function confirmDispatch(id: string): Promise<Dispatch> {
  const res = await apiFetch(`/api/dispatches/${id}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) await throwServerError(res, 'Sefer teslim alma onayı verilemedi');
  const json = await res.json();
  return json.dispatch;
}

export async function closeDispatch(id: string, reconciliationData: any): Promise<Dispatch> {
  const res = await apiFetch(`/api/dispatches/${id}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reconciliationData),
  });
  if (!res.ok) await throwServerError(res, 'Gün sonu mutabakatı kapatılamadı');
  const json = await res.json();
  return json.dispatch;
}

export async function reopenDispatch(
  id: string,
  reason: string
): Promise<{ reopened: boolean; code?: string; dispatch: Dispatch | null }> {
  const res = await apiFetch(`/api/dispatches/${id}/reopen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) await throwServerError(res, 'Sefer yeniden açılamadı');
  return res.json();
}

export async function fetchDeliveries(params?: { dispatchId?: string; driverId?: string; date?: string }): Promise<Delivery[]> {
  try {
    const query = new URLSearchParams();
    if (params?.dispatchId) query.set('dispatchId', params.dispatchId);
    if (params?.driverId) query.set('driverId', params.driverId);
    if (params?.date) query.set('date', params.date);

    const res = await apiFetch(`/api/deliveries?${query.toString()}`);
    if (!res.ok) throw new Error('Teslimatlar alınamadı');
    const json = await res.json();
    saveCache('deliveries_latest', json.deliveries);
    return json.deliveries;
  } catch (err) {
    const cached = getCache('deliveries_latest');
    if (cached) return cached;
    throw err;
  }
}

// Build a complete Delivery shape from full or partial input so every UI
// component can safely read totals/payments without crashing.
export function normalizeDelivery(deliveryData: any, forceOffline = false): Delivery {
  const items = Array.isArray(deliveryData.deliveredItems) ? deliveryData.deliveredItems : [];
  const deliveredGrandTotal =
    typeof deliveryData.deliveredGrandTotal === 'number'
      ? deliveryData.deliveredGrandTotal
      : items.reduce((sum: number, it: any) => sum + (Number(it?.lineTotal) || 0), 0);

  const cp = deliveryData.collectedPayment || {};
  const cashAmount = Number(cp.cashAmount) || 0;
  const posAmount = Number(cp.posAmount) || 0;
  const totalCollected = Number(cp.totalCollected) || cashAmount + posAmount;
  const diffUncollected = deliveredGrandTotal - totalCollected;

  let status: PaymentStatus = 'unpaid';
  if (totalCollected >= deliveredGrandTotal && deliveredGrandTotal > 0) {
    status = totalCollected > deliveredGrandTotal ? 'overpaid' : 'paid_full';
  } else if (totalCollected > 0) {
    status = 'partial';
  }

  const emptyRecv = deliveryData.emptyContainersReceived || { damacana: 0, camDamacana: 0, tup: 0 };

  return {
    id:
      deliveryData.id ||
      `offline_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    dispatchId: deliveryData.dispatchId,
    driverId: deliveryData.driverId,
    driverName: deliveryData.driverName || '',
    vehiclePlate: deliveryData.vehiclePlate || '',
    customerId: deliveryData.customerId,
    customerName: deliveryData.customerName || 'Bilinmeyen Müşteri',
    customerAddress: deliveryData.customerAddress || '',
    customerPhone: deliveryData.customerPhone || '',
    timestamp: deliveryData.timestamp || new Date().toISOString(),
    deliveredItems: items,
    deliveredGrandTotal,
    collectedPayment: {
      method:
        cp.method ||
        (cashAmount > 0 && posAmount > 0 ? 'MIXED' : posAmount > 0 ? 'POS' : cashAmount > 0 ? 'CASH' : 'UNPAID'),
      cashAmount,
      posAmount,
      totalCollected,
      status,
      diffUncollected,
    },
    emptyContainersReceived: {
      damacana: Number(emptyRecv.damacana) || 0,
      camDamacana: Number(emptyRecv.camDamacana) || 0,
      tup: Number(emptyRecv.tup) || 0,
    },
    emptyContainersDiff: deliveryData.emptyContainersDiff || { damacana: 0, camDamacana: 0, tup: 0 },
    notes: deliveryData.notes || '',
    isOfflineSync: forceOffline || Boolean(deliveryData.isOfflineSync),
  };
}

export async function createDelivery(deliveryData: any): Promise<{ delivery: Delivery; updatedCustomer: Customer }> {
  // Tekrarlanan isteklerde (retry/çevrimdışı senkron) AYNI kimliğin kullanılması
  // için istemci tarafında kararlı bir teslimat ID'si üretilir. Sunucu bu ID'yi
  // kullanarak çift kaydı ve çift bakiye uygulamasını engeller.
  const clientId: string =
    typeof deliveryData?.id === 'string' && deliveryData.id
      ? deliveryData.id
      : `del_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const payload = { ...deliveryData, id: clientId };

  // If browser is offline, queue locally
  if (!navigator.onLine) {
    const queue = getOfflineQueue();
    const offlineDelivery = normalizeDelivery(payload, true);
    queue.push({
      ...offlineDelivery,
      syncStatus: 'pending',
      queuedAt: new Date().toISOString(),
    });
    saveOfflineQueue(queue);

    // Mock response for offline UI
    return {
      delivery: offlineDelivery,
      updatedCustomer: {} as Customer,
    };
  }

  try {
    const res = await apiFetch('/api/deliveries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const httpErr: any = new Error(errData.error || 'Teslimat kaydedilemedi');
      httpErr.isHttpError = true;
      throw httpErr;
    }
    const json = await res.json();
    return json;
  } catch (err: any) {
    // Sunucu kaydı reddettiyse (doğrulama/yetki) kuyruğa alma, hatayı göster
    if (err?.isHttpError) throw err;

    // Yalnızca ağ hatasında çevrimdışı kuyruğa al
    const queue = getOfflineQueue();
    const offlineDelivery = normalizeDelivery(payload, true);
    queue.push({
      ...offlineDelivery,
      syncStatus: 'pending',
      queuedAt: new Date().toISOString(),
    });
    saveOfflineQueue(queue);

    return {
      delivery: offlineDelivery,
      updatedCustomer: {} as Customer,
    };
  }
}

export interface OfflineSyncSummary {
  synced: number;
  conflicts: number;
  pending: number;
}

// Drain and sync queued offline deliveries.
// includeConflicts=false: otomatik senkron; çakışmalar atlanır (silinmez).
// includeConflicts=true: kullanıcı "Şimdi Eşitle" derse çakışmalar da denenir
// (sefer yönetici tarafından yeniden açıldıktan sonra).
export async function syncOfflineDeliveries(includeConflicts = false): Promise<OfflineSyncSummary> {
  // Eski kuyruk kayıtlarında kimlik yoksa/geçersizse kalıcı kimlik ata.
  // Atama, çevrimdışıyken de yapılır; böylece sonraki denemeler aynı kimliği
  // kullanır ve sunucuda çift kayıt oluşmaz.
  const assigned = assignMissingQueueIds(getOfflineQueue(), makeQueueId);
  if (assigned.changed) saveOfflineQueue(assigned.queue);
  const queue = assigned.queue;

  if (!navigator.onLine) {
    return {
      synced: 0,
      conflicts: queue.filter(isConflictQueueItem).length,
      pending: queue.filter((item) => !isConflictQueueItem(item)).length,
    };
  }

  if (queue.length === 0) return { synced: 0, conflicts: 0, pending: 0 };

  let synced = 0;
  let conflicts = 0;
  let pending = 0;
  const remaining: any[] = [];

  for (const item of queue) {
    // Otomatik senkron çakışmaları tekrar tekrar denemez; kayıt korunur.
    if (!shouldAttemptSync(item, includeConflicts)) {
      remaining.push(item);
      conflicts++;
      continue;
    }

    let classification: DeliverySyncClassification;
    try {
      const res = await apiFetch('/api/deliveries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, isOfflineSync: true }),
      });
      let body: any = null;
      if (!res.ok) {
        body = await res.json().catch(() => null);
      }
      classification = classifyDeliverySyncResponse(res.status, body);
    } catch {
      classification = {
        action: 'pending',
        retain: true,
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'Ağ hatası; kayıt kuyrukta tutuluyor.',
      };
    }

    if (classification.action === 'synced') {
      synced++;
      continue;
    }

    // Reddedilen kayıt ASLA sessizce silinmez; durumu ve son hatası saklanır.
    const retained = buildQueueItemAfterSync(item, classification);
    if (retained) {
      remaining.push(retained);
      if (classification.action === 'conflict') conflicts++;
      else pending++;
    }
  }

  saveOfflineQueue(remaining);
  return { synced, conflicts, pending };
}

export async function fetchDailyReport(date?: string, driverId?: string): Promise<any> {
  const query = new URLSearchParams();
  if (date) query.set('date', date);
  if (driverId && driverId !== 'all') query.set('driverId', driverId);

  const res = await apiFetch(`/api/reports/daily?${query.toString()}`);
  if (!res.ok) throw new Error('Günlük rapor alınamadı');
  return res.json();
}

export async function fetchCleanupStatus(): Promise<CleanupStatus> {
  const res = await apiFetch('/api/cleanup/status');
  if (!res.ok) throw new Error('Temizlik durumu alınamadı');
  return res.json();
}

export async function triggerManualCleanup(): Promise<any> {
  const res = await apiFetch('/api/cleanup/trigger', { method: 'POST' });
  if (!res.ok) {
    let message = 'Temizleme tetiklenemedi';
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* yanıt gövdesi yoksa varsayılan mesaj kullanılır */
    }
    throw new Error(message);
  }
  return res.json();
}

export async function fetchDatabaseStatus(): Promise<DatabaseStatus> {
  const res = await apiFetch('/api/database/status');
  if (!res.ok) throw new Error('Veritabanı durumu alınamadı');
  return res.json();
}

export async function triggerDatabaseSeed(): Promise<any> {
  const res = await apiFetch('/api/database/seed', { method: 'POST' });
  if (!res.ok) throw new Error('Veritabanı başlangıç kurulumu yapılamadı');
  return res.json();
}

