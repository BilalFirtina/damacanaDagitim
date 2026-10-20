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
 *   1. Dry-run hicbir satiri silmez, arsive YAZMAZ.
 *   2. Gercek calisma: arsiv-once silme sirasi (deliveries -> dispatches),
 *      FK ihlali olmadan, dogru satirlar silinir.
 *   3. Uygun seferin esikten YENI teslimati da silinir; sinirdaki (esik gunu)
 *      ve -59 gun seferleri korunur; acik (in_transit) sefer korunur.
 *   4. Enjekte edilen hata TUM islemi (arsiv satirlari dahil) geri alir.
 *   5. Eszamanli calisma advisory lock ile RETENTION_LOCKED dondurur.
 *   6. Denetim (audit) tablolari temizlikten etkilenmez.
 *   7. anon/authenticated purge_retention'u calistiramaz, retention tablolarini
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
      ('u_driver', 'Şoför', 'ci_driver', 'driver', true, '1111')
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
}

async function resetTransactional(c: Client): Promise<void> {
  await c.query(`
    TRUNCATE
      public.delivery_container_returns,
      public.delivery_items,
      public.deliveries,
      public.dispatch_reconciliation_items,
      public.dispatch_items,
      public.dispatches,
      public.retention_archive
    RESTART IDENTITY CASCADE;
  `);
}

async function seedScenario(c: Client): Promise<void> {
  await c.query(`
    INSERT INTO public.dispatches
      (id, date, driver_id, driver_name, vehicle_plate, loaded_by_user_id, loaded_by_user_name, status, closed_at, closed_by_user_id, closed_by_user_name)
    VALUES
      ('D61', to_char((now() AT TIME ZONE 'UTC')::date - 61, 'YYYY-MM-DD'), 'u_driver', 'Şoför', '34 CI 061', 'u_admin', 'Yönetici', 'completed', now() - interval '61 day', 'u_admin', 'Yönetici'),
      ('D60', to_char((now() AT TIME ZONE 'UTC')::date - 60, 'YYYY-MM-DD'), 'u_driver', 'Şoför', '34 CI 060', 'u_admin', 'Yönetici', 'completed', now() - interval '60 day', 'u_admin', 'Yönetici'),
      ('D59', to_char((now() AT TIME ZONE 'UTC')::date - 59, 'YYYY-MM-DD'), 'u_driver', 'Şoför', '34 CI 059', 'u_admin', 'Yönetici', 'completed', now() - interval '59 day', 'u_admin', 'Yönetici'),
      ('DOPEN', to_char((now() AT TIME ZONE 'UTC')::date - 100, 'YYYY-MM-DD'), 'u_driver', 'Şoför', '34 CI 100', 'u_admin', 'Yönetici', 'in_transit', NULL, NULL, NULL);
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
      ('DELOPEN', 'DOPEN', 'u_driver', 'Şoför', '34 CI 100', 'c1', 'Test Müşteri', now(), 100, 'CASH', 100, 100, 'paid');
  `);
  await c.query(`
    INSERT INTO public.delivery_items (delivery_id, line_no, product_id, product_name, quantity, unit_price, line_total)
    VALUES ('DEL61OLD', 1, 'p_water', 'Damacana Su', 2, 100, 200);
  `);
  await c.query(`
    INSERT INTO public.delivery_container_returns (delivery_id, deposit_type, received_qty, diff_qty)
    VALUES ('DEL61OLD', 'damacana', 2, 0);
  `);
}

