import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  User,
  Product,
  Customer,
  Dispatch,
  Delivery,
  CleanupStatus
} from './src/types/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const DB_FILE = path.resolve(__dirname, 'data_store.json');

app.use(express.json());

// In-memory / File-backed Database Structure
interface DatabaseSchema {
  users: User[];
  products: Product[];
  customers: Customer[];
  dispatches: Dispatch[];
  deliveries: Delivery[];
  lastCleanupDate?: string;
  purgedCountTotal?: number;
}

const defaultProducts: Product[] = [
  {
    id: 'prod_damacana_19l',
    name: '19L Damacana Su (Polikarbon)',
    category: 'damacana',
    defaultUnitPrice: 100,
    isDeposit: true,
    depositType: 'damacana',
    unit: 'Adet',
    description: 'Doğal kaynak damacana su - depozitolu 19 litre',
  },
  {
    id: 'prod_pet_05l_24',
    name: '0.5L Pet Su (24\'lü Koli)',
    category: 'pet',
    defaultUnitPrice: 120,
    isDeposit: false,
    depositType: 'none',
    unit: 'Koli',
    description: '24 adet 500ml pet şişe doğal kaynak suyu',
  },
  {
    id: 'prod_pet_15l_12',
    name: '1.5L Pet Su (12\'li Koli)',
    category: 'pet',
    defaultUnitPrice: 110,
    isDeposit: false,
    depositType: 'none',
    unit: 'Koli',
    description: '12 adet 1.5 litre pet şişe su',
  },
  {
    id: 'prod_soda_beypazari_24',
    name: 'Beypazarı Maden Suyu (24\'lü Koli)',
    category: 'soda',
    defaultUnitPrice: 180,
    isDeposit: false,
    depositType: 'none',
    unit: 'Koli',
    description: 'Doğal maden suyu 200ml cam şişe',
  },
  {
    id: 'prod_soda_kizilay_24',
    name: 'Kızılay Maden Suyu (24\'lü Koli)',
    category: 'soda',
    defaultUnitPrice: 175,
    isDeposit: false,
    depositType: 'none',
    unit: 'Koli',
    description: '24 adet 200ml sade maden suyu',
  },
  {
    id: 'prod_tup_12kg',
    name: 'Mutfak Tüpü (12 Kg - Tombul/Uzun)',
    category: 'tup',
    defaultUnitPrice: 750,
    isDeposit: true,
    depositType: 'tup',
    unit: 'Adet',
    description: 'Ev tipi 12kg gaz tüpü - depozitolu boş tüp iadeli',
  },
  {
    id: 'prod_tup_2kg',
    name: 'Piknik Tüpü (2 Kg)',
    category: 'tup',
    defaultUnitPrice: 160,
    isDeposit: true,
    depositType: 'tup',
    unit: 'Adet',
    description: '2kg piknik gaz tüpü - depozitolu',
  },
  {
    id: 'prod_bardak_3000',
    name: 'Karton Bardak 7oz (3000\'li Koli)',
    category: 'bardak',
    defaultUnitPrice: 320,
    isDeposit: false,
    depositType: 'none',
    unit: 'Koli',
    description: 'Sıcak ve soğuk su sebili uyumlu tek kullanımlık bardak',
  },
];

const defaultUsers: User[] = [
  {
    id: 'usr_admin',
    name: 'Uğur Fırtına',
    username: 'yonetici',
    role: 'admin',
    canLoadVehicle: true,
    pin: '1234',
    phone: '0532 555 10 00',
  },
  {
    id: 'usr_driver_1',
    name: 'Ahmet Yılmaz',
    username: 'ahmet',
    role: 'driver',
    canLoadVehicle: true, // Authorized lead driver
    assignedPlate: '34 SU 101',
    pin: '1010',
    phone: '0533 555 20 01',
  },
  {
    id: 'usr_driver_2',
    name: 'Mehmet Kaya',
    username: 'mehmet',
    role: 'driver',
    canLoadVehicle: false, // Standard driver (inspects and confirms load)
    assignedPlate: '34 SU 202',
    pin: '2020',
    phone: '0535 555 30 02',
  },
  {
    id: 'usr_driver_3',
    name: 'Serkan Aydın',
    username: 'serkan',
    role: 'driver',
    canLoadVehicle: false, // Standard driver
    assignedPlate: '34 SU 303',
    pin: '3030',
    phone: '0536 555 40 03',
  },
];

