export type UserRole = 'admin' | 'driver';

export const AUTHORIZED_VEHICLE_PLATES = ['01 FV 823', '06 GB 357', '01 AVH 886'] as const;

export interface User {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  canLoadVehicle: boolean; // Only admin or authorized lead driver can input warehouse vehicle loads
  isLeadDriver?: boolean; // Tek yetkili şoför (tüm araçlara yükleme girebilen yetkili şoför)
  title?: string; // e.g. 'İş Yeri Sahibi / Depo Yöneticisi', 'Tek Yetkili Şoför', 'Saha Dağıtım Şoförü'
  assignedPlate?: string;
  pin: string;
  phone?: string;
}

export type ProductCategory = 'damacana' | 'pet' | 'soda' | 'tup' | 'bardak' | 'sebil';
export type DepositType =
  | 'damacana'
  | 'cam_damacana'
  | 'tup'
  | 'tup_buyuk'
  | 'tup_kucuk'
  | 'sebil'
  | 'none';

export const PRODUCT_CATEGORY_ORDER: Record<ProductCategory, number> = {
  damacana: 1,
  pet: 2,
  soda: 3,
  tup: 4,
  bardak: 5,
  sebil: 6,
};

export const PRODUCT_CATEGORY_TITLES: Record<ProductCategory, string> = {
  damacana: 'Damacana Su',
  pet: 'Pet Su',
  tup: 'Tüp',
  soda: 'Maden Suyu / İçecek',
  bardak: 'Bardak & Sarf Malzeme',
  sebil: 'Su Sebili',
};

// Kategoriler veritabanından yüklenemezse (çevrimdışı/hata) kullanılacak
// varsayılan birim ve depozito kuralları. DB kayıtları bunları geçersiz kılar.
export const PRODUCT_CATEGORY_DEFAULTS: Record<
  ProductCategory,
  { unit: string; isDeposit: boolean; depositType: DepositType }
> = {
  damacana: { unit: 'Adet', isDeposit: true, depositType: 'damacana' },
  pet: { unit: 'Koli', isDeposit: false, depositType: 'none' },
  tup: { unit: 'Adet', isDeposit: true, depositType: 'tup' },
  soda: { unit: 'Koli', isDeposit: false, depositType: 'none' },
  bardak: { unit: 'Paket', isDeposit: false, depositType: 'none' },
  sebil: { unit: 'Adet', isDeposit: true, depositType: 'sebil' },
};

// Kategoriler artık veritabanındaki product_categories tablosundan beslenir.
// Veritabanı erişilemezse yukarıdaki varsayılanlar (offline/yerel) kullanılır.
export interface ProductCategoryInfo {
  code: string;
  title: string;
  order: number;
  defaultUnit?: string;
  isDeposit?: boolean;
  depositType?: string;
}

interface CategoryRegistryEntry {
  title: string;
  order: number;
  defaultUnit?: string;
  isDeposit?: boolean;
  depositType?: string;
}

const categoryRegistry: Map<string, CategoryRegistryEntry> = new Map(
  (Object.keys(PRODUCT_CATEGORY_ORDER) as ProductCategory[]).map((code) => {
    const def = PRODUCT_CATEGORY_DEFAULTS[code];
    return [
      code,
      {
        title: PRODUCT_CATEGORY_TITLES[code],
        order: PRODUCT_CATEGORY_ORDER[code],
        defaultUnit: def.unit,
        isDeposit: def.isDeposit,
        depositType: def.depositType,
      },
    ];
  })
);

// Veritabanından gelen kategori tanımlarını kaydeder (yalnızca geçerli kayıtlar kabul edilir).
export function setProductCategories(list: ProductCategoryInfo[] | undefined | null): void {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!item || typeof item.code !== 'string' || !item.code) continue;
    categoryRegistry.set(item.code, {
      title: item.title || item.code,
      order: Number.isFinite(item.order) ? Number(item.order) : 99,
      defaultUnit: item.defaultUnit,
      isDeposit: item.isDeposit,
      depositType: item.depositType,
    });
  }
}

export function getProductCategoryOrder(code: string): number {
  return categoryRegistry.get(code)?.order ?? 99;
}

export function getProductCategoryTitle(code: string): string {
  return categoryRegistry.get(code)?.title ?? code;
}

export function getProductCategoryDefaults(code: string): Pick<CategoryRegistryEntry, 'defaultUnit' | 'isDeposit' | 'depositType'> {
  return categoryRegistry.get(code) || {};
}

// Sıralı kategori kodları (veritabanı sırasına göre)
export function getProductCategoryCodes(): string[] {
  return Array.from(categoryRegistry.keys()).sort(
    (a, b) => getProductCategoryOrder(a) - getProductCategoryOrder(b)
  );
}

export function sortProductsByCategory<T extends { category: string; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const orderA = getProductCategoryOrder(a.category);
    const orderB = getProductCategoryOrder(b.category);
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name, 'tr');
  });
}

