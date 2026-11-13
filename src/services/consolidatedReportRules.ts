import type { Customer, Delivery, Product } from '../types';
import { isGlassDamacana } from '../types';
import { isAccountCustomerDelivery } from './customerVisibility';

// Konsolide gün sonu raporu için saf hesaplama katmanı.
// Şoför bazında, müşteri başına tek satır üretir. Aynı müşteri farklı
// şoförlerden hizmet alırsa her şoförün kendi bölümünde ayrı satır oluşur.
// Havale (TRANSFER) kayıtları raporda hiçbir toplama girmez.

export interface ReportPayment {
  id: string;
  customerId: string;
  customerName?: string;
  amount: number;
  method: string;
  note: string;
  collectedByUserId: string;
  collectedByUserName: string;
  collectedAt: string;
}

export interface ReportDispatch {
  id?: string;
  driverId: string;
  driverName: string;
  vehiclePlate: string;
  loadedItems?: Array<{ productId: string; quantity: number }>;
}

export interface DispatchReturnProduct {
  productId: string;
  name: string;
  unit: string;
  loaded: number;
  delivered: number;
  remaining: number;
  isDeposit: boolean;
}

export interface DispatchReturnSummary {
  dispatchId: string;
  driverId: string;
  driverName: string;
  vehiclePlate: string;
  emptyDamacana: number;
  emptyCamDamacana: number;
  emptyTupBuyuk: number;
  emptyTupKucuk: number;
  sebilReceived: number;
  remainingProducts: DispatchReturnProduct[];
}

export interface ReportDriver {
  id: string;
  name: string;
}

export interface ConsolidatedRow {
  key: string;
  driverId: string;
  driverName: string;
  customerId: string;
  customerName: string;
  customerAddress: string;
  isAccount: boolean;
  balance: number | null;
  times: number[];
  firstAt: number;
  lastAt: number;
  hasLateDelivery: boolean;
  deliveryCount: number;
  damacanaFull: number;
  camDamacanaFull: number;
  tupBuyukFull: number;
  tupKucukFull: number;
  damacanaEmpty: number;
  camDamacanaEmpty: number;
  tupBuyukEmpty: number;
  tupKucukEmpty: number;
  sebilGiven: number;
  sebilReceived: number;
  productLines: Array<{ productId: string; name: string; unit: string; quantity: number }>;
  deliveredAmount: number;
  deliveryCash: number;
  deliveryPos: number;
  paymentCash: number;
  paymentPos: number;
  notes: string[];
}

export interface ConsolidatedDriverSection {
  driverId: string;
  driverName: string;
  plates: string[];
  rows: ConsolidatedRow[];
  cash: number;
  pos: number;
  deliveredAmount: number;
  returns: DispatchReturnSummary[];
}

export interface ConsolidatedCustomerPaymentRow {
  driverName: string;
  customerName: string;
  source: 'Teslimat' | 'Teslimat Dışı' | 'Teslimat + Tahsilat';
  cash: number;
  pos: number;
}

export interface ConsolidatedProductLine {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  amount: number;
  hasAccountAmount: boolean;
  category: string;
}

export interface ConsolidatedReport {
  drivers: ConsolidatedDriverSection[];
  adminCash: number;
  adminPos: number;
  adminCount: number;
  customerPayments: ConsolidatedCustomerPaymentRow[];
  products: ConsolidatedProductLine[];
  icmal: {
    deliveryCount: number;
    visitedCustomerCount: number;
    driverCount: number;
    pesinCiro: number;
    hasAccountDelivery: boolean;
    deliveryCash: number;
    deliveryPos: number;
    standaloneCash: number;
    standalonePos: number;
    collectionTotal: number;
    creditAdded: number;
    damacanaFull: number;
    camDamacanaFull: number;
    tupBuyukFull: number;
    tupKucukFull: number;
    tupFull: number;
    damacanaEmpty: number;
    camDamacanaEmpty: number;
    tupBuyukEmpty: number;
    tupKucukEmpty: number;
    sebilGiven: number;
    sebilReceived: number;
  };
}

const toNumber = (value: unknown): number => Number(value) || 0;

const timeOf = (value: string | null | undefined): number => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

const isCashOrPos = (method: string) => method === 'CASH' || method === 'POS';

// III. "Gün İçinde Teslim Edilen Ürün ve Miktar Dökümü" tablosunun sırası:
// damacana → pet → bardak su → soda → tüp → bardak/sarf → sebil.
// Bardak Su ürünleri bardak kategorisinde tutulsa da pet ile soda arasında
// gösterilir; grupların içinde Türkçe alfabetik sıralama yapılır.
const REPORT_CATEGORY_RANK: Record<string, number> = {
  damacana: 1,
  pet: 2,
  bardak_su: 3,
  soda: 4,
  tup: 5,
  bardak: 6,
  sebil: 7,
};