const defaultCustomers: Customer[] = [
  {
    id: 'cust_1',
    name: 'Yıldız Cafe & Bistro',
    phone: '0216 450 11 22',
    address: 'Moda Cad. No: 42, Kadıköy',
    district: 'Kadıköy',
    isAccountCustomer: true,
    currentBalanceTL: 0,
    emptyDepositBalance: { damacana: 4, tup: 0 },
    customPrices: {
      prod_damacana_19l: 85,
      prod_soda_beypazari_24: 165,
    },
    notes: 'Arka kapıdan mutfağa bırakılacak. Sabah 10:00 dan önce teslimat.',
    createdDate: '2026-09-01',
  },
  {
    id: 'cust_2',
    name: 'Boğaziçi Unlu Mamülleri',
    phone: '0216 340 33 44',
    address: 'Hakimiyeti Milliye Cad. No: 18, Üsküdar',
    district: 'Üsküdar',
    isAccountCustomer: true,
    currentBalanceTL: 350,
    emptyDepositBalance: { damacana: 6, tup: 1 },
    customPrices: {
      prod_damacana_19l: 85,
      prod_pet_05l_24: 110,
    },
    notes: 'Fırın ustası Mehmet Bey teslim alıyor.',
    createdDate: '2026-09-10',
  },
  {
    id: 'cust_3',
    name: 'Demir Hukuk & Mimarlık',
    phone: '0216 570 55 66',
    address: 'Varyap Meridian B Blok Kat: 12, Ataşehir',
    district: 'Ataşehir',
    isAccountCustomer: true,
    currentBalanceTL: 285,
    emptyDepositBalance: { damacana: 3, tup: 0 },
    customPrices: {
      prod_damacana_19l: 95,
    },
    notes: 'Danışma sekreteryaya bırakılıyor.',
    createdDate: '2026-09-15',
  },
  {
    id: 'cust_4',
    name: 'Marmara Balıkçısı',
    phone: '0216 380 77 88',
    address: 'Sahil Yolu No: 85, Maltepe',
    district: 'Maltepe',
    isAccountCustomer: false, // Peşin çalışan müşteri
    currentBalanceTL: 0,
    emptyDepositBalance: { damacana: 8, tup: 2 },
    customPrices: {
      prod_damacana_19l: 90,
      prod_soda_kizilay_24: 160,
    },
    notes: 'Kasa görevlisi Ayhan Bey peşin ödüyor.',
    createdDate: '2026-09-20',
  },
  {
    id: 'cust_5',
    name: 'Ayşe Hanım (Ev Abonesi)',
    phone: '0532 111 22 33',
    address: 'Bağdat Cad. Çiçek Apt. D: 5, Bostancı',
    district: 'Kadıköy',
    isAccountCustomer: false,
    currentBalanceTL: 0,
    emptyDepositBalance: { damacana: 1, tup: 0 },
    customPrices: {},
    notes: 'Zil bozuk, gelince cepten aranacak.',
    createdDate: '2026-09-25',
  },
  {
    id: 'cust_6',
    name: 'Çağdaş Spor Kompleksi',
    phone: '0216 488 99 00',
    address: 'Atalar Mah. Spor Cad. No: 14, Kartal',
    district: 'Kartal',
    isAccountCustomer: true,
    currentBalanceTL: 600,
    emptyDepositBalance: { damacana: 12, tup: 0 },
    customPrices: {
      prod_damacana_19l: 80,
      prod_pet_05l_24: 105,
      prod_bardak_3000: 290,
    },
    notes: 'Giriş resepsiyonu ve spor salonu sebilleri için.',
    createdDate: '2026-09-28',
  },
];

const getTodayDateStr = () => new Date().toISOString().split('T')[0];

