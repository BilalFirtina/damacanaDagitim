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

export type ProductCategory = 'damacana' | 'pet' | 'soda' | 'tup' | 'bardak';
export type DepositType = 'damacana' | 'cam_damacana' | 'tup' | 'none';

export const PRODUCT_CATEGORY_ORDER: Record<ProductCategory, number> = {
  damacana: 1,
  pet: 2,
  tup: 3,
  soda: 4,
  bardak: 5,
};

export const PRODUCT_CATEGORY_TITLES: Record<ProductCategory, string> = {
  damacana: 'Damacana Su',
  pet: 'Pet Su',
  tup: 'Tüp',
  soda: 'Maden Suyu / İçecek',
  bardak: 'Bardak & Sarf Malzeme',
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
    tup: number; // Gaz tüpü
    cam_damacana?: number;
  };
  customPrices: Record<string, number>; // Product ID -> agreed custom unit price
  notes?: string;
  createdDate: string;
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
    tup: number;
  };
  emptyContainersDiff: {
    damacana: number; // delivered deposit items - received empty containers
    camDamacana?: number;
    cam_damacana?: number;
    tup: number;
  };
  notes?: string;
  isOfflineSync?: boolean;
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
