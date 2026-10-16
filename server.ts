import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  User,
  Product,
  Customer,
  Dispatch,
  Delivery,
} from './src/types/index.ts';
import {
  getUsers,
  createUser,
  updateUser,
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getCustomers,
  createCustomer,
  updateCustomer,
  getDispatches,
  createDispatch,
  updateDispatch,
  getDeliveries,
  createDeliveryRecord,
  runRetentionCleanup,
  getCleanupStats,
  getNext2300Time,
  isSupabaseConfigured,
  getDatabaseStatus,
  ensureSupabaseSeeded,
  configureSupabase,
  checkSupabaseHealth,
} from './src/server/db.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(express.json());

const getTodayDateStr = () => new Date().toISOString().split('T')[0];

// PWA Manifest and Service Worker static serving with proper headers
app.get(['/manifest.json', '/manifest.webmanifest'], (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.sendFile(path.resolve(__dirname, 'public', 'manifest.json'));
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.resolve(__dirname, 'public', 'sw.js'));
});

// Safe boot-time cleanup and Supabase initialization
runRetentionCleanup().catch((err) => console.error('Initial cleanup error', err));
ensureSupabaseSeeded().catch((err) => console.error('Initial Supabase seed error', err));

// Schedule recurring daily 60-day cleanup at exactly 23:00:00 every night
function setupDailyRetentionJob() {
  const { msUntil, formatted } = getNext2300Time();
  console.log(`[Retention Scheduler] 60-Day cleanup scheduled for: ${formatted}`);

  setTimeout(async () => {
    console.log('[Retention Scheduler] Executing daily 23:00 60-day data retention cleanup...');
    try {
      const res = await runRetentionCleanup();
      console.log(
        `[Retention Scheduler] 23:00 cleanup completed: ${res.purgedDispatches} dispatches and ${res.purgedDeliveries} deliveries older than 60 days purged.`
      );
    } catch (err) {
      console.error('[Retention Scheduler] Error during scheduled 23:00 cleanup:', err);
    }
    // Re-schedule for the next 23:00
    setupDailyRetentionJob();
  }, msUntil);
}

setupDailyRetentionJob();

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

