/**
 * scripts/ci/delivery-cancellation-pg-test.ts
 *
 * Gercek PostgreSQL uzerinde teslimat iptal/duzenleme RPC'sini dogrular.
 * Mock degildir: Supabase stub'i + supabase_schema.sql + migrations uygulanir,
 * ardindan public.cancel_or_replace_delivery gercekten cagrilir.
 *
 * Kullanim:
 *   DATABASE_URL=postgres://... npx tsx scripts/ci/delivery-cancellation-pg-test.ts
 *   DATABASE_URL=postgres://... npx tsx scripts/ci/delivery-cancellation-pg-test.ts --apply-only
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const APPLY_ONLY = process.argv.includes('--apply-only');
const RPC = 'public.cancel_or_replace_delivery(jsonb)';

let passed = 0;
let failed = 0;
const failureDetails: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    const message = `${name}${detail ? ` -- ${detail}` : ''}`;
    failureDetails.push(message);
    console.log(`  FAIL  ${message}`);
  }
}

function readRel(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

async function newClient(): Promise<Client> {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  return c;
}

async function applySchemaAndMigrations(c: Client): Promise<void> {
  console.log('  -- sema hazirlaniyor (stub + temel sema + migrations)');
  await c.query('DROP SCHEMA IF EXISTS public CASCADE');
  await c.query('CREATE SCHEMA public');
  await c.query('DROP SCHEMA IF EXISTS auth CASCADE');
  await c.query(readRel('scripts/ci/supabase_stub.sql'));
  await c.query(readRel('supabase_schema.sql'));

  const dir = path.join(ROOT, 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    await c.query(fs.readFileSync(path.join(dir, f), 'utf-8'));
    console.log(`     migrations/${f} uygulandi`);
  }
}

async function seedReference(c: Client): Promise<void> {
  await c.query(`
    INSERT INTO public.users (id, name, username, role, can_load_vehicle, pin) VALUES
      ('u_admin', 'Yönetici', 'ci_admin', 'admin', true, '0000'),
      ('u_driver', 'Şoför', 'ci_driver', 'driver', true, '1111')
    ON CONFLICT (id) DO NOTHING;
  `);
  await c.query(`
    INSERT INTO public.products
      (id, name, category, default_unit_price, is_deposit, deposit_type, unit)
    VALUES
      ('p_water', 'Damacana Su', 'pet', 100, true, 'damacana', 'Adet'),
      ('p_cam', 'Cam Damacana', 'damacana', 120, true, 'cam_damacana', 'Adet'),
      ('p_tup', 'Tüp', 'tup', 300, true, 'tup', 'Adet')
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          category = EXCLUDED.category,
          is_deposit = EXCLUDED.is_deposit,
          deposit_type = EXCLUDED.deposit_type;
  `);
  await c.query(`
    INSERT INTO public.customers (id, name, current_balance_tl, is_account_customer)
    VALUES ('c1', 'Test Müşteri', 0, true)
    ON CONFLICT (id) DO UPDATE
      SET current_balance_tl = 0,
          is_account_customer = true;
  `);
}

async function resetTransactional(c: Client): Promise<void> {
  await c.query(`
    TRUNCATE
      public.delivery_container_returns,
      public.delivery_items,
      public.deliveries,
      public.dispatch_reconciliation_items,
      public.dispatch_items,
      public.dispatches
    RESTART IDENTITY CASCADE;
  `);
  // Denetim tablosu normalde TRUNCATE edilemez. Test izolasyonu icin trigger
  // yalnizca bu baglantida gecici olarak devre disi birakilir.
  await c.query('ALTER TABLE public.delivery_cancellation_audit DISABLE TRIGGER USER');
  try {
    await c.query('TRUNCATE public.delivery_cancellation_audit RESTART IDENTITY');
  } finally {
    await c.query('ALTER TABLE public.delivery_cancellation_audit ENABLE TRIGGER USER');
  }
  await c.query('DELETE FROM public.customer_empty_balances');
  await c.query('DELETE FROM public.customer_product_prices');
  await c.query(
    "UPDATE public.customers SET current_balance_tl = 0, is_account_customer = true WHERE id = 'c1'"
  );
}

async function seedDispatch(c: Client, loadedQty = 20): Promise<void> {
  await c.query(`
    INSERT INTO public.dispatches
      (id, date, driver_id, driver_name, vehicle_plate,
       loaded_by_user_id, loaded_by_user_name, status)
    VALUES
      ('D1', to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'),
       'u_driver', 'Şoför', '34 CI 001', 'u_admin', 'Yönetici', 'in_transit');
  `);
  await c.query(
    `INSERT INTO public.dispatch_items (dispatch_id, product_id, quantity)
     VALUES ('D1', 'p_water', $1), ('D1', 'p_cam', 20), ('D1', 'p_tup', 20)`,
    [loadedQty]
  );
}

interface DeliverySeed {
  id?: string;
  quantity?: number;
  unitPrice?: number;
  cash?: number;
  total?: number;
  diff?: number;
  emptyDiff?: number;
  emptyBalance?: number;
  appliedDelta?: number | null;
}

async function seedDelivery(c: Client, opts: DeliverySeed = {}): Promise<void> {
  const id = opts.id ?? 'DEL1';
  const quantity = opts.quantity ?? 10;
  const unitPrice = opts.unitPrice ?? 100;
  const total = opts.total ?? quantity * unitPrice;
  const cash = opts.cash ?? 700;
  const diff = opts.diff ?? total - cash;
  const applied = opts.appliedDelta === undefined ? diff : opts.appliedDelta;

  await c.query(
    `UPDATE public.customers SET current_balance_tl = $1 WHERE id = 'c1'`,
    [Math.max(diff, 0)]
  );
  await c.query(
    `INSERT INTO public.deliveries
       (id, dispatch_id, driver_id, driver_name, vehicle_plate,
        customer_id, customer_name, timestamp, delivered_grand_total,
        payment_method, cash_amount, pos_amount, total_collected,
        diff_uncollected, payment_status, applied_balance_delta_tl)
     VALUES
       ($1, 'D1', 'u_driver', 'Şoför', '34 CI 001',
        'c1', 'Test Müşteri', now(), $2,
        'CASH', $3, 0, $3, $4, 'partial', $5)`,
    [id, total, cash, diff, applied]
  );
  await c.query(
    `INSERT INTO public.delivery_items
       (delivery_id, line_no, product_id, product_name, quantity, unit_price, line_total)
     VALUES ($1, 1, 'p_water', 'Damacana Su', $2, $3, $4)`,
    [id, quantity, unitPrice, quantity * unitPrice]
  );

  const emptyDiff = opts.emptyDiff ?? 0;
  if (emptyDiff !== 0) {
    await c.query(
      `INSERT INTO public.delivery_container_returns
         (delivery_id, deposit_type, received_qty, diff_qty)
       VALUES ($1, 'damacana', 0, $2)`,
      [id, emptyDiff]
    );
  }
  const emptyBalance = opts.emptyBalance ?? Math.max(emptyDiff, 0);
  if (emptyBalance !== 0) {
    await c.query(
      `INSERT INTO public.customer_empty_balances (customer_id, deposit_type, quantity)
       VALUES ('c1', 'damacana', $1)
       ON CONFLICT (customer_id, deposit_type) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [emptyBalance]
    );
  }
}

async function balance(c: Client): Promise<number> {
  const r = await c.query(`SELECT current_balance_tl FROM public.customers WHERE id = 'c1'`);
  return Number(r.rows[0]?.current_balance_tl ?? 0);
}

async function empty(c: Client, type = 'damacana'): Promise<number> {
  const r = await c.query(
    `SELECT quantity FROM public.customer_empty_balances
     WHERE customer_id = 'c1' AND deposit_type = $1`,
    [type]
  );
  return Number(r.rows[0]?.quantity ?? 0);
}

const POOL_TYPES = ['damacana', 'cam_damacana', 'tup'] as const;
type PoolType = (typeof POOL_TYPES)[number];
type PoolCounts = Record<PoolType, number>;

function emptyPoolCounts(): PoolCounts {
  return { damacana: 0, cam_damacana: 0, tup: 0 };
}

function countsMatch(
  actual: PoolCounts,
  expected: Partial<PoolCounts>
): boolean {
  return POOL_TYPES.every(
    (type) => actual[type] === Number(expected[type] ?? 0)
  );
}

async function emptyBalances(c: Client): Promise<PoolCounts> {
  const out = emptyPoolCounts();
  const r = await c.query(
    `SELECT deposit_type, quantity FROM public.customer_empty_balances
     WHERE customer_id = 'c1'`
  );
  for (const row of r.rows) {
    if (row.deposit_type in out) {
      out[row.deposit_type as PoolType] = Number(row.quantity) || 0;
    }
  }
  return out;
}

async function setEmptyBalances(
  c: Client,
  balances: Partial<PoolCounts>
): Promise<void> {
  await c.query('DELETE FROM public.customer_empty_balances WHERE customer_id = $1', [
    'c1',
  ]);
  for (const type of POOL_TYPES) {
    const qty = Number(balances[type] ?? 0);
    if (!Number.isInteger(qty) || qty < 0) {
      throw new Error(`Gecersiz bos kap bakiyesi: ${type}=${qty}`);
    }
    if (qty === 0) continue;
    await c.query(
      `INSERT INTO public.customer_empty_balances (customer_id, deposit_type, quantity)
       VALUES ('c1', $1, $2)`,
      [type, qty]
    );
  }
}

interface PoolDeliverySeed {
  id: string;
  items: Array<{ productId: string; productName: string; quantity: number }>;
  diffs?: Partial<PoolCounts>;
  received?: Partial<PoolCounts>;
}

async function seedPoolDelivery(
  c: Client,
  opts: PoolDeliverySeed
): Promise<void> {
  await c.query(
    `INSERT INTO public.deliveries
       (id, dispatch_id, driver_id, driver_name, vehicle_plate,
        customer_id, customer_name, timestamp, delivered_grand_total,
        payment_method, cash_amount, pos_amount, total_collected,
        diff_uncollected, payment_status, applied_balance_delta_tl)
     VALUES
       ($1, 'D1', 'u_driver', 'Şoför', '34 CI 001',
        'c1', 'Test Müşteri', now(), 0,
        'UNPAID', 0, 0, 0, 0, 'paid_full', 0)`,
    [opts.id]
  );

  let lineNo = 0;
  for (const item of opts.items) {
    lineNo++;
    await c.query(
      `INSERT INTO public.delivery_items
         (delivery_id, line_no, product_id, product_name, quantity, unit_price, line_total)
       VALUES ($1, $2, $3, $4, $5, 0, 0)`,
      [opts.id, lineNo, item.productId, item.productName, item.quantity]
    );
  }

  for (const type of POOL_TYPES) {
    const diff = Number(opts.diffs?.[type] ?? 0);
    const received = Number(opts.received?.[type] ?? 0);
    if (diff === 0 && received === 0) continue;
    await c.query(
      `INSERT INTO public.delivery_container_returns
         (delivery_id, deposit_type, received_qty, diff_qty)
       VALUES ($1, $2, $3, $4)`,
      [opts.id, type, received, diff]
    );
  }
}

async function deliveryRow(c: Client, id: string): Promise<any> {
  const r = await c.query('SELECT * FROM public.deliveries WHERE id = $1', [id]);
  return r.rows[0];
}

async function auditCount(c: Client, id: string): Promise<number> {
  const r = await c.query(
    'SELECT count(*)::int AS n FROM public.delivery_cancellation_audit WHERE delivery_id = $1',
    [id]
  );
  return Number(r.rows[0].n);
}

async function auditRow(c: Client, id: string): Promise<any> {
  const r = await c.query(
    'SELECT * FROM public.delivery_cancellation_audit WHERE delivery_id = $1 ORDER BY id DESC LIMIT 1',
    [id]
  );
  return r.rows[0];
}

async function callRpc(c: Client, payload: Record<string, unknown>): Promise<any> {
  const r = await c.query(
    `SELECT public.cancel_or_replace_delivery($1::jsonb) AS r`,
    [JSON.stringify(payload)]
  );
  return r.rows[0].r;
}

async function errorOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return '';
  } catch (e: any) {
    return String(e?.message ?? e);
  }
}

function cancelPayload(id = 'DEL1', reason = 'Yanlış müşteriye kaydedildi') {
  return {
    mode: 'cancel',
    delivery_id: id,
    reason,
    actor_id: 'u_driver',
  };
}

function replacementPayload() {
  return {
    id: 'DEL_REPLACEMENT',
    dispatch_id: 'D1',
    driver_id: 'u_driver',
    driver_name: 'Şoför',
    vehicle_plate: '34 CI 001',
    customer_id: 'c1',
    customer_name: 'Test Müşteri',
    delivered_grand_total: 1200,
    payment_method: 'CASH',
    cash_amount: 900,
    pos_amount: 0,
    total_collected: 900,
    diff_uncollected: 300,
    payment_status: 'partial',
    is_offline_sync: false,
    items: [
      {
        line_no: 1,
        product_id: 'p_water',
        product_name: 'Damacana Su',
        quantity: 12,
        unit_price: 100,
        line_total: 1200,
      },
    ],
    container_returns: [
      { deposit_type: 'damacana', received_qty: 1, diff_qty: 1 },
    ],
    empty_deltas: { damacana: 1 },
    prices: [],
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLockWaiters(
  c: Client,
  pids: number[],
  timeoutMs = 5000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await c.query(
      `SELECT count(*)::int AS n
         FROM pg_stat_activity
        WHERE pid = ANY($1::int[])
          AND wait_event_type = 'Lock'`,
      [pids]
    );
    if (Number(r.rows[0].n) === pids.length) return true;
    await sleep(25);
  }
  return false;
}

function applyPayload(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    dispatch_id: 'D1',
    driver_id: 'u_driver',
    driver_name: 'Şoför',
    vehicle_plate: '34 CI 001',
    customer_id: 'c1',
    customer_name: 'Test Müşteri',
    customer_address: '',
    customer_phone: '',
    delivered_grand_total: 500,
    payment_method: 'CASH',
    cash_amount: 200,
    pos_amount: 0,
    total_collected: 200,
    diff_uncollected: 300,
    payment_status: 'partial',
    notes: 'CI',
    is_offline_sync: false,
    items: [
      {
        line_no: 1,
        product_id: 'p_water',
        product_name: 'Damacana Su',
        quantity: 5,
        unit_price: 100,
        line_total: 500,
      },
    ],
    container_returns: [
      { deposit_type: 'damacana', received_qty: 4, diff_qty: 1 },
    ],
    empty_deltas: { damacana: 1 },
    prices: [],
    ...overrides,
  };
}

function poolApplyPayload(
  id: string,
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
  }>,
  diffs: Partial<PoolCounts> = {},
  received: Partial<PoolCounts> = {}
): Record<string, unknown> {
  const containerReturns = POOL_TYPES.map((type) => ({
    deposit_type: type,
    received_qty: Number(received[type] ?? 0),
    diff_qty: Number(diffs[type] ?? 0),
  }));
  const emptyDeltas: Record<string, number> = {};
  for (const row of containerReturns) {
    emptyDeltas[row.deposit_type] = row.diff_qty;
  }

  return {
    id,
    dispatch_id: 'D1',
    driver_id: 'u_driver',
    driver_name: 'Şoför',
    vehicle_plate: '34 CI 001',
    customer_id: 'c1',
    customer_name: 'Test Müşteri',
    customer_address: '',
    customer_phone: '',
    delivered_grand_total: 0,
    payment_method: 'UNPAID',
    cash_amount: 0,
    pos_amount: 0,
    total_collected: 0,
    diff_uncollected: 0,
    payment_status: 'paid_full',
    notes: 'CI deposit pools',
    is_offline_sync: false,
    items: items.map((item, index) => ({
      line_no: index + 1,
      product_id: item.productId,
      product_name: item.productName,
      quantity: item.quantity,
      unit_price: 0,
      line_total: 0,
    })),
    container_returns: containerReturns,
    empty_deltas: emptyDeltas,
    prices: [],
  };
}

async function callApply(c: Client, payload: Record<string, unknown>): Promise<any> {
  const r = await c.query(`SELECT public.apply_delivery($1::jsonb) AS r`, [
    JSON.stringify(payload),
  ]);
  return r.rows[0].r;
}

async function deliveryCount(c: Client, status?: string): Promise<number> {
  const r = status
    ? await c.query(
        `SELECT count(*)::int AS n FROM public.deliveries WHERE status = $1`,
        [status]
      )
    : await c.query(`SELECT count(*)::int AS n FROM public.deliveries`);
  return Number(r.rows[0].n);
}

async function deliveryItemQty(c: Client, id: string): Promise<number> {
  const r = await c.query(
    `SELECT COALESCE(sum(quantity), 0)::int AS n
       FROM public.delivery_items
      WHERE delivery_id = $1`,
    [id]
  );
  return Number(r.rows[0].n);
}

async function auditTotal(c: Client): Promise<number> {
  const r = await c.query(
    `SELECT count(*)::int AS n FROM public.delivery_cancellation_audit`
  );
  return Number(r.rows[0].n);
}

async function markDispatchCompleted(c: Client): Promise<void> {
  await c.query(
    `UPDATE public.dispatches
        SET status = 'completed',
            closed_at = now(),
            closed_by_user_id = 'u_admin',
            closed_by_user_name = 'Yönetici'
      WHERE id = 'D1'`
  );
}

async function reopenDispatch(c: Client): Promise<any> {
  const r = await c.query(
    `SELECT public.reopen_dispatch($1::jsonb) AS r`,
    [
      JSON.stringify({
        dispatch_id: 'D1',
        reopened_by_user_id: 'u_admin',
        reason: 'CI yeniden açma',
      }),
    ]
  );
  return r.rows[0].r;
}

async function scenarioCancel(c: Client): Promise<void> {
  console.log('\n[1] Iptal: bakiye ve bos kap geri alinir, idempotent');
  await resetTransactional(c);
  await seedDispatch(c);
  await seedDelivery(c, { emptyDiff: 2, emptyBalance: 2 });

  const res = await callRpc(c, cancelPayload());
  check('iptal basarili', res.cancelled === true && res.duplicate === false);
  check('islem turu cancel', res.action === 'cancel');
  check('bakiye 300 -> 0', Number(res.previous_balance) === 300 && Number(res.new_balance) === 0);
  check('ters bakiye 300', Number(res.reversed_balance) === 300);
  check('bos damacana 2 -> 0', (await empty(c)) === 0);

  const row = await deliveryRow(c, 'DEL1');
  check('teslimat cancelled', row.status === 'cancelled');
  check('cancel alanlari dolu', !!row.cancelled_at && row.cancelled_by_user_id === 'u_driver' && row.cancel_reason.length >= 3);
  check('musteri bakiyesi 0', (await balance(c)) === 0);

  const audit = await auditRow(c, 'DEL1');
  check('denetim kaydi olustu', !!audit && audit.action === 'cancel');
  check('denetimde ters bos kap 2', Number(audit.reversed_empty?.damacana) === 2);
  check('denetimde onceki/sonraki bakiye', Number(audit.previous_balance) === 300 && Number(audit.new_balance) === 0);

  const auditBefore = await auditCount(c, 'DEL1');
  const dup = await callRpc(c, cancelPayload());
  check('ikinci iptal duplicate', dup.duplicate === true);
  check('ikinci iptal bakiyeyi degistirmedi', (await balance(c)) === 0);
  check('ikinci iptal denetim eklemedi', (await auditCount(c, 'DEL1')) === auditBefore);

  await c.query(`UPDATE public.dispatches SET status = 'completed', closed_at = now() WHERE id = 'D1'`);
  const afterClose = await callRpc(c, cancelPayload());
  check('sefer kapandiktan sonra da duplicate', afterClose.duplicate === true);
  check('sefer kapali retry bakiyeyi degistirmedi', (await balance(c)) === 0);
}

async function scenarioReplace(c: Client): Promise<void> {
  console.log('\n[2] Duzenleme: eski iptal + yeni kayit, net bakiye/bos kap');
  await resetTransactional(c);
  await seedDispatch(c);
  await seedDelivery(c, { emptyDiff: 2, emptyBalance: 2 });

  const replacement = replacementPayload();
  const res = await callRpc(c, {
    mode: 'replace',
    delivery_id: 'DEL1',
    reason: 'Adet yanlis girilmis',
    actor_id: 'u_driver',
    replacement,
  });

  check('duzenleme basarili', res.cancelled === true && res.duplicate === false);
  check('islem turu replace', res.action === 'replace');
  check('yeni teslimat id dogru', res.replacement_delivery_id === 'DEL_REPLACEMENT');

  const oldRow = await deliveryRow(c, 'DEL1');
  check('eski teslimat cancelled', oldRow.status === 'cancelled');
  check('eski teslimat yeni id ile isaretli', oldRow.replaced_by_delivery_id === 'DEL_REPLACEMENT');

  const newRow = await deliveryRow(c, 'DEL_REPLACEMENT');
  check('yeni teslimat active', newRow && newRow.status === 'active');
  check('yeni teslimat bakiyesi 300', Number(newRow.applied_balance_delta_tl) === 300);
  check('musteri bakiyesi net 300', (await balance(c)) === 300);
  check('bos damacana net 1', (await empty(c)) === 1);

  const newItems = await c.query(
    `SELECT quantity FROM public.delivery_items WHERE delivery_id = 'DEL_REPLACEMENT'`
  );
  check('yeni kalem miktari 12', Number(newItems.rows[0]?.quantity) === 12);

  const audit = await auditRow(c, 'DEL1');
  check('denetimde replace kaydi', audit.action === 'replace');
  check('denetimde yeni teslimat id', audit.replacement_delivery_id === 'DEL_REPLACEMENT');
  check('denetimde ters bakiye 300', Number(audit.reversed_balance) === 300);
  check('denetimde ters bos kap 2', Number(audit.reversed_empty?.damacana) === 2);

  const auditBefore = await auditCount(c, 'DEL1');
  const dup = await callRpc(c, {
    mode: 'replace',
    delivery_id: 'DEL1',
    reason: 'Adet yanlis girilmis',
    actor_id: 'u_driver',
    replacement,
  });
  check('ayni replacement retry duplicate', dup.duplicate === true);
  check('duplicate denetim eklemedi', (await auditCount(c, 'DEL1')) === auditBefore);

  const cancelNew = await callRpc(c, cancelPayload('DEL_REPLACEMENT'));
  check('yeni teslimat da iptal edilebilir', cancelNew.duplicate === false);
  check('yeni iptal sonrasi bakiye 0', (await balance(c)) === 0);
  check('yeni iptal sonrasi bos kap 0', (await empty(c)) === 0);
}

async function scenarioHistorical(c: Client): Promise<void> {
  console.log('\n[3] Eski kayit: applied_balance_delta_tl NULL -> desteklenmez');
  await resetTransactional(c);
  await seedDispatch(c);
  await seedDelivery(c, { appliedDelta: null });

  const err = await errorOf(() => callRpc(c, cancelPayload()));
  check('CANCEL_HISTORICAL_UNSUPPORTED', /CANCEL_HISTORICAL_UNSUPPORTED/.test(err), err);
  check('teslimat active kaldi', (await deliveryRow(c, 'DEL1')).status === 'active');
  check('bakiye degismedi', (await balance(c)) === 300);
  check('denetim yazilmadi', (await auditCount(c, 'DEL1')) === 0);
}

async function scenarioEmptyConflict(c: Client): Promise<void> {
  console.log('\n[4] Bos kap cakismasi: negatif bakiye reddedilir, rollback');
  await resetTransactional(c);
  await seedDispatch(c);
  await seedDelivery(c, { emptyDiff: 5, emptyBalance: 2 });

  const err = await errorOf(() => callRpc(c, cancelPayload()));
  check('EMPTY_REVERSAL_CONFLICT', /EMPTY_REVERSAL_CONFLICT/.test(err), err);
  check('teslimat active kaldi', (await deliveryRow(c, 'DEL1')).status === 'active');
  check('bakiye degismedi', (await balance(c)) === 300);
  check('bos kap degismedi', (await empty(c)) === 2);
  check('denetim yazilmadi', (await auditCount(c, 'DEL1')) === 0);
}

async function scenarioValidation(c: Client): Promise<void> {
  console.log('\n[5] Yetki ve dogrulama');
  await resetTransactional(c);
  await seedDispatch(c);
  await seedDelivery(c, { emptyDiff: 2, emptyBalance: 2 });

  const adminErr = await errorOf(() =>
    callRpc(c, { ...cancelPayload(), actor_id: 'u_admin' })
  );
  check('yonetici iptal edemez', /NOT_AUTHORIZED/.test(adminErr), adminErr);

  const shortErr = await errorOf(() => callRpc(c, cancelPayload('DEL1', 'ab')));
  check('kisa gerekce reddedilir', /REASON_REQUIRED/.test(shortErr), shortErr);

  const modeErr = await errorOf(() =>
    callRpc(c, { ...cancelPayload(), mode: 'delete' })
  );
  check('gecersiz mode reddedilir', /VALIDATION_ERROR/.test(modeErr), modeErr);

  const mismatch = replacementPayload();
  mismatch.customer_id = 'c_other';
  const mismatchErr = await errorOf(() =>
    callRpc(c, {
      mode: 'replace',
      delivery_id: 'DEL1',
      reason: 'Musteri degistirilemez',
      actor_id: 'u_driver',
      replacement: mismatch,
    })
  );
  check('musteri baglami degistirilemez', /VALIDATION_ERROR/.test(mismatchErr), mismatchErr);
  check('basarisiz denemeler bakiye degistirmedi', (await balance(c)) === 300);
}

async function scenarioPrivileges(c: Client): Promise<void> {
  console.log('\n[6] Yetkiler ve denetim degismezligi');
  await resetTransactional(c);
  await seedDispatch(c);
  await seedDelivery(c, { emptyDiff: 1, emptyBalance: 1 });
  await callRpc(c, cancelPayload());

  const fnOk = async (role: string): Promise<boolean> =>
    (
      await c.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [
        role,
        RPC,
      ])
    ).rows[0].ok === true;
  const tableOk = async (role: string, table: string): Promise<boolean> =>
    (
      await c.query(`SELECT has_table_privilege($1, $2, 'SELECT') AS ok`, [
        role,
        `public.${table}`,
      ])
    ).rows[0].ok === true;

  check('service_role RPC calistirabilir', (await fnOk('service_role')) === true);
  check('anon RPC calistiramaz', (await fnOk('anon')) === false);
  check('authenticated RPC calistiramaz', (await fnOk('authenticated')) === false);
  check('anon denetim okuyamaz', (await tableOk('anon', 'delivery_cancellation_audit')) === false);
  check('authenticated denetim okuyamaz', (await tableOk('authenticated', 'delivery_cancellation_audit')) === false);
  check('service_role denetim okuyabilir', (await tableOk('service_role', 'delivery_cancellation_audit')) === true);

  const anon = await newClient();
  try {
    await anon.query('SET ROLE anon');
    const execErr = await errorOf(() =>
      anon.query('SELECT public.cancel_or_replace_delivery($1::jsonb)', [
        JSON.stringify(cancelPayload()),
      ])
    );
    check('anon calisma zamani EXECUTE reddedildi', /permission denied/i.test(execErr), execErr);
    const selectErr = await errorOf(() =>
      anon.query('SELECT count(*) FROM public.delivery_cancellation_audit')
    );
    check('anon calisma zamani SELECT reddedildi', /permission denied/i.test(selectErr), selectErr);
  } finally {
    try {
      await anon.query('RESET ROLE');
    } catch {
      /* yoksay */
    }
    await anon.end();
  }

  const last = await c.query('SELECT id FROM public.delivery_cancellation_audit ORDER BY id LIMIT 1');
  if (last.rows[0]) {
    const mutErr = await errorOf(() =>
      c.query('UPDATE public.delivery_cancellation_audit SET reason = $1 WHERE id = $2', [
        'degistirildi',
        last.rows[0].id,
      ])
    );
    check('denetim UPDATE reddedildi', /AUDIT_IMMUTABLE/.test(mutErr), mutErr);
    const delErr = await errorOf(() =>
      c.query('DELETE FROM public.delivery_cancellation_audit WHERE id = $1', [
        last.rows[0].id,
      ])
    );
    check('denetim DELETE reddedildi', /AUDIT_IMMUTABLE/.test(delErr), delErr);
  } else {
    check('denetim UPDATE reddedildi', false, 'denetim kaydi yok');
    check('denetim DELETE reddedildi', false, 'denetim kaydi yok');
  }
}

