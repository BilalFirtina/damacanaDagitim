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
  sebil: 'Sebil & Pompa',
};

// Kategoriler veritabanından yüklenemezse (çevrimdışı/hata) kullanılacak
// varsayılan birim ve depozito kuralları. DB kayıtları bunları geçersiz kılar.
export const PRODUCT_CATEGORY_DEFAULTS: Record<
  ProductCategory,
  { unit: string; isDeposit: boolean; depositType: DepositType }
> = {
  damacana: { unit: 'Adet', isDeposit: true, depositType: 'damacana' },
  pet: { unit: 'Koli', isDeposit: false, depositType: 'none' },
  tup: { unit: 'Adet', isDeposit: true, depositType: 'tup_buyuk' },
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

// Pet grubunda rafta/araçta en sık kullanılan bardak suyu başa, cam suyu
// sona alır. Diğer pet ürünleri kendi aralarında alfabetik kalır.
const PET_FIRST_PRODUCT_ID = 'prod_bardak_su_60';
const PET_LAST_PRODUCT_ID = 'prod_pet_cam_su_0_33_12';

function petProductRank(product: { id?: string }): number {
  if (product.id === PET_FIRST_PRODUCT_ID) return 0;
  if (product.id === PET_LAST_PRODUCT_ID) return 2;
  return 1;
}

export function sortProductsByCategory<
  T extends { id?: string; category: string; name: string }
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const orderA = getProductCategoryOrder(a.category);
    const orderB = getProductCategoryOrder(b.category);
    if (orderA !== orderB) return orderA - orderB;
    if (a.category === 'pet' && b.category === 'pet') {
      const rank = petProductRank(a) - petProductRank(b);
      if (rank !== 0) return rank;
    }
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
  T extends { id?: string; category: string; name: string; depositType?: string }
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
    if (a.category === 'pet' && b.category === 'pet') {
      const rank = petProductRank(a) - petProductRank(b);
      if (rank !== 0) return rank;
    }
    return a.name.localeCompare(b.name, 'tr');
  });
}

// Kategori bazlı görsel ayrım. Aynı kategorideki ürünler her ekranda aynı
// renk setiyle gösterilir. Sınıflar Tailwind JIT tarafından görülebilmesi
// için statik dize olarak tanımlanır (dinamik sınıf birleştirme yapılmaz).
export interface ProductCategoryColor {
  /** Çip/kart için zemin + yazı + kenarlık sınıfları. */
  chip: string;
  /** Liste/tablo satırı için hafif zemin + yazı sınıfları. */
  row: string;
  /** Küçük renk göstergesi (nokta) sınıfları. */
  dot: string;
}

const PRODUCT_CATEGORY_COLORS: Record<string, ProductCategoryColor> = {
  damacana: {
    chip: 'bg-sky-50 text-sky-900 border-sky-200',
    row: 'bg-sky-50/60 text-sky-950',
    dot: 'bg-sky-500',
  },
  pet: {
    chip: 'bg-teal-50 text-teal-900 border-teal-200',
    row: 'bg-teal-50/60 text-teal-950',
    dot: 'bg-teal-500',
  },
  soda: {
    chip: 'bg-green-50 text-green-900 border-green-200',
    row: 'bg-green-50/60 text-green-950',
    dot: 'bg-green-500',
  },
  tup: {
    chip: 'bg-gray-100 text-gray-900 border-gray-300',
    row: 'bg-gray-100/70 text-gray-900',
    dot: 'bg-gray-500',
  },
  bardak: {
    chip: 'cat-bardak-speckled text-slate-900 border-slate-400/70',
    row: 'bg-[#f7efdc]/70 text-slate-900',
    dot: 'cat-bardak-speckled',
  },
  sebil: {
    chip: 'bg-white text-slate-900 border-slate-400',
    row: 'bg-white text-slate-900',
    dot: 'bg-white border border-slate-400',
  },
};

// Veritabanından gelen yeni/dinamik kategoriler için yedek palet.
// Kod adına göre deterministik seçilir; aynı kod her zaman aynı rengi alır.
const FALLBACK_CATEGORY_COLORS: ProductCategoryColor[] = [
  {
    chip: 'bg-violet-50 text-violet-900 border-violet-200',
    row: 'bg-violet-50/60 text-violet-950',
    dot: 'bg-violet-500',
  },
  {
    chip: 'bg-orange-50 text-orange-900 border-orange-200',
    row: 'bg-orange-50/60 text-orange-950',
    dot: 'bg-orange-500',
  },
  {
    chip: 'bg-pink-50 text-pink-900 border-pink-200',
    row: 'bg-pink-50/60 text-pink-950',
    dot: 'bg-pink-500',
  },
  {
    chip: 'bg-indigo-50 text-indigo-900 border-indigo-200',
    row: 'bg-indigo-50/60 text-indigo-950',
    dot: 'bg-indigo-500',
  },
  {
    chip: 'bg-lime-50 text-lime-900 border-lime-200',
    row: 'bg-lime-50/60 text-lime-950',
    dot: 'bg-lime-500',
  },
  {
    chip: 'bg-cyan-50 text-cyan-900 border-cyan-200',
    row: 'bg-cyan-50/60 text-cyan-950',
    dot: 'bg-cyan-500',
  },
];