const isBardakSuLine = (line: { name: string }): boolean =>
  line.name.toLocaleLowerCase('tr-TR').includes('bardak su');

export function sortConsolidatedProductLines(
  lines: ConsolidatedProductLine[]
): ConsolidatedProductLine[] {
  const rankOf = (line: ConsolidatedProductLine): number =>
    isBardakSuLine(line)
      ? REPORT_CATEGORY_RANK.bardak_su
      : REPORT_CATEGORY_RANK[line.category] ?? 99;

  return [...lines].sort((a, b) => {
    const rankA = rankOf(a);
    const rankB = rankOf(b);
    if (rankA !== rankB) return rankA - rankB;
    if (rankA === REPORT_CATEGORY_RANK.damacana) {
      // Cam damacana, damacana grubunun en sonunda (yükleme ekranıyla aynı kural).
      const glassA = isGlassDamacana({ category: a.category, name: a.name }) ? 1 : 0;
      const glassB = isGlassDamacana({ category: b.category, name: b.name }) ? 1 : 0;
      if (glassA !== glassB) return glassA - glassB;
    }
    return a.name.localeCompare(b.name, 'tr');
  });
}

function newRow(
  driverId: string,
  driverName: string,
  customerId: string,
  customerName: string,
  customerAddress: string,
  isAccount: boolean,
  balance: number | null
): ConsolidatedRow {
  return {
    key: `${driverId}|${customerId}`,
    driverId,
    driverName,
    customerId,
    customerName,
    customerAddress,
    isAccount,
    balance,
    times: [],
    firstAt: 0,
    lastAt: 0,
    hasLateDelivery: false,
    deliveryCount: 0,
    damacanaFull: 0,
    camDamacanaFull: 0,
    tupBuyukFull: 0,
    tupKucukFull: 0,
    damacanaEmpty: 0,
    camDamacanaEmpty: 0,
    tupBuyukEmpty: 0,
    tupKucukEmpty: 0,
    sebilGiven: 0,
    sebilReceived: 0,
    productLines: [],
    deliveredAmount: 0,
    deliveryCash: 0,
    deliveryPos: 0,
    paymentCash: 0,
    paymentPos: 0,
    notes: [],
  };
}

export function rowCash(row: ConsolidatedRow): number {
  return row.deliveryCash + row.paymentCash;
}

export function rowPos(row: ConsolidatedRow): number {
  return row.deliveryPos + row.paymentPos;
}

