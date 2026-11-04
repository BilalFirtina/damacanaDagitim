/**
 * scripts/ci/retention-pg-test.ts
 *
 * Gercek bir PostgreSQL uzerinde retention (saklama/temizleme) semantigini
 * dogrular. Mock degildir: Supabase stub'i + supabase_schema.sql + migrations
 * uygulanir, ardindan public.purge_retention gercekten cagrilir.
 *
 * Kullanim:
 *   DATABASE_URL=postgres://... npx tsx scripts/ci/retention-pg-test.ts
 *   DATABASE_URL=postgres://... npx tsx scripts/ci/retention-pg-test.ts --apply-only
 *
 * Kontrol edilenler (AGENTS.md 15 ve retention tasarimi):
 *   1. Dry-run hicbir satiri silmez, arsiv kullanmaz.
 *   2. Gercek calisma: dogrudan silme sirasi (deliveries -> dispatches),
 *      FK ihlali olmadan, dogru satirlar silinir.
 *   3. Uygun seferin esikten YENI teslimati da silinir; sinirdaki (esik gunu)
 *      ve -59 gun seferleri korunur; eski acik (in_transit) sefer de silinir.
 *   4. Enjekte edilen hata TUM islemi geri alir.
 *   5. Eszamanli calisma advisory lock ile RETENTION_LOCKED dondurur.
 *   6. Esikten eski tahsilat/denetim kayitlari silinir; esik icindeki kalir.
 *   7. Musteri kaydi, nihai bakiye/emanet, son fiyat ve sebil detaylari korunur.
 *   8. anon/authenticated purge_retention'u calistiramaz, retention tablolarini
 *      okuyamaz; service_role calistirabilir.
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

const RETENTION_DAYS = 60;
const LOCK_KEY = 620260102;
const PURGE_FN = 'public.purge_retention(boolean,text[],text[],integer)';

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

async function count(c: Client, table: string): Promise<number> {
  const r = await c.query(`SELECT count(*)::int AS n FROM public.${table}`);
  return Number(r.rows[0].n);
}

async function applySchemaAndMigrations(c: Client): Promise<void> {
  console.log('  -- sema hazirlaniyor (stub + temel sema + migrations)');
  await c.query('DROP SCHEMA IF EXISTS public CASCADE');
  await c.query('CREATE SCHEMA public');
  await c.query('DROP SCHEMA IF EXISTS auth CASCADE');

  await c.query(readRel('scripts/ci/supabase_stub.sql'));
  console.log('     stub uygulandi');

  await c.query(readRel('supabase_schema.sql'));
  console.log('     supabase_schema.sql uygulandi');

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
      ('u_driver', 'Şoför', 'ci_driver', 'driver', true, '1111'),
      ('u_driver_2', 'Şoför 2', 'ci_driver_2', 'driver', true, '2222'),
      ('u_driver_3', 'Şoför 3', 'ci_driver_3', 'driver', true, '3333')
    ON CONFLICT (id) DO NOTHING;
  `);
  await c.query(`
    INSERT INTO public.products (id, name, category, default_unit_price, is_deposit, deposit_type, unit)
    VALUES ('p_water', 'Damacana Su', 'pet', 100, false, 'none', 'Adet')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  `);
  await c.query(`
    INSERT INTO public.customers (id, name, current_balance_tl, is_account_customer)
    VALUES ('c1', 'Test Müşteri', 1234.56, true)
    ON CONFLICT (id) DO UPDATE SET current_balance_tl = 1234.56;
  `);
  await c.query(`
    INSERT INTO public.customer_empty_balances (customer_id, deposit_type, quantity) VALUES
      ('c1', 'damacana', 7),
      ('c1', 'tup', 2)
    ON CONFLICT (customer_id, deposit_type) DO UPDATE SET quantity = EXCLUDED.quantity;
  `);
  // 60 günden sonra korunması gereken müşteri ticari bilgileri.
  await c.query(`
    INSERT INTO public.customer_product_prices (customer_id, product_id, unit_price)
    VALUES ('c1', 'p_water', 95)
    ON CONFLICT (customer_id, product_id) DO UPDATE SET unit_price = 95;
  `);
  await c.query(`
    INSERT INTO public.customer_dispensers
      (id, customer_id, brand, model, quantity, note, updated_by_user_id, updated_by_user_name)
    VALUES ('DISP1', 'c1', 'Marka X', 'Model Y', 1, 'Mutfakta', 'u_admin', 'Yönetici')
    ON CONFLICT (id) DO UPDATE SET note = EXCLUDED.note;
  `);
}

async function resetTransactional(c: Client): Promise<void> {
  // customer_payments denetim izi trigger'ı TRUNCATE'i engeller; yalnızca test
  // kurulumu sırasında geçici olarak devre dışı bırakılır.
  await c.query(
    'ALTER TABLE public.customer_payments DISABLE TRIGGER trg_customer_payments_no_truncate'
  );
  try {
    await c.query(`
      TRUNCATE
        public.delivery_container_returns,
        public.delivery_items,
        public.deliveries,
        public.dispatch_reconciliation_items,
        public.dispatch_items,
        public.dispatches,
        public.retention_archive,
        public.customer_payments
      RESTART IDENTITY CASCADE;
    `);
  } finally {
    await c.query(
      'ALTER TABLE public.customer_payments ENABLE TRIGGER trg_customer_payments_no_truncate'
    );
  }
}

async function seedScenario(c: Client): Promise<void> {
  await c.query(`
    INSERT INTO public.dispatches
      (id, date, driver_id, driver_name, vehicle_plate, loaded_by_user_id, loaded_by_user_name, status, closed_at, closed_by_user_id, closed_by_user_name)
    VALUES
      ('D61', to_char((now() AT TIME ZONE 'UTC')::date - 61, 'YYYY-MM-DD'), 'u_driver', 'Şoför', '34 CI 061', 'u_admin', 'Yönetici', 'completed', now() - interval '61 day', 'u_admin', 'Yönetici'),
      ('D60', to_char((now() AT TIME ZONE 'UTC')::date - 60, 'YYYY-MM-DD'), 'u_driver', 'Şoför', '34 CI 060', 'u_admin', 'Yönetici', 'completed', now() - interval '60 day', 'u_admin', 'Yönetici'),
      ('D59', to_char((now() AT TIME ZONE 'UTC')::date - 59, 'YYYY-MM-DD'), 'u_driver', 'Şoför', '34 CI 059', 'u_admin', 'Yönetici', 'completed', now() - interval '59 day', 'u_admin', 'Yönetici'),
      ('DOPEN', to_char((now() AT TIME ZONE 'UTC')::date - 100, 'YYYY-MM-DD'), 'u_driver_2', 'Şoför 2', '34 CI 100', 'u_admin', 'Yönetici', 'in_transit', NULL, NULL, NULL),
      ('DPENDING', to_char((now() AT TIME ZONE 'UTC')::date - 100, 'YYYY-MM-DD'), 'u_driver_3', 'Şoför 3', '34 CI 101', 'u_admin', 'Yönetici', 'pending_confirmation', NULL, NULL, NULL);
  `);
  await c.query(`
    INSERT INTO public.dispatch_items (dispatch_id, product_id, quantity)
    VALUES ('D61', 'p_water', 10);
  `);
  await c.query(`
    INSERT INTO public.dispatch_reconciliation_items (dispatch_id, product_id, expected_qty, counted_qty)
    VALUES ('D61', 'p_water', 10, 8);
  `);
  await c.query(`
    INSERT INTO public.deliveries
      (id, dispatch_id, driver_id, driver_name, vehicle_plate, customer_id, customer_name,
       timestamp, delivered_grand_total, payment_method, cash_amount, total_collected, payment_status)
    VALUES
      ('DEL61OLD', 'D61', 'u_driver', 'Şoför', '34 CI 061', 'c1', 'Test Müşteri', now() - interval '61 day', 100, 'CASH', 100, 100, 'paid'),
      ('DEL61NEW', 'D61', 'u_driver', 'Şoför', '34 CI 061', 'c1', 'Test Müşteri', now(), 100, 'CASH', 100, 100, 'paid'),
      ('DEL60', 'D60', 'u_driver', 'Şoför', '34 CI 060', 'c1', 'Test Müşteri', now() - interval '60 day', 100, 'CASH', 100, 100, 'paid'),
      ('DEL59', 'D59', 'u_driver', 'Şoför', '34 CI 059', 'c1', 'Test Müşteri', now() - interval '59 day', 100, 'CASH', 100, 100, 'paid'),
      ('DELOPEN', 'DOPEN', 'u_driver_2', 'Şoför 2', '34 CI 100', 'c1', 'Test Müşteri', now(), 100, 'CASH', 100, 100, 'paid');
  `);
  await c.query(`
    INSERT INTO public.delivery_items (delivery_id, line_no, product_id, product_name, quantity, unit_price, line_total)
    VALUES ('DEL61OLD', 1, 'p_water', 'Damacana Su', 2, 100, 200);
  `);
  await c.query(`
    INSERT INTO public.delivery_container_returns (delivery_id, deposit_type, received_qty, diff_qty)
    VALUES ('DEL61OLD', 'damacana', 2, 0);
  `);
  // Eşikten eski tahsilat silinir; eşik içindeki tahsilat korunur.
  await c.query(`
    INSERT INTO public.customer_payments
      (id, customer_id, amount, method, note, collected_by_user_id,
       collected_by_user_name, dispatch_id, collected_at)
    VALUES
      ('PAY61', 'c1', 250, 'CASH', 'CI eski tahsilat', 'u_admin', 'Yönetici', 'D61', now() - interval '61 day'),
      ('PAY59', 'c1', 40, 'CASH', 'CI yeni tahsilat', 'u_admin', 'Yönetici', 'D59', now() - interval '59 day');
  `);
}

async function eligibleDispatchIds(c: Client): Promise<string[]> {
  const r = await c.query(`
    SELECT COALESCE(array_agg(id), ARRAY[]::text[]) AS ids
    FROM public.dispatches
    WHERE date < to_char((now() AT TIME ZONE 'UTC')::date - ${RETENTION_DAYS}, 'YYYY-MM-DD');
  `);
  return r.rows[0].ids;
}

async function purge(c: Client, dry: boolean, dispatchIds: string[]): Promise<any> {
  const r = await c.query(
    `SELECT public.purge_retention($1::boolean, $2::text[], $3::text[], $4::integer) AS r`,
    [dry, dispatchIds, [], RETENTION_DAYS]
  );
  return r.rows[0].r;
}

async function dispatchIds(c: Client): Promise<string[]> {
  const r = await c.query('SELECT id FROM public.dispatches ORDER BY id');
  return r.rows.map((x: any) => x.id);
}

async function deliveryIds(c: Client): Promise<string[]> {
  const r = await c.query('SELECT id FROM public.deliveries ORDER BY id');
  return r.rows.map((x: any) => x.id);
}

async function balancesSnapshot(c: Client): Promise<string> {
  const cust = await c.query(
    'SELECT id, current_balance_tl::text AS bal FROM public.customers ORDER BY id'
  );
  const emp = await c.query(
    'SELECT customer_id, deposit_type, quantity FROM public.customer_empty_balances ORDER BY customer_id, deposit_type'
  );
  return JSON.stringify({ cust: cust.rows, emp: emp.rows });
}

async function installOrderTriggers(c: Client): Promise<void> {
  await c.query('CREATE TEMP TABLE ci_del_log (seq serial, tbl text)');
  await c.query(`
    CREATE OR REPLACE FUNCTION ci_log_del() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO ci_del_log(tbl) VALUES (TG_TABLE_NAME);
      RETURN OLD;
    END $$;
  `);
  await c.query(
    'CREATE TRIGGER ci_log_del_trg BEFORE DELETE ON public.deliveries FOR EACH ROW EXECUTE FUNCTION ci_log_del()'
  );
  await c.query(
    'CREATE TRIGGER ci_log_disp_trg BEFORE DELETE ON public.dispatches FOR EACH ROW EXECUTE FUNCTION ci_log_del()'
  );
}

async function dropOrderTriggers(c: Client): Promise<void> {
  await c.query('DROP TRIGGER IF EXISTS ci_log_del_trg ON public.deliveries');
  await c.query('DROP TRIGGER IF EXISTS ci_log_disp_trg ON public.dispatches');
  await c.query('DROP FUNCTION IF EXISTS ci_log_del()');
  await c.query('DROP TABLE IF EXISTS ci_del_log');
}

async function scenarioDryRun(c: Client): Promise<void> {
  console.log('\n[1] Dry-run: hicbir seyi silmez, arsive yazmaz');
  await resetTransactional(c);
  await seedScenario(c);
  const before = {
    d: await count(c, 'dispatches'),
    del: await count(c, 'deliveries'),
    bal: await balancesSnapshot(c),
  };
  const res = await purge(c, true, await eligibleDispatchIds(c));
  check('dry-run archived_rows = 0', Number(res.archived_rows) === 0);
  check('dry-run purged_dispatches = 0', Number(res.purged_dispatches) === 0);
  check('dry-run purged_deliveries = 0', Number(res.purged_deliveries) === 0);
  check('dry-run sefer sayisi degismedi', (await count(c, 'dispatches')) === before.d);
  check('dry-run teslimat sayisi degismedi', (await count(c, 'deliveries')) === before.del);
  check('dry-run arsiv bos kaldi', (await count(c, 'retention_archive')) === 0);
  check('dry-run bakiye degismedi', (await balancesSnapshot(c)) === before.bal);
}

async function scenarioRealRun(c: Client): Promise<void> {
  console.log('\n[2] Gercek calisma: hareketleri sil, musteri ticari verisini koru');
  await resetTransactional(c);
  await seedScenario(c);
  await c.query(`
    INSERT INTO public.retention_archive
      (run_id, archived_at, purge_date, retention_days, table_name, row_count)
    VALUES ('OLD_ARCH', now() - interval '61 day',
            ((now() AT TIME ZONE 'UTC')::date - 61), 60, 'dispatches', 1)
  `);
  await installOrderTriggers(c);
  const before = await balancesSnapshot(c);
  const res = await purge(c, false, await eligibleDispatchIds(c));

  const dIds = await dispatchIds(c);
  check('uygun sefer (D61) silindi', !dIds.includes('D61'));
  check('sinirdaki sefer (D60) korundu', dIds.includes('D60'));
  check('D59 seferi korundu', dIds.includes('D59'));
  check('acik sefer (DOPEN) da silindi', !dIds.includes('DOPEN'));
  check('askida sefer (DPENDING) da silindi', !dIds.includes('DPENDING'));

  const dli = await deliveryIds(c);
  check('esikten eski teslimat silindi', !dli.includes('DEL61OLD'));
  check('esikten YENI ama uygun sefere ait teslimat da silindi', !dli.includes('DEL61NEW'));
  check('sinirdaki teslimat korundu', dli.includes('DEL60'));
  check('acik seferin teslimati da silindi', !dli.includes('DELOPEN'));

  check(
    'rapor edilen silme sayilari (3 sefer, 3 teslimat)',
    Number(res.purged_dispatches) === 3 && Number(res.purged_deliveries) === 3,
    JSON.stringify({ d: res.purged_dispatches, del: res.purged_deliveries })
  );

  check(
    'arsiv kullanilmadi (0 satir)',
    (await count(c, 'retention_archive')) === 0
  );
  check('musteri bakiye/boş kap degismedi', (await balancesSnapshot(c)) === before);

  const oldPayment = await c.query(
    `SELECT id FROM public.customer_payments WHERE id = 'PAY61'`
  );
  check('esikten eski tahsilat silindi', oldPayment.rowCount === 0);
  const recentPayment = await c.query(
    `SELECT amount FROM public.customer_payments WHERE id = 'PAY59'`
  );
  check('esik icindeki tahsilat korundu', recentPayment.rowCount === 1);
  check(
    'eski tahsilat sayisi raporlandi',
    Number(res.purged_customer_payments) === 1 &&
      Number(res.purged_retention_archive) === 1,
    JSON.stringify({
      pay: res.purged_customer_payments,
      arch: res.purged_retention_archive,
    })
  );

  const price = await c.query(
    `SELECT unit_price FROM public.customer_product_prices WHERE customer_id = 'c1' AND product_id = 'p_water'`
  );
  check('son satis fiyati korundu', price.rowCount === 1 && Number(price.rows[0]?.unit_price) === 95);
  const dispenser = await c.query(
    `SELECT brand, model, quantity, note FROM public.customer_dispensers WHERE id = 'DISP1'`
  );
  check(
    'sebil marka/model/aciklama korundu',
    dispenser.rowCount === 1 &&
      dispenser.rows[0]?.brand === 'Marka X' &&
      dispenser.rows[0]?.model === 'Model Y' &&
      Number(dispenser.rows[0]?.quantity) === 1 &&
      dispenser.rows[0]?.note === 'Mutfakta'
  );

  const seqs = (await c.query('SELECT tbl FROM ci_del_log ORDER BY seq')).rows.map((x: any) => x.tbl);
  const lastDel = seqs.lastIndexOf('deliveries');
  const firstDisp = seqs.indexOf('dispatches');
  check(
    'silme sirasi: teslimatlar seferlerden ONCE',
    seqs.includes('deliveries') && seqs.includes('dispatches') && lastDel < firstDisp,
    JSON.stringify(seqs)
  );
  await dropOrderTriggers(c);
}

async function scenarioInjectedFailure(c: Client): Promise<void> {
  console.log('\n[3] Enjekte edilen hata: tum islem geri alinir');
  await resetTransactional(c);
  await seedScenario(c);
  const dBefore = await count(c, 'dispatches');
  const delBefore = await count(c, 'deliveries');
  await c.query(`
    CREATE OR REPLACE FUNCTION ci_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'CI_INJECTED_FAILURE'; END $$;
  `);
  await c.query(
    'CREATE TRIGGER ci_fail_trg BEFORE DELETE ON public.dispatches FOR EACH ROW EXECUTE FUNCTION ci_fail()'
  );
  let err = '';
  try {
    await purge(c, false, await eligibleDispatchIds(c));
  } catch (e: any) {
    err = String(e?.message ?? e);
  }
  await c.query('DROP TRIGGER IF EXISTS ci_fail_trg ON public.dispatches');
  await c.query('DROP FUNCTION IF EXISTS ci_fail()');
  check('hata yuzeye cikti', /CI_INJECTED_FAILURE/.test(err), err);
  check('seferler geri alindi', (await count(c, 'dispatches')) === dBefore);
  check('teslimatlar geri alindi', (await count(c, 'deliveries')) === delBefore);
  check('arsiv satirlari da geri alindi', (await count(c, 'retention_archive')) === 0);
}

async function scenarioLock(c: Client): Promise<void> {
  console.log('\n[4] Eszamanli calisma: advisory lock');
  await resetTransactional(c);
  await seedScenario(c);
  const holder = await newClient();
  try {
    await holder.query('BEGIN');
    const got = (await holder.query('SELECT pg_try_advisory_xact_lock($1) AS got', [LOCK_KEY])).rows[0].got;
    check('kilidi tutan oturum kilidi aldi', got === true);
    let err = '';
    try {
      await purge(c, false, await eligibleDispatchIds(c));
    } catch (e: any) {
      err = String(e?.message ?? e);
    }
    check('eszamanli purge RETENTION_LOCKED ile reddedildi', /RETENTION_LOCKED/.test(err), err);
    check('kilitliyken arsiv bos', (await count(c, 'retention_archive')) === 0);
    await holder.query('ROLLBACK');
    const after = await purge(c, false, await eligibleDispatchIds(c));
    check('kilit birakilinca purge basarili', Number(after.purged_dispatches) === 3);
  } finally {
    await holder.end();
  }
}

async function scenarioBoundary(c: Client): Promise<void> {
  console.log('\n[5] Esik siniri: -61 silinir, -60 ve -59 korunur');
  await resetTransactional(c);
  await seedScenario(c);
  const res = await purge(c, false, ['D61', 'D60', 'D59']);
  const dIds = await dispatchIds(c);
  check('sinir: -61 silindi', !dIds.includes('D61'));
  check('sinir: -60 korundu', dIds.includes('D60'));
  check('sinir: -59 korundu', dIds.includes('D59'));
  check('sinir: yalnizca 1 sefer silindi', Number(res.purged_dispatches) === 1);
}

async function scenarioAudit(c: Client): Promise<void> {
  console.log('\n[6] Denetim (audit) kayitlari: eski silinir, yeni korunur');
  await resetTransactional(c);
  await seedScenario(c);
  const before = await balancesSnapshot(c);
  await c.query(`
    INSERT INTO public.dispatch_reopen_audit
      (dispatch_id, reopened_by_user_id, reopened_by_user_name, reason, reopened_at)
    VALUES
      ('D61', 'u_admin', 'Yönetici', 'OLD_REOPEN', now() - interval '61 day'),
      ('D59', 'u_admin', 'Yönetici', 'NEW_REOPEN', now() - interval '1 day');
  `);
  await c.query(`
    INSERT INTO public.dispatch_loading_audit
      (dispatch_id, changed_by_user_id, changed_by_user_name, previous_items, new_items, changed_at)
    VALUES
      ('D61', 'u_admin', 'Yönetici', '[]'::jsonb, '[]'::jsonb, now() - interval '61 day'),
      ('D59', 'u_admin', 'Yönetici', '[]'::jsonb, '[]'::jsonb, now() - interval '1 day');
  `);
  await c.query(`
    INSERT INTO public.customer_financial_audit
      (customer_id, changed_by_user_id, changed_by_user_name, reason, changed_at)
    VALUES
      ('c1', 'u_admin', 'Yönetici', 'OLD_FIN', now() - interval '61 day'),
      ('c1', 'u_admin', 'Yönetici', 'NEW_FIN', now() - interval '1 day');
  `);
  await c.query(`
    INSERT INTO public.deliveries
      (id, dispatch_id, driver_id, driver_name, vehicle_plate, customer_id, customer_name,
       timestamp, delivered_grand_total, payment_method, cash_amount, total_collected,
       payment_status, status, cancelled_at, cancelled_by_user_id, cancelled_by_user_name,
       cancel_reason, applied_balance_delta_tl)
    VALUES
      ('DEL61CANC', 'D61', 'u_driver', 'Şoför', '34 CI 061', 'c1', 'Test Müşteri',
       now() - interval '61 day', 100, 'CASH', 100, 100,
       'paid', 'cancelled', now() - interval '60 day', 'u_driver', 'Şoför',
       'CI iptal testi', 0);
  `);
  await c.query(`
    INSERT INTO public.delivery_cancellation_audit
      (delivery_id, dispatch_id, customer_id, action, performed_by_user_id,
       performed_by_user_name, reason, reversed_balance, created_at)
    VALUES
      ('DEL61CANC', 'D61', 'c1', 'cancel', 'u_driver', 'Şoför', 'OLD_CANCEL', 0, now() - interval '61 day'),
      ('DEL59', 'D59', 'c1', 'cancel', 'u_driver', 'Şoför', 'NEW_CANCEL', 0, now() - interval '1 day');
  `);

  const res = await purge(c, false, await eligibleDispatchIds(c));

  const oldAuditCount = async (table: string, column: string): Promise<number> => {
    const r = await c.query(
      `SELECT count(*)::int AS n FROM public.${table} WHERE ${column} < now() - interval '60 day'`
    );
    return Number(r.rows[0].n);
  };
  check('eski dispatch_reopen_audit silindi', (await oldAuditCount('dispatch_reopen_audit', 'reopened_at')) === 0);
  check('yeni dispatch_reopen_audit korundu', (await count(c, 'dispatch_reopen_audit')) >= 1);
  check('eski dispatch_loading_audit silindi', (await oldAuditCount('dispatch_loading_audit', 'changed_at')) === 0);
  check('yeni dispatch_loading_audit korundu', (await count(c, 'dispatch_loading_audit')) >= 1);
  check('eski customer_financial_audit silindi', (await oldAuditCount('customer_financial_audit', 'changed_at')) === 0);
  check('yeni customer_financial_audit korundu', (await count(c, 'customer_financial_audit')) >= 1);
  check('eski delivery_cancellation_audit silindi', (await oldAuditCount('delivery_cancellation_audit', 'created_at')) === 0);
  check('yeni delivery_cancellation_audit korundu', (await count(c, 'delivery_cancellation_audit')) >= 1);
  check(
    'silme sayilari raporlandi',
    Number(res.purged_dispatch_reopen_audit) === 1 &&
      Number(res.purged_dispatch_loading_audit) === 1 &&
      Number(res.purged_customer_financial_audit) === 1 &&
      Number(res.purged_delivery_cancellation_audit) === 1,
    JSON.stringify(res)
  );
  check(
    'iptal edilen teslimat temizlendi',
    (await deliveryIds(c)).every((id) => id !== 'DEL61CANC')
  );
  check('musteri bakiye/boş kap degismedi', (await balancesSnapshot(c)) === before);
}

async function scenarioPrivileges(c: Client): Promise<void> {
  console.log('\n[7] Yetkiler: purge/service_role-only, retention tablolari gizli');
  const fnOk = async (role: string): Promise<boolean> =>
    (await c.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, PURGE_FN])).rows[0].ok === true;
  const tblOk = async (role: string, table: string): Promise<boolean> =>
    (await c.query(`SELECT has_table_privilege($1, $2, 'SELECT') AS ok`, [role, `public.${table}`])).rows[0].ok === true;

  check('service_role purge_retention calistirabilir', (await fnOk('service_role')) === true);
  check('anon purge_retention calistiramaz', (await fnOk('anon')) === false);
  check('authenticated purge_retention calistiramaz', (await fnOk('authenticated')) === false);
  check('anon retention_archive okuyamaz', (await tblOk('anon', 'retention_archive')) === false);
  check('anon retention_state okuyamaz', (await tblOk('anon', 'retention_state')) === false);
  check('authenticated retention_archive okuyamaz', (await tblOk('authenticated', 'retention_archive')) === false);
  check('service_role retention_archive okuyabilir', (await tblOk('service_role', 'retention_archive')) === true);

  const anon = await newClient();
  try {
    await anon.query('SET ROLE anon');
    let e1 = '';
    try {
      await anon.query('SELECT public.purge_retention(false, $1::text[], $2::text[], $3::integer)', [[], [], RETENTION_DAYS]);
    } catch (e: any) {
      e1 = String(e?.message ?? e);
    }
    check('anon calisma zamani EXECUTE reddedildi', /permission denied/i.test(e1), e1);
    let e2 = '';
    try {
      await anon.query('SELECT count(*) FROM public.retention_archive');
    } catch (e: any) {
      e2 = String(e?.message ?? e);
    }
    check('anon calisma zamani SELECT reddedildi', /permission denied/i.test(e2), e2);
  } finally {
    try {
      await anon.query('RESET ROLE');
    } catch {
      /* yoksay */
    }
    await anon.end();
  }
}

