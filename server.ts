import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  User,
  Product,
  Customer,
  Dispatch,
  LoadedItem,
} from './src/types/index.ts';
import {
  getUsers,
  createUser,
  updateUser,
  getProducts,
  getProductCategories,
  createProduct,
  updateProduct,
  deleteProduct,
  getCustomers,
  createCustomer,
  updateCustomer,
  getDispatches,
  createDispatch,
  updateDispatchLoading,
  confirmDispatchAtomic,
  closeDispatchAtomic,
  adminUpdateCustomerAtomic,
  getDeliveries,
  getDeliveryById,
  createDeliveryRecord,
  cancelDeliveryAtomic,
  replaceDeliveryAtomic,
  reopenDispatch,
  DeliveryDbError,
  DispatchDbError,
  assertRpcAuthorizationReady,
  runRetentionCleanup,
  getCleanupStats,
  getRetentionHealth,
  getNext2300Time,
  getDatabaseStatus,
  ensureSupabaseSeeded,
  configureSupabase,
} from './src/server/db.ts';
import {
  DeliveryInputError,
  normalizeDeliveryInput,
  assertVehicleStockAvailable,
  assertEmptyBalanceForReplacement,
} from './src/server/deliveryInput.ts';
import {
  isDispatchOpenForDelivery,
  validateReopenRequest,
  deliveryPayloadsMatch,
} from './src/services/offlineSync.ts';
import {
  validateDispatchUpdate,
  validateConfirmTransition,
  validateCloseTransition,
  DispatchRuleResult,
} from './src/services/dispatchRules.ts';
import { todayUtcDateStr } from './src/services/dateWindow.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(express.json());

const getTodayDateStr = () => todayUtcDateStr();

// PWA Manifest and Service Worker static serving with proper headers
app.get(['/manifest.json', '/manifest.webmanifest'], (_req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.sendFile(path.resolve(__dirname, 'public', 'manifest.json'));
});

app.get('/sw.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.resolve(__dirname, 'public', 'sw.js'));
});

// Safe boot-time cleanup and Supabase initialization.
// Boot runs the retention job every start (Dry-Run by default). This is the
// catch-up mechanism: because Render Free instances spin down when idle (and
// can be redeployed/restarted at any time), a missed 23:00 run is executed on
// the next startup instead of being silently skipped.
runRetentionCleanup()
  .then((res) => {
    if (res.locked) {
      console.warn('[Retention] Boot run skipped: another purge is in progress (lock held).');
    }
  })
  .catch((err) => console.error('Initial retention cleanup error', err));
ensureSupabaseSeeded().catch((err) => console.error('Initial Supabase seed error', err));

// Visible startup/health warning if no successful purge has run in > 3 days.
async function warnIfRetentionStale() {
  try {
    const health = await getRetentionHealth();
    if (health.stale) {
      console.warn(
        `[Retention] WARNING: No successful retention run since ${health.lastSuccessAt || 'never'} ` +
          `(> 3 days). Check /api/cleanup/status. dryRun=${health.lastDryRun ?? 'unknown'} ` +
          `lastError=${health.lastError || 'none'}`
      );
    }
  } catch (err) {
    console.error('[Retention] Health check failed:', err);
  }
}
warnIfRetentionStale();