export function buildConsolidatedReport(input: {
  deliveries: Delivery[];
  payments: ReportPayment[];
  dispatches: ReportDispatch[];
  products: Product[];
  customers: Customer[];
  drivers: ReportDriver[];
}): ConsolidatedReport {
  const productById = new Map(input.products.map((p) => [p.id, p]));
  const customerById = new Map(input.customers.map((c) => [c.id, c]));
  const driverNameById = new Map(input.drivers.map((d) => [d.id, d.name]));

  const rows = new Map<string, ConsolidatedRow>();
  const platesByDriver = new Map<string, Set<string>>();
  const driverSeen = new Map<string, string>();
  const deliveredByDispatch = new Map<string, Map<string, number>>();
  const emptyByDispatch = new Map<
    string,
    {
      damacana: number;
      camDamacana: number;
      tupBuyuk: number;
      tupKucuk: number;
      sebil: number;
    }
  >();

  const rowFor = (
    driverId: string,
    driverName: string,
    customerId: string,
    customerName: string,
    customerAddress: string,
    isAccount: boolean
  ) => {
    const key = `${driverId}|${customerId}`;
    let row = rows.get(key);
    if (!row) {
      const customer = customerById.get(customerId);
      row = newRow(
        driverId,
        driverName,
        customerId,
        customerName,
        customerAddress,
        isAccount,
        customer ? toNumber(customer.currentBalanceTL) : null
      );
      rows.set(key, row);
    }
    return row;
  };

  const noteDriver = (driverId: string, driverName: string) => {
    if (!driverSeen.has(driverId)) driverSeen.set(driverId, driverName);
  };

  for (const dispatch of input.dispatches) {
    noteDriver(dispatch.driverId, dispatch.driverName);
    if (dispatch.vehiclePlate) {
      const set = platesByDriver.get(dispatch.driverId) || new Set<string>();
      set.add(dispatch.vehiclePlate);
      platesByDriver.set(dispatch.driverId, set);
    }
  }

  const icmal = {
    deliveryCount: 0,
    visitedCustomerCount: 0,
    driverCount: 0,
    pesinCiro: 0,
    hasAccountDelivery: false,
    deliveryCash: 0,
    deliveryPos: 0,
    standaloneCash: 0,
    standalonePos: 0,
    collectionTotal: 0,
    creditAdded: 0,
    damacanaFull: 0,
    camDamacanaFull: 0,
    tupBuyukFull: 0,
    tupKucukFull: 0,
    tupFull: 0,
    damacanaEmpty: 0,
    camDamacanaEmpty: 0,
    tupBuyukEmpty: 0,
    tupKucukEmpty: 0,
    sebilGiven: 0,
    sebilReceived: 0,
  };

  const productTotals = new Map<string, ConsolidatedProductLine>();

  for (const delivery of input.deliveries) {
    const driverName = delivery.driverName || driverNameById.get(delivery.driverId) || 'Bilinmeyen Şoför';
    noteDriver(delivery.driverId, driverName);
    if (delivery.vehiclePlate) {
      const set = platesByDriver.get(delivery.driverId) || new Set<string>();
      set.add(delivery.vehiclePlate);
      platesByDriver.set(delivery.driverId, set);
    }

    // Sefer bazında teslim edilen ürünler ve toplanan boşlar. Yükleme günü
    // raporunda bir sonraki güne kayan teslimatlar da buraya girer.
    if (delivery.dispatchId) {
      let deliveredMap = deliveredByDispatch.get(delivery.dispatchId);
      if (!deliveredMap) {
        deliveredMap = new Map<string, number>();
        deliveredByDispatch.set(delivery.dispatchId, deliveredMap);
      }
      for (const item of delivery.deliveredItems || []) {
        const productId = String(item?.productId || '');
        if (!productId) continue;
        deliveredMap.set(
          productId,
          (deliveredMap.get(productId) || 0) + toNumber(item.quantity)
        );
      }

      let empty = emptyByDispatch.get(delivery.dispatchId);
      if (!empty) {
        empty = { damacana: 0, camDamacana: 0, tupBuyuk: 0, tupKucuk: 0, sebil: 0 };
        emptyByDispatch.set(delivery.dispatchId, empty);
      }
      empty.damacana += toNumber(delivery.emptyContainersReceived?.damacana);
      empty.camDamacana += toNumber(
        delivery.emptyContainersReceived?.camDamacana ??
          delivery.emptyContainersReceived?.cam_damacana
      );
      empty.tupBuyuk += toNumber(delivery.emptyContainersReceived?.tupBuyuk);
      empty.tupKucuk += toNumber(delivery.emptyContainersReceived?.tupKucuk);
      empty.sebil += toNumber(delivery.emptyContainersReceived?.sebil);
    }

    const customer = customerById.get(delivery.customerId);
    const isAccount = isAccountCustomerDelivery(delivery, input.customers);
    const row = rowFor(
      delivery.driverId,
      driverName,
      delivery.customerId,
      customer?.name || delivery.customerName,
      customer?.address ?? delivery.customerAddress ?? '',
      isAccount
    );
    if (isAccount) row.isAccount = true;

    row.deliveryCount += 1;
    if (delivery.isLateDelivery) row.hasLateDelivery = true;
    row.times.push(timeOf(delivery.timestamp));

    icmal.deliveryCount += 1;
    if (isAccount) icmal.hasAccountDelivery = true;

    for (const item of delivery.deliveredItems || []) {
      const quantity = toNumber(item.quantity);
      if (quantity <= 0) continue;
      const product = productById.get(item.productId);
      const depositType = product?.depositType ?? 'none';

      const totals = productTotals.get(item.productId) || {
        productId: item.productId,
        name: item.productName || product?.name || item.productId,
        unit: product?.unit || 'Adet',
        quantity: 0,
        amount: 0,
        hasAccountAmount: false,
        category: product?.category || 'none',
      };
      totals.quantity += quantity;
      if (isAccount) totals.hasAccountAmount = true;
      else totals.amount += toNumber(item.lineTotal);
      productTotals.set(item.productId, totals);

      if (depositType === 'damacana') {
        row.damacanaFull += quantity;
        icmal.damacanaFull += quantity;
      } else if (depositType === 'cam_damacana') {
        row.camDamacanaFull += quantity;
        icmal.camDamacanaFull += quantity;
      } else if (depositType === 'tup_buyuk') {
        row.tupBuyukFull += quantity;
        icmal.tupBuyukFull += quantity;
        icmal.tupFull += quantity;
      } else if (depositType === 'tup_kucuk') {
        row.tupKucukFull += quantity;
        icmal.tupKucukFull += quantity;
        icmal.tupFull += quantity;
      } else if (depositType === 'sebil') {
        row.sebilGiven += quantity;
        icmal.sebilGiven += quantity;
      } else {
        const existing = row.productLines.find((line) => line.productId === item.productId);
        if (existing) existing.quantity += quantity;
        else
          row.productLines.push({
            productId: item.productId,
            name: item.productName || product?.name || item.productId,
            unit: product?.unit || 'Adet',
            quantity,
          });
      }
    }

    if (!isAccount) {
      const amount = toNumber(delivery.deliveredGrandTotal);
      row.deliveredAmount += amount;
      icmal.pesinCiro += amount;
      const diff = toNumber(delivery.collectedPayment?.diffUncollected);
      if (diff > 0) icmal.creditAdded += diff;
    }

    const cash = toNumber(delivery.collectedPayment?.cashAmount);
    const pos = toNumber(delivery.collectedPayment?.posAmount);
    row.deliveryCash += cash;
    row.deliveryPos += pos;
    icmal.deliveryCash += cash;
    icmal.deliveryPos += pos;

    const damacana = toNumber(delivery.emptyContainersReceived?.damacana);
    const camDamacana = toNumber(
      delivery.emptyContainersReceived?.camDamacana ?? delivery.emptyContainersReceived?.cam_damacana
    );
    const tupBuyuk = toNumber(delivery.emptyContainersReceived?.tupBuyuk);
    const tupKucuk = toNumber(delivery.emptyContainersReceived?.tupKucuk);
    const sebil = toNumber(delivery.emptyContainersReceived?.sebil);
    row.damacanaEmpty += damacana;
    row.camDamacanaEmpty += camDamacana;
    row.tupBuyukEmpty += tupBuyuk;
    row.tupKucukEmpty += tupKucuk;
    row.sebilReceived += sebil;
    icmal.damacanaEmpty += damacana;
    icmal.camDamacanaEmpty += camDamacana;
    icmal.tupBuyukEmpty += tupBuyuk;
    icmal.tupKucukEmpty += tupKucuk;
    icmal.sebilReceived += sebil;

    const note = (delivery.notes || '').trim();
    if (note && !row.notes.includes(note)) row.notes.push(note);
  }

  const adminPayments = { cash: 0, pos: 0, count: 0 };

  for (const payment of input.payments) {
    if (!isCashOrPos(payment.method)) continue;
    const amount = toNumber(payment.amount);
    const cash = payment.method === 'CASH' ? amount : 0;
    const pos = payment.method === 'POS' ? amount : 0;

    icmal.standaloneCash += cash;
    icmal.standalonePos += pos;

    if (!driverNameById.has(payment.collectedByUserId)) {
      adminPayments.cash += cash;
      adminPayments.pos += pos;
      adminPayments.count += 1;
      continue;
    }

    const driverName = driverNameById.get(payment.collectedByUserId) || payment.collectedByUserName;
    noteDriver(payment.collectedByUserId, driverName);
    const customer = customerById.get(payment.customerId);
    const row = rowFor(
      payment.collectedByUserId,
      driverName,
      payment.customerId,
      customer?.name || payment.customerName || payment.customerId,
      customer?.address ?? '',
      Boolean(customer?.isAccountCustomer)
    );
    row.times.push(timeOf(payment.collectedAt));
    row.paymentCash += cash;
    row.paymentPos += pos;
    const note = (payment.note || '').trim();
    if (note && !row.notes.includes(note)) row.notes.push(note);
  }

  const allRows = Array.from(rows.values());
  for (const row of allRows) {
    row.times = row.times.filter((t) => t > 0);
    row.firstAt = row.times.length ? Math.min(...row.times) : 0;
    row.lastAt = row.times.length ? Math.max(...row.times) : 0;
  }

  // Sefer bazında depoya iade özeti. Sadece adedi sıfırdan büyük kalemler
  // tutulur; tamamen boş seferler rapora hiç girmez.
  const returnsByDriver = new Map<string, DispatchReturnSummary[]>();
  for (const dispatch of input.dispatches) {
    if (!dispatch.id) continue;

    const empty = emptyByDispatch.get(dispatch.id) || {
      damacana: 0,
      camDamacana: 0,
      tupBuyuk: 0,
      tupKucuk: 0,
      sebil: 0,
    };
    const deliveredMap = deliveredByDispatch.get(dispatch.id);
    const remainingProducts: DispatchReturnProduct[] = [];

    for (const loaded of dispatch.loadedItems || []) {
      const loadedQuantity = toNumber(loaded.quantity);
      const deliveredQuantity = deliveredMap?.get(loaded.productId) || 0;
      const remaining = loadedQuantity - deliveredQuantity;
      if (remaining <= 0) continue;
      const product = productById.get(loaded.productId);
      remainingProducts.push({
        productId: loaded.productId,
        name: product?.name || loaded.productId,
        unit: product?.unit || 'Adet',
        loaded: loadedQuantity,
        delivered: deliveredQuantity,
        remaining,
        isDeposit: Boolean(product?.isDeposit),
      });
    }

    const hasEmpty =
      empty.damacana > 0 ||
      empty.camDamacana > 0 ||
      empty.tupBuyuk > 0 ||
      empty.tupKucuk > 0 ||
      empty.sebil > 0;
    if (!hasEmpty && remainingProducts.length === 0) continue;

    const driverReturns = returnsByDriver.get(dispatch.driverId) || [];
    driverReturns.push({
      dispatchId: dispatch.id,
      driverId: dispatch.driverId,
      driverName: dispatch.driverName,
      vehiclePlate: dispatch.vehiclePlate,
      emptyDamacana: empty.damacana,
      emptyCamDamacana: empty.camDamacana,
      emptyTupBuyuk: empty.tupBuyuk,
      emptyTupKucuk: empty.tupKucuk,
      sebilReceived: empty.sebil,
      remainingProducts,
    });
    returnsByDriver.set(dispatch.driverId, driverReturns);
  }

  const drivers: ConsolidatedDriverSection[] = Array.from(driverSeen.entries())
    .map(([driverId, driverName]) => {
      const driverRows = allRows
        .filter((row) => row.driverId === driverId)
        .sort(
          (a, b) =>
            (a.firstAt || Number.MAX_SAFE_INTEGER) - (b.firstAt || Number.MAX_SAFE_INTEGER) ||
            a.customerName.localeCompare(b.customerName, 'tr')
        );
      return {
        driverId,
        driverName,
        plates: Array.from(platesByDriver.get(driverId) || []),
        rows: driverRows,
        cash: driverRows.reduce((sum, row) => sum + rowCash(row), 0),
        pos: driverRows.reduce((sum, row) => sum + rowPos(row), 0),
        deliveredAmount: driverRows.reduce((sum, row) => sum + row.deliveredAmount, 0),
        returns: returnsByDriver.get(driverId) || [],
      };
    })
    .filter((section) => section.rows.length > 0 || section.plates.length > 0)
    .sort((a, b) => a.driverName.localeCompare(b.driverName, 'tr'));

  const customerPayments: ConsolidatedCustomerPaymentRow[] = [];
  for (const row of allRows) {
    const deliveryPaid = row.deliveryCash + row.deliveryPos;
    const standalonePaid = row.paymentCash + row.paymentPos;
    let source: ConsolidatedCustomerPaymentRow['source'] | null = null;
    if (deliveryPaid > 0 && standalonePaid > 0) source = 'Teslimat + Tahsilat';
    else if (standalonePaid > 0) source = 'Teslimat Dışı';
    else if (deliveryPaid > 0) source = 'Teslimat';
    if (!source) continue;
    customerPayments.push({
      driverName: row.driverName,
      customerName: row.customerName,
      source,
      cash: rowCash(row),
      pos: rowPos(row),
    });
  }
  customerPayments.sort(
    (a, b) => a.driverName.localeCompare(b.driverName, 'tr') || a.customerName.localeCompare(b.customerName, 'tr')
  );

  // Teslimat yapılmadan yalnızca tahsilat alınan müşteri de bir müşteri
  // ilişkisidir; rapordaki tek satırla tutarlı olsun diye tüm satırlar sayılır.
  const allCustomerIds = new Set(allRows.map((row) => row.customerId));
  icmal.visitedCustomerCount = allCustomerIds.size;
  icmal.driverCount = drivers.length;
  icmal.collectionTotal =
    icmal.deliveryCash + icmal.deliveryPos + icmal.standaloneCash + icmal.standalonePos;

  return {
    drivers,
    adminCash: adminPayments.cash,
    adminPos: adminPayments.pos,
    adminCount: adminPayments.count,
    customerPayments,
    products: sortConsolidatedProductLines(Array.from(productTotals.values())),
    icmal,
  };
}