async function scenarioClosedDispatch(c: Client): Promise<void> {
  console.log('\n[7] Kapali sefer: ilk iptal/duzenleme reddedilir, reopen sonrasi iptal');
  await resetTransactional(c);
  await seedDispatch(c);
  await seedDelivery(c, { emptyDiff: 2, emptyBalance: 2 });
  await markDispatchCompleted(c);

  const cancelErr = await errorOf(() => callRpc(c, cancelPayload()));
  check('ilk iptal DISPATCH_CLOSED', /DISPATCH_CLOSED/.test(cancelErr), cancelErr);
  check('kapali sefer iptali teslimati degistirmedi', (await deliveryRow(c, 'DEL1')).status === 'active');
  check('kapali sefer iptali bakiyeyi degistirmedi', (await balance(c)) === 300);
  check('kapali sefer iptali bos kabi degistirmedi', (await empty(c)) === 2);
  check('kapali sefer iptali denetim yazmadi', (await auditCount(c, 'DEL1')) === 0);

  const replacement = replacementPayload();
  replacement.id = 'DEL_CLOSED_REPLACEMENT';
  const replaceErr = await errorOf(() =>
    callRpc(c, {
      mode: 'replace',
      delivery_id: 'DEL1',
      reason: 'Kapali seferde duzenleme',
      actor_id: 'u_driver',
      replacement,
    })
  );
  check('ilk duzenleme DISPATCH_CLOSED', /DISPATCH_CLOSED/.test(replaceErr), replaceErr);
  check('kapali sefer duzenlemesi yeni kayit yazmadi', !(await deliveryRow(c, 'DEL_CLOSED_REPLACEMENT')));
  check('kapali sefer duzenlemesi eski teslimati degistirmedi', (await deliveryRow(c, 'DEL1')).status === 'active');
  check('kapali sefer duzenlemesi bakiyeyi degistirmedi', (await balance(c)) === 300);
  check('kapali sefer duzenlemesi bos kabi degistirmedi', (await empty(c)) === 2);
  check('kapali sefer duzenlemesi denetim yazmadi', (await auditCount(c, 'DEL1')) === 0);

  const reopened = await reopenDispatch(c);
  check('reopen basarili', reopened.reopened === true, JSON.stringify(reopened));
  check('reopen sonrasi durum in_transit', (await c.query(`SELECT status FROM public.dispatches WHERE id = 'D1'`)).rows[0].status === 'in_transit');

  const res = await callRpc(c, cancelPayload());
  check('reopen sonrasi ayni iptal basarili', res.cancelled === true && res.duplicate === false);
  check('reopen sonrasi bakiye 0', (await balance(c)) === 0);
  check('reopen sonrasi bos kap 0', (await empty(c)) === 0);
  check('reopen sonrasi tek denetim', (await auditCount(c, 'DEL1')) === 1);
}