const defaultDispatches: Dispatch[] = [
  {
    id: 'disp_today_1',
    date: getTodayDateStr(),
    driverId: 'usr_driver_1',
    driverName: 'Ahmet Yılmaz',
    vehiclePlate: '34 SU 101',
    loadedByUserId: 'usr_admin',
    loadedByUserName: 'Mustafa Demir (Firma Sahibi)',
    driverConfirmedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    status: 'in_transit',
    loadedItems: [
      { productId: 'prod_damacana_19l', quantity: 95 },
      { productId: 'prod_pet_05l_24', quantity: 20 },
      { productId: 'prod_soda_beypazari_24', quantity: 15 },
      { productId: 'prod_bardak_3000', quantity: 5 },
    ],
    createdAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
  },
  {
    id: 'disp_today_2',
    date: getTodayDateStr(),
    driverId: 'usr_driver_2',
    driverName: 'Mehmet Kaya',
    vehiclePlate: '34 SU 202',
    loadedByUserId: 'usr_admin',
    loadedByUserName: 'Mustafa Demir (Firma Sahibi)',
    driverConfirmedAt: null, // PENDING DRIVER CONFIRMATION!
    status: 'pending_confirmation',
    loadedItems: [
      { productId: 'prod_damacana_19l', quantity: 80 },
      { productId: 'prod_pet_05l_24', quantity: 15 },
      { productId: 'prod_soda_kizilay_24', quantity: 10 },
      { productId: 'prod_tup_12kg', quantity: 4 },
    ],
    createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  },
];

const defaultDeliveries: Delivery[] = [
  {
    id: 'del_101',
    dispatchId: 'disp_today_1',
    driverId: 'usr_driver_1',
    driverName: 'Ahmet Yılmaz',
    vehiclePlate: '34 SU 101',
    customerId: 'cust_1',
    customerName: 'Yıldız Cafe & Bistro',
    customerAddress: 'Moda Cad. No: 42, Kadıköy',
    customerPhone: '0216 450 11 22',
    timestamp: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    deliveredItems: [
      {
        productId: 'prod_damacana_19l',
        productName: '19L Damacana Su',
        quantity: 8,
        unitPrice: 85,
        lineTotal: 680,
      },
      {
        productId: 'prod_soda_beypazari_24',
        productName: 'Beypazarı Maden Suyu (24\'lü)',
        quantity: 2,
        unitPrice: 165,
        lineTotal: 330,
      },
    ],
    deliveredGrandTotal: 1010,
    collectedPayment: {
      method: 'MIXED',
      cashAmount: 510,
      posAmount: 500,
      totalCollected: 1010,
      status: 'paid_full',
      diffUncollected: 0,
    },
    emptyContainersReceived: { damacana: 8, tup: 0 },
    emptyContainersDiff: { damacana: 0, tup: 0 },
    notes: 'Teslim edildi, boşlar mutfaktan alındı.',
  },
  {
    id: 'del_102',
    dispatchId: 'disp_today_1',
    driverId: 'usr_driver_1',
    driverName: 'Ahmet Yılmaz',
    vehiclePlate: '34 SU 101',
    customerId: 'cust_3',
    customerName: 'Demir Hukuk & Mimarlık',
    customerAddress: 'Varyap Meridian B Blok Kat: 12, Ataşehir',
    customerPhone: '0216 570 55 66',
    timestamp: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    deliveredItems: [
      {
        productId: 'prod_damacana_19l',
        productName: '19L Damacana Su',
        quantity: 3,
        unitPrice: 95,
        lineTotal: 285,
      },
    ],
    deliveredGrandTotal: 285,
    collectedPayment: {
      method: 'UNPAID',
      cashAmount: 0,
      posAmount: 0,
      totalCollected: 0,
      status: 'unpaid',
      diffUncollected: 285,
    },
    emptyContainersReceived: { damacana: 2, tup: 0 },
    emptyContainersDiff: { damacana: 1, tup: 0 }, // 1 damacana customer deficit!
    notes: 'Tahsilat alınmadı, cariye eklendi. 1 boş eksik verildi.',
  },
  {
    id: 'del_103',
    dispatchId: 'disp_today_1',
    driverId: 'usr_driver_1',
    driverName: 'Ahmet Yılmaz',
    vehiclePlate: '34 SU 101',
    customerId: 'cust_5',
    customerName: 'Ayşe Hanım (Ev Abonesi)',
    customerAddress: 'Bağdat Cad. Çiçek Apt. D: 5, Bostancı',
    customerPhone: '0532 111 22 33',
    timestamp: new Date(Date.now() - 1 * 3600 * 1000).toISOString(),
    deliveredItems: [
      {
        productId: 'prod_damacana_19l',
        productName: '19L Damacana Su',
        quantity: 1,
        unitPrice: 100,
        lineTotal: 100,
      },
    ],
    deliveredGrandTotal: 100,
    collectedPayment: {
      method: 'CASH',
      cashAmount: 100,
      posAmount: 0,
      totalCollected: 100,
      status: 'paid_full',
      diffUncollected: 0,
    },
    emptyContainersReceived: { damacana: 1, tup: 0 },
    emptyContainersDiff: { damacana: 0, tup: 0 },
    notes: 'Nakit tahsilat yapıldı.',
  },
];