// Health & Database Connection Info
app.get('/api/health', async (req, res) => {
  const dbStatus = await getDatabaseStatus();
  res.json({
    status: 'ok',
    database: dbStatus.type,
    connected: dbStatus.isConnected,
    provider: dbStatus.provider,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/database/status', async (req, res) => {
  try {
    const status = await getDatabaseStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/database/config', async (req, res) => {
  try {
    const { url, key, enabled } = req.body;
    const result = await configureSupabase({ url, key, enabled });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Veritabanı yapılandırması başarısız' });
  }
});

app.post('/api/database/seed', async (req, res) => {
  try {
    await ensureSupabaseSeeded();
    const status = await getDatabaseStatus();
    res.json({ message: 'Veritabanı kontrol edildi / başlangıç verileri aktarıldı', status });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 1. Users / Auth
app.get('/api/users', async (req, res) => {
  try {
    const users = await getUsers();
    res.json({ users });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre/PIN gereklidir' });
  }

  try {
    const users = await getUsers();
    const user = users.find(
      (u) =>
        u.username.toLowerCase() === username.trim().toLowerCase() &&
        u.pin.toString() === pin.toString().trim()
    );

    if (!user) {
      return res.status(401).json({ error: 'Hatalı kullanıcı adı veya şifre!' });
    }

    res.json({ user, message: 'Giriş başarılı' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
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

  try {
    const saved = await createUser(newUser);
    res.status(201).json({ user: saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const updated = await updateUser(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    res.json({ user: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Products
app.get('/api/products', async (req, res) => {
  try {
    const products = await getProducts();
    res.json({ products });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', async (req, res) => {
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

  try {
    const created = await createProduct(newProduct);
    res.status(201).json({ product: created });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const updated = await updateProduct(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Ürün bulunamadı' });
    res.json({ product: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await deleteProduct(req.params.id);
    res.json({ success: true, message: 'Ürün başarıyla silindi' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Customers
app.get('/api/customers', async (req, res) => {
  try {
    const customers = await getCustomers();
    res.json({ customers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/customers', async (req, res) => {
  const { name, phone, address, emails, isAccountCustomer, notes, customPrices } = req.body;
  if (!name) return res.status(400).json({ error: 'Müşteri adı zorunludur' });

  // Sanitize multiple emails
  const cleanEmails: string[] = Array.isArray(emails)
    ? emails.map((e: any) => String(e).trim()).filter((e: string) => e.length > 0)
    : [];

  const newCust: Customer = {
    id: `cust_${Date.now()}`,
    name,
    phone: phone || '',
    address: address || '',
    emails: cleanEmails,
    isAccountCustomer: !!isAccountCustomer,
    currentBalanceTL: 0,
    emptyDepositBalance: { damacana: 0, camDamacana: 0, tup: 0 },
    customPrices: customPrices || {},
    notes: notes || '',
    createdDate: getTodayDateStr(),
  };

  try {
    const created = await createCustomer(newCust);
    res.status(201).json({ customer: created });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/customers/:id', async (req, res) => {
  try {
    const updated = await updateCustomer(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Müşteri bulunamadı' });
    res.json({ customer: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Dispatches (Seferler & Yüklemeler)
app.get('/api/dispatches', async (req, res) => {
  try {
    const date = req.query.date as string;
    const dispatches = await getDispatches(date);
    res.json({ dispatches });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/dispatches', async (req, res) => {
  const {
    driverId,
    vehiclePlate,
    loadedItems,
    loadedByUserId,
    loadedByUserName,
    driverConfirmed,
  } = req.body;

  try {
    const users = await getUsers();
    const driver = users.find((u) => u.id === driverId);
    if (!driver) return res.status(404).json({ error: 'Şoför bulunamadı' });

    const todayStr = getTodayDateStr();

    // Önceki rapor/sefer tamamlanmadan şoför veya araç tekrar atanamaz
    const allDispatches = await getDispatches();
    const activeDriverDispatch = allDispatches.find(
      (d) => d.driverId === driverId && d.status !== 'completed'
    );
    if (activeDriverDispatch) {
      return res.status(400).json({
        error: `Bu şoför (${driver.name}) halen aktif bir dağıtım seferindedir (${activeDriverDispatch.vehiclePlate}). Önceki sefer raporu tamamlanmadan yeni sefer açılamaz.`,
      });
    }

    const selectedPlate = vehiclePlate || driver.assignedPlate || '34 SU 101';
    const activePlateDispatch = allDispatches.find(
      (d) => d.vehiclePlate === selectedPlate && d.status !== 'completed'
    );
    if (activePlateDispatch) {
      return res.status(400).json({
        error: `Bu araç plakası (${selectedPlate}) halen aktif bir dağıtımda kullanılmaktadır (${activePlateDispatch.driverName}). Önceki seferin bitiş raporu onaylanmadan bu araç seçilemez.`,
      });
    }

    const isConfirmed = !!driverConfirmed;

    const newDispatch: Dispatch = {
      id: `disp_${Date.now()}`,
      date: todayStr,
      driverId,
      driverName: driver.name,
      vehiclePlate: selectedPlate,
      loadedByUserId: loadedByUserId || 'usr_admin',
      loadedByUserName: loadedByUserName || 'Yönetici',
      driverConfirmedAt: isConfirmed ? new Date().toISOString() : null,
      status: isConfirmed ? 'in_transit' : 'pending_confirmation',
      loadedItems: loadedItems || [],
      createdAt: new Date().toISOString(),
    };

    const saved = await createDispatch(newDispatch);
    res.status(201).json({ dispatch: saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/dispatches/:id', async (req, res) => {
  try {
    const updated = await updateDispatch(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Sefer bulunamadı' });
    res.json({ dispatch: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/dispatches/:id/confirm', async (req, res) => {
  try {
    const updated = await updateDispatch(req.params.id, {
      driverConfirmedAt: new Date().toISOString(),
      status: 'in_transit',
    });
    if (!updated) return res.status(404).json({ error: 'Sefer bulunamadı' });
    res.json({ dispatch: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/dispatches/:id/close', async (req, res) => {
  try {
    const allDispatches = await getDispatches();
    const dispatch = allDispatches.find((d) => d.id === req.params.id);
    if (!dispatch) return res.status(404).json({ error: 'Sefer bulunamadı' });

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

    const dispatchDeliveries = await getDeliveries({ dispatchId: dispatch.id });

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

    const reconciliation = {
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

    const updated = await updateDispatch(dispatch.id, {
      endOfDayReconciliation: reconciliation,
      status: 'completed',
    });

    // Sürücünün önceki takılı kalmış açık seferleri varsa onları da tamamlandı işaretle
    for (const other of allDispatches) {
      if (
        other.id !== dispatch.id &&
        other.driverId === dispatch.driverId &&
        other.status !== 'completed'
      ) {
        await updateDispatch(other.id, { status: 'completed' });
      }
    }

    res.json({ dispatch: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Deliveries (Saha Teslimatları & Canlı Ekip Akışı)
app.get('/api/deliveries', async (req, res) => {
  try {
    const dispatchId = req.query.dispatchId as string;
    const driverId = req.query.driverId as string;
    const date = req.query.date as string;

    const deliveries = await getDeliveries({ dispatchId, driverId, date });
    res.json({ deliveries });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/deliveries', async (req, res) => {
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

  try {
    const [allDispatches, allUsers, allCustomers, allProducts] = await Promise.all([
      getDispatches(),
      getUsers(),
      getCustomers(),
      getProducts(),
    ]);

    const dispatch = allDispatches.find((d) => d.id === dispatchId);
    const driver = allUsers.find((u) => u.id === driverId);
    const customer = allCustomers.find((c) => c.id === customerId);

    if (!dispatch || !driver || !customer) {
      return res.status(400).json({ error: 'Geçersiz sefer, şoför veya müşteri bilgisi' });
    }

    const items = deliveredItems || [];
    let deliveredGrandTotal = 0;
    let depositDeliveredDamacana = 0;
    let depositDeliveredCamDamacana = 0;
    let depositDeliveredTup = 0;

    items.forEach((item: any) => {
      deliveredGrandTotal += item.lineTotal;
      const prod = allProducts.find((p) => p.id === item.productId);
      if (prod?.depositType === 'damacana') {
        depositDeliveredDamacana += item.quantity;
      } else if (prod?.depositType === 'cam_damacana') {
        depositDeliveredCamDamacana += item.quantity;
      } else if (prod?.depositType === 'tup') {
        depositDeliveredTup += item.quantity;
      }

      // Remember last price in customer profile
      if (item.unitPrice && prod) {
        if (!customer.customPrices) customer.customPrices = {};
        customer.customPrices[item.productId] = item.unitPrice;
      }
    });

    const emptiesRecv = emptyContainersReceived || { damacana: 0, camDamacana: 0, tup: 0 };
    const recvDamacana = Number(emptiesRecv.damacana) || 0;
    const recvCamDamacana = Number(emptiesRecv.camDamacana || emptiesRecv.cam_damacana) || 0;
    const recvTup = Number(emptiesRecv.tup) || 0;

    const emptyContainersDiff = {
      damacana: depositDeliveredDamacana - recvDamacana,
      camDamacana: depositDeliveredCamDamacana - recvCamDamacana,
      tup: depositDeliveredTup - recvTup,
    };

    if (!customer.emptyDepositBalance) customer.emptyDepositBalance = { damacana: 0, camDamacana: 0, tup: 0 };
    customer.emptyDepositBalance.damacana = (Number(customer.emptyDepositBalance.damacana) || 0) + emptyContainersDiff.damacana;
    customer.emptyDepositBalance.camDamacana = (Number(customer.emptyDepositBalance.camDamacana) || 0) + emptyContainersDiff.camDamacana;
    customer.emptyDepositBalance.tup = (Number(customer.emptyDepositBalance.tup) || 0) + emptyContainersDiff.tup;

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

    if (customer.isAccountCustomer) {
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

    const result = await createDeliveryRecord(newDelivery, customer);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Reports & Analytics
app.get('/api/reports/daily', async (req, res) => {
  try {
    const date = (req.query.date as string) || getTodayDateStr();
    const driverId = req.query.driverId as string;

    const allDispatches = await getDispatches(date);
    let dispatches = allDispatches;
    if (driverId && driverId !== 'all') {
      dispatches = dispatches.filter((d) => d.driverId === driverId);
    }

    const allDeliveries = await getDeliveries({ date });
    let deliveries = allDeliveries;
    if (driverId && driverId !== 'all') {
      deliveries = deliveries.filter((del) => del.driverId === driverId);
    }

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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Retention Status & Trigger
app.get('/api/cleanup/status', async (req, res) => {
  try {
    const status = await getCleanupStats();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cleanup/trigger', async (req, res) => {
  try {
    const result = await runRetentionCleanup();
    res.json({
      message: '60 günlük otomatik temizleme çalıştırıldı',
      ...result,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
        hmr: false,
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