async function scenarioAccountFlagChange(c: Client): Promise<void> {
  console.log('\n[8] Hesap musterisi bayragi degisince orijinal delta geri alinir');
  await resetTransactional(c);
  await seedDispatch(c, 10);
  const applied = await callApply(
    c,
    applyPayload('DEL_ACCOUNT', {
      delivered_grand_total: 1000,
      cash_amount: 700,
      total_collected: 700,
      diff_uncollected: 300,
      items: [
        {
          line_no: 1,
          product_id: 'p_water',
          product_name: 'Damacana Su',
          quantity: 10,
          unit_price: 100,
          line_total: 1000,
        },
      ],
      container_returns: [
        { deposit_type: 'damacana', received_qty: 9, diff_qty: 1 },
      ],
      empty_deltas: { damacana: 1 },
    })
  );
  check('hesap musterisine uygulama basarili', applied.duplicate === false);
  check('bayrak true iken bakiye 300', (await balance(c)) === 300);
  check('bayrak true iken bos kap 1', (await empty(c)) === 1);
  const appliedRow = await deliveryRow(c, 'DEL_ACCOUNT');
  check('uygulanan delta 300 saklandi', Number(appliedRow.applied_balance_delta_tl) === 300);

  await c.query(`UPDATE public.customers SET is_account_customer = false WHERE id = 'c1'`);
  const res = await callRpc(c, cancelPayload('DEL_ACCOUNT'));
  check('bayrak false iken iptal basarili', res.cancelled === true);
  check('orijinal 300 delta geri alindi', (await balance(c)) === 0);
  check('bos kap 0', (await empty(c)) === 0);
  const audit = await auditRow(c, 'DEL_ACCOUNT');
  check('denetim ters delta 300', Number(audit.reversed_balance) === 300);
  check('denetim onceki 300 sonraki 0', Number(audit.previous_balance) === 300 && Number(audit.new_balance) === 0);
}

