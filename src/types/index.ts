export type UserRole = 'admin' | 'driver';

export interface User {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  canLoadVehicle: boolean; // Only admin or authorized lead driver can input warehouse vehicle loads
  assignedPlate?: string;
  pin: string;
  phone?: string;
}

export type ProductCategory = 'damacana' | 'pet' | 'soda' | 'tup' | 'bardak';
export type DepositType = 'damacana' | 'tup' | 'none';

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
  district?: string;
  isAccountCustomer: boolean; // Managers decide whether unpaid amounts become customer balance
  currentBalanceTL: number; // Positive = Customer owes us (debt), Negative = Customer prepayment
  emptyDepositBalance: {
    damacana: number;
    tup: number;
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
  collectedEmptyDamacana: number; // Empty 19L carboys to drop at warehouse
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
    tup: number;
  };
  emptyContainersDiff: {
    damacana: number; // delivered deposit items - received empty containers
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
