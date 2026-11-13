import type {
  Customer,
  CustomerDispenserInput,
  Delivery,
  Dispatch,
  DispenserDetailInput,
  Product,
  User,
} from '../types/index.ts';
import {
  CustomerDispenserValidationError,
  normalizeCustomerDispenserInput,
} from '../services/customerDispenserRules.ts';
import {
  computeDeliveredDeposits,
  computeEmptyContainersDiff,
} from '../services/depositRules.ts';

export class DeliveryInputError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'DeliveryInputError';
    this.status = status;
    this.code = code;
  }
}

export interface NormalizeDeliveryInput {
  id: string;
  dispatch: Dispatch;
  driver: User;
  customer: Customer;
  products: Product[];
  deliveredItems: unknown;
  collectedPayment: any;
  emptyContainersReceived: any;
  notes: unknown;
  isOfflineSync?: boolean;
}

export interface NormalizedDeliveryInput {
  delivery: Delivery;
  priceUpdates: Record<string, number>;
}

/**
 * POST /api/deliveries ve düzenleme (replacement) için ortak doğrulama.
 * Bu fonksiyon yalnızca GÜVENİLMEZ istemci girdisini normalize eder ve
 * sunucunun hesapladığı tutarları üretir; veritabanına yazmaz.
 */
export function normalizeDeliveryInput(
  input: NormalizeDeliveryInput
): NormalizedDeliveryInput {
  const {
    id,
    dispatch,
    driver,
    customer,
    products,
    deliveredItems,
    collectedPayment,
    emptyContainersReceived,
    notes,
    isOfflineSync,
  } = input;

  if (deliveredItems !== undefined && !Array.isArray(deliveredItems)) {
    throw new DeliveryInputError(400, 'Teslimat kalemleri geçersiz.');
  }
  const items = Array.isArray(deliveredItems) ? deliveredItems : [];

  const unknownItem = items.find(
    (item: any) => !products.some((p) => p.id === item.productId)
  );
  if (unknownItem) {
    throw new DeliveryInputError(
      400,
      `Bilinmeyen ürün kaydı: ${unknownItem.productId}`
    );
  }

  // Faturalı müşteride birim fiyat şoförden alınmaz; ürünün default fiyatı
  // sunucuda uygulanır. Fiyat bilgisi ileride kullanım için kayıtta kalır.
  const isAccountCustomer = Boolean(customer?.isAccountCustomer);

  const invalidItem = items.find((item: any) => {
    const quantity = Number(item?.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) return true;
    if (isAccountCustomer) return false;
    const unitPrice = Number(item?.unitPrice);
    return !Number.isFinite(unitPrice) || unitPrice < 0;
  });
  if (invalidItem) {
    throw new DeliveryInputError(
      400,
      'Teslimat kalemlerinde geçersiz miktar veya tutar var.'
    );
  }

  const seenDeliveryProducts = new Set<string>();
  for (const item of items) {
    const productId = String(item?.productId || '');
    if (seenDeliveryProducts.has(productId)) {
      throw new DeliveryInputError(
        400,
        'Aynı ürün teslimat kalemlerinde birden fazla kez yer alamaz.',
        'VALIDATION_ERROR'
      );
    }
    seenDeliveryProducts.add(productId);
  }

  // Satır tutarı istemciden GÜVENİLMEZ; miktar × birim fiyat sunucuda
  // hesaplanır. Böylece düşük tutar bildirilerek borç azaltılamaz.
  const normalizedItems = items.map((item: any) => {
    const quantity = Number(item.quantity);
    const product = products.find((p) => p.id === item.productId);
    const unitPrice = isAccountCustomer
      ? Number(product?.defaultUnitPrice ?? 0)
      : Number(item.unitPrice);
    return {
      ...item,
      quantity,
      unitPrice,
      lineTotal: Math.round(quantity * unitPrice * 100) / 100,
    };
  });

  let deliveredGrandTotal = 0;
  const priceUpdates: Record<string, number> = {};

  normalizedItems.forEach((item: any) => {
    deliveredGrandTotal += item.lineTotal;
    const prod = products.find((p) => p.id === item.productId);

    // Müşteri profilindeki son fiyat, tekrar kontrolünden SONRA uygulanır.
    if (item.unitPrice > 0 && prod) {
      priceUpdates[item.productId] = item.unitPrice;
    }
  });

  const tupBuyuk = Math.max(0, Math.floor(Number(emptyContainersReceived?.tupBuyuk) || 0));
  const tupKucuk = Math.max(0, Math.floor(Number(emptyContainersReceived?.tupKucuk) || 0));
  const emptiesRecv: {
    damacana: number;
    camDamacana: number;
    tupBuyuk?: number;
    tupKucuk?: number;
    sebil: number;
  } = {
    damacana: Math.max(0, Math.floor(Number(emptyContainersReceived?.damacana) || 0)),
    camDamacana: Math.max(
      0,
      Math.floor(
        Number(emptyContainersReceived?.camDamacana ?? emptyContainersReceived?.cam_damacana) || 0
      )
    ),
    sebil: Math.max(0, Math.floor(Number(emptyContainersReceived?.sebil) || 0)),
  };
  // Boyut alanları yalnızca veri varsa eklenir.
  if (tupBuyuk > 0 || tupKucuk > 0) {
    emptiesRecv.tupBuyuk = tupBuyuk;
    emptiesRecv.tupKucuk = tupKucuk;
  }

  const receivedEmptyTotal =
    emptiesRecv.damacana +
    emptiesRecv.camDamacana +
    (emptiesRecv.tupBuyuk || 0) +
    (emptiesRecv.tupKucuk || 0) +
    emptiesRecv.sebil;
  if (normalizedItems.length === 0 && receivedEmptyTotal === 0) {
    throw new DeliveryInputError(
      400,
      'Teslimat için en az bir ürün veya müşteriden alınan boş kap girilmelidir.',
      'EMPTY_DELIVERY'
    );
  }

  const deposited = computeDeliveredDeposits(normalizedItems, products);
  const emptyContainersDiff = computeEmptyContainersDiff(deposited, emptiesRecv);

  const payment = collectedPayment || {
    method: 'UNPAID',
    cashAmount: 0,
    posAmount: 0,
    totalCollected: 0,
  };

  const cash = Math.max(0, Number(payment.cashAmount) || 0);
  const pos = Math.max(0, Number(payment.posAmount) || 0);
  const totalCollected = cash + pos;
  const diffUncollected = deliveredGrandTotal - totalCollected;

  let paymentStatus: any = 'unpaid';
  if (totalCollected >= deliveredGrandTotal && deliveredGrandTotal > 0) {
    paymentStatus = totalCollected > deliveredGrandTotal ? 'overpaid' : 'paid_full';
  } else if (totalCollected > 0 && totalCollected < deliveredGrandTotal) {
    paymentStatus = 'partial';
  }

  const normalizedPayment = {
    method:
      payment.method ||
      (cash > 0 && pos > 0 ? 'MIXED' : pos > 0 ? 'POS' : cash > 0 ? 'CASH' : 'UNPAID'),
    cashAmount: cash,
    posAmount: pos,
    totalCollected,
    status: paymentStatus,
    diffUncollected,
  };

  const delivery: Delivery = {
    id,
    dispatchId: dispatch.id,
    driverId: driver.id,
    driverName: driver.name,
    vehiclePlate: dispatch.vehiclePlate,
    customerId: customer.id,
    customerName: customer.name,
    customerAddress: customer.address,
    customerPhone: customer.phone,
    timestamp: new Date().toISOString(),
    deliveredItems: normalizedItems,
    deliveredGrandTotal,
    collectedPayment: normalizedPayment,
    emptyContainersReceived: emptiesRecv,
    emptyContainersDiff,
    notes: (notes as string) || '',
    isOfflineSync: !!isOfflineSync,
  };

  return { delivery, priceUpdates };
}