// Tek aktif sefer garantisi: aynı şoför veya aynı plaka için ikinci aktif
// sefer DB seviyesinde reddedilmelidir. Tamamlanmış seferler indekse girmez.
async function scenarioActiveDispatchUniqueness(c: Client): Promise<void> {
  console.log('\n[7] Tek aktif sefer garantisi (unique index)');
  await resetTransactional(c);
  await seedReference(c);

  const insertDispatch = (id: string, driverId: string, plate: string, status: string) =>
    c.query(
      `INSERT INTO public.dispatches
         (id, date, driver_id, driver_name, vehicle_plate, loaded_by_user_id, loaded_by_user_name,
          status, closed_at, closed_by_user_id, closed_by_user_name)
       VALUES ($1, to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'), $2, 'Şoför', $3,
               'u_admin', 'Yönetici', $4,
               CASE WHEN $4 = 'completed' THEN now() ELSE NULL END,
               CASE WHEN $4 = 'completed' THEN 'u_admin' ELSE NULL END,
               CASE WHEN $4 = 'completed' THEN 'Yönetici' ELSE NULL END)`,
      [id, driverId, plate, status]
    );

  const violation = async (fn: () => Promise<any>): Promise<string> => {
    try {
      await fn();
      return 'NO_ERROR';
    } catch (e: any) {
      return `${e?.code || ''}:${e?.constraint || ''}`;
    }
  };

  await insertDispatch('U1', 'u_driver', '34 U 001', 'in_transit');
  check(
    'aynı şoför için ikinci aktif sefer reddedildi',
    (await violation(() => insertDispatch('U2', 'u_driver', '34 U 002', 'pending_confirmation'))) ===
      '23505:ux_dispatches_active_driver'
  );
  check(
    'aynı plaka için ikinci aktif sefer reddedildi',
    (await violation(() => insertDispatch('U3', 'u_driver_2', '34 U 001', 'in_transit'))) ===
      '23505:ux_dispatches_active_plate'
  );

  await insertDispatch('U4', 'u_driver_2', '34 U 003', 'completed');
  check(
    'tamamlanmış sefer indekse girmez; aynı şoför yeni aktif sefer açabilir',
    (await violation(() => insertDispatch('U5', 'u_driver_2', '34 U 004', 'in_transit'))) ===
      'NO_ERROR'
  );

  await resetTransactional(c);
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
    await scenarioDryRun(c);
    await scenarioRealRun(c);
    await scenarioInjectedFailure(c);
    await scenarioLock(c);
    await scenarioBoundary(c);
    await scenarioAudit(c);
    await scenarioActiveDispatchUniqueness(c);
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
