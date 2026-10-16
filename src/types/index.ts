export type UserRole = 'admin' | 'driver';

export const AUTHORIZED_VEHICLE_PLATES = ['01 FV 823', '06 GB 357', '01 AVH 886'] as const;
export type AuthorizedVehiclePlate = typeof AUTHORIZED_VEHICLE_PLATES[number];

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

export function sortProductsByCategory<T extends { category: ProductCategory; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const orderA = PRODUCT_CATEGORY_ORDER[a.category] ?? 99;
    const orderB = PRODUCT_CATEGORY_ORDER[b.category] ?? 99;
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
