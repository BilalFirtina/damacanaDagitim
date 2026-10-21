import assert from 'node:assert/strict';
import {
  assertVehicleStockAvailable,
  normalizeDeliveryInput,
  type NormalizeDeliveryInput,
  type NormalizedDeliveryInput,
} from '../src/server/deliveryInput.ts';
import {
  computeDeliveredDeposits,
  computeEmptyContainersDiff,
} from '../src/services/depositRules.ts';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

class OracleHttpError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'OracleHttpError';
    this.status = status;
    this.code = code;
  }
}

const products: any[] = [
  {
    id: 'p_water',
    name: 'Damacana Su',
    category: 'damacana',
    defaultUnitPrice: 100,
    isDeposit: true,
    depositType: 'damacana',
    unit: 'Adet',
  },
  {
    id: 'p_cam',
    name: 'Cam Damacana',
    category: 'damacana',
    defaultUnitPrice: 120,
    isDeposit: true,
    depositType: 'cam_damacana',
    unit: 'Adet',
  },
  {
    id: 'p_tup',
    name: 'Tüp',
    category: 'tup',
    defaultUnitPrice: 300,
    isDeposit: true,
    depositType: 'tup',
    unit: 'Adet',
  },
  {
    id: 'p_pet',
    name: 'Pet Su',
    category: 'pet',
    defaultUnitPrice: 50,
    isDeposit: false,
    depositType: 'none',
    unit: 'Adet',
  },
];

const dispatch: any = {
  id: 'D1',
  date: '2026-10-20',
  driverId: 'u_driver',
  driverName: 'Şoför',
  vehiclePlate: '34 CI 001',
  loadedByUserId: 'u_admin',
  loadedByUserName: 'Yönetici',
  driverConfirmedAt: null,
  status: 'in_transit',
  loadedItems: [
    { productId: 'p_water', quantity: 10 },
    { productId: 'p_cam', quantity: 6 },
    { productId: 'p_tup', quantity: 5 },
    { productId: 'p_pet', quantity: 100 },
  ],
  createdAt: '2026-10-20T06:00:00.000Z',
};

const driver: any = {
  id: 'u_driver',
  name: 'Şoför',
  username: 'driver',
  role: 'driver',
  canLoadVehicle: true,
  pin: '1111',
};

const customer: any = {
  id: 'c1',
  name: 'Test Müşteri',
  phone: '05000000000',
  address: 'Test Adres',
  isAccountCustomer: true,
  currentBalanceTL: 0,
  emptyDepositBalance: { damacana: 0, camDamacana: 0, tup: 0 },
  customPrices: {},
  createdDate: '2026-01-01',
};

const existingWater2: any = {
  id: 'OLD1',
  dispatchId: 'D1',
  driverId: 'u_driver',
  driverName: 'Şoför',
  vehiclePlate: '34 CI 001',
  customerId: 'c1',
  customerName: 'Test Müşteri',
  timestamp: '2026-10-20T07:00:00.000Z',
  deliveredItems: [
    {
      productId: 'p_water',
      productName: 'Damacana Su',
      quantity: 2,
      unitPrice: 100,
      lineTotal: 200,
    },
  ],
  deliveredGrandTotal: 200,
  collectedPayment: {
    method: 'CASH',
    cashAmount: 200,
    posAmount: 0,
    totalCollected: 200,
    status: 'paid_full',
    diffUncollected: 0,
  },
  emptyContainersReceived: { damacana: 0, camDamacana: 0, tup: 0 },
  emptyContainersDiff: { damacana: 2, camDamacana: 0, tup: 0 },
  notes: '',
  isOfflineSync: false,
};

function baseInput(): NormalizeDeliveryInput {
  return {
    id: 'del_case',
    dispatch,
    driver,
    customer,
    products,
    deliveredItems: [
      {
        productId: 'p_water',
        productName: 'Damacana Su',
        quantity: 2,
        unitPrice: 100,
      },
    ],
    collectedPayment: {
      method: 'CASH',
      cashAmount: 200,
      posAmount: 0,
      totalCollected: 200,
    },
    emptyContainersReceived: {},
    notes: 'CI',
    isOfflineSync: false,
  };
}

