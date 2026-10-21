/**
 * scripts/ci/customer-dispensers-pg-test.ts
 *
 * Gercek PostgreSQL uzerinde customer_dispensers tablosunun sema, yetki,
 * CRUD ve retention izolasyonunu dogrular. Mock degildir.
 *
 * Kullanim:
 *   DATABASE_URL=postgres://... npx tsx scripts/ci/customer-dispensers-pg-test.ts
 *   DATABASE_URL=postgres://... npx tsx scripts/ci/customer-dispensers-pg-test.ts --apply-only
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
    INSERT INTO public.products (id, name, category, default_unit_price, is_deposit, deposit_type, unit)
    VALUES ('p_water', 'Damacana Su', 'pet', 100, false, 'none', 'Adet')
    ON CONFLICT (id) DO NOTHING;
  `);
  await c.query(`
    INSERT INTO public.customers (id, name, current_balance_tl, is_account_customer)
    VALUES ('c_disp', 'Sebil Müşterisi', 500, true)
    ON CONFLICT (id) DO UPDATE SET current_balance_tl = 500;
  `);
  await c.query(`
    INSERT INTO public.customer_empty_balances (customer_id, deposit_type, quantity) VALUES
      ('c_disp', 'damacana', 3),
      ('c_disp', 'tup', 1)
    ON CONFLICT (customer_id, deposit_type) DO UPDATE SET quantity = EXCLUDED.quantity;
  `);
}

async function scenarioSchema(c: Client): Promise<void> {
  console.log('\n[1] Sema: yalnizca beklenen kolonlar, kisitlar ve indeks');

  const cols = await c.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customer_dispensers'
    ORDER BY ordinal_position
  `);
  const expected = [
    ['id', 'text', 'NO'],
    ['customer_id', 'text', 'NO'],
    ['brand', 'text', 'NO'],
    ['model', 'text', 'NO'],
    ['quantity', 'integer', 'NO'],
    ['note', 'text', 'YES'],
    ['created_at', 'timestamp with time zone', 'NO'],
    ['updated_at', 'timestamp with time zone', 'NO'],
    ['updated_by_user_id', 'text', 'NO'],
    ['updated_by_user_name', 'text', 'NO'],
  ];
  const actual = cols.rows.map((row: any) => [
    row.column_name,
    row.data_type,
    row.is_nullable,
  ]);
  check('kolon listesi ve tipleri birebir', JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify(actual));

  const constraints = await c.query(`
    SELECT contype, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.customer_dispensers'::regclass
    ORDER BY contype, conname
  `);
  const types = constraints.rows.map((row: any) => row.contype);
  check('primary key var', types.filter((x: string) => x === 'p').length === 1);
  check('foreign key yok', types.filter((x: string) => x === 'f').length === 0);
  check('unique kisit yok', types.filter((x: string) => x === 'u').length === 0);
  check('tek CHECK kisiti var', types.filter((x: string) => x === 'c').length === 1);
  const quantityCheck = constraints.rows.find((row: any) =>
    /quantity\s*>=\s*1/i.test(String(row.definition))
  );
  check('quantity >= 1 CHECK tanimli', Boolean(quantityCheck), JSON.stringify(constraints.rows));

  const index = await c.query(`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'customer_dispensers'
      AND indexname = 'idx_customer_dispensers_customer_id'
  `);
  check(
    'customer_id indeksi var',
    index.rows.length === 1 && /\(customer_id\)/.test(String(index.rows[0].indexdef)),
    JSON.stringify(index.rows)
  );
}

async function scenarioPrivileges(c: Client): Promise<void> {
  console.log('\n[2] Yetkiler: RLS acik, politika yok, yalnizca service_role');

  const rls = await c.query(`
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.customer_dispensers'::regclass
  `);
  check('RLS acik', rls.rows[0]?.relrowsecurity === true);

  const policies = await c.query(`
    SELECT count(*)::int AS n
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'customer_dispensers'
  `);
  check('RLS politikasi yok', Number(policies.rows[0].n) === 0);

  const privilege = async (role: string, action: string): Promise<boolean> =>
    (
      await c.query('SELECT has_table_privilege($1, $2, $3) AS ok', [
        role,
        'public.customer_dispensers',
        action,
      ])
    ).rows[0].ok === true;

  for (const role of ['anon', 'authenticated']) {
    check(`${role} SELECT yetkisi yok`, (await privilege(role, 'SELECT')) === false);
    check(`${role} INSERT yetkisi yok`, (await privilege(role, 'INSERT')) === false);
    check(`${role} UPDATE yetkisi yok`, (await privilege(role, 'UPDATE')) === false);
    check(`${role} DELETE yetkisi yok`, (await privilege(role, 'DELETE')) === false);
  }
  for (const action of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    check(
      `service_role ${action} yetkisi var`,
      (await privilege('service_role', action)) === true
    );
  }

  const denied = async (role: string, sql: string): Promise<boolean> => {
    let error = '';
    try {
      await c.query(`SET ROLE ${role}`);
      await c.query(sql);
    } catch (e: any) {
      error = String(e?.message ?? e);
    } finally {
      await c.query('RESET ROLE');
    }
    return /permission denied|42501/i.test(error);
  };

  for (const role of ['anon', 'authenticated']) {
    check(
      `${role} calisma zamani SELECT reddedildi`,
      await denied(role, 'SELECT count(*) FROM public.customer_dispensers')
    );
    check(
      `${role} calisma zamani INSERT reddedildi`,
      await denied(
        role,
        "INSERT INTO public.customer_dispensers (id, customer_id, brand, model, quantity, updated_by_user_id, updated_by_user_name) VALUES ('x', 'c_disp', 'X', 'Y', 1, 'u', 'U')"
      )
    );
    check(
      `${role} calisma zamani UPDATE reddedildi`,
      await denied(
        role,
        "UPDATE public.customer_dispensers SET brand = 'X' WHERE id = 'none'"
      )
    );
    check(
      `${role} calisma zamani DELETE reddedildi`,
      await denied(
        role,
        "DELETE FROM public.customer_dispensers WHERE id = 'none'"
      )
    );
  }
}

async function scenarioCrud(c: Client): Promise<void> {
  console.log('\n[3] service_role CRUD ve veri kurallari');

  await c.query('SET ROLE service_role');
  try {
    await c.query(`
      INSERT INTO public.customer_dispensers
        (id, customer_id, brand, model, quantity, note, updated_by_user_id, updated_by_user_name)
      VALUES
        ('d1', 'c_disp', 'Hayat', 'HT-200', 2, 'Mutfak', 'u_admin', 'Yönetici'),
        ('d2', 'c_disp', 'Hayat', 'HT-200', 1, NULL, 'u_driver', 'Şoför')
    `);
    const duplicate = await c.query(
      "SELECT count(*)::int AS n FROM public.customer_dispensers WHERE customer_id = 'c_disp' AND brand = 'Hayat' AND model = 'HT-200'"
    );
    check('ayni marka/model birden fazla kayitta olabilir', Number(duplicate.rows[0].n) === 2);

    const defaults = await c.query(
      "SELECT created_at IS NOT NULL AND updated_at IS NOT NULL AS ok FROM public.customer_dispensers WHERE id = 'd1'"
    );
    check('zaman damgalari dolu', defaults.rows[0]?.ok === true);

    let zeroError = '';
    try {
      await c.query(`
        INSERT INTO public.customer_dispensers
          (id, customer_id, brand, model, quantity, updated_by_user_id, updated_by_user_name)
        VALUES ('d0', 'c_disp', 'Sırma', 'Mini', 0, 'u_admin', 'Yönetici')
      `);
    } catch (e: any) {
      zeroError = String(e?.message ?? e);
    }
    check('sifir adet CHECK ile reddedilir', /check constraint|23514/i.test(zeroError), zeroError);

    let nullError = '';
    try {
      await c.query(`
        INSERT INTO public.customer_dispensers
          (id, customer_id, brand, model, quantity, updated_by_user_id, updated_by_user_name)
        VALUES ('dnull', 'c_disp', NULL, 'Mini', 1, 'u_admin', 'Yönetici')
      `);
    } catch (e: any) {
      nullError = String(e?.message ?? e);
    }
    check('bos marka NOT NULL ile reddedilir', /not-null|null value|23502/i.test(nullError), nullError);

    await c.query(`
      UPDATE public.customer_dispensers
      SET quantity = 4, note = 'Salon', updated_by_user_id = 'u_driver',
          updated_by_user_name = 'Şoför', updated_at = now()
      WHERE id = 'd1'
    `);
    const updated = await c.query(
      "SELECT quantity, note, updated_by_user_id, updated_by_user_name FROM public.customer_dispensers WHERE id = 'd1'"
    );
    check('guncelleme calisir', Number(updated.rows[0]?.quantity) === 4 && updated.rows[0]?.note === 'Salon');
    check(
      'guncelleyen kullanici alanlari korunur',
      updated.rows[0]?.updated_by_user_id === 'u_driver' &&
        updated.rows[0]?.updated_by_user_name === 'Şoför'
    );

    await c.query("DELETE FROM public.customer_dispensers WHERE id = 'd2'");
    const remaining = await c.query(
      "SELECT array_agg(id ORDER BY id) AS ids FROM public.customer_dispensers WHERE customer_id = 'c_disp'"
    );
    check('silme calisir', JSON.stringify(remaining.rows[0]?.ids) === JSON.stringify(['d1']));
  } finally {
    await c.query('RESET ROLE');
  }
}

async function retentionSnapshot(c: Client): Promise<string> {
  const dispensers = await c.query(
    'SELECT * FROM public.customer_dispensers ORDER BY id'
  );
  const customers = await c.query(
    'SELECT id, current_balance_tl::text AS balance FROM public.customers ORDER BY id'
  );
  const empties = await c.query(
    'SELECT customer_id, deposit_type, quantity FROM public.customer_empty_balances ORDER BY customer_id, deposit_type'
  );
  return JSON.stringify({
    dispensers: dispensers.rows,
    customers: customers.rows,
    empties: empties.rows,
  });
}

async function scenarioRetention(c: Client): Promise<void> {
  console.log('\n[4] Retention: sebil, musteri bakiyesi ve bos kap degismez');

  await c.query(`
    TRUNCATE
      public.delivery_container_returns,
      public.delivery_items,
      public.deliveries,
      public.dispatch_reconciliation_items,
      public.dispatch_items,
      public.dispatches,
      public.retention_archive
    RESTART IDENTITY CASCADE
  `);
  await c.query(`
    INSERT INTO public.dispatches
      (id, date, driver_id, driver_name, vehicle_plate, loaded_by_user_id, loaded_by_user_name,
       status, closed_at, closed_by_user_id, closed_by_user_name)
    VALUES
      ('D_DISP_OLD', to_char((now() AT TIME ZONE 'UTC')::date - 61, 'YYYY-MM-DD'),
       'u_driver', 'Şoför', '34 CI 061', 'u_admin', 'Yönetici', 'completed',
       now() - interval '61 day', 'u_admin', 'Yönetici')
  `);
  await c.query(`
    INSERT INTO public.deliveries
      (id, dispatch_id, driver_id, driver_name, vehicle_plate, customer_id, customer_name,
       timestamp, delivered_grand_total, payment_method, cash_amount, total_collected, payment_status)
    VALUES
      ('DEL_DISP_OLD', 'D_DISP_OLD', 'u_driver', 'Şoför', '34 CI 061', 'c_disp',
       'Sebil Müşterisi', now() - interval '61 day', 100, 'CASH', 100, 100, 'paid')
  `);

  const before = await retentionSnapshot(c);
  const result = await c.query(
    'SELECT public.purge_retention($1::boolean, $2::text[], $3::text[], $4::integer) AS r',
    [false, ['D_DISP_OLD'], [], RETENTION_DAYS]
  );
  check(
    'uygun sefer retention ile silindi',
    Number(result.rows[0]?.r?.purged_dispatches) === 1,
    JSON.stringify(result.rows[0]?.r)
  );
  check('sebil/musteri/bos kap snapshot degismedi', (await retentionSnapshot(c)) === before);
  const remaining = await c.query(
    "SELECT count(*)::int AS n FROM public.customer_dispensers WHERE id = 'd1'"
  );
  check('sebil kaydi korundu', Number(remaining.rows[0].n) === 1);
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
    await scenarioSchema(c);
    await scenarioPrivileges(c);
    await scenarioCrud(c);
    await scenarioRetention(c);
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