async function scenarioApplyRegression(c: Client): Promise<void> {
  console.log('\n[9] apply_delivery regresyon: duplicate, negatif bos kap, oversell, kapali sefer');

  await resetTransactional(c);
  await seedDispatch(c, 20);
  const first = await callApply(c, applyPayload('DEL_DUP'));
  check('duplicate ilk uygulama basarili', first.duplicate === false);
  const dup = await callApply(
    c,
    applyPayload('DEL_DUP', {
      delivered_grand_total: 1500,
      cash_amount: 0,
      total_collected: 0,
      diff_uncollected: 1500,
      items: [
        {
          line_no: 1,
          product_id: 'p_water',
          product_name: 'Damacana Su',
          quantity: 15,
          unit_price: 100,
          line_total: 1500,
        },
      ],
      container_returns: [
        { deposit_type: 'damacana', received_qty: 0, diff_qty: 15 },
      ],
      empty_deltas: { damacana: 15 },
    })
  );
  check('duplicate ayni id duplicate doner', dup.duplicate === true);
  check('duplicate tek teslimat', (await deliveryCount(c)) === 1);
  check('duplicate kalem miktari degismedi', (await deliveryItemQty(c, 'DEL_DUP')) === 5);
  check('duplicate bakiye degismedi', (await balance(c)) === 300);
  check('duplicate bos kap degismedi', (await empty(c)) === 1);

  await resetTransactional(c);
  await seedDispatch(c, 20);
  const negErr = await errorOf(() =>
    callApply(
      c,
      applyPayload('DEL_NEG', {
        container_returns: [
          { deposit_type: 'damacana', received_qty: 6, diff_qty: -1 },
        ],
        empty_deltas: { damacana: -1 },
      })
    )
  );
  check('negatif bos kap EMPTY_BALANCE_NEGATIVE', /EMPTY_BALANCE_NEGATIVE/.test(negErr), negErr);
  check('negatif bos kap teslimat yazmadi', (await deliveryCount(c)) === 0);
  check('negatif bos kap kalem yazmadi', (await deliveryItemQty(c, 'DEL_NEG')) === 0);
  check('negatif bos kap bakiye yazmadi', (await balance(c)) === 0);
  check('negatif bos kap bakiye satiri yok', (await empty(c)) === 0);
  check('negatif bos kap denetim yazmadi', (await auditTotal(c)) === 0);

  await resetTransactional(c);
  await seedDispatch(c, 5);
  const overErr = await errorOf(() =>
    callApply(
      c,
      applyPayload('DEL_OVER', {
        delivered_grand_total: 600,
        cash_amount: 600,
        total_collected: 600,
        diff_uncollected: 0,
        items: [
          {
            line_no: 1,
            product_id: 'p_water',
            product_name: 'Damacana Su',
            quantity: 6,
            unit_price: 100,
            line_total: 600,
          },
        ],
        container_returns: [
          { deposit_type: 'damacana', received_qty: 5, diff_qty: 1 },
        ],
        empty_deltas: { damacana: 1 },
      })
    )
  );
  check('oversell INSUFFICIENT_VEHICLE_STOCK', /INSUFFICIENT_VEHICLE_STOCK/.test(overErr), overErr);
  check('oversell teslimat yazmadi', (await deliveryCount(c)) === 0);
  check('oversell bakiye yazmadi', (await balance(c)) === 0);
  check('oversell bos kap yazmadi', (await empty(c)) === 0);

  await resetTransactional(c);
  await seedDispatch(c, 20);
  await markDispatchCompleted(c);
  const closedErr = await errorOf(() => callApply(c, applyPayload('DEL_CLOSED_APPLY')));
  check('kapali sefer apply DISPATCH_CLOSED', /DISPATCH_CLOSED/.test(closedErr), closedErr);
  check('kapali sefer apply teslimat yazmadi', (await deliveryCount(c)) === 0);
  check('kapali sefer apply bakiye yazmadi', (await balance(c)) === 0);
}