/**
 * Şoförün sebil iadesi sırasında serbest metin olarak girdiği marka/model/
 * açıklama satırlarını doğrular. Marka/model sistemde kayıtlı değerlerle
 * eşleştirilmez; yalnızca kayıt/rapor bilgisi olarak saklanır.
 */
export function normalizeDispenserReturnDetails(
  value: unknown,
  maxCount: number
): DispenserDetailInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new DeliveryInputError(400, 'Sebil iade detayları geçersiz.');
  }

  const details: DispenserDetailInput[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new DeliveryInputError(400, 'Sebil iade detayları geçersiz.');
    }
    const record = raw as Record<string, unknown>;
    const brand = typeof record.brand === 'string' ? record.brand.trim() : '';
    const model = typeof record.model === 'string' ? record.model.trim() : '';
    const note = typeof record.note === 'string' ? record.note.trim() : '';
    if (!brand && !model && !note) continue;

    try {
      const normalized = normalizeCustomerDispenserInput({
        ...record,
        quantity: 1,
      });
      details.push({
        brand: normalized.brand,
        model: normalized.model,
        note: normalized.note,
      });
    } catch (e) {
      if (e instanceof CustomerDispenserValidationError) {
        throw new DeliveryInputError(
          400,
          `Sebil iade detayı geçersiz: ${e.message}`
        );
      }
      throw e;
    }
  }

  if (details.length > maxCount) {
    throw new DeliveryInputError(
      400,
      'İade edilen sebil sayısından fazla detay girilemez.',
      'DISPENSER_DETAIL_COUNT_MISMATCH'
    );
  }
  return details;
}