// Schedule recurring daily 60-day cleanup at exactly 23:00:00 every night
function setupDailyRetentionJob() {
  const { msUntil, formatted } = getNext2300Time();
  console.log(`[Retention Scheduler] 60-Day cleanup scheduled for: ${formatted}`);

  setTimeout(async () => {
    console.log('[Retention Scheduler] Executing daily 23:00 60-day data retention cleanup...');
    try {
      const res = await runRetentionCleanup();
      if (res.locked) {
        console.warn('[Retention Scheduler] Run skipped: another purge holds the lock.');
      } else {
        console.log(
          `[Retention Scheduler] completed (dryRun=${res.dryRun}): ${res.purgedDispatches} dispatches, ${res.purgedDeliveries} deliveries, ${res.archivedRows} archived rows.`
        );
      }
    } catch (err) {
      console.error('[Retention Scheduler] Error during scheduled cleanup:', err);
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
app.get('/api/health', async (_req, res) => {
  const dbStatus = await getDatabaseStatus();
  res.json({
    status: 'ok',
    database: dbStatus.type,
    connected: dbStatus.isConnected,
    provider: dbStatus.provider,
    timestamp: new Date().toISOString(),
  });
});

// -------------------------------------------------------------
// SERVER-SIDE AUTHENTICATION & ROLE-BASED AUTHORIZATION
// -------------------------------------------------------------
interface SessionInfo {
  userId: string;
  role: 'admin' | 'driver';
  name: string;
  canLoadVehicle: boolean;
  createdAt: number;
}

const sessions = new Map<string, SessionInfo>();
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 gün

function createSession(user: User): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    userId: user.id,
    role: user.role,
    name: user.name,
    canLoadVehicle: !!user.canLoadVehicle,
    createdAt: Date.now(),
  });
  return token;
}

function extractToken(req: Request): string | undefined {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const headerToken = req.headers['x-auth-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }
  return undefined;
}

function getSession(req: Request): SessionInfo | null {
  const token = extractToken(req);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function getAuthUser(req: Request): SessionInfo | undefined {
  return (req as any).authUser as SessionInfo | undefined;
}

function authenticate(req: Request, res: Response, next: NextFunction) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Oturum geçersiz veya süresi doldu. Lütfen tekrar giriş yapın.' });
  }
  (req as any).authUser = session;
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = getAuthUser(req);
  if (!session || session.role !== 'admin') {
    return res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gereklidir.' });
  }
  next();
}

function requireAdminOrLoader(req: Request, res: Response, next: NextFunction) {
  const session = getAuthUser(req);
  if (!session) {
    return res.status(401).json({ error: 'Oturum geçersiz.' });
  }
  if (session.role === 'admin' || session.canLoadVehicle) {
    return next();
  }
  return res.status(403).json({ error: 'Bu işlem için depo yükleme yetkisi gereklidir.' });
}

function canManageDispatch(req: Request, dispatch: Dispatch): boolean {
  const session = getAuthUser(req);
  if (!session) return false;
  if (session.role === 'admin') return true;
  return session.userId === dispatch.driverId;
}

function sendDispatchRuleError(res: Response, result: DispatchRuleResult<any>) {
  const status =
    result.errorCode === 'NOT_AUTHORIZED'
      ? 403
      : result.errorCode === 'DISPATCH_ALREADY_COMPLETED' ||
          result.errorCode === 'DISPATCH_CLOSED' ||
          result.errorCode === 'INVALID_STATE' ||
          result.errorCode === 'BALANCE_CONFLICT' ||
          result.errorCode === 'EMPTY_CONFLICT'
        ? 409
        : 400;
  return res.status(status).json({
    error: result.message || 'İşlem gerçekleştirilemedi.',
    code: result.errorCode || 'VALIDATION_ERROR',
  });
}

function sendDispatchDbError(res: Response, err: any) {
  const code =
    err instanceof DispatchDbError || err instanceof DeliveryDbError ? err.code : err?.code;
  const status =
    code === 'DISPATCH_NOT_FOUND' || code === 'CUSTOMER_NOT_FOUND'
      ? 404
      : code === 'NOT_AUTHORIZED'
        ? 403
        : code === 'MIGRATION_REQUIRED' || code === 'RPC_AUTH_REQUIRED'
          ? 503
          : code === 'VALIDATION_ERROR' || code === 'EXPECTATION_REQUIRED'
            ? 400
            : code === 'DISPATCH_ALREADY_COMPLETED' ||
                code === 'DISPATCH_CLOSED' ||
                code === 'INVALID_DISPATCH_STATE' ||
                code === 'BALANCE_CONFLICT' ||
                code === 'EMPTY_CONFLICT' ||
                code === 'NOT_COMPLETED' ||
                code === 'ACTIVE_DISPATCH_CONFLICT' ||
                code === 'HISTORICAL_DELIVERY_ITEMS_MISSING' ||
                code === 'PAYMENT_DATA_INCONSISTENT' ||
                code === 'HISTORICAL_REOPEN_BLOCKED' ||
                code === 'INSUFFICIENT_VEHICLE_STOCK'
              ? 409
              : 500;
  return res.status(status).json({
    error: err?.message || 'İşlem gerçekleştirilemedi.',
    code: code || 'DISPATCH_FAILED',
    ...(err?.details ? { details: err.details } : {}),
  });
}

function sendDeliveryCorrectionError(res: Response, err: any) {
  if (err instanceof DeliveryInputError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }

  const code = err instanceof DeliveryDbError ? err.code : err?.code;
  const status =
    code === 'DELIVERY_NOT_FOUND' ||
    code === 'DISPATCH_NOT_FOUND' ||
    code === 'CUSTOMER_NOT_FOUND'
      ? 404
      : code === 'NOT_AUTHORIZED'
        ? 403
        : code === 'REASON_REQUIRED'
          ? 400
          : code === 'VALIDATION_ERROR' || code === 'EMPTY_BALANCE_NEGATIVE'
            ? 422
            : code === 'CANCEL_HISTORICAL_UNSUPPORTED' ||
                code === 'EMPTY_REVERSAL_CONFLICT' ||
                code === 'DELIVERY_ALREADY_CANCELLED' ||
                code === 'REPLACEMENT_ID_CONFLICT' ||
                code === 'DISPATCH_CLOSED' ||
                code === 'INSUFFICIENT_VEHICLE_STOCK' ||
                code === 'PAYMENT_DATA_INCONSISTENT'
              ? 409
              : code === 'MIGRATION_REQUIRED' ||
                  code === 'RPC_AUTH_REQUIRED' ||
                  code === 'REMOTE_REQUIRED'
                ? 503
                : 500;
  return res.status(status).json({
    error: err?.message || 'Teslimat düzeltilemedi.',
    code: code || 'DELIVERY_CORRECTION_FAILED',
  });
}

// Giriş: herkese açık
app.post('/api/auth/login', async (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre/PIN gereklidir' });
  }

  try {
    const users = await getUsers();
    const user = users.find(
      (u) =>
        u.username.toLowerCase() === String(username).trim().toLowerCase() &&
        u.pin.toString() === String(pin).toString().trim()
    );

    if (!user) {
      return res.status(401).json({ error: 'Hatalı kullanıcı adı veya şifre!' });
    }

    const token = createSession(user);
    res.json({ user: { ...user, pin: '' }, token, message: 'Giriş başarılı' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Çıkış: token geçerliyse oturumu kapat
app.post('/api/auth/logout', (req, res) => {
  const token = extractToken(req);
  if (token) sessions.delete(token);
  res.json({ success: true, message: 'Oturum kapatıldı.' });
});

// Bu noktadan sonraki tüm /api uçları kimlik doğrulaması gerektirir
app.use('/api', authenticate);

// Veri yazan tüm uçlar, sunucunun ayrıcalıklı DB rolüyle ve sertleştirilmiş
// RPC yetkileriyle çalıştığını doğrulamadan işlem yapamaz. Veritabanı
// yapılandırması bu kapıdan muaftır; aksi halde hatalı anahtar düzeltilemez.
app.use('/api', async (req, res, next) => {
  const method = String(req.method || '').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  if (req.originalUrl.split('?')[0] === '/api/database/config') return next();

  try {
    await assertRpcAuthorizationReady();
    next();
  } catch (err: any) {
    const code = err instanceof DispatchDbError ? err.code : err?.code;
    return res.status(503).json({
      error:
        err?.message ||
        'Güvenli veritabanı yetkisi doğrulanamadığı için işlem reddedildi.',
      code: code || 'RPC_AUTH_REQUIRED',
    });
  }
});

app.get('/api/database/status', requireAdmin, async (_req, res) => {
  try {
    const status = await getDatabaseStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/database/config', requireAdmin, async (req, res) => {
  try {
    const { url, key, enabled } = req.body;
    const result = await configureSupabase({ url, key, enabled });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Veritabanı yapılandırması başarısız' });
  }
});

app.post('/api/database/seed', requireAdmin, async (_req, res) => {
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
    const session = getAuthUser(req);
    // PIN bilgisi yalnızca yöneticiye döndürülür
    const safeUsers =
      session?.role === 'admin' ? users : users.map((u) => ({ ...u, pin: '' }));
    res.json({ users: safeUsers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', requireAdmin, async (req, res) => {
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

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const updated = await updateUser(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    res.json({ user: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Products
app.get('/api/products', async (_req, res) => {
  try {
    const products = await getProducts();
    res.json({ products });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2b. Product Categories (veritabanı kaynaklı; kategori yönetimi veri odaklıdır)
app.get('/api/product-categories', async (_req, res) => {
  try {
    const categories = await getProductCategories();
    res.json({ categories });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', requireAdmin, async (req, res) => {
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

app.put('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    const updated = await updateProduct(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Ürün bulunamadı' });
    res.json({ product: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    await deleteProduct(req.params.id);
    res.json({ success: true, message: 'Ürün başarıyla silindi' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Customers
app.get('/api/customers', async (_req, res) => {
  try {
    const customers = await getCustomers();
    res.json({ customers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Müşteri oluşturma: hem depo yöneticisi hem de şoför (yetkilendirilmiş saha kullanıcısı) yapabilir.
app.post('/api/customers', async (req, res) => {
  const { name, phone, address, emails, isAccountCustomer, notes, customPrices } = req.body;
  if (!name) return res.status(400).json({ error: 'Müşteri adı zorunludur' });

  // Sanitize multiple emails
  const cleanEmails: string[] = Array.isArray(emails)
    ? emails.map((e: any) => String(e).trim()).filter((e: string) => e.length > 0)
    : [];

  const newCust: Customer = {
    id: `cust_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
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
    res.status(500).json({ error: err.message || 'Müşteri kaydedilemedi' });
  }
});

// Müşteri güncelleme ve bakiye/boş kap sıfırlama yalnızca depo yöneticisine açıktır.
// (Sunucu tarafı yetki sınırı: şoförler doğrudan API çağrısıyla bile sıfırlayamaz.)
app.put('/api/customers/:id', requireAdmin, async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const allowedFields = new Set([
    'name',
    'phone',
    'address',
    'emails',
    'isAccountCustomer',
    'notes',
    'customPrices',
    'currentBalanceTL',
    'emptyDepositBalance',
    'expectedBalanceTL',
    'expectedEmptyDepositBalance',
    'correctionReason',
  ]);
  const unknown = Object.keys(body).filter((key) => !allowedFields.has(key));
  if (unknown.length > 0) {
    return res.status(400).json({
      error: `Desteklenmeyen müşteri alanı: ${unknown.join(', ')}`,
      code: 'VALIDATION_ERROR',
    });
  }

  const hasBalance = body.currentBalanceTL !== undefined;
  const hasEmpty = body.emptyDepositBalance !== undefined;

  if (hasBalance) {
    const expected = Number(body.expectedBalanceTL);
    if (!Number.isFinite(expected)) {
      return res.status(400).json({
        error: 'Bakiye güncellemesi için beklenen güncel değer (expectedBalanceTL) zorunludur.',
        code: 'EXPECTATION_REQUIRED',
      });
    }
  }

  if (hasEmpty) {
    if (!body.emptyDepositBalance || typeof body.emptyDepositBalance !== 'object') {
      return res.status(400).json({
        error: 'Boş kap bakiyesi geçersiz.',
        code: 'VALIDATION_ERROR',
      });
    }
    const expected = body.expectedEmptyDepositBalance;
    if (!expected || typeof expected !== 'object') {
      return res.status(400).json({
        error:
          'Boş kap güncellemesi için beklenen güncel değer (expectedEmptyDepositBalance) zorunludur.',
        code: 'EXPECTATION_REQUIRED',
      });
    }
  }

  if ((hasBalance || hasEmpty) && body.customPrices !== undefined) {
    return res.status(400).json({
      error: 'Özel fiyatlar bakiye/boş kap güncellemesiyle aynı istekte değiştirilemez.',
      code: 'VALIDATION_ERROR',
    });
  }

  const updates: Partial<Customer> = {};
  for (const key of ['name', 'phone', 'address', 'emails', 'isAccountCustomer', 'notes'] as const) {
    if (body[key] !== undefined) (updates as any)[key] = body[key];
  }
  if (body.customPrices !== undefined) updates.customPrices = body.customPrices;
  if (hasBalance) updates.currentBalanceTL = Number(body.currentBalanceTL) || 0;
  if (hasEmpty) updates.emptyDepositBalance = body.emptyDepositBalance;

  try {
    const updated =
      hasBalance || hasEmpty
        ? await adminUpdateCustomerAtomic(
            req.params.id,
            updates,
            {
              balance: hasBalance ? Number(body.expectedBalanceTL) : undefined,
              empty: hasEmpty ? body.expectedEmptyDepositBalance : undefined,
            },
            { id: getAuthUser(req)!.userId, name: getAuthUser(req)!.name },
            typeof body.correctionReason === 'string' ? body.correctionReason : undefined
          )
        : await updateCustomer(req.params.id, updates);

    if (!updated) return res.status(404).json({ error: 'Müşteri bulunamadı' });
    res.json({ customer: updated });
  } catch (err: any) {
    sendDispatchDbError(res, err);
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

app.post('/api/dispatches', requireAdminOrLoader, async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { driverId, vehiclePlate, loadedItems, driverConfirmed } = body;
  const session = getAuthUser(req)!;

  if (typeof driverId !== 'string' || !driverId) {
    return res.status(400).json({ error: 'Şoför seçilmelidir.' });
  }

  const items = Array.isArray(loadedItems) ? loadedItems : [];
  if (loadedItems !== undefined && !Array.isArray(loadedItems)) {
    return res.status(400).json({ error: 'Yükleme kalemleri geçersiz.' });
  }
  if (items.length > 200) {
    return res.status(400).json({ error: 'Yükleme kalemleri geçersiz.' });
  }
  const seenProducts = new Set<string>();
  const normalizedItems: LoadedItem[] = [];
  for (const item of items) {
    const productId = typeof item?.productId === 'string' ? item.productId.trim() : '';
    const quantity = Number(item?.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity < 0) {
      return res.status(400).json({ error: 'Yükleme kalemlerinde geçersiz ürün veya miktar var.' });
    }
    if (seenProducts.has(productId)) {
      return res.status(400).json({ error: 'Aynı ürün yükleme listesinde birden fazla kez yer alamaz.' });
    }
    seenProducts.add(productId);
    normalizedItems.push({ productId, quantity });
  }

  try {
    const [users, allProducts] = await Promise.all([getUsers(), getProducts()]);
    const driver = users.find((u) => u.id === driverId);
    if (!driver) return res.status(404).json({ error: 'Şoför bulunamadı' });
    if (driver.role !== 'driver') {
      return res.status(400).json({ error: 'Sefer yalnızca şoför rolündeki kullanıcıya atanabilir.' });
    }

    const unknownProduct = normalizedItems.find(
      (item) => !allProducts.some((p) => p.id === item.productId)
    );
    if (unknownProduct) {
      return res.status(400).json({ error: `Bilinmeyen ürün kaydı: ${unknownProduct.productId}` });
    }

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

    // Plaka dinamiktir; istemciden veya şoför tanımından gelir. Sabit plaka yoktur.
    const selectedPlate = String(vehiclePlate || driver.assignedPlate || '').trim();
    if (!selectedPlate) {
      return res.status(400).json({ error: 'Araç plakası seçilmelidir.' });
    }
    const activePlateDispatch = allDispatches.find(
      (d) => d.vehiclePlate === selectedPlate && d.status !== 'completed'
    );
    if (activePlateDispatch) {
      return res.status(400).json({
        error: `Bu araç plakası (${selectedPlate}) halen aktif bir dağıtımda kullanılmaktadır (${activePlateDispatch.driverName}). Önceki seferin bitiş raporu onaylanmadan bu araç seçilemez.`,
      });
    }

    // Onay yalnızca atanmış şoförün kendi oturumundan gelirse geçerlidir.
    // Yönetici/yükleyici başka bir şoför adına dağıtımı başlatamaz.
    const isConfirmed = !!driverConfirmed && session.userId === driverId;

    const newDispatch: Dispatch = {
      id: `disp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      date: todayStr,
      driverId,
      driverName: driver.name,
      vehiclePlate: selectedPlate,
      // Yükleyen kimliği istemciden değil, doğrulanmış oturumdan alınır.
      loadedByUserId: session.userId,
      loadedByUserName: session.name,
      driverConfirmedAt: isConfirmed ? new Date().toISOString() : null,
      status: isConfirmed ? 'in_transit' : 'pending_confirmation',
      loadedItems: normalizedItems,
      createdAt: new Date().toISOString(),
    };

    const saved = await createDispatch(newDispatch);
    res.status(201).json({ dispatch: saved });
  } catch (err: any) {
    const raw = `${err?.message || ''} ${err?.details || ''}`;
    if (String(err?.code || '') === '23505' || /duplicate key|unique constraint/i.test(raw)) {
      return res.status(409).json({
        error:
          'Bu şoför veya araç plakası için eşzamanlı başka bir aktif sefer oluşturuldu. Lütfen listeyi yenileyin.',
        code: 'ACTIVE_DISPATCH_CONFLICT',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/dispatches/:id', async (req, res) => {
  try {
    const allDispatches = await getDispatches();
    const existing = allDispatches.find((d) => d.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Sefer bulunamadı' });

    const session = getAuthUser(req)!;
    const validation = validateDispatchUpdate(req.body, {
      role: session.role,
      canLoadVehicle: session.canLoadVehicle,
      status: existing.status,
    });
    if (!validation.ok) return sendDispatchRuleError(res, validation);

    const updated = await updateDispatchLoading(
      existing.id,
      validation.updates!.loadedItems,
      { id: session.userId, name: session.name }
    );
    res.json({ dispatch: updated });
  } catch (err: any) {
    sendDispatchDbError(res, err);
  }
});

app.post('/api/dispatches/:id/confirm', async (req, res) => {
  try {
    const allDispatches = await getDispatches();
    const existing = allDispatches.find((d) => d.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Sefer bulunamadı' });
    if (!canManageDispatch(req, existing)) {
      return res.status(403).json({ error: 'Bu seferi teslim alma yetkiniz yok.' });
    }

    const validation = validateConfirmTransition(existing.status);
    if (!validation.ok) return sendDispatchRuleError(res, validation);

    // Onay da atomik koşullu güncelleme kullanır: okuma ile yazma arasında
    // sefer kapatıldıysa "in_transit"e geri döndürülemez.
    const result = await confirmDispatchAtomic(existing.id);
    res.json({ dispatch: result.dispatch, alreadyConfirmed: !result.changed });
  } catch (err: any) {
    sendDispatchDbError(res, err);
  }
});

app.post('/api/dispatches/:id/close', async (req, res) => {
  try {
    const allDispatches = await getDispatches();
    const dispatch = allDispatches.find((d) => d.id === req.params.id);
    if (!dispatch) return res.status(404).json({ error: 'Sefer bulunamadı' });
    if (!canManageDispatch(req, dispatch)) {
      return res.status(403).json({ error: 'Bu seferi kapatma yetkiniz yok.' });
    }

    const validation = validateCloseTransition(dispatch.status);
    if (!validation.ok) return sendDispatchRuleError(res, validation);

    const session = getAuthUser(req)!;

    // İstemcinin gönderdiği closedBy* alanları ve toplamlar dikkate ALINMAZ.
    // Kapatan kullanıcı oturumdan, toplamlar DB içindeki teslimatlardan alınır.
    const updated = await closeDispatchAtomic(
      dispatch.id,
      {
        remainingFullCounted: req.body?.remainingFullCounted,
        collectedEmptyDamacana: req.body?.collectedEmptyDamacana,
        collectedEmptyCamDamacana: req.body?.collectedEmptyCamDamacana,
        collectedEmptyTup: req.body?.collectedEmptyTup,
        actualCashInPocket: req.body?.actualCashInPocket,
        actualPosSlipsTotal: req.body?.actualPosSlipsTotal,
        notes: req.body?.notes,
      },
      session.userId,
      session.name
    );

    res.json({ dispatch: updated });
  } catch (err: any) {
    sendDispatchDbError(res, err);
  }
});

// Kapatılmış seferi denetim kaydıyla yeniden açma.
// Yalnızca yönetici (role='admin') çağırabilir; şoför erişimi reddedilir.
app.post('/api/dispatches/:id/reopen', requireAdmin, async (req, res) => {
  const session = getAuthUser(req)!;
  const validation = validateReopenRequest({
    role: session.role,
    reason: typeof req.body?.reason === 'string' ? req.body.reason : '',
  });
  if (!validation.ok) {
    if (validation.errorCode === 'NOT_AUTHORIZED') {
      return res.status(403).json({
        error: 'Bu işlemi yalnızca yönetici yapabilir.',
        code: 'NOT_AUTHORIZED',
      });
    }
    return res.status(400).json({
      error: 'Yeniden açma için geçerli bir gerekçe girin.',
      code: 'REASON_REQUIRED',
    });
  }

  const reason = validation.reason!;
  try {
    const result = await reopenDispatch(req.params.id, session.userId, session.name, reason);
    if (!result.reopened) {
      if (result.code === 'NOT_COMPLETED') {
        return res.status(409).json({
          error: 'Yalnızca kapatılmış seferler yeniden açılabilir.',
          code: 'NOT_COMPLETED',
        });
      }
      return res.status(409).json({
        error: 'Sefer yeniden açılamadı.',
        code: result.code || 'NOT_REOPENED',
      });
    }
    res.json(result);
  } catch (err: any) {
    const code = err instanceof DeliveryDbError ? err.code : err?.code;
    if (code === 'DISPATCH_NOT_FOUND') {
      return res.status(404).json({ error: err.message, code });
    }
    if (code === 'NOT_AUTHORIZED') {
      return res.status(403).json({ error: err.message, code });
    }
    if (code === 'REASON_REQUIRED') {
      return res.status(400).json({ error: err.message, code });
    }
    if (code === 'ACTIVE_DISPATCH_CONFLICT' || code === 'HISTORICAL_REOPEN_BLOCKED') {
      return res.status(409).json({ error: err.message, code });
    }
    if (code === 'MIGRATION_REQUIRED' || code === 'RPC_AUTH_REQUIRED') {
      return res.status(503).json({ error: err.message, code });
    }
    res.status(500).json({ error: err.message, code: code || 'REOPEN_FAILED' });
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
    id: requestedId,
    dispatchId,
    driverId,
    customerId,
    deliveredItems,
    collectedPayment,
    emptyContainersReceived,
    notes,
    isOfflineSync,
  } = req.body;

  // İstemcinin gönderdiği kimlik yalnızca beklenen biçimdeyse kabul edilir.
  let clientDeliveryId: string | null = null;
  if (requestedId !== undefined && requestedId !== null && requestedId !== '') {
    if (typeof requestedId !== 'string' || !/^(del_|offline_)[A-Za-z0-9_-]+$/.test(requestedId) || requestedId.length > 100) {
      return res.status(400).json({ error: 'Geçersiz teslimat kimliği' });
    }
    clientDeliveryId = requestedId;
  }

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

    const session = getAuthUser(req);
    // Depo yöneticisi teslimat yapmaz; teslimat yalnızca atanmış şoför adına
    // ve şoför oturumuyla kaydedilebilir.
    if (!session || session.role !== 'driver') {
      return res.status(403).json({
        error: 'Teslimat kaydı yalnızca şoför oturumuyla yapılabilir.',
        code: 'NOT_AUTHORIZED',
      });
    }
    if (session.userId !== driver.id || dispatch.driverId !== driver.id) {
      return res.status(403).json({
        error: 'Yalnızca kendi seferinize ve kendi adınıza teslimat kaydedebilirsiniz.',
      });
    }

    const { delivery: newDelivery, priceUpdates } = normalizeDeliveryInput({
      id:
        clientDeliveryId ||
        `del_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      dispatch,
      driver,
      customer,
      products: allProducts,
      deliveredItems,
      collectedPayment,
      emptyContainersReceived,
      notes,
      isOfflineSync,
    });

    // Tekrarlanan istek (retry / çevrimdışı senkron) koruması:
    // Aynı kimlik daha önce kaydedildiyse hiçbir stok/bakiye işlemi YAPILMAZ.
    // İçerik birebir aynıysa idempotent başarı; farklıysa çakışma döner.
    // Bu kontrol kapatılmış sefer kontrolünden ÖNCE gelir.
    if (clientDeliveryId) {
      const existing = await getDeliveryById(clientDeliveryId);
      if (existing) {
        if (!deliveryPayloadsMatch(newDelivery, existing)) {
          return res.status(409).json({
            error:
              'Bu teslimat kimliği daha önce farklı bir içerikle kaydedilmiş. Kayıt değiştirilmedi.',
            code: 'ID_CONFLICT',
          });
        }
        return res.status(200).json({
          delivery: existing,
          updatedCustomer: customer,
          duplicate: true,
        });
      }
    }

    // Kapatılmış sefere yeni teslimat eklenemez. Kuyruktaki kayıt silinmez;
    // istemci bunu çakışma olarak saklar ve yönetici seferi yeniden açabilir.
    if (!isDispatchOpenForDelivery(dispatch.status)) {
      return res.status(409).json({
        error:
          'Sefer kapatılmış. Geç teslimat için yönetici seferi yeniden açmalıdır.',
        code: 'DISPATCH_CLOSED',
      });
    }

    // Araç stoğu: yüklenen miktardan, bu seferde daha önce teslim edilenler
    // düşülür. Kesin kontrol DB RPC'sinde kilit altında tekrarlanır.
    const existingDispatchDeliveries = await getDeliveries({ dispatchId: dispatch.id });
    assertVehicleStockAvailable(newDelivery, dispatch, existingDispatchDeliveries);

    // Aşağıdaki mutasyonlar yalnızca yerel (fallback) yansıma içindir; merkezi
    // bakiyeyi DB'de apply_delivery delta olarak günceller. Tekrar kontrolünden
    // sonra uygulanır ki duplicate yanıtı güncel müşteriyi yanlış göstermesin.
    if (Object.keys(priceUpdates).length > 0) {
      customer.customPrices = { ...(customer.customPrices || {}), ...priceUpdates };
    }

    const currentEmpty = customer.emptyDepositBalance || { damacana: 0, camDamacana: 0, tup: 0 };
    const nextEmpty = {
      damacana:
        (Number(currentEmpty.damacana) || 0) +
        newDelivery.emptyContainersDiff.damacana,
      camDamacana:
        (Number(currentEmpty.camDamacana ?? (currentEmpty as any).cam_damacana) || 0) +
        Number(
          newDelivery.emptyContainersDiff.camDamacana ??
            newDelivery.emptyContainersDiff.cam_damacana ??
            0
        ),
      tup:
        (Number(currentEmpty.tup) || 0) + newDelivery.emptyContainersDiff.tup,
    };
    if (nextEmpty.damacana < 0 || nextEmpty.camDamacana < 0 || nextEmpty.tup < 0) {
      return res.status(422).json({
        error:
          'Boş kap bakiyesi negatife düşeceği için işlem reddedildi. Lütfen miktarları kontrol edin.',
        code: 'EMPTY_BALANCE_NEGATIVE',
      });
    }
    customer.emptyDepositBalance = nextEmpty;

    if (customer.isAccountCustomer) {
      customer.currentBalanceTL =
        (Number(customer.currentBalanceTL) || 0) +
        newDelivery.collectedPayment.diffUncollected;
    }

    const result = await createDeliveryRecord(newDelivery, customer);

    // Eşzamanlı iki istek aynı kimlikle geldiyse RPC yalnızca birini uygular.
    // İkinci isteğin içeriği farklıysa sessizce başarı dönülmez.
    if (result.duplicate && !deliveryPayloadsMatch(newDelivery, result.delivery)) {
      return res.status(409).json({
        error:
          'Bu teslimat kimliği eşzamanlı olarak farklı bir içerikle kaydedilmiş. Kayıt değiştirilmedi.',
        code: 'ID_CONFLICT',
      });
    }

    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (err: any) {
    if (err instanceof DeliveryInputError) {
      return res.status(err.status).json({
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
      });
    }
    const code = err instanceof DeliveryDbError ? err.code : err?.code;
    if (code === 'DISPATCH_CLOSED' || code === 'ID_CONFLICT') {
      return res.status(409).json({ error: err.message, code });
    }
    if (code === 'CUSTOMER_NOT_FOUND' || code === 'DISPATCH_NOT_FOUND') {
      return res.status(404).json({ error: err.message, code });
    }
    if (code === 'EMPTY_BALANCE_NEGATIVE' || code === 'VALIDATION_ERROR') {
      return res.status(422).json({ error: err.message, code });
    }
    if (code === 'INSUFFICIENT_VEHICLE_STOCK' || code === 'PAYMENT_DATA_INCONSISTENT') {
      return res.status(409).json({ error: err.message, code });
    }
    if (code === 'MIGRATION_REQUIRED' || code === 'RPC_AUTH_REQUIRED') {
      return res.status(503).json({ error: err.message, code });
    }
    res.status(500).json({ error: err.message, code: code || 'DELIVERY_FAILED' });
  }
});

// 5b. Teslimat iptali (soft-cancel) — yalnızca teslimatı yapan şoför
app.post('/api/deliveries/:id/cancel', async (req, res) => {
  const deliveryId = String(req.params.id || '');
  const reason = String(req.body?.reason || '').trim();

  if (reason.length < 3) {
    return res.status(400).json({
      error: 'İptal için en az 3 karakterlik bir gerekçe girin.',
      code: 'REASON_REQUIRED',
    });
  }

  try {
    const session = getAuthUser(req);
    if (!session || session.role !== 'driver') {
      return res.status(403).json({
        error: 'Teslimat iptali yalnızca şoför oturumuyla yapılabilir.',
        code: 'NOT_AUTHORIZED',
      });
    }

    const [existing, allDispatches] = await Promise.all([
      getDeliveryById(deliveryId),
      getDispatches(),
    ]);
    if (!existing) {
      return res.status(404).json({
        error: 'Teslimat bulunamadı.',
        code: 'DELIVERY_NOT_FOUND',
      });
    }
    const dispatch = allDispatches.find((d) => d.id === existing.dispatchId);
    if (!dispatch) {
      return res.status(404).json({
        error: 'Sefer bulunamadı.',
        code: 'DISPATCH_NOT_FOUND',
      });
    }

    if (session.userId !== existing.driverId || dispatch.driverId !== session.userId) {
      return res.status(403).json({
        error: 'Yalnızca kendi seferinizdeki teslimatı iptal edebilirsiniz.',
        code: 'NOT_AUTHORIZED',
      });
    }
    if (!isDispatchOpenForDelivery(dispatch.status)) {
      return res.status(409).json({
        error: 'Sefer kapatılmış. Düzeltme için yönetici seferi yeniden açmalıdır.',
        code: 'DISPATCH_CLOSED',
      });
    }

    const result = await cancelDeliveryAtomic(deliveryId, session.userId, reason);
    res.json({
      delivery: result.delivery,
      replacement: null,
      updatedCustomer: result.updatedCustomer,
      duplicate: result.duplicate,
    });
  } catch (err: any) {
    sendDeliveryCorrectionError(res, err);
  }
});

// 5c. Teslimat düzenlemesi — eski kayıt iptal + yeni kayıt tek transaction
app.post('/api/deliveries/:id/replace', async (req, res) => {
  const deliveryId = String(req.params.id || '');
  const reason = String(req.body?.reason || '').trim();
  const replacementId = String(req.body?.replacementId || '');

  if (reason.length < 3) {
    return res.status(400).json({
      error: 'Düzenleme için en az 3 karakterlik bir gerekçe girin.',
      code: 'REASON_REQUIRED',
    });
  }
  if (
    !/^(del_|offline_)[A-Za-z0-9_-]+$/.test(replacementId) ||
    replacementId.length > 100 ||
    replacementId === deliveryId
  ) {
    return res.status(400).json({
      error: 'Geçersiz düzenleme kimliği.',
      code: 'VALIDATION_ERROR',
    });
  }

  try {
    const session = getAuthUser(req);
    if (!session || session.role !== 'driver') {
      return res.status(403).json({
        error: 'Teslimat düzenlemesi yalnızca şoför oturumuyla yapılabilir.',
        code: 'NOT_AUTHORIZED',
      });
    }

    const [existing, allDispatches, allUsers, allCustomers, allProducts] =
      await Promise.all([
        getDeliveryById(deliveryId),
        getDispatches(),
        getUsers(),
        getCustomers(),
        getProducts(),
      ]);

    if (!existing) {
      return res.status(404).json({
        error: 'Teslimat bulunamadı.',
        code: 'DELIVERY_NOT_FOUND',
      });
    }
    const dispatch = allDispatches.find((d) => d.id === existing.dispatchId);
    const driver = allUsers.find((u) => u.id === existing.driverId);
    const customer = allCustomers.find((c) => c.id === existing.customerId);
    if (!dispatch || !driver || !customer) {
      return res.status(404).json({
        error: 'Teslimatın sefer, şoför veya müşteri bilgisi bulunamadı.',
        code: 'DELIVERY_NOT_FOUND',
      });
    }
    if (session.userId !== existing.driverId || dispatch.driverId !== session.userId) {
      return res.status(403).json({
        error: 'Yalnızca kendi seferinizdeki teslimatı düzenleyebilirsiniz.',
        code: 'NOT_AUTHORIZED',
      });
    }

    if (existing.status === 'cancelled') {
      if (existing.replacedByDeliveryId !== replacementId) {
        return res.status(409).json({
          error: 'Bu teslimat başka bir işlemle iptal edilmiş.',
          code: 'DELIVERY_ALREADY_CANCELLED',
        });
      }
    } else if (!isDispatchOpenForDelivery(dispatch.status)) {
      return res.status(409).json({
        error: 'Sefer kapatılmış. Düzeltme için yönetici seferi yeniden açmalıdır.',
        code: 'DISPATCH_CLOSED',
      });
    }

    const { delivery: replacement } = normalizeDeliveryInput({
      id: replacementId,
      dispatch,
      driver,
      customer,
      products: allProducts,
      deliveredItems: req.body?.deliveredItems,
      collectedPayment: req.body?.collectedPayment,
      emptyContainersReceived: req.body?.emptyContainersReceived,
      notes: req.body?.notes,
      isOfflineSync: false,
    });

    if (existing.status !== 'cancelled') {
      const activeDeliveries = await getDeliveries({ dispatchId: dispatch.id });
      assertVehicleStockAvailable(
        replacement,
        dispatch,
        activeDeliveries,
        existing.id
      );
      assertEmptyBalanceForReplacement(customer, existing, replacement);
    }

    const result = await replaceDeliveryAtomic(
      deliveryId,
      session.userId,
      reason,
      replacement
    );
    res.json({
      delivery: result.delivery,
      replacement: result.replacement,
      updatedCustomer: result.updatedCustomer,
      duplicate: result.duplicate,
    });
  } catch (err: any) {
    sendDeliveryCorrectionError(res, err);
  }
});

// 6. Reports & Analytics
app.get('/api/reports/daily', requireAdmin, async (req, res) => {
  try {
    const date = (req.query.date as string) || getTodayDateStr();
    const driverId = req.query.driverId as string;

    const [allDispatches, allCustomers] = await Promise.all([
      getDispatches(date),
      getCustomers(),
    ]);
    const accountCustomerIds = new Set(
      allCustomers.filter((c) => c.isAccountCustomer).map((c) => c.id)
    );
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
    let totalEmptyCamDamacanaCollected = 0;
    let totalEmptyTupCollected = 0;

    const deliveredProductQuantities: Record<string, { name: string; quantity: number }> = {};

    deliveries.forEach((del) => {
      totalDeliveredValue += del.deliveredGrandTotal;
      totalCashCollected += del.collectedPayment.cashAmount;
      totalPosCollected += del.collectedPayment.posAmount;
      if (
        accountCustomerIds.has(del.customerId) &&
        del.collectedPayment.diffUncollected > 0
      ) {
        totalCreditAdded += del.collectedPayment.diffUncollected;
      }
      totalEmptyDamacanaCollected += del.emptyContainersReceived.damacana || 0;
      totalEmptyCamDamacanaCollected +=
        Number(del.emptyContainersReceived.camDamacana || del.emptyContainersReceived.cam_damacana) || 0;
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
        totalEmptyCamDamacanaCollected,
        totalEmptyTupCollected,
        deliveredProductQuantities,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Retention Status & Trigger
app.get('/api/cleanup/status', requireAdmin, async (_req, res) => {
  try {
    const status = await getCleanupStats();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cleanup/trigger', requireAdmin, async (_req, res) => {
  try {
    const result = await runRetentionCleanup();
    if (result.locked) {
      return res.status(409).json({
        error: 'Başka bir saklama temizliği şu anda çalışıyor. Lütfen tekrar deneyin.',
        code: 'RETENTION_LOCKED',
        ...result,
      });
    }
    res.json({
      message: result.dryRun
        ? '60 günlük saklama temizliği çalıştırıldı (DRY-RUN: hiçbir kayıt silinmedi)'
        : '60 günlük saklama temizliği çalıştırıldı',
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
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[SuDağıtım Pro] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