async function scenarioConcurrentDispatchLock(c: Client): Promise<void> {
  console.log('\n[10] Eszamanli iptal: sefer kilidi birakilana kadar bekler');
  await resetTransactional(c);
  await seedDispatch(c);
  await seedDelivery(c, { emptyDiff: 2, emptyBalance: 2 });

  const a = await newClient();
  const b = await newClient();
  let aInTransaction = false;
  try {
    await a.query(`SET lock_timeout = '8s'`);
    await b.query(`SET lock_timeout = '8s'`);
    await a.query('BEGIN');
    aInTransaction = true;
    await a.query(`SELECT id FROM public.dispatches WHERE id = 'D1' FOR UPDATE`);

    const pidB = Number(
      (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    );
    let bDone = false;
    let bResolvedAfterRelease = false;
    let released = false;
    const bResult = callRpc(b, cancelPayload())
      .then((value) => {
        bDone = true;
        bResolvedAfterRelease = released;
        return { ok: true as const, value };
      })
      .catch((e) => {
        bDone = true;
        bResolvedAfterRelease = released;
        return { ok: false as const, error: String(e?.message ?? e) };
      });

    const blocked = await waitForLockWaiters(c, [pidB]);
    check('B sefer kilidinde bekledi', blocked);
    check('B A commit etmeden tamamlanmadi', !bDone);

    released = true;
    await a.query('COMMIT');
    aInTransaction = false;
    const result = await bResult;

    check('B hata vermedi', result.ok, result.ok ? '' : result.error);
    check('B A commit ettikten sonra tamamlandi', result.ok && bResolvedAfterRelease);
    check('iptal basarili', result.ok && result.value.cancelled === true);
    check('bakiye 0', (await balance(c)) === 0);
    check('bos kap 0', (await empty(c)) === 0);
    check('teslimat cancelled', (await deliveryRow(c, 'DEL1')).status === 'cancelled');
    check('tek denetim', (await auditCount(c, 'DEL1')) === 1);
  } finally {
    if (aInTransaction) {
      try {
        await a.query('ROLLBACK');
      } catch {
        /* yoksay */
      }
    }
    await a.end();
    await b.end();
  }
}

async function scenarioCancelRacesNewDelivery(c: Client): Promise<void> {
  console.log('\n[11] Iptal vs yeni teslimat yarisi (20 iterasyon, kilit bariyeri)');
  const gate = await newClient();
  const cancelClient = await newClient();
  const applyClient = await newClient();
  const failures: string[] = [];

  try {
    await cancelClient.query(`SET lock_timeout = '8s'`);
    await applyClient.query(`SET lock_timeout = '8s'`);
    await cancelClient.query(`SET statement_timeout = '15s'`);
    await applyClient.query(`SET statement_timeout = '15s'`);

    for (let i = 1; i <= 20; i++) {
      await resetTransactional(c);
      await seedDispatch(c, 20);
      await seedDelivery(c, { emptyDiff: 2, emptyBalance: 2 });

      await gate.query('BEGIN');
      await gate.query(`SELECT id FROM public.dispatches WHERE id = 'D1' FOR UPDATE`);

      const pidCancel = Number(
        (await cancelClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      );
      const pidApply = Number(
        (await applyClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      );
      const racePayload = applyPayload('RACE_NEW', {
        cash_amount: 300,
        total_collected: 300,
        diff_uncollected: 200,
      });

      const cancelTask = callRpc(cancelClient, cancelPayload())
        .then((value) => ({ ok: true as const, value }))
        .catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));
      await sleep(i % 2 === 0 ? 5 : 1);
      const applyTask = callApply(applyClient, racePayload)
        .then((value) => ({ ok: true as const, value }))
        .catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));

      const bothBlocked = await waitForLockWaiters(c, [pidCancel, pidApply]);
      await gate.query('COMMIT');

      const [cancelResult, applyResult] = await Promise.all([cancelTask, applyTask]);
      if (!bothBlocked) failures.push(`iter ${i}: iki islem sefer kilidinde beklemedi`);
      if (!cancelResult.ok) failures.push(`iter ${i}: iptal ${cancelResult.error}`);
      if (!applyResult.ok) failures.push(`iter ${i}: apply ${applyResult.error}`);
      if (cancelResult.ok && cancelResult.value.duplicate !== false) {
        failures.push(`iter ${i}: iptal duplicate`);
      }
      if (applyResult.ok && applyResult.value.duplicate !== false) {
        failures.push(`iter ${i}: apply duplicate`);
      }

      const finalBalance = await balance(c);
      const finalEmpty = await empty(c);
      const cancelled = await deliveryCount(c, 'cancelled');
      const audit = await auditCount(c, 'DEL1');
      const newRow = await deliveryRow(c, 'RACE_NEW');
      if (finalBalance !== 200) failures.push(`iter ${i}: bakiye ${finalBalance}`);
      if (finalEmpty !== 1) failures.push(`iter ${i}: bos kap ${finalEmpty}`);
      if (cancelled !== 1) failures.push(`iter ${i}: cancelled ${cancelled}`);
      if (audit !== 1) failures.push(`iter ${i}: audit ${audit}`);
      if (!newRow || newRow.status !== 'active') failures.push(`iter ${i}: yeni teslimat active degil`);
      if (Number(newRow?.applied_balance_delta_tl) !== 200) {
        failures.push(`iter ${i}: yeni delta ${newRow?.applied_balance_delta_tl}`);
      }
    }
  } finally {
    try {
      await gate.query('ROLLBACK');
    } catch {
      /* yoksay */
    }
    await gate.end();
    await cancelClient.end();
    await applyClient.end();
  }

  check(
    '20/20 yaris: bakiye 200, bos kap 1, tek cancelled, tek audit, deadlock/timeout yok',
    failures.length === 0,
    failures.slice(0, 3).join(' | ')
  );
}

