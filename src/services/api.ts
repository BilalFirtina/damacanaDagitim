import {
  User,
  Product,
  Customer,
  Dispatch,
  Delivery,
  CleanupStatus,
  DatabaseStatus,
} from '../types';

const OFFLINE_QUEUE_KEY = 'sudagitim_offline_deliveries_queue';
const CACHED_DATA_KEY = 'sudagitim_cached_local_data';

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
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, pin }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Hatalı kullanıcı adı veya şifre');
  }
  const json = await res.json();
  return json.user;
}

export async function fetchUsers(): Promise<User[]> {
  try {
    const res = await fetch('/api/users');
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
  const res = await fetch(`/api/users/${id}`, {
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
    const res = await fetch('/api/products');
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

export async function updateProduct(id: string, updates: Partial<Product>): Promise<Product> {
  const res = await fetch(`/api/products/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Ürün güncellenemedi');
  const json = await res.json();
  return json.product;
}

export async function createProduct(product: Partial<Product>): Promise<Product> {
  const res = await fetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(product),
  });
  if (!res.ok) throw new Error('Ürün oluşturulamadı');
  const json = await res.json();
  return json.product;
}

export async function deleteProduct(id: string): Promise<boolean> {
  const res = await fetch(`/api/products/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Ürün silinemedi');
  return true;
}

export async function fetchCustomers(): Promise<Customer[]> {
  try {
    const res = await fetch('/api/customers');
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
  const res = await fetch('/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(customer),
  });
  if (!res.ok) throw new Error('Müşteri oluşturulamadı');
  const json = await res.json();
  return json.customer;
}

export async function updateCustomer(id: string, updates: Partial<Customer>): Promise<Customer> {
  const res = await fetch(`/api/customers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Müşteri güncellenemedi');
  const json = await res.json();
  return json.customer;
}

export async function fetchDispatches(date?: string): Promise<Dispatch[]> {
  try {
    const url = date ? `/api/dispatches?date=${encodeURIComponent(date)}` : '/api/dispatches';
    const res = await fetch(url);
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
  const res = await fetch('/api/dispatches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dispatch),
  });
  if (!res.ok) throw new Error('Yükleme oluşturulamadı');
  const json = await res.json();
  return json.dispatch;
}

export async function updateDispatch(id: string, updates: Partial<Dispatch>): Promise<Dispatch> {
  const res = await fetch(`/api/dispatches/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Sefer güncellenemedi');
  const json = await res.json();
  return json.dispatch;
}

export async function confirmDispatch(id: string): Promise<Dispatch> {
  const res = await fetch(`/api/dispatches/${id}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('Sefer teslim alma onayı verilemedi');
  const json = await res.json();
  return json.dispatch;
}

export async function closeDispatch(id: string, reconciliationData: any): Promise<Dispatch> {
  const res = await fetch(`/api/dispatches/${id}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reconciliationData),
  });
  if (!res.ok) throw new Error('Gün sonu mutabakatı kapatılamadı');
  const json = await res.json();
  return json.dispatch;
}

export async function fetchDeliveries(params?: { dispatchId?: string; driverId?: string; date?: string }): Promise<Delivery[]> {
  try {
    const query = new URLSearchParams();
    if (params?.dispatchId) query.set('dispatchId', params.dispatchId);
    if (params?.driverId) query.set('driverId', params.driverId);
    if (params?.date) query.set('date', params.date);

    const res = await fetch(`/api/deliveries?${query.toString()}`);
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

export async function createDelivery(deliveryData: any): Promise<{ delivery: Delivery; updatedCustomer: Customer }> {
  // If browser is offline, queue locally
  if (!navigator.onLine) {
    const queue = getOfflineQueue();
    const offlineDelivery: any = {
      ...deliveryData,
      id: `offline_${Date.now()}`,
      timestamp: new Date().toISOString(),
      isOfflineSync: true,
    };
    queue.push(offlineDelivery);
    saveOfflineQueue(queue);

    // Mock response for offline UI
    return {
      delivery: offlineDelivery,
      updatedCustomer: {} as Customer,
    };
  }

  try {
    const res = await fetch('/api/deliveries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deliveryData),
    });
    if (!res.ok) throw new Error('Teslimat kaydedilemedi');
    const json = await res.json();
    return json;
  } catch (err) {
    // If request failed due to connectivity, fallback to queue
    const queue = getOfflineQueue();
    const offlineDelivery: any = {
      ...deliveryData,
      id: `offline_${Date.now()}`,
      timestamp: new Date().toISOString(),
      isOfflineSync: true,
    };
    queue.push(offlineDelivery);
    saveOfflineQueue(queue);

    return {
      delivery: offlineDelivery,
      updatedCustomer: {} as Customer,
    };
  }
}

// Drain and sync queued offline deliveries
export async function syncOfflineDeliveries(): Promise<number> {
  if (!navigator.onLine) return 0;
  const queue = getOfflineQueue();
  if (queue.length === 0) return 0;

  let synced = 0;
  const remaining = [];

  for (const item of queue) {
    try {
      const res = await fetch('/api/deliveries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, isOfflineSync: true }),
      });
      if (res.ok) {
        synced++;
      } else {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  saveOfflineQueue(remaining);
  return synced;
}

export async function fetchDailyReport(date?: string, driverId?: string): Promise<any> {
  const query = new URLSearchParams();
  if (date) query.set('date', date);
  if (driverId && driverId !== 'all') query.set('driverId', driverId);

  const res = await fetch(`/api/reports/daily?${query.toString()}`);
  if (!res.ok) throw new Error('Günlük rapor alınamadı');
  return res.json();
}

export async function fetchCleanupStatus(): Promise<CleanupStatus> {
  const res = await fetch('/api/cleanup/status');
  if (!res.ok) throw new Error('Temizlik durumu alınamadı');
  return res.json();
}

export async function triggerManualCleanup(): Promise<any> {
  const res = await fetch('/api/cleanup/trigger', { method: 'POST' });
  if (!res.ok) throw new Error('Temizleme tetiklenemedi');
  return res.json();
}

export async function fetchDatabaseStatus(): Promise<DatabaseStatus> {
  const res = await fetch('/api/database/status');
  if (!res.ok) throw new Error('Veritabanı durumu alınamadı');
  return res.json();
}

export async function triggerDatabaseSeed(): Promise<any> {
  const res = await fetch('/api/database/seed', { method: 'POST' });
  if (!res.ok) throw new Error('Veritabanı başlangıç kurulumu yapılamadı');
  return res.json();
}

export async function updateDatabaseConfig(cfg: { url?: string; key?: string; enabled?: boolean }): Promise<any> {
  const res = await fetch('/api/database/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Veritabanı yapılandırması güncellenemedi');
  }
  return res.json();
}