export function getProductCategoryColor(code: string): ProductCategoryColor {
  if (code && PRODUCT_CATEGORY_COLORS[code]) return PRODUCT_CATEGORY_COLORS[code];
  const key = String(code || 'none');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_CATEGORY_COLORS[hash % FALLBACK_CATEGORY_COLORS.length];
}

// LoadedItem / DeliveryItem gibi yalnızca productId taşıyan kayıtları,
// çözümlenen ürünün kategorisine göre sıralar. Kayıt sırası değiştirilmez,
// yalnızca dönen kopya sıralanır. Eşleşmeyen ürünler en sonda yer alır.
export function sortItemsByProductCategory<T extends { productId: string }>(
  items: T[],
  products: Array<{
    id: string;
    category?: string;
    name?: string;
    depositType?: string;
  }>
): T[] {
  const productById = new Map<string, { id: string; category?: string; name?: string; depositType?: string }>();
  for (const product of products || []) productById.set(product.id, product);
  return [...(items || [])].sort((a, b) => {
    const pa = productById.get(a.productId);
    const pb = productById.get(b.productId);
    const orderA = pa ? getProductCategoryOrder(pa.category || '') : 99;
    const orderB = pb ? getProductCategoryOrder(pb.category || '') : 99;
    if (orderA !== orderB) return orderA - orderB;
    if (pa && pb && pa.category === 'damacana') {
      const glassA = isGlassDamacana(pa) ? 1 : 0;
      const glassB = isGlassDamacana(pb) ? 1 : 0;
      if (glassA !== glassB) return glassA - glassB;
    }
    if (pa && pb && pa.category === 'pet' && pb.category === 'pet') {
      const rank = petProductRank(pa) - petProductRank(pb);
      if (rank !== 0) return rank;
    }
    return String(pa?.name || a.productId).localeCompare(
      String(pb?.name || b.productId),
      'tr'
    );
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
  sourceDeliveryId?: string | null;
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

/** Sebil teslim/iade anında girilen serbest metin detayı (adet ayrı taşınır). */
export interface DispenserDetailInput {
  brand: string;
  model: string;
  note?: string | null;
  /** İade, müşteride kayıtlı belirli bir sebil detayından seçildiyse. */
  customerDispenserId?: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  isActive: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseItem {
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  lineTotal: number | null;
}

export interface Purchase {
  id: string;
  purchasedAt: string;
  supplierId: string;
  supplierName: string;
  description: string | null;
  status: 'active' | 'cancelled';
  totalAmount: number | null;
  createdByUserId: string;
  createdByUserName: string;
  dispatchId: string | null;
  dispatchPlate: string | null;
  cancelledAt: string | null;
  cancelledByUserId: string | null;
  cancelledByUserName: string | null;
  createdAt: string;
  updatedAt: string;
  items: PurchaseItem[];
}

export interface PurchaseInputItem {
  productId: string;
  quantity: number;
  unitPrice?: number | null;
}

export type CustomerPaymentStatus = 'active' | 'cancelled';

export interface CustomerPayment {
  id: string;
  customerId: string;
  customerName?: string;
  /** Faturalı müşteri etiketi; tutar tahsilat tutarıdır, cari borç değildir. */
  isAccountCustomer?: boolean;
  amount: number;
  method: 'CASH' | 'POS' | 'TRANSFER';
  note: string;
  dispatchId?: string | null;
  dispatchPlate?: string | null;
  dispatchStatus?: string | null;
  collectedByUserId: string;
  collectedByUserName: string;
  collectedAt: string;
  status: CustomerPaymentStatus;
  correctedAt?: string | null;
  correctedByUserName?: string | null;
  correctionCount?: number;
  /** Sunucu tarafından hesaplanır: aktif seferde kendi tahsilatı veya admin. */
  canCorrect?: boolean;
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
  collectedEmptyTupBuyuk: number; // Empty large gas cylinders to drop at warehouse
  collectedEmptyTupKucuk: number; // Empty small gas cylinders to drop at warehouse
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
    tupBuyuk?: number;
    tupKucuk?: number;
    sebil?: number;
  };
  emptyContainersDiff: {
    damacana: number; // delivered deposit items - received empty containers
    camDamacana?: number;
    cam_damacana?: number;
    tupBuyuk?: number;
    tupKucuk?: number;
    sebil?: number;
  };
  notes?: string;
  isOfflineSync?: boolean;
  /** Yüklenen/kalan stoktan fazla teslimat şoför tarafından onaylandı. */
  stockOverride?: boolean;
  /** Onaylı stok aşımının ürün bazında anlık görüntüsü. */
  stockOverrideDetails?: Array<{
    productId: string;
    productName?: string;
    loaded: number;
    deliveredBefore: number;
    remaining: number;
    requested: number;
    oversell: number;
  }>;
  /** Yalnızca yeni teslimatta sebil iadesi için gönderilen serbest metin detayları. */
  dispenserReturns?: DispenserDetailInput[];
  /** Yalnızca yeni teslimatta bırakılan sebil marka/model/açıklama detayları. */
  dispenserGivenDetails?: CustomerDispenserInput[];
  /** Sebil iadesi kayıtlı detaylarla eşleşmediğinde girilen açıklama. */
  dispenserReturnNote?: string;
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
  purchases?: number;
  purchase_items?: number;
  purchase_audit?: number;
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