async function scenarioCancelSeparatesPools(c: Client): Promise<void> {
  console.log('\n[12] Iptal: damacana/cam/tup havuzlari ayri geri alinir');
  await resetTransactional(c);
  await seedDispatch(c);
  await seedPoolDelivery(c, {
    id: 'POOL_CANCEL',
    items: [
      { productId: 'p_water', productName: 'Damacana Su', quantity: 2 },
      { productId: 'p_cam', productName: 'Cam Damacana', quantity: 1 },
      { productId: 'p_tup', productName: 'Tüp', quantity: 1 },
    ],
    diffs: { damacana: 2, cam_damacana: 1, tup: 1 },
  });
  await setEmptyBalances(c, { damacana: 7, cam_damacana: 3, tup: 2 });

  const res = await callRpc(c, cancelPayload('POOL_CANCEL'));
  check('uc havuzlu iptal basarili', res.cancelled === true && res.duplicate === false);
  check(
    'iptal sonrasi havuzlar 5/2/1',
    countsMatch(await emptyBalances(c), { damacana: 5, cam_damacana: 2, tup: 1 }),
    JSON.stringify(await emptyBalances(c))
  );
  const audit = await auditRow(c, 'POOL_CANCEL');
  check(
    'denetimde ters havuzlar 2/1/1',
    Number(audit.reversed_empty?.damacana) === 2 &&
      Number(audit.reversed_empty?.cam_damacana) === 1 &&
      Number(audit.reversed_empty?.tup) === 1,
    JSON.stringify(audit.reversed_empty)
  );

  const auditBefore = await auditCount(c, 'POOL_CANCEL');
  const dup = await callRpc(c, cancelPayload('POOL_CANCEL'));
  check('ikinci iptal duplicate', dup.duplicate === true);
  check(
    'duplicate havuzlari degistirmedi',
    countsMatch(await emptyBalances(c), { damacana: 5, cam_damacana: 2, tup: 1 })
  );
  check('duplicate denetim eklemedi', (await auditCount(c, 'POOL_CANCEL')) === auditBefore);
}