async function eligibleDispatchIds(c: Client): Promise<string[]> {
  const r = await c.query(`
    SELECT COALESCE(array_agg(id), ARRAY[]::text[]) AS ids
    FROM public.dispatches
    WHERE status = 'completed' AND closed_at IS NOT NULL
      AND date < to_char((now() AT TIME ZONE 'UTC')::date - ${RETENTION_DAYS}, 'YYYY-MM-DD');
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
      IF NOT EXISTS (SELECT 1 FROM public.retention_archive WHERE table_name = TG_TABLE_NAME) THEN
        RAISE EXCEPTION 'ARCHIVE_BEFORE_DELETE_VIOLATED: %', TG_TABLE_NAME;
      END IF;
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
  console.log('\n[2] Gercek calisma: arsiv-once silme, dogru satirlar');
  await resetTransactional(c);
  await seedScenario(c);
  await installOrderTriggers(c);
  const before = await balancesSnapshot(c);
  const res = await purge(c, false, await eligibleDispatchIds(c));

  const dIds = await dispatchIds(c);
  check('uygun sefer (D61) silindi', !dIds.includes('D61'));
  check('sinirdaki sefer (D60) korundu', dIds.includes('D60'));
  check('D59 seferi korundu', dIds.includes('D59'));
  check('acik sefer (DOPEN) korundu', dIds.includes('DOPEN'));

  const dli = await deliveryIds(c);
  check('esikten eski teslimat silindi', !dli.includes('DEL61OLD'));
  check('esikten YENI ama uygun sefere ait teslimat da silindi', !dli.includes('DEL61NEW'));
  check('sinirdaki teslimat korundu', dli.includes('DEL60'));
  check('acik seferin teslimati korundu', dli.includes('DELOPEN'));

  check(
    'rapor edilen silme sayilari (1 sefer, 2 teslimat)',
    Number(res.purged_dispatches) === 1 && Number(res.purged_deliveries) === 2,
    JSON.stringify({ d: res.purged_dispatches, del: res.purged_deliveries })
  );

  const archSum = Number(
    (await c.query('SELECT COALESCE(sum(row_count),0)::int AS n FROM public.retention_archive')).rows[0].n
  );
  check('arsiv satir sayisi toplami = 7', archSum === 7, `bulunan=${archSum}`);
  check('her iki tablo arsivlendi',
    Number((await c.query("SELECT count(*)::int n FROM public.retention_archive WHERE table_name='dispatches'")).rows[0].n) >= 1 &&
    Number((await c.query("SELECT count(*)::int n FROM public.retention_archive WHERE table_name='deliveries'")).rows[0].n) >= 1
  );
  check('musteri bakiye/boş kap degismedi', (await balancesSnapshot(c)) === before);

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
    check('kilit birakilinca purge basarili', Number(after.purged_dispatches) === 1);
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
  console.log('\n[6] Denetim (audit) tablolari temizlikten etkilenmez');
  await resetTransactional(c);
  await seedScenario(c);
  await c.query(`
    INSERT INTO public.dispatch_reopen_audit (dispatch_id, reopened_by_user_id, reopened_by_user_name, reason)
    VALUES ('D61', 'u_admin', 'Yönetici', 'CI test');
  `);
  await c.query(`
    INSERT INTO public.dispatch_loading_audit (dispatch_id, changed_by_user_id, changed_by_user_name, previous_items, new_items)
    VALUES ('D61', 'u_admin', 'Yönetici', '[]'::jsonb, '[]'::jsonb);
  `);
  await c.query(`
    INSERT INTO public.customer_financial_audit (customer_id, changed_by_user_id, changed_by_user_name, reason)
    VALUES ('c1', 'u_admin', 'Yönetici', 'CI test');
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
       performed_by_user_name, reason, reversed_balance)
    VALUES
      ('DEL61CANC', 'D61', 'c1', 'cancel', 'u_driver', 'Şoför', 'CI iptal testi', 0);
  `);
  const a1 = await count(c, 'dispatch_reopen_audit');
  const a2 = await count(c, 'dispatch_loading_audit');
  const a3 = await count(c, 'customer_financial_audit');
  const a4 = await count(c, 'delivery_cancellation_audit');
  await purge(c, false, await eligibleDispatchIds(c));
  check('dispatch_reopen_audit degismedi', (await count(c, 'dispatch_reopen_audit')) === a1 && a1 >= 1);
  check('dispatch_loading_audit degismedi', (await count(c, 'dispatch_loading_audit')) === a2 && a2 >= 1);
  check('customer_financial_audit degismedi', (await count(c, 'customer_financial_audit')) === a3 && a3 >= 1);
  check('delivery_cancellation_audit degismedi', (await count(c, 'delivery_cancellation_audit')) === a4 && a4 >= 1);
  check(
    'iptal edilen teslimat temizlendi, denetim kaydi kaldi',
    (await deliveryIds(c)).every((id) => id !== 'DEL61CANC') &&
      (await c.query(
        "SELECT count(*)::int n FROM public.delivery_cancellation_audit WHERE delivery_id = 'DEL61CANC'"
      )).rows[0].n === 1
  );
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