function legacyNormalize(input: any): NormalizedDeliveryInput {
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
    throw new OracleHttpError(400, 'Teslimat kalemleri geçersiz.');
  }
  const items = Array.isArray(deliveredItems) ? deliveredItems : [];

  const unknownItem = items.find(
    (item: any) => !products.some((p: any) => p.id === item.productId)
  );
  if (unknownItem) {
    throw new OracleHttpError(
      400,
      `Bilinmeyen ürün kaydı: ${unknownItem.productId}`
    );
  }

  const invalidItem = items.find((item: any) => {
    const quantity = Number(item?.quantity);
    const unitPrice = Number(item?.unitPrice);
    return (
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(unitPrice) ||
      unitPrice < 0
    );
  });
  if (invalidItem) {
    throw new OracleHttpError(
      400,
      'Teslimat kalemlerinde geçersiz miktar veya tutar var.'
    );
  }

  const seenDeliveryProducts = new Set<string>();
  for (const item of items) {
    const productId = String(item?.productId || '');
    if (seenDeliveryProducts.has(productId)) {
      throw new OracleHttpError(
        400,
        'Aynı ürün teslimat kalemlerinde birden fazla kez yer alamaz.',
        'VALIDATION_ERROR'
      );
    }
    seenDeliveryProducts.add(productId);
  }

  const normalizedItems = items.map((item: any) => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
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
    const prod = products.find((p: any) => p.id === item.productId);

    if (item.unitPrice > 0 && prod) {
      priceUpdates[item.productId] = item.unitPrice;
    }
  });

  const emptiesRecv = {
    damacana: Math.max(0, Math.floor(Number(emptyContainersReceived?.damacana) || 0)),
    camDamacana: Math.max(
      0,
      Math.floor(
        Number(emptyContainersReceived?.camDamacana ?? emptyContainersReceived?.cam_damacana) || 0
      )
    ),
    tup: Math.max(0, Math.floor(Number(emptyContainersReceived?.tup) || 0)),
  };

  const receivedEmptyTotal =
    emptiesRecv.damacana + emptiesRecv.camDamacana + emptiesRecv.tup;
  if (normalizedItems.length === 0 && receivedEmptyTotal === 0) {
    throw new OracleHttpError(
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

  const delivery: any = {
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
    notes: notes || '',
    isOfflineSync: !!isOfflineSync,
  };

  return { delivery, priceUpdates };
}

function legacyAssertVehicleStockAvailable(
  delivery: any,
  dispatch: any,
  activeDeliveries: any[]
): void {
  const alreadyDelivered: Record<string, number> = {};
  for (const existing of activeDeliveries) {
    for (const item of existing.deliveredItems || []) {
      alreadyDelivered[item.productId] =
        (alreadyDelivered[item.productId] || 0) + (Number(item.quantity) || 0);
    }
  }
  for (const item of delivery.deliveredItems) {
    const loaded = dispatch.loadedItems.find(
      (li: any) => li.productId === item.productId
    );
    const available =
      (Number(loaded?.quantity) || 0) - (alreadyDelivered[item.productId] || 0);
    if (item.quantity > available) {
      throw new OracleHttpError(
        409,
        'Araçta bu üründen yeterli stok yok. Teslimat miktarı yüklenen miktarı aşamaz.',
        'INSUFFICIENT_VEHICLE_STOCK'
      );
    }
  }
}

function capture(fn: () => any): { ok: true; value: any } | { ok: false; error: any } {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

function errorShape(error: any): { status: number | null; code: string | null; message: string } {
  return {
    status: typeof error?.status === 'number' ? error.status : null,
    code: typeof error?.code === 'string' ? error.code : null,
    message: String(error?.message ?? error),
  };
}

function scrubDelivery(delivery: any): any {
  const { timestamp, ...rest } = delivery;
  void timestamp;
  return rest;
}

function compareValues(name: string, expected: any, actual: any): void {
  try {
    assert.deepStrictEqual(actual, expected);
    check(name, true);
  } catch {
    check(name, false, `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
}

type Expectation = 'ok' | 'normalize-error' | 'stock-error';

interface EquivalenceCase {
  name: string;
  overrides?: Record<string, unknown>;
  existing?: any[];
  expect: Expectation;
  expectedCamReceived?: number;
  expectedCode?: string;
}

const cases: EquivalenceCase[] = [
  { name: 'gecerli tek kalem', expect: 'ok' },
  {
    name: 'gecerli coklu kalem',
    overrides: {
      deliveredItems: [
        { productId: 'p_water', productName: 'Damacana Su', quantity: 2, unitPrice: 100 },
        { productId: 'p_pet', productName: 'Pet Su', quantity: 3, unitPrice: 50 },
      ],
    },
    expect: 'ok',
  },
  {
    name: 'bos kalem dizisi',
    overrides: { deliveredItems: [], collectedPayment: { method: 'UNPAID', cashAmount: 0, posAmount: 0 } },
    expect: 'normalize-error',
    expectedCode: 'EMPTY_DELIVERY',
  },
  {
    name: 'eksik deliveredItems',
    overrides: { deliveredItems: undefined },
    expect: 'normalize-error',
    expectedCode: 'EMPTY_DELIVERY',
  },
  {
    name: 'yalniz bos kap teslimati',
    overrides: {
      deliveredItems: [],
      emptyContainersReceived: { damacana: 2 },
      collectedPayment: { method: 'UNPAID', cashAmount: 0, posAmount: 0 },
    },
    expect: 'ok',
  },
  {
    name: 'bos kap ve kalem birlikte',
    overrides: { emptyContainersReceived: { damacana: 2 } },
    expect: 'ok',
  },
  { name: 'null deliveredItems', overrides: { deliveredItems: null }, expect: 'normalize-error' },
  { name: 'obje deliveredItems', overrides: { deliveredItems: { productId: 'p_water' } }, expect: 'normalize-error' },
  {
    name: 'bilinmeyen urun',
    overrides: {
      deliveredItems: [{ productId: 'p_unknown', productName: 'Yok', quantity: 1, unitPrice: 10 }],
    },
    expect: 'normalize-error',
  },
  {
    name: 'sifir miktar',
    overrides: { deliveredItems: [{ productId: 'p_water', quantity: 0, unitPrice: 100 }] },
    expect: 'normalize-error',
  },
  {
    name: 'negatif miktar',
    overrides: { deliveredItems: [{ productId: 'p_water', quantity: -1, unitPrice: 100 }] },
    expect: 'normalize-error',
  },
  {
    name: 'kesirli miktar',
    overrides: { deliveredItems: [{ productId: 'p_water', quantity: 1.5, unitPrice: 100 }] },
    expect: 'normalize-error',
  },
  {
    name: 'string miktar',
    overrides: { deliveredItems: [{ productId: 'p_water', quantity: '2', unitPrice: 100 }] },
    expect: 'ok',
  },
  {
    name: 'negatif fiyat',
    overrides: { deliveredItems: [{ productId: 'p_water', quantity: 1, unitPrice: -1 }] },
    expect: 'normalize-error',
  },
  {
    name: 'string fiyat',
    overrides: { deliveredItems: [{ productId: 'p_water', quantity: 2, unitPrice: '100' }] },
    expect: 'ok',
  },
  {
    name: 'ayni urun iki kez',
    overrides: {
      deliveredItems: [
        { productId: 'p_water', quantity: 1, unitPrice: 100 },
        { productId: 'p_water', quantity: 1, unitPrice: 100 },
      ],
    },
    expect: 'normalize-error',
  },
  {
    name: 'ayni urun farkli fiyatla iki kez',
    overrides: {
      deliveredItems: [
        { productId: 'p_water', quantity: 1, unitPrice: 100 },
        { productId: 'p_water', quantity: 1, unitPrice: 90 },
      ],
    },
    expect: 'normalize-error',
  },
  { name: 'eksik emptyContainersReceived', overrides: { emptyContainersReceived: undefined }, expect: 'ok' },
  {
    name: 'camDamacana alani',
    overrides: { emptyContainersReceived: { camDamacana: 2 } },
    expect: 'ok',
    expectedCamReceived: 2,
  },
  {
    name: 'cam_damacana alani',
    overrides: { emptyContainersReceived: { cam_damacana: 2 } },
    expect: 'ok',
    expectedCamReceived: 2,
  },
  {
    name: 'camDamacana cam_damacana oncelikli',
    overrides: { emptyContainersReceived: { camDamacana: 2, cam_damacana: 4 } },
    expect: 'ok',
    expectedCamReceived: 2,
  },
  {
    name: 'camDamacana sifir nullish degil',
    overrides: { emptyContainersReceived: { camDamacana: 0, cam_damacana: 4 } },
    expect: 'ok',
    expectedCamReceived: 0,
  },
  {
    name: 'camDamacana null fallback',
    overrides: { emptyContainersReceived: { camDamacana: null, cam_damacana: 4 } },
    expect: 'ok',
    expectedCamReceived: 4,
  },
  {
    name: 'bos kap tasmasi',
    overrides: {
      deliveredItems: [{ productId: 'p_water', quantity: 1, unitPrice: 100 }],
      emptyContainersReceived: { damacana: 2 },
    },
    expect: 'ok',
  },
  {
    name: 'nakit odeme',
    overrides: { collectedPayment: { method: 'CASH', cashAmount: 200, posAmount: 0 } },
    expect: 'ok',
  },
  {
    name: 'pos odeme',
    overrides: { collectedPayment: { method: 'POS', cashAmount: 0, posAmount: 200 } },
    expect: 'ok',
  },
  {
    name: 'karma odeme',
    overrides: { collectedPayment: { method: 'MIXED', cashAmount: 100, posAmount: 100 } },
    expect: 'ok',
  },
  {
    name: 'fazla odeme',
    overrides: { collectedPayment: { method: 'CASH', cashAmount: 300, posAmount: 0 } },
    expect: 'ok',
  },
  {
    name: 'odenmemis',
    overrides: { collectedPayment: { method: 'UNPAID', cashAmount: 0, posAmount: 0 } },
    expect: 'ok',
  },
  {
    name: 'kismi odeme',
    overrides: { collectedPayment: { method: 'CASH', cashAmount: 100, posAmount: 0 } },
    expect: 'ok',
  },
  {
    name: 'bos method nakit fallback',
    overrides: { collectedPayment: { method: '', cashAmount: 200, posAmount: 0 } },
    expect: 'ok',
  },
  {
    name: 'bos method pos fallback',
    overrides: { collectedPayment: { method: '', cashAmount: 0, posAmount: 200 } },
    expect: 'ok',
  },
  {
    name: 'bos method karma fallback',
    overrides: { collectedPayment: { method: '', cashAmount: 100, posAmount: 100 } },
    expect: 'ok',
  },
  {
    name: 'bos method odenmemis fallback',
    overrides: { collectedPayment: { method: '', cashAmount: 0, posAmount: 0 } },
    expect: 'ok',
  },
  {
    name: 'negatif nakit sifirlanir',
    overrides: { collectedPayment: { method: 'CASH', cashAmount: -50, posAmount: 0 } },
    expect: 'ok',
  },
  {
    name: 'negatif pos sifirlanir',
    overrides: { collectedPayment: { method: 'POS', cashAmount: 0, posAmount: -50 } },
    expect: 'ok',
  },
  {
    name: 'string odeme tutarlari',
    overrides: { collectedPayment: { method: '', cashAmount: '100', posAmount: '50' } },
    expect: 'ok',
  },
  { name: 'collectedPayment yok', overrides: { collectedPayment: undefined }, expect: 'ok' },
  {
    name: 'sifir fiyat price update yok',
    overrides: {
      deliveredItems: [{ productId: 'p_water', quantity: 2, unitPrice: 0 }],
      collectedPayment: { method: 'UNPAID', cashAmount: 0, posAmount: 0 },
    },
    expect: 'ok',
  },
  {
    name: 'coklu fiyat guncellemesi',
    overrides: {
      deliveredItems: [
        { productId: 'p_water', quantity: 1, unitPrice: 90 },
        { productId: 'p_pet', quantity: 1, unitPrice: 45 },
      ],
    },
    expect: 'ok',
  },
  { name: 'notes yok', overrides: { notes: undefined }, expect: 'ok' },
  { name: 'offline true', overrides: { isOfflineSync: true }, expect: 'ok' },
  {
    name: 'stok tam esit',
    overrides: {
      deliveredItems: [{ productId: 'p_water', quantity: 10, unitPrice: 100 }],
      collectedPayment: { method: 'CASH', cashAmount: 1000, posAmount: 0 },
    },
    expect: 'ok',
  },
  {
    name: 'stok bir fazla',
    overrides: {
      deliveredItems: [{ productId: 'p_water', quantity: 11, unitPrice: 100 }],
      collectedPayment: { method: 'CASH', cashAmount: 1100, posAmount: 0 },
    },
    expect: 'stock-error',
  },
  {
    name: 'mevcut teslimatla stok tam esit',
    overrides: {
      deliveredItems: [{ productId: 'p_water', quantity: 8, unitPrice: 100 }],
      collectedPayment: { method: 'CASH', cashAmount: 800, posAmount: 0 },
    },
    existing: [existingWater2],
    expect: 'ok',
  },
  {
    name: 'mevcut teslimatla stok bir fazla',
    overrides: {
      deliveredItems: [{ productId: 'p_water', quantity: 9, unitPrice: 100 }],
      collectedPayment: { method: 'CASH', cashAmount: 900, posAmount: 0 },
    },
    existing: [existingWater2],
    expect: 'stock-error',
  },
  {
    name: 'cam damacana teslimati',
    overrides: {
      deliveredItems: [{ productId: 'p_cam', quantity: 3, unitPrice: 120 }],
      emptyContainersReceived: { camDamacana: 1 },
      collectedPayment: { method: 'CASH', cashAmount: 360, posAmount: 0 },
    },
    expect: 'ok',
  },
  {
    name: 'tup teslimati',
    overrides: {
      deliveredItems: [{ productId: 'p_tup', quantity: 2, unitPrice: 300 }],
      collectedPayment: { method: 'CASH', cashAmount: 600, posAmount: 0 },
    },
    expect: 'ok',
  },
  {
    name: 'pet teslimati depozitosuz',
    overrides: {
      deliveredItems: [{ productId: 'p_pet', quantity: 5, unitPrice: 50 }],
      collectedPayment: { method: 'CASH', cashAmount: 250, posAmount: 0 },
    },
    expect: 'ok',
  },
  {
    name: 'karisik depozito tipleri',
    overrides: {
      deliveredItems: [
        { productId: 'p_water', quantity: 1, unitPrice: 100 },
        { productId: 'p_cam', quantity: 2, unitPrice: 120 },
        { productId: 'p_tup', quantity: 1, unitPrice: 300 },
      ],
      emptyContainersReceived: { damacana: 1, camDamacana: 1, tup: 1 },
      collectedPayment: { method: 'CASH', cashAmount: 640, posAmount: 0 },
    },
    expect: 'ok',
  },
  {
    name: 'coklu urunde stok fazlasi',
    overrides: {
      deliveredItems: [
        { productId: 'p_water', quantity: 10, unitPrice: 100 },
        { productId: 'p_cam', quantity: 7, unitPrice: 120 },
      ],
      collectedPayment: { method: 'CASH', cashAmount: 1840, posAmount: 0 },
    },
    expect: 'stock-error',
  },
  {
    name: 'bos string miktar',
    overrides: { deliveredItems: [{ productId: 'p_water', quantity: '', unitPrice: 100 }] },
    expect: 'normalize-error',
  },
  {
    name: 'sonsuz miktar',
    overrides: { deliveredItems: [{ productId: 'p_water', quantity: 'Infinity', unitPrice: 100 }] },
    expect: 'normalize-error',
  },
  {
    name: 'sayisal olmayan fiyat',
    overrides: { deliveredItems: [{ productId: 'p_water', quantity: 1, unitPrice: 'abc' }] },
    expect: 'normalize-error',
  },
  {
    name: 'eksik fiyat',
    overrides: { deliveredItems: [{ productId: 'p_water', quantity: 1 }] },
    expect: 'normalize-error',
  },
  {
    name: 'integer gorunumlu ondalik',
    overrides: { deliveredItems: [{ productId: 'p_water', quantity: 2.0, unitPrice: 100 }] },
    expect: 'ok',
  },
  {
    name: 'negatif bos kap girisi sifirlanir',
    overrides: { emptyContainersReceived: { damacana: -3 } },
    expect: 'ok',
  },
  {
    name: 'kesirli bos kap girisi floor',
    overrides: { emptyContainersReceived: { damacana: 2.9 } },
    expect: 'ok',
  },
  {
    name: 'bos kalem ve nakit odeme',
    overrides: {
      deliveredItems: [],
      collectedPayment: { method: 'CASH', cashAmount: 10, posAmount: 0 },
    },
    expect: 'normalize-error',
    expectedCode: 'EMPTY_DELIVERY',
  },
];

let camComparisons = 0;
let camMismatches = 0;

for (const testCase of cases) {
  const input = {
    ...baseInput(),
    ...(testCase.overrides ?? {}),
  } as NormalizeDeliveryInput;

  const oracle = capture(() => legacyNormalize(input));
  const actual = capture(() => normalizeDeliveryInput(input));

  compareValues(`${testCase.name}: normalize sonucu`, oracle.ok, actual.ok);

  if (!oracle.ok && !actual.ok) {
    compareValues(
      `${testCase.name}: hata status/code/message`,
      errorShape(oracle.error),
      errorShape(actual.error)
    );
    if (testCase.expectedCode !== undefined) {
      check(
        `${testCase.name}: beklenen hata kodu`,
        actual.error.code === testCase.expectedCode,
        `expected=${testCase.expectedCode} actual=${actual.error.code}`
      );
    }
  } else if (oracle.ok && actual.ok) {
    compareValues(
      `${testCase.name}: delivery ciktisi`,
      scrubDelivery(oracle.value.delivery),
      scrubDelivery(actual.value.delivery)
    );
    compareValues(
      `${testCase.name}: priceUpdates`,
      oracle.value.priceUpdates,
      actual.value.priceUpdates
    );
    if (testCase.expectedCamReceived !== undefined) {
      compareValues(
        `${testCase.name}: camDamacana alani`,
        testCase.expectedCamReceived,
        actual.value.delivery.emptyContainersReceived.camDamacana
      );
    }
    const oldNextCam =
      (Number(0) || 0) + actual.value.delivery.emptyContainersDiff.camDamacana;
    const newNextCam =
      (Number(0) || 0) +
      Number(
        actual.value.delivery.emptyContainersDiff.camDamacana ??
          actual.value.delivery.emptyContainersDiff.cam_damacana ??
          0
      );
    camComparisons++;
    if (!Object.is(oldNextCam, newNextCam)) camMismatches++;
  }

  const existing = testCase.existing ?? [];
  const oracleStock = oracle.ok
    ? capture(() => legacyAssertVehicleStockAvailable(oracle.value.delivery, dispatch, existing))
    : null;
  const actualStock = actual.ok
    ? capture(() => assertVehicleStockAvailable(actual.value.delivery, dispatch, existing))
    : null;

  if (oracleStock && actualStock) {
    compareValues(`${testCase.name}: stock sonucu`, oracleStock.ok, actualStock.ok);
    if (!oracleStock.ok && !actualStock.ok) {
      compareValues(
        `${testCase.name}: stock hata status/code/message`,
        errorShape(oracleStock.error),
        errorShape(actualStock.error)
      );
    }
  }

  const actualKind: Expectation = !actual.ok
    ? 'normalize-error'
    : actualStock && !actualStock.ok
      ? 'stock-error'
      : 'ok';
  check(
    `${testCase.name}: beklenen ${testCase.expect}`,
    actualKind === testCase.expect,
    `gercek=${actualKind}`
  );
}

check(
  `camDamacana ?? cam_damacana ?? 0 nextEmpty esdegeri (${camComparisons} ciktida ${camMismatches} fark)`,
  camComparisons > 0 && camMismatches === 0,
  `karsilastirma=${camComparisons} fark=${camMismatches}`
);

check(
  `en az 40 girdi (${cases.length})`,
  cases.length >= 40,
  `girdi=${cases.length}`
);

console.log(`\nSONUC: ${passed} gecti, ${failed} basarisiz`);
if (failed > 0) process.exit(1);
