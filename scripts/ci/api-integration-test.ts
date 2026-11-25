/**
 * API entegrasyon testi — gerçek server + yerel PostgreSQL.
 *
 * CI'de şema/migration uygulandıktan sonra çalışır. Test verisini kendisi
 * seed eder, server'ı ayrı portta başlatır ve kritik API sözleşmelerini
 * gerçek HTTP istekleriyle doğrular.
 *
 * Güvenlik: yalnızca localhost DATABASE_URL kabul edilir.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';

const ROOT = process.cwd();
const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

const TODAY = new Date().toISOString().slice(0, 10);
const ADMIN = { username: 'api_admin', pin: '1111' };
const DRIVER = { username: 'api_driver', pin: '2222' };
const DRIVER2 = { username: 'api_driver2', pin: '3333' };

let passed = 0;
let failed = 0;
const failedChecks: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failedChecks.push(name);
    console.error(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

function assertLocalDatabase(url: string) {
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`API testi yalnızca yerel veritabanında çalışır: ${host}`);
  }
}

async function seed(client: Client) {
  await client.query(
    `INSERT INTO public.users (id, name, username, role, can_load_vehicle, pin)
     VALUES
       ('u_api_admin', 'API Admin', $1, 'admin', true, $2),
       ('u_api_driver', 'API Şoför', $3, 'driver', true, $4),
       ('u_api_driver2', 'API Şoför 2', $5, 'driver', true, $6)
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       role = EXCLUDED.role,
       can_load_vehicle = EXCLUDED.can_load_vehicle,
       pin = EXCLUDED.pin`,
    [ADMIN.username, ADMIN.pin, DRIVER.username, DRIVER.pin, DRIVER2.username, DRIVER2.pin]
  );

  await client.query(
    `INSERT INTO public.customers (id, name, is_account_customer, current_balance_tl)
     VALUES ('c_api_cash', 'API Peşin Müşteri', false, 0),
            ('c_api_account', 'API Faturalı Müşteri', true, 0)
     ON CONFLICT (id) DO UPDATE SET
       current_balance_tl = EXCLUDED.current_balance_tl,
       is_account_customer = EXCLUDED.is_account_customer`
  );

  await client.query(
    `INSERT INTO public.products
       (id, name, category, default_unit_price, is_deposit, deposit_type, unit)
     VALUES ('p_api_water', 'API Damacana', 'damacana', 100, true, 'damacana', 'Adet')
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       category = EXCLUDED.category,
       default_unit_price = EXCLUDED.default_unit_price,
       is_deposit = EXCLUDED.is_deposit,
       deposit_type = EXCLUDED.deposit_type,
       unit = EXCLUDED.unit`
  );

  await client.query(
    `INSERT INTO public.suppliers (id, name, is_active, note)
     VALUES ('sup_api', 'API Toptancı', true, 'CI')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true`
  );

  await client.query(
    `INSERT INTO public.dispatches
       (id, date, driver_id, driver_name, vehicle_plate, loaded_by_user_id,
        loaded_by_user_name, status, created_at)
     VALUES
       ('d_api_1', $1, 'u_api_driver', 'API Şoför', '34 API 001',
        'u_api_admin', 'API Admin', 'in_transit', now() - interval '2 hour'),
       ('d_api_2', $1, 'u_api_driver2', 'API Şoför 2', '34 API 002',
        'u_api_admin', 'API Admin', 'in_transit', now() - interval '1 hour')
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       driver_id = EXCLUDED.driver_id,
       driver_name = EXCLUDED.driver_name,
       vehicle_plate = EXCLUDED.vehicle_plate`,
    [TODAY]
  );

  await client.query(
    `INSERT INTO public.dispatch_items (dispatch_id, product_id, quantity)
     VALUES ('d_api_1', 'p_api_water', 10), ('d_api_2', 'p_api_water', 10)
     ON CONFLICT (dispatch_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity`
  );
}

async function request(
  pathname: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {}
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // HTML/boş yanıt olabilir; metin olarak korunur.
  }
  return { status: response.status, body };
}

async function login(credentials: { username: string; pin: string }): Promise<string> {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: credentials,
  });
  if (result.status !== 200 || typeof result.body?.token !== 'string') {
    throw new Error(`Login başarısız (${credentials.username}): ${result.status}`);
  }
  return result.body.token;
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) return;
    } catch {
      // Server henüz açılmadı.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Server 30 saniye içinde ayağa kalkmadı.');
}

async function main() {
  assertLocalDatabase(DATABASE_URL);

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  await seed(db);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(PORT),
    DATABASE_URL,
    NODE_ENV: 'test',
  };
  for (const key of [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
  ]) {
    delete env[key];
  }

  const server = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server.ts'],
    {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    }
  );
  let logs = '';
  server.stdout?.on('data', (chunk) => {
    logs += String(chunk);
  });
  server.stderr?.on('data', (chunk) => {
    logs += String(chunk);
  });

  try {
    await waitForServer();

    const health = await request('/api/health');
    check('health 200', health.status === 200);

    const badLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { username: ADMIN.username, pin: 'wrong' },
    });
    check('hatalı PIN 401', badLogin.status === 401);

    const adminToken = await login(ADMIN);
    const driverToken = await login(DRIVER);
    const driver2Token = await login(DRIVER2);
    check('admin login', !!adminToken);
    check('şoför login', !!driverToken);

    const driverReport = await request('/api/reports/daily', { token: driverToken });
    check('şoför günlük rapor 403', driverReport.status === 403);

    const adminReport = await request('/api/reports/daily', { token: adminToken });
    check('admin günlük rapor 200', adminReport.status === 200);

    const crossDriverPayments = await request(
      `/api/payments?date=${TODAY}&driverId=u_api_driver`,
      { token: driver2Token }
    );
    check('şoför başka şoförün tahsilatına 403', crossDriverPayments.status === 403);

    const paymentId = `pay_api_ci_${Date.now()}`;
    const paymentCreate = await request('/api/customers/c_api_cash/payments', {
      method: 'POST',
      token: driverToken,
      body: {
        paymentId,
        amount: 100,
        method: 'CASH',
        note: 'API CI',
        dispatchId: 'd_api_1',
      },
    });
    check('tahsilat oluşturma 201', paymentCreate.status === 201);

    const paymentList = await request(`/api/payments?dispatchId=d_api_1`, {
      token: driverToken,
    });
    const listedPayment = paymentList.body?.payments?.find((p: any) => p.id === paymentId);
    check('tahsilat listesinde kayıt var', paymentList.status === 200 && !!listedPayment);
    check('şoför kendi tahsilatında canCorrect true', listedPayment?.canCorrect === true);

    const adminAmendDriver = await request(`/api/payments/${paymentId}`, {
      method: 'PUT',
      token: adminToken,
      body: { amount: 90, method: 'CASH', expectedAmount: 100, expectedMethod: 'CASH' },
    });
    check(
      'yönetici şoförün tahsilatını düzenleyemez (403)',
      adminAmendDriver.status === 403 &&
        adminAmendDriver.body?.code === 'NOT_AUTHORIZED'
    );

    const adminPaymentList = await request(`/api/payments?date=${TODAY}`, {
      token: adminToken,
    });
    const adminSeesDriverPayment = adminPaymentList.body?.payments?.find(
      (p: any) => p.id === paymentId
    );
    check(
      'yönetici şoför tahsilatında canCorrect false',
      adminPaymentList.status === 200 && adminSeesDriverPayment?.canCorrect === false
    );

    const paymentAmend = await request(`/api/payments/${paymentId}`, {
      method: 'PUT',
      token: driverToken,
      body: {
        amount: 120,
        method: 'POS',
        expectedAmount: listedPayment?.amount,
        expectedMethod: listedPayment?.method,
      },
    });
    check(
      'tahsilat düzeltme beklenen tutarla 200',
      paymentAmend.status === 200 &&
        Number(paymentAmend.body?.payment?.amount) === 120 &&
        paymentAmend.body?.payment?.method === 'POS'
    );

    const paymentStale = await request(`/api/payments/${paymentId}`, {
      method: 'PUT',
      token: driverToken,
      body: { amount: 130, method: 'CASH', expectedAmount: 100, expectedMethod: 'CASH' },
    });
    check(
      'bayat beklenen tutar 409 PAYMENT_CHANGED',
      paymentStale.status === 409 &&
        paymentStale.body?.code === 'PAYMENT_CHANGED' &&
        Number(paymentStale.body?.currentAmount) === 120 &&
        paymentStale.body?.currentMethod === 'POS'
    );

    const paymentCancel = await request(`/api/payments/${paymentId}/cancel`, {
      method: 'POST',
      token: driverToken,
    });
    check('tahsilat iptali 200', paymentCancel.status === 200);
    const paymentRow = await db.query('SELECT count(*)::int AS n FROM public.customer_payments WHERE id=$1', [
      paymentId,
    ]);
    check('iptalde tahsilat fiziksel silindi', paymentRow.rows[0]?.n === 0);

    const adminLinkedPaymentId = `pay_api_admin_link_${Date.now()}`;
    const adminLinkedPayment = await request('/api/customers/c_api_cash/payments', {
      method: 'POST',
      token: adminToken,
      body: {
        paymentId: adminLinkedPaymentId,
        amount: 10,
        method: 'CASH',
        dispatchId: 'd_api_1',
      },
    });
    check(
      'yönetici tahsilatı sefere bağlanamaz (400)',
      adminLinkedPayment.status === 400 &&
        adminLinkedPayment.body?.code === 'DISPATCH_NOT_ALLOWED'
    );

    const adminPaymentId = `pay_api_admin_${Date.now()}`;
    const adminPaymentCreate = await request('/api/customers/c_api_cash/payments', {
      method: 'POST',
      token: adminToken,
      body: { paymentId: adminPaymentId, amount: 10, method: 'CASH', note: 'API admin CI' },
    });
    check('yönetici tahsilatı oluşturma 201', adminPaymentCreate.status === 201);

    const adminCustomerPayments = await request('/api/customers/c_api_cash/payments', {
      token: adminToken,
    });
    const adminOwnPayment = adminCustomerPayments.body?.payments?.find(
      (p: any) => p.id === adminPaymentId
    );
    check(
      'yönetici kendi tahsilatında canCorrect true',
      adminCustomerPayments.status === 200 && adminOwnPayment?.canCorrect === true
    );

    const adminPaymentAmend = await request(`/api/payments/${adminPaymentId}`, {
      method: 'PUT',
      token: adminToken,
      body: {
        amount: 15,
        method: 'POS',
        expectedAmount: adminOwnPayment?.amount,
        expectedMethod: adminOwnPayment?.method,
      },
    });
    check(
      'yönetici kendi tahsilatını aynı gün düzenler 200',
      adminPaymentAmend.status === 200 &&
        Number(adminPaymentAmend.body?.payment?.amount) === 15 &&
        adminPaymentAmend.body?.payment?.method === 'POS'
    );

    const adminPaymentCancel = await request(`/api/payments/${adminPaymentId}/cancel`, {
      method: 'POST',
      token: adminToken,
    });
    check('yönetici kendi tahsilatını aynı gün iptal eder 200', adminPaymentCancel.status === 200);

    const noOverride = await request('/api/deliveries', {
      method: 'POST',
      token: driverToken,
      body: {
        id: `del_api_no_override_${Date.now()}`,
        dispatchId: 'd_api_1',
        driverId: 'u_api_driver',
        customerId: 'c_api_cash',
        deliveredItems: [
          { productId: 'p_api_water', productName: 'API Damacana', quantity: 11, unitPrice: 100 },
        ],
        collectedPayment: {
          method: 'UNPAID',
          cashAmount: 0,
          posAmount: 0,
          totalCollected: 0,
          diffUncollected: 1100,
        },
        emptyContainersReceived: { damacana: 0, camDamacana: 0, tupBuyuk: 0, tupKucuk: 0, sebil: 0 },
      },
    });
    check('override olmadan stok aşımı 409', noOverride.status === 409);

    const overrideId = `del_api_override_${Date.now()}`;
    const overrideDelivery = await request('/api/deliveries', {
      method: 'POST',
      token: driverToken,
      body: {
        id: overrideId,
        dispatchId: 'd_api_1',
        driverId: 'u_api_driver',
        customerId: 'c_api_cash',
        deliveredItems: [
          { productId: 'p_api_water', productName: 'API Damacana', quantity: 11, unitPrice: 100 },
        ],
        collectedPayment: {
          method: 'UNPAID',
          cashAmount: 0,
          posAmount: 0,
          totalCollected: 0,
          diffUncollected: 1100,
        },
        emptyContainersReceived: { damacana: 0, camDamacana: 0, tupBuyuk: 0, tupKucuk: 0, sebil: 0 },
        allowStockOverride: true,
      },
    });
    check('override ile stok aşımı 201', overrideDelivery.status === 201);
    check(
      'override detayı döndü',
      overrideDelivery.body?.delivery?.stockOverride === true &&
        Array.isArray(overrideDelivery.body?.delivery?.stockOverrideDetails)
    );

    const cancelDelivery = await request(`/api/deliveries/${overrideId}/cancel`, {
      method: 'POST',
      token: driverToken,
    });
    check('teslimat iptali 200', cancelDelivery.status === 200);
    const deliveryRow = await db.query(
      'SELECT count(*)::int AS n FROM public.deliveries WHERE id = $1',
      [overrideId]
    );
    check('iptalde teslimat fiziksel silindi', deliveryRow.rows[0]?.n === 0);

    const cancelDeliveryAgain = await request(`/api/deliveries/${overrideId}/cancel`, {
      method: 'POST',
      token: driverToken,
    });
    check(
      'silinmiş teslimatın tekrar iptali DELIVERY_NOT_FOUND',
      cancelDeliveryAgain.status === 404 &&
        cancelDeliveryAgain.body?.code === 'DELIVERY_NOT_FOUND'
    );

    const purchaseId = `pur_api_ci_${Date.now()}`;
    const purchaseCreate = await request('/api/purchases', {
      method: 'POST',
      token: adminToken,
      body: {
        id: purchaseId,
        supplierId: 'sup_api',
        description: 'API CI',
        items: [{ productId: 'p_api_water', quantity: 2, unitPrice: 50 }],
      },
    });
    check('satın alım oluşturma 201', purchaseCreate.status === 201);

    const purchaseUpdate = await request(`/api/purchases/${purchaseId}`, {
      method: 'PUT',
      token: adminToken,
      body: {
        supplierId: 'sup_api',
        description: 'API CI güncel',
        items: [{ productId: 'p_api_water', quantity: 3, unitPrice: 50 }],
      },
    });
    check('satın alım düzeltme 200', purchaseUpdate.status === 200);

    const purchaseCancel = await request(`/api/purchases/${purchaseId}/cancel`, {
      method: 'POST',
      token: adminToken,
      body: {},
    });
    check('satın alım iptali 200', purchaseCancel.status === 200);

    const adminBalance = await request('/api/customers/c_api_cash', {
      method: 'PUT',
      token: adminToken,
      body: { currentBalanceTL: 250, expectedBalanceTL: 0 },
    });
    check('admin bakiye düzeltme 200', adminBalance.status === 200);

    const driverBalance = await request('/api/customers/c_api_cash', {
      method: 'PUT',
      token: driverToken,
      body: { currentBalanceTL: 0, expectedBalanceTL: 250 },
    });
    check('şoför bakiye düzeltme 403', driverBalance.status === 403);

    const dispatchCancel = await request('/api/dispatches/d_api_2/cancel', {
      method: 'POST',
      token: adminToken,
    });
    check(
      'yükleme iptali gerekçesiz 200',
      dispatchCancel.status === 200 && dispatchCancel.body?.cancelled === true
    );
    const dispatchRow = await db.query(
      'SELECT count(*)::int AS n FROM public.dispatches WHERE id = $1',
      ['d_api_2']
    );
    check('yükleme iptalinde sefer fiziksel silindi', dispatchRow.rows[0]?.n === 0);
  } finally {
    const exited = new Promise<void>((resolve) => server.once('exit', () => resolve()));
    server.kill('SIGTERM');
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (server.exitCode === null) server.kill('SIGKILL');
    await db.end();
    if (failed > 0) {
      console.error('\nServer logları:\n' + logs.split('\n').slice(-30).join('\n'));
    }
  }

  console.log(`\nAPI entegrasyon: ${passed} başarılı, ${failed} başarısız`);
  if (failed > 0) {
    console.log(`::error title=API entegrasyon::${failedChecks.join(', ')}`);
    process.exit(1);
  }
}

main().catch((error) => {
  const message = String(error?.message || error || 'bilinmeyen hata');
  console.error('API entegrasyon hatası:', error);
  console.log(`::error title=API entegrasyon::${message.slice(0, 900)}`);
  process.exit(1);
});