async function scenarioCamOnlyWithPlasticReturn(c: Client): Promise<void> {
  console.log('\n[13] Yalniz cam teslimati + plastik bos iadesi');
  await resetTransactional(c);
  await seedDispatch(c);
  await setEmptyBalances(c, { damacana: 5, cam_damacana: 2, tup: 1 });

  const applied = await callApply(
    c,
    poolApplyPayload(
      'POOL_CAM_ONLY',
      [{ productId: 'p_cam', productName: 'Cam Damacana', quantity: 1 }],
      { damacana: -2, cam_damacana: 1, tup: 0 },
      { damacana: 2 }
    )
  );
  check('cam-only teslimat basarili', applied.duplicate === false);
  check(
    'cam-only: plastik 3, cam 3, tup 1',
    countsMatch(await emptyBalances(c), { damacana: 3, cam_damacana: 3, tup: 1 }),
    JSON.stringify(await emptyBalances(c))
  );

  await callRpc(c, cancelPayload('POOL_CAM_ONLY'));
  check(
    'cam-only iptal havuzlari 5/2/1 yapti',
    countsMatch(await emptyBalances(c), { damacana: 5, cam_damacana: 2, tup: 1 })
  );
}

async function scenarioPlasticOnlyWithCamReturn(c: Client): Promise<void> {
  console.log('\n[14] Yalniz plastik teslimati + cam bos iadesi');
  await resetTransactional(c);
  await seedDispatch(c);
  await setEmptyBalances(c, { damacana: 5, cam_damacana: 2, tup: 1 });

  const applied = await callApply(
    c,
    poolApplyPayload(
      'POOL_PLASTIC_ONLY',
      [{ productId: 'p_water', productName: 'Damacana Su', quantity: 1 }],
      { damacana: 1, cam_damacana: -2, tup: 0 },
      { cam_damacana: 2 }
    )
  );
  check('plastik-only teslimat basarili', applied.duplicate === false);
  check(
    'plastik-only: plastik 6, cam 0, tup 1',
    countsMatch(await emptyBalances(c), { damacana: 6, cam_damacana: 0, tup: 1 }),
    JSON.stringify(await emptyBalances(c))
  );

  await callRpc(c, cancelPayload('POOL_PLASTIC_ONLY'));
  check(
    'plastik-only iptal havuzlari 5/2/1 yapti',
    countsMatch(await emptyBalances(c), { damacana: 5, cam_damacana: 2, tup: 1 })
  );
}

async function scenarioMixedThreePools(c: Client): Promise<void> {
  console.log('\n[15] Karma uc havuz: her havuz kendi miktariyla degisir');
  await resetTransactional(c);
  await seedDispatch(c);
  await setEmptyBalances(c, { damacana: 5, cam_damacana: 2, tup: 1 });

  const applied = await callApply(
    c,
    poolApplyPayload(
      'POOL_MIXED',
      [
        { productId: 'p_water', productName: 'Damacana Su', quantity: 2 },
        { productId: 'p_cam', productName: 'Cam Damacana', quantity: 1 },
        { productId: 'p_tup', productName: 'Tüp', quantity: 1 },
      ],
      { damacana: 2, cam_damacana: -1, tup: 1 },
      { cam_damacana: 2 }
    )
  );
  check('karma teslimat basarili', applied.duplicate === false);
  check(
    'karma uygulama: plastik 7, cam 1, tup 2',
    countsMatch(await emptyBalances(c), { damacana: 7, cam_damacana: 1, tup: 2 }),
    JSON.stringify(await emptyBalances(c))
  );

  await callRpc(c, cancelPayload('POOL_MIXED'));
  check(
    'karma iptal havuzlari 5/2/1 yapti',
    countsMatch(await emptyBalances(c), { damacana: 5, cam_damacana: 2, tup: 1 })
  );
}