// Helper: Load database or initialize with seed data
function loadDatabase(): DatabaseSchema {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(data) as DatabaseSchema;
      return parsed;
    }
  } catch (err) {
    console.error('Error loading database file, falling back to defaults', err);
  }

  const initialDb: DatabaseSchema = {
    users: defaultUsers,
    products: defaultProducts,
    customers: defaultCustomers,
    dispatches: defaultDispatches,
    deliveries: defaultDeliveries,
    purgedCountTotal: 0,
  };
  saveDatabase(initialDb);
  return initialDb;
}

function saveDatabase(db: DatabaseSchema) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing database file', err);
  }
}

// 60-Day Automatic Cleanup Routine
function runRetentionCleanup(db: DatabaseSchema): { purgedDispatches: number; purgedDeliveries: number } {
  const RETENTION_DAYS = 60;
  const thresholdMs = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  const thresholdDateStr = new Date(thresholdMs).toISOString().split('T')[0];

  const initialDispatches = db.dispatches.length;
  const initialDeliveries = db.deliveries.length;

  // Filter out dispatches and deliveries older than 60 days
  const retainedDispatches = db.dispatches.filter((d) => {
    // Keep if date is within threshold
    return d.date >= thresholdDateStr;
  });

  const retainedDispatchIds = new Set(retainedDispatches.map((d) => d.id));

  const retainedDeliveries = db.deliveries.filter((del) => {
    // Keep if delivery timestamp is newer than threshold AND belongs to retained dispatch (or within 60 days)
    const delDate = del.timestamp.split('T')[0];
    return delDate >= thresholdDateStr && retainedDispatchIds.has(del.dispatchId);
  });

  const purgedDispatches = initialDispatches - retainedDispatches.length;
  const purgedDeliveries = initialDeliveries - retainedDeliveries.length;

  if (purgedDispatches > 0 || purgedDeliveries > 0) {
    db.dispatches = retainedDispatches;
    db.deliveries = retainedDeliveries;
    db.lastCleanupDate = new Date().toISOString();
    db.purgedCountTotal = (db.purgedCountTotal || 0) + purgedDispatches + purgedDeliveries;
    saveDatabase(db);
    console.log(
      `[Cleanup] Automatically purged records older than 60 days (${thresholdDateStr}): ${purgedDispatches} dispatches, ${purgedDeliveries} deliveries.`
    );
  }

  return { purgedDispatches, purgedDeliveries };
}

let db = loadDatabase();
// Run retention cleanup upon boot
runRetentionCleanup(db);

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

app.get('/api/users', (req, res) => {
  res.json({ users: db.users });
});

app.post('/api/auth/login', (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre/PIN gereklidir' });
  }

  const user = db.users.find(
    (u) =>
      u.username.toLowerCase() === username.trim().toLowerCase() &&
      u.pin.toString() === pin.toString().trim()
  );

  if (!user) {
    return res.status(401).json({ error: 'Hatalı kullanıcı adı veya şifre!' });
  }

  res.json({ user, message: 'Giriş başarılı' });
});