/**
 * Yeni teslimatta müşteriye bırakılan sebil marka/model/açıklama satırlarını
 * doğrular. İstemci aynı bilgileri adet bazında gruplayarak gönderir; toplam
 * adet teslim edilen sebil sayısını aşamaz.
 */
export function normalizeDispenserGivenDetails(
  value: unknown,
  maxCount: number
): CustomerDispenserInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new DeliveryInputError(400, 'Verilen sebil detayları geçersiz.');
  }

  const details: CustomerDispenserInput[] = [];
  let totalQuantity = 0;
  for (const raw of value) {
    try {
      const normalized = normalizeCustomerDispenserInput(raw);
      totalQuantity += normalized.quantity;
      if (totalQuantity > maxCount) {
        throw new DeliveryInputError(
          400,
          'Verilen sebil sayısından fazla detay girilemez.',
          'DISPENSER_DETAIL_COUNT_MISMATCH'
        );
      }
      details.push(normalized);
    } catch (e) {
      if (e instanceof DeliveryInputError) throw e;
      if (e instanceof CustomerDispenserValidationError) {
        throw new DeliveryInputError(
          400,
          `Verilen sebil detayı geçersiz: ${e.message}`
        );
      }
      throw e;
    }
  }
  return details;
}

/**
 * Aynı seferdeki aktif teslimatları dikkate alarak araç stoğunu doğrular.
 * `excludeDeliveryId` düzenlemede eski teslimatın yerine geçen kaydı hariç
 * tutar; DB RPC'si kilit altında aynı kontrolü tekrarlar.
 */
export function assertVehicleStockAvailable(
  delivery: Delivery,
  dispatch: Dispatch,
  activeDeliveries: Delivery[],
  excludeDeliveryId?: string
): void {
  const alreadyDelivered: Record<string, number> = {};
  for (const existing of activeDeliveries) {
    if (excludeDeliveryId && existing.id === excludeDeliveryId) continue;
    for (const item of existing.deliveredItems || []) {
      alreadyDelivered[item.productId] =
        (alreadyDelivered[item.productId] || 0) + (Number(item.quantity) || 0);
    }
  }

  for (const item of delivery.deliveredItems) {
    const loaded = dispatch.loadedItems.find((li) => li.productId === item.productId);
    const available =
      (Number(loaded?.quantity) || 0) - (alreadyDelivered[item.productId] || 0);
    if (item.quantity > available) {
      throw new DeliveryInputError(
        409,
        'Araçta bu üründen yeterli stok yok. Teslimat miktarı yüklenen miktarı aşamaz.',
        'INSUFFICIENT_VEHICLE_STOCK'
      );
    }
  }
}