// Cam damacana, plastik damacanalardan görsel olarak ayrılır ve yükleme
// ekranlarında her zaman kategorinin en sonunda gösterilir.
export function isGlassDamacana(product: {
  category?: string;
  depositType?: string;
  name?: string;
}): boolean {
  if (!product || (product.category && product.category !== 'damacana')) return false;
  if (product.depositType === 'cam_damacana') return true;
  return normalizeProductSearch(String(product.name || '')).includes('cam damacana');
}

// Yükleme ekranı sıralaması: kategori içinde cam damacana en sonda,
// diğer ürünler Türkçe ada göre alfabetik.
export function sortProductsForLoading<
  T extends { category: string; name: string; depositType?: string }
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const orderA = getProductCategoryOrder(a.category);
    const orderB = getProductCategoryOrder(b.category);
    if (orderA !== orderB) return orderA - orderB;
    if (a.category === 'damacana') {
      const glassA = isGlassDamacana(a) ? 1 : 0;
      const glassB = isGlassDamacana(b) ? 1 : 0;
      if (glassA !== glassB) return glassA - glassB;
    }
    return a.name.localeCompare(b.name, 'tr');
  });
}

export interface ProductCategoryGroup<T> {
  code: string;
  title: string;
  order: number;
  products: T[];
}

// Ürünleri kategori sırasına göre gruplar. Boş kategoriler dönmez.
// İsteğe bağlı sıralayıcı ile ekranlara özel ürün sırası uygulanabilir.
export function groupProductsByCategory<T extends { category: string; name: string }>(
  items: T[],
  sorter?: (items: T[]) => T[]
): ProductCategoryGroup<T>[] {
  const groups = new Map<string, ProductCategoryGroup<T>>();
  const sorted = sorter ? sorter(items) : sortProductsByCategory(items);
  for (const product of sorted) {
    const code = product.category || 'none';
    let group = groups.get(code);
    if (!group) {
      group = {
        code,
        title: getProductCategoryTitle(code),
        order: getProductCategoryOrder(code),
        products: [],
      };
      groups.set(code, group);
    }
    group.products.push(product);
  }
  return Array.from(groups.values()).sort((a, b) => a.order - b.order);
}

// Türkçe büyük/küçük harf uyumlu arama için ortak normalizasyon.
export function normalizeProductSearch(value: string): string {
  return String(value || '').toLocaleLowerCase('tr-TR').trim();
}

export function filterProductsBySearch<T extends { category: string; name: string }>(
  items: T[],
  search: string
): T[] {
  const term = normalizeProductSearch(search);
  if (!term) return [...items];
  return items.filter((product) => {
    const name = normalizeProductSearch(product.name);
    const code = normalizeProductSearch(product.category);
    const title = normalizeProductSearch(getProductCategoryTitle(product.category));
    return name.includes(term) || code.includes(term) || title.includes(term);
  });
}

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  defaultUnitPrice: number;
  isDeposit: boolean;
  depositType: DepositType;
  unit: string;
  description?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  emails?: string[]; // Multiple email addresses for e-invoices, statements and accounting
  isAccountCustomer: boolean; // Managers decide whether unpaid amounts become customer balance
  currentBalanceTL: number; // Positive = Customer owes us (debt), Negative = Customer prepayment
  emptyDepositBalance: {
    damacana: number; // Plastik / polikarbon damacana
    camDamacana: number; // Cam damacana
    tup: number; // Eski tek tüp türü (geriye dönük okuma)
    tupBuyuk?: number; // Büyük tüp (12 kg) boş bakiyesi
    tupKucuk?: number; // Küçük tüp (2 kg) boş bakiyesi
    sebil?: number; // Ücretsiz emanet su sebili (adet)
    cam_damacana?: number;
  };
  customPrices: Record<string, number>; // Product ID -> agreed custom unit price
  notes?: string;
  createdDate: string;
}

export interface CustomerDispenser {
  id: string;
  customerId: string;
  brand: string;
  model: string;
  quantity: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  updatedByUserId: string;
  updatedByUserName: string;
}

export interface CustomerDispenserInput {
  brand: string;
  model: string;
  quantity: number;
  note?: string | null;
}

export interface LoadedItem {
  productId: string;
  quantity: number;
}

export type DispatchStatus = 'pending_confirmation' | 'in_transit' | 'completed';

export interface EndOfDayReconciliation {
  closedAt: string;
  closedByUserId: string;
  closedByUserName: string;
  remainingFullCounted: Record<string, number>; // Product ID -> physically counted count
  remainingFullExpected: Record<string, number>; // Product ID -> (loaded - delivered)
  collectedEmptyDamacana: number; // Empty standard carboys to drop at warehouse
  collectedEmptyCamDamacana?: number; // Empty glass jugs to drop at warehouse
  collectedEmptyTup: number; // Empty gas cylinders to drop at warehouse
  collectedEmptySebil?: number; // Emanet su sebilleri toplanan adet
  actualCashInPocket: number; // Actual physical cash driver turns in
  actualPosSlipsTotal: number; // Total sum of credit card slips
  totalDeliveredValue: number;
  totalCashCollected: number;
  totalPosCollected: number;
  totalCreditAdded: number; // Amount deferred to customer account balances
  notes?: string;
}