app.post('/api/users', (req, res) => {
  const { name, username, role, canLoadVehicle, assignedPlate, pin, phone } = req.body;
  if (!name || !username || !role) {
    return res.status(400).json({ error: 'İsim, kullanıcı adı ve rol zorunludur' });
  }
  const newUser: User = {
    id: `usr_${Date.now()}`,
    name,
    username,
    role,
    canLoadVehicle: !!canLoadVehicle,
    assignedPlate: assignedPlate || '',
    pin: pin || '1234',
    phone: phone || '',
  };
  db.users.push(newUser);
  saveDatabase(db);
  res.status(201).json({ user: newUser });
});

app.put('/api/users/:id', (req, res) => {
  const userIndex = db.users.findIndex((u) => u.id === req.params.id);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  }
  db.users[userIndex] = { ...db.users[userIndex], ...req.body };
  saveDatabase(db);
  res.json({ user: db.users[userIndex] });
});

// 2. Products
app.get('/api/products', (req, res) => {
  res.json({ products: db.products });
});

app.post('/api/products', (req, res) => {
  const { name, category, defaultUnitPrice, isDeposit, depositType, unit, description } = req.body;
  const newProduct: Product = {
    id: `prod_${Date.now()}`,
    name,
    category: category || 'damacana',
    defaultUnitPrice: Number(defaultUnitPrice) || 100,
    isDeposit: !!isDeposit,
    depositType: depositType || 'none',
    unit: unit || 'Adet',
    description: description || '',
  };
  db.products.push(newProduct);
  saveDatabase(db);
  res.status(201).json({ product: newProduct });
});

app.put('/api/products/:id', (req, res) => {
  const idx = db.products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Ürün bulunamadı' });
  db.products[idx] = { ...db.products[idx], ...req.body };
  saveDatabase(db);
  res.json({ product: db.products[idx] });
});

// 3. Customers
app.get('/api/customers', (req, res) => {
  res.json({ customers: db.customers });
});

app.post('/api/customers', (req, res) => {
  const { name, phone, address, district, isAccountCustomer, notes, customPrices } = req.body;
  if (!name) return res.status(400).json({ error: 'Müşteri adı zorunludur' });

  const newCust: Customer = {
    id: `cust_${Date.now()}`,
    name,
    phone: phone || '',
    address: address || '',
    district: district || '',
    isAccountCustomer: !!isAccountCustomer,
    currentBalanceTL: 0,
    emptyDepositBalance: { damacana: 0, tup: 0 },
    customPrices: customPrices || {},
    notes: notes || '',
    createdDate: getTodayDateStr(),
  };

  db.customers.push(newCust);
  saveDatabase(db);
  res.status(201).json({ customer: newCust });
});

app.put('/api/customers/:id', (req, res) => {
  const idx = db.customers.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Müşteri bulunamadı' });
  db.customers[idx] = { ...db.customers[idx], ...req.body };
  saveDatabase(db);
  res.json({ customer: db.customers[idx] });
});

// 4. Dispatches (Seferler & Yüklemeler)
app.get('/api/dispatches', (req, res) => {
  const date = req.query.date as string;
  let dispatches = db.dispatches;
  if (date) {
    dispatches = dispatches.filter((d) => d.date === date);
  }
  res.json({ dispatches });
});

// Create warehouse loading (Restricted to admin or authorized driver with canLoadVehicle)
app.post('/api/dispatches', (req, res) => {
  const {
    driverId,
    vehiclePlate,
    loadedItems,
    loadedByUserId,
    loadedByUserName,
    driverConfirmed,
  } = req.body;

  const driver = db.users.find((u) => u.id === driverId);
  if (!driver) return res.status(404).json({ error: 'Şoför bulunamadı' });

  const todayStr = getTodayDateStr();

  // If driver confirmed right away (e.g. self-loaded authorized driver)
  const isConfirmed = !!driverConfirmed;

  const newDispatch: Dispatch = {
    id: `disp_${Date.now()}`,
    date: todayStr,
    driverId,
    driverName: driver.name,
    vehiclePlate: vehiclePlate || driver.assignedPlate || '34 SU 000',
    loadedByUserId: loadedByUserId || 'usr_admin',
    loadedByUserName: loadedByUserName || 'Yönetici',
    driverConfirmedAt: isConfirmed ? new Date().toISOString() : null,
    status: isConfirmed ? 'in_transit' : 'pending_confirmation',
    loadedItems: loadedItems || [],
    createdAt: new Date().toISOString(),
  };

  db.dispatches.push(newDispatch);
  saveDatabase(db);
  res.status(201).json({ dispatch: newDispatch });
});

