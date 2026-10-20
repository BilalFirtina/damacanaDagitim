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

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
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
    VALUES ('p_water', 'Damacana Su', 'pet', 100, true, 'damacana', 'Adet')
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
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
  await c.query('UPDATE public.customers SET current_balance_tl = 0');
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
     VALUES ('D1', 'p_water', $1)`,
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
  } finally {
    await c.end();
  }

  console.log(`\nSONUC: ${passed} gecti, ${failed} basarisiz`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('BEKLENMEYEN HATA:', e);
  process.exit(1);
});