export interface Dispatch {
  id: string;
  date: string; // YYYY-MM-DD
  driverId: string;
  driverName: string;
  vehiclePlate: string;
  loadedByUserId: string;
  loadedByUserName: string;
  driverConfirmedAt: string | null; // null if pending driver count inspection
  status: DispatchStatus;
  loadedItems: LoadedItem[];
  endOfDayReconciliation?: EndOfDayReconciliation;
  createdAt: string;
  /** Yükleme düzeltme/iptal uygunluğu için okuma modeli alanları. */
  hasActiveDeliveries?: boolean;
  hasLinkedPayments?: boolean;
}

export interface DeliveryItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export type PaymentMethod = 'CASH' | 'POS' | 'MIXED' | 'UNPAID';
export type PaymentStatus = 'paid_full' | 'partial' | 'unpaid' | 'overpaid';

export interface CollectedPayment {
  method: PaymentMethod;
  cashAmount: number;
  posAmount: number;
  totalCollected: number;
  status: PaymentStatus;
  diffUncollected: number; // (deliveredGrandTotal - totalCollected). Positive means customer has unpaid debt.
}

export interface Delivery {
  id: string;
  dispatchId: string;
  driverId: string;
  driverName: string;
  vehiclePlate: string;
  customerId: string;
  /** Listeleme/raporlarda faturalı müşteri tutarlarını gizlemek için taşınır. */
  isAccountCustomer?: boolean;
  customerName: string;
  customerAddress: string;
  customerPhone?: string;
  timestamp: string; // ISO string
  deliveredItems: DeliveryItem[];
  deliveredGrandTotal: number;
  collectedPayment: CollectedPayment;
  emptyContainersReceived: {
    damacana: number;
    camDamacana?: number;
    cam_damacana?: number;
    tup: number; // Eski tek tüp türü (geriye dönük okuma)
    tupBuyuk?: number;
    tupKucuk?: number;
    sebil?: number;
  };
  emptyContainersDiff: {
    damacana: number; // delivered deposit items - received empty containers
    camDamacana?: number;
    cam_damacana?: number;
    tup: number; // Eski tek tüp türü (geriye dönük okuma)
    tupBuyuk?: number;
    tupKucuk?: number;
    sebil?: number;
  };
  notes?: string;
  isOfflineSync?: boolean;
  /** Rapor, teslimatın yükleme gününden farklı bir güne kaldığını işaretler. */
  isLateDelivery?: boolean;
  status?: 'active' | 'cancelled';
  cancelledAt?: string | null;
  cancelledByUserId?: string | null;
  cancelledByUserName?: string | null;
  cancelReason?: string | null;
  replacedByDeliveryId?: string | null;
}

export interface CleanupStatus {
  totalDispatches: number;
  totalDeliveries: number;
  oldestRecordDate: string | null;
  retentionDays: number;
  thresholdDate: string;
  purgedCountLastRun: number;
  purgedCountTotal?: number;
  lastCleanupDate?: string | null;
  nextScheduledRun?: string;
  health?: RetentionHealth;
}

export interface RetentionCounts {
  dispatches: number;
  deliveries: number;
  dispatch_items: number;
  dispatch_reconciliation_items: number;
  delivery_items: number;
  delivery_container_returns: number;
  customer_payments?: number;
  customer_financial_audit?: number;
  delivery_cancellation_audit?: number;
  dispatch_cancellation_audit?: number;
  dispatch_loading_audit?: number;
  customer_operations?: number;
  retention_archive?: number;
  archived_rows: number;
}

export interface RetentionHealth {
  lastSuccessAt: string | null;
  lastFinishedAt: string | null;
  lastDryRun: boolean | null;
  lastError: string | null;
  lastThresholdDate: string | null;
  retentionDays: number;
  counts: Partial<RetentionCounts> | null;
  stale: boolean;
}

export interface RetentionRunResult {
  dryRun: boolean;
  thresholdDate: string;
  retentionDays: number;
  purgedDispatches: number;
  purgedDeliveries: number;
  archivedRows: number;
  counts: Partial<RetentionCounts> | null;
  locked: boolean;
  lastCleanupDate: string;
  error?: string | null;
}

export interface DatabaseStatus {
  type: 'supabase_api' | 'postgres_direct' | 'local_json';
  isConnected: boolean;
  provider: string;
  url?: string;
  tables: {
    users: number;
    products: number;
    customers: number;
    dispatches: number;
    deliveries: number;
  };
  message: string;
  error?: string | null;
}