// Update / adjust vehicle load (Before or during route by authorized user)
app.put('/api/dispatches/:id', (req, res) => {
  const idx = db.dispatches.findIndex((d) => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Sefer bulunamadı' });

  db.dispatches[idx] = { ...db.dispatches[idx], ...req.body };
  saveDatabase(db);
  res.json({ dispatch: db.dispatches[idx] });
});

// Driver confirms loading count and starts route
app.post('/api/dispatches/:id/confirm', (req, res) => {
  const idx = db.dispatches.findIndex((d) => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Sefer bulunamadı' });

  db.dispatches[idx].driverConfirmedAt = new Date().toISOString();
  db.dispatches[idx].status = 'in_transit';
  saveDatabase(db);
  res.json({ dispatch: db.dispatches[idx] });
});

// Driver / Admin closes end of day reconciliation
app.post('/api/dispatches/:id/close', (req, res) => {
  const idx = db.dispatches.findIndex((d) => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Sefer bulunamadı' });

  const {
    closedByUserId,
    closedByUserName,
    remainingFullCounted,
    collectedEmptyDamacana,
    collectedEmptyTup,
    actualCashInPocket,
    actualPosSlipsTotal,
    notes,
  } = req.body;

  const dispatch = db.dispatches[idx];

  // Calculate actual delivered quantities and expected remaining
  const dispatchDeliveries = db.deliveries.filter((del) => del.dispatchId === dispatch.id);

  const deliveredTotals: Record<string, number> = {};
  let totalDeliveredValue = 0;
  let totalCashCollected = 0;
  let totalPosCollected = 0;
  let totalCreditAdded = 0;

  dispatchDeliveries.forEach((del) => {
    totalDeliveredValue += del.deliveredGrandTotal;
    totalCashCollected += del.collectedPayment.cashAmount;
    totalPosCollected += del.collectedPayment.posAmount;
    if (del.collectedPayment.diffUncollected > 0) {
      totalCreditAdded += del.collectedPayment.diffUncollected;
    }

    del.deliveredItems.forEach((item) => {
      deliveredTotals[item.productId] = (deliveredTotals[item.productId] || 0) + item.quantity;
    });
  });

  const remainingFullExpected: Record<string, number> = {};
  dispatch.loadedItems.forEach((loaded) => {
    const deliveredCount = deliveredTotals[loaded.productId] || 0;
    remainingFullExpected[loaded.productId] = Math.max(0, loaded.quantity - deliveredCount);
  });

  dispatch.endOfDayReconciliation = {
    closedAt: new Date().toISOString(),
    closedByUserId: closedByUserId || dispatch.driverId,
    closedByUserName: closedByUserName || dispatch.driverName,
    remainingFullCounted: remainingFullCounted || {},
    remainingFullExpected,
    collectedEmptyDamacana: Number(collectedEmptyDamacana) || 0,
    collectedEmptyTup: Number(collectedEmptyTup) || 0,
    actualCashInPocket: Number(actualCashInPocket) || 0,
    actualPosSlipsTotal: Number(actualPosSlipsTotal) || 0,
    totalDeliveredValue,
    totalCashCollected,
    totalPosCollected,
    totalCreditAdded,
    notes: notes || '',
  };

  dispatch.status = 'completed';
  saveDatabase(db);
  res.json({ dispatch });
});

// 5. Deliveries (Saha Teslimatları & Canlı Ekip Akışı)
app.get('/api/deliveries', (req, res) => {
  const dispatchId = req.query.dispatchId as string;
  const driverId = req.query.driverId as string;
  const date = req.query.date as string;

  let deliveries = [...db.deliveries];

  if (dispatchId) {
    deliveries = deliveries.filter((d) => d.dispatchId === dispatchId);
  }
  if (driverId) {
    deliveries = deliveries.filter((d) => d.driverId === driverId);
  }
  if (date) {
    deliveries = deliveries.filter((d) => d.timestamp.startsWith(date));
  }

  // Sort newest first for live team activity feed
  deliveries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  res.json({ deliveries });
});

app.post('/api/deliveries', (req, res) => {
  const {
    dispatchId,
    driverId,
    customerId,
    deliveredItems,
    collectedPayment,
    emptyContainersReceived,
    notes,
    isOfflineSync,
  } = req.body;

  const dispatch = db.dispatches.find((d) => d.id === dispatchId);
  const driver = db.users.find((u) => u.id === driverId);
  const customerIdx = db.customers.findIndex((c) => c.id === customerId);

  if (!dispatch || !driver || customerIdx === -1) {
    return res.status(400).json({ error: 'Geçersiz sefer, şoför veya müşteri bilgisi' });
  }

  const customer = db.customers[customerIdx];

  // Calculate delivered grand total
  const items = deliveredItems || [];
  let deliveredGrandTotal = 0;
  let depositDeliveredDamacana = 0;
  let depositDeliveredTup = 0;

  items.forEach((item: any) => {
    deliveredGrandTotal += item.lineTotal;
    const prod = db.products.find((p) => p.id === item.productId);
    if (prod?.depositType === 'damacana') {
      depositDeliveredDamacana += item.quantity;
    } else if (prod?.depositType === 'tup') {
      depositDeliveredTup += item.quantity;
    }

    // Automatically remember last custom price for this customer!
    if (item.unitPrice && prod) {
      if (!customer.customPrices) customer.customPrices = {};
      customer.customPrices[item.productId] = item.unitPrice;
    }
  });

  const emptiesRecv = emptyContainersReceived || { damacana: 0, tup: 0 };
  const emptyContainersDiff = {
    damacana: depositDeliveredDamacana - (emptiesRecv.damacana || 0),
    tup: depositDeliveredTup - (emptiesRecv.tup || 0),
  };

  // Update customer deposit empty balance
  if (!customer.emptyDepositBalance) customer.emptyDepositBalance = { damacana: 0, tup: 0 };
  customer.emptyDepositBalance.damacana += emptyContainersDiff.damacana;
  customer.emptyDepositBalance.tup += emptyContainersDiff.tup;

  // Handle flexible payment calculation
  const payment = collectedPayment || {
    method: 'UNPAID',
    cashAmount: 0,
    posAmount: 0,
    totalCollected: 0,
  };

  const cash = Number(payment.cashAmount) || 0;
  const pos = Number(payment.posAmount) || 0;
  const totalCollected = cash + pos;
  const diffUncollected = deliveredGrandTotal - totalCollected;

  let paymentStatus: any = 'unpaid';
  if (totalCollected >= deliveredGrandTotal && deliveredGrandTotal > 0) {
    paymentStatus = totalCollected > deliveredGrandTotal ? 'overpaid' : 'paid_full';
  } else if (totalCollected > 0 && totalCollected < deliveredGrandTotal) {
    paymentStatus = 'partial';
  }

  const normalizedPayment = {
    method: payment.method || (cash > 0 && pos > 0 ? 'MIXED' : pos > 0 ? 'POS' : cash > 0 ? 'CASH' : 'UNPAID'),
    cashAmount: cash,
    posAmount: pos,
    totalCollected,
    status: paymentStatus,
    diffUncollected,
  };

  // If customer is an account customer, automatically update current TL balance!
  if (customer.isAccountCustomer) {
    // If diffUncollected is positive: customer owes us more (+). If negative (overpaid): customer has credit (-).
    customer.currentBalanceTL = (customer.currentBalanceTL || 0) + diffUncollected;
  }

  const newDelivery: Delivery = {
    id: `del_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    dispatchId: dispatch.id,
    driverId: driver.id,
    driverName: driver.name,
    vehiclePlate: dispatch.vehiclePlate,
    customerId: customer.id,
    customerName: customer.name,
    customerAddress: customer.address,
    customerPhone: customer.phone,
    timestamp: new Date().toISOString(),
    deliveredItems: items,
    deliveredGrandTotal,
    collectedPayment: normalizedPayment,
    emptyContainersReceived: emptiesRecv,
    emptyContainersDiff,
    notes: notes || '',
    isOfflineSync: !!isOfflineSync,
  };

  db.deliveries.unshift(newDelivery);
  db.customers[customerIdx] = customer;
  saveDatabase(db);

  res.status(201).json({ delivery: newDelivery, updatedCustomer: customer });
});

// 6. Reports & Analytics
app.get('/api/reports/daily', (req, res) => {
  const date = (req.query.date as string) || getTodayDateStr();
  const driverId = req.query.driverId as string;

  let dispatches = db.dispatches.filter((d) => d.date === date);
  if (driverId) {
    dispatches = dispatches.filter((d) => d.driverId === driverId);
  }

  const dispatchIds = new Set(dispatches.map((d) => d.id));
  const deliveries = db.deliveries.filter((del) => dispatchIds.has(del.dispatchId));

  // Summary aggregation
  let totalDeliveries = deliveries.length;
  let totalCustomersVisited = new Set(deliveries.map((d) => d.customerId)).size;
  let totalDeliveredValue = 0;
  let totalCashCollected = 0;
  let totalPosCollected = 0;
  let totalCreditAdded = 0;
  let totalEmptyDamacanaCollected = 0;
  let totalEmptyTupCollected = 0;

  const deliveredProductQuantities: Record<string, { name: string; quantity: number }> = {};

  deliveries.forEach((del) => {
    totalDeliveredValue += del.deliveredGrandTotal;
    totalCashCollected += del.collectedPayment.cashAmount;
    totalPosCollected += del.collectedPayment.posAmount;
    if (del.collectedPayment.diffUncollected > 0) {
      totalCreditAdded += del.collectedPayment.diffUncollected;
    }
    totalEmptyDamacanaCollected += del.emptyContainersReceived.damacana || 0;
    totalEmptyTupCollected += del.emptyContainersReceived.tup || 0;

    del.deliveredItems.forEach((item) => {
      if (!deliveredProductQuantities[item.productId]) {
        deliveredProductQuantities[item.productId] = { name: item.productName, quantity: 0 };
      }
      deliveredProductQuantities[item.productId].quantity += item.quantity;
    });
  });

  res.json({
    date,
    driverId: driverId || 'all',
    dispatches,
    deliveries,
    summary: {
      totalDeliveries,
      totalCustomersVisited,
      totalDeliveredValue,
      totalCashCollected,
      totalPosCollected,
      totalCreditAdded,
      totalGrandCollected: totalCashCollected + totalPosCollected,
      totalEmptyDamacanaCollected,
      totalEmptyTupCollected,
      deliveredProductQuantities,
    },
  });
});

// 7. 60-Day Data Retention Status & Manual Purge
app.get('/api/cleanup/status', (req, res) => {
  const RETENTION_DAYS = 60;
  const thresholdMs = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  const thresholdDateStr = new Date(thresholdMs).toISOString().split('T')[0];

  let oldestRecordDate: string | null = null;
  if (db.dispatches.length > 0) {
    const dates = db.dispatches.map((d) => d.date).sort();
    oldestRecordDate = dates[0];
  }

  const status: CleanupStatus = {
    totalDispatches: db.dispatches.length,
    totalDeliveries: db.deliveries.length,
    oldestRecordDate,
    retentionDays: RETENTION_DAYS,
    thresholdDate: thresholdDateStr,
    purgedCountLastRun: db.purgedCountTotal || 0,
  };

  res.json(status);
});

app.post('/api/cleanup/trigger', (req, res) => {
  const result = runRetentionCleanup(db);
  res.json({
    message: '60 günlük otomatik temizleme çalıştırıldı',
    ...result,
  });
});

// -------------------------------------------------------------
// VITE DEV MIDDLEWARE / STATIC ASSETS
// -------------------------------------------------------------
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const httpServer = http.createServer(app);

  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false, // Explicitly disabled to prevent WebSocket errors in AI Studio proxy
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[SuDağıtım Pro] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