async function scenarioReplacementSeparatesPools(c: Client): Promise<void> {
  console.log('\n[16] Duzenleme: eski/yeni deltalar havuz bazinda uygulanir');
  await resetTransactional(c);
  await seedDispatch(c);
  await seedPoolDelivery(c, {
    id: 'POOL_OLD',
    items: [
      { productId: 'p_water', productName: 'Damacana Su', quantity: 2 },
      { productId: 'p_cam', productName: 'Cam Damacana', quantity: 2 },
      { productId: 'p_tup', productName: 'Tüp', quantity: 2 },
    ],
    diffs: { damacana: 2, cam_damacana: 1, tup: 1 },
  });
  await setEmptyBalances(c, { damacana: 7, cam_damacana: 3, tup: 2 });

  const replacement = poolApplyPayload(
    'POOL_REPLACEMENT',
    [
      { productId: 'p_water', productName: 'Damacana Su', quantity: 2 },
      { productId: 'p_cam', productName: 'Cam Damacana', quantity: 3 },
      { productId: 'p_tup', productName: 'Tüp', quantity: 1 },
    ],
    { damacana: -1, cam_damacana: 2, tup: 0 },
    { damacana: 3, cam_damacana: 1, tup: 1 }
  );
  const res = await callRpc(c, {
    mode: 'replace',
    delivery_id: 'POOL_OLD',
    reason: 'Havuz bazli duzenleme',
    actor_id: 'u_driver',
    replacement,
  });

  check('uc havuzlu duzenleme basarili', res.cancelled === true && res.duplicate === false);
  check('eski teslimat cancelled', (await deliveryRow(c, 'POOL_OLD')).status === 'cancelled');
  check(
    'yeni teslimat active',
    (await deliveryRow(c, 'POOL_REPLACEMENT'))?.status === 'active'
  );
  check(
    'duzenleme sonrasi havuzlar 4/4/1',
    countsMatch(await emptyBalances(c), { damacana: 4, cam_damacana: 4, tup: 1 }),
    JSON.stringify(await emptyBalances(c))
  );
  const audit = await auditRow(c, 'POOL_OLD');
  check(
    'duzenleme denetiminde ters havuzlar 2/1/1',
    Number(audit.reversed_empty?.damacana) === 2 &&
      Number(audit.reversed_empty?.cam_damacana) === 1 &&
      Number(audit.reversed_empty?.tup) === 1,
    JSON.stringify(audit.reversed_empty)
  );

  await callRpc(c, cancelPayload('POOL_REPLACEMENT'));
  check(
    'yeni teslimat iptali havuzlari 5/2/1 yapti',
    countsMatch(await emptyBalances(c), { damacana: 5, cam_damacana: 2, tup: 1 })
  );
}

async function scenarioPoolFailureIsolation(c: Client): Promise<void> {
  console.log('\n[17] Hata izolasyonu: bir havuz hatasi digerlerini degistirmez');
  await resetTransactional(c);
  await seedDispatch(c);
  await seedPoolDelivery(c, {
    id: 'POOL_CONFLICT',
    items: [{ productId: 'p_cam', productName: 'Cam Damacana', quantity: 2 }],
    diffs: { cam_damacana: 2 },
  });
  await setEmptyBalances(c, { damacana: 5, cam_damacana: 0, tup: 1 });

  const cancelErr = await errorOf(() => callRpc(c, cancelPayload('POOL_CONFLICT')));
  check(
    'cam ters kaydi EMPTY_REVERSAL_CONFLICT',
    /EMPTY_REVERSAL_CONFLICT:cam_damacana/.test(cancelErr),
    cancelErr
  );
  check(
    'iptal hatasi plastik/tup havuzlarini degistirmedi',
    countsMatch(await emptyBalances(c), { damacana: 5, cam_damacana: 0, tup: 1 }),
    JSON.stringify(await emptyBalances(c))
  );
  check('iptal hatasi teslimati active birakti', (await deliveryRow(c, 'POOL_CONFLICT')).status === 'active');
  check('iptal hatasi denetim yazmadi', (await auditCount(c, 'POOL_CONFLICT')) === 0);

  await resetTransactional(c);
  await seedDispatch(c);
  await setEmptyBalances(c, { damacana: 0, cam_damacana: 3, tup: 1 });
  const applyErr = await errorOf(() =>
    callApply(
      c,
      poolApplyPayload(
        'POOL_NEG',
        [{ productId: 'p_cam', productName: 'Cam Damacana', quantity: 1 }],
        { damacana: -2, cam_damacana: 1, tup: 0 },
        { damacana: 2 }
      )
    )
  );
  check(
    'negatif plastik EMPTY_BALANCE_NEGATIVE',
    /EMPTY_BALANCE_NEGATIVE:damacana/.test(applyErr),
    applyErr
  );
  check(
    'apply hatasi cam/tup havuzlarini degistirmedi',
    countsMatch(await emptyBalances(c), { damacana: 0, cam_damacana: 3, tup: 1 }),
    JSON.stringify(await emptyBalances(c))
  );
  check('apply hatasi teslimat yazmadi', (await deliveryCount(c)) === 0);
  check('apply hatasi denetim yazmadi', (await auditTotal(c)) === 0);
}

async function main(): Promise<void> {
  const c = await newClient();
  try {
    await applySchemaAndMigrations(c);
    if (APPLY_ONLY) {
      console.log('\nSema + migrations uygulandi (--apply-only).');
      return;
    }
    await seedReference(c);
    await scenarioCancel(c);
    await scenarioReplace(c);
    await scenarioHistorical(c);
    await scenarioEmptyConflict(c);
    await scenarioValidation(c);
    await scenarioPrivileges(c);
    await scenarioClosedDispatch(c);
    await scenarioAccountFlagChange(c);
    await scenarioApplyRegression(c);
    await scenarioConcurrentDispatchLock(c);
    await scenarioCancelRacesNewDelivery(c);
    await scenarioCancelSeparatesPools(c);
    await scenarioCamOnlyWithPlasticReturn(c);
    await scenarioPlasticOnlyWithCamReturn(c);
    await scenarioMixedThreePools(c);
    await scenarioReplacementSeparatesPools(c);
    await scenarioPoolFailureIsolation(c);
  } finally {
    await c.end();
  }

  console.log(`\nSONUC: ${passed} gecti, ${failed} basarisiz`);
  if (failed > 0) {
    const detail = failureDetails.join(' | ').slice(0, 60000);
    console.log(`::error title=PG_TEST_FAIL::${detail}`);
    process.exit(1);
  }
}

main().catch((e) => {
  const detail = String(e?.stack ?? e).slice(0, 60000);
  console.log(`::error title=PG_TEST_ERROR::${detail}`);
  console.error('BEKLENMEYEN HATA:', e);
  process.exit(1);
});
