/**
 * scripts/ci/payments-pg-test.ts
 *
 * Gerçek PostgreSQL üzerinde teslimat dışı tahsilat RPC'sini doğrular:
 * atomik bakiye güncellemesi, ödeme + denetim kaydı, idempotency,
 * doğrulama hataları, rol yetkileri ve sefere bağlı tahsilatların gün sonu
 * kasa/POS toplamlarına dahil edilmesi. Mock değildir.
 *
 * Kullanım:
 *   DATABASE_URL=postgres://... npx tsx scripts/ci/payments-pg-test.ts
 *
 * Not: Şema ve migration'ların önceden uygulanmış olması beklenir
 * (CI'de retention-pg-test.ts --apply-only adımı bunu yapar).
 */

import { Client } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

const FN = 'public.record_customer_payment';
const FN_SIG = 'public.record_customer_payment(jsonb)';
const TABLE = 'public.customer_payments';
const CUSTOMER_ID = 'c_pay_ci';

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

async function newClient(): Promise<Client> {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  return c;
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    payment_id: 'pay_ci_1',
    customer_id: CUSTOMER_ID,
    amount: 125.5,
    method: 'CASH',
    note: 'CI testi',
    collected_by_user_id: 'u_admin',
    collected_by_user_name: 'Yönetici',
    ...overrides,
  };
}

async function callPayment(c: Client, body: Record<string, unknown>) {
  const res = await c.query(`SELECT ${FN}($1::jsonb) AS result`, [JSON.stringify(body)]);
  return res.rows[0].result as {
    already_applied: boolean;
    balance: number;
    previous_balance?: number;
  };
}

async function expectError(c: Client, body: Record<string, unknown>, pattern: RegExp) {
  await c.query('SAVEPOINT payment_error');
  let message = '';
  try {
    await callPayment(c, body);
  } catch (e: any) {
    message = String(e?.message ?? e);
  } finally {
    await c.query('ROLLBACK TO SAVEPOINT payment_error');
  }
  return pattern.test(message);
}

async function main(): Promise<void> {
  const c = await newClient();

  console.log('\n[1] Fonksiyon ve yetkiler');
  const exists = await c.query('SELECT to_regprocedure($1) AS fn', [FN_SIG]);
  check('record_customer_payment fonksiyonu var', !!exists.rows[0].fn);

  const hasFn = async (role: string) =>
    (
      await c.query('SELECT has_function_privilege($1, $2, $3) AS ok', [
        role,
        FN_SIG,
        'EXECUTE',
      ])
    ).rows[0].ok === true;

  check('anon EXECUTE yetkisi yok', (await hasFn('anon')) === false);
  check('authenticated EXECUTE yetkisi yok', (await hasFn('authenticated')) === false);
  check('service_role EXECUTE yetkisi var', (await hasFn('service_role')) === true);

  const hasTable = async (role: string, action: string) =>
    (
      await c.query('SELECT has_table_privilege($1, $2, $3) AS ok', [
        role,
        TABLE,
        action,
      ])
    ).rows[0].ok === true;

  for (const role of ['anon', 'authenticated']) {
    check(`${role} tablo SELECT yetkisi yok`, (await hasTable(role, 'SELECT')) === false);
    check(`${role} tablo INSERT yetkisi yok`, (await hasTable(role, 'INSERT')) === false);
  }
  check('service_role tablo SELECT yetkisi var', (await hasTable('service_role', 'SELECT')) === true);
  check('service_role tablo INSERT yetkisi var', (await hasTable('service_role', 'INSERT')) === true);

  console.log('\n[2] Atomik tahsilat, idempotency ve denetim izi');
  await c.query('BEGIN');
  try {
    await c.query(
      `INSERT INTO public.customers (id, name, current_balance_tl, is_account_customer)
       VALUES ($1, 'CI Ödeme Müşterisi', 500, true)
       ON CONFLICT (id) DO UPDATE SET current_balance_tl = 500`,
      [CUSTOMER_ID]
    );

    await c.query('SET ROLE service_role');

    const first = await callPayment(c, payload());
    check('ilk tahsilat uygulandı', first.already_applied === false);
    check('bakiye 374,50', Number(first.balance) === 374.5, `${first.balance}`);

    const paymentRow = await c.query(
      `SELECT amount, method, note FROM ${TABLE} WHERE id = 'pay_ci_1'`
    );
    check('ödeme kaydı oluştu', paymentRow.rowCount === 1);
    check('tutar 125,50', Number(paymentRow.rows[0]?.amount) === 125.5);
    check('yöntem CASH', paymentRow.rows[0]?.method === 'CASH');

    const audit = await c.query(
      `SELECT previous_balance, new_balance, reason
         FROM public.customer_financial_audit
        WHERE customer_id = $1
        ORDER BY changed_at DESC, id DESC
        LIMIT 1`,
      [CUSTOMER_ID]
    );
    check('denetim kaydı oluştu', audit.rowCount === 1);
    check('önceki bakiye 500', Number(audit.rows[0]?.previous_balance) === 500);
    check('yeni bakiye 374,50', Number(audit.rows[0]?.new_balance) === 374.5);
    check(
      'denetim gerekçesi tahsilat',
      /tahsilat/i.test(String(audit.rows[0]?.reason ?? ''))
    );

    const second = await callPayment(c, payload());
    check('aynı payment_id idempotent', second.already_applied === true);
    check('bakiye ikinci kez düşmedi', Number(second.balance) === 374.5);
    const countRow = await c.query(
      `SELECT count(*)::int AS n FROM ${TABLE} WHERE id = 'pay_ci_1'`
    );
    check('tek ödeme kaydı', Number(countRow.rows[0].n) === 1);

    console.log('\n[3] Doğrulama hataları');
    check(
      'sıfır tutar reddedildi',
      await expectError(c, payload({ payment_id: 'pay_bad_amount', amount: 0 }), /PAYMENT_AMOUNT_INVALID/)
    );
    check(
      'geçersiz yöntem reddedildi',
      await expectError(
        c,
        payload({ payment_id: 'pay_bad_method', method: 'BITCOIN' }),
        /PAYMENT_METHOD_INVALID/
      )
    );
    check(
      'olmayan müşteri reddedildi',
      await expectError(
        c,
        payload({ payment_id: 'pay_bad_customer', customer_id: 'c_yok' }),
        /CUSTOMER_NOT_FOUND/
      )
    );

    await c.query('RESET ROLE');
  } finally {
    await c.query('ROLLBACK');
    await c.query('RESET ROLE');
  }

  console.log('\n[4] anon çalışma zamanı erişimi');
  await c.query('BEGIN');
  try {
    await c.query('SAVEPOINT anon_call');
    let denied = false;
    try {
      await c.query('SET ROLE anon');
      await c.query(`SELECT ${FN}($1::jsonb)`, ['{}']);
    } catch (e: any) {
      denied = /permission denied|42501/i.test(String(e?.message ?? e));
    } finally {
      // Önce savepoint'e dön: hata sonrası transaction aksi halde kilitli kalır.
      await c.query('ROLLBACK TO SAVEPOINT anon_call');
      await c.query('RESET ROLE');
    }
    check('anon RPC çağrısı reddedildi', denied);
  } finally {
    await c.query('ROLLBACK');
  }

  console.log('\n[5] Sefere bagli tahsilat ve gun sonu kasa toplami');
  await c.query('BEGIN');
  try {
    await c.query(
      `INSERT INTO public.users (id, name, username, role, can_load_vehicle, pin)
       VALUES ('u_driver_pay_ci', 'CI Şoför', 'ci_pay_driver', 'driver', true, '1234')
       ON CONFLICT (id) DO NOTHING;`
    );
    await c.query(
      `INSERT INTO public.dispatches
         (id, date, driver_id, driver_name, vehicle_plate, loaded_by_user_id,
          loaded_by_user_name, status)
       VALUES
         ('D_PAY_CI', to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD'),
          'u_driver_pay_ci', 'CI Şoför', '34 PAY 01', 'u_admin', 'Yönetici',
          'in_transit')
       ON CONFLICT (id) DO UPDATE SET status = 'in_transit';`
    );
    await c.query(
      `INSERT INTO public.customers (id, name, current_balance_tl, is_account_customer)
       VALUES ($1, 'CI Ödeme Müşterisi', 500, true)
       ON CONFLICT (id) DO UPDATE SET current_balance_tl = 500`,
      [CUSTOMER_ID]
    );

    const linked = await callPayment(
      c,
      payload({
        payment_id: 'pay_linked_ci',
        dispatch_id: 'D_PAY_CI',
        collected_by_user_id: 'u_driver_pay_ci',
        collected_by_user_name: 'CI Şoför',
        amount: 100,
        method: 'CASH',
      })
    );
    check('sefer baglantili tahsilat uygulandi', linked.already_applied === false);
    const linkedRow = await c.query(
      `SELECT dispatch_id FROM ${TABLE} WHERE id = 'pay_linked_ci'`
    );
    check('tahsilat dispatch_id ile saklandi', linkedRow.rows[0]?.dispatch_id === 'D_PAY_CI');

    await callPayment(
      c,
      payload({
        payment_id: 'pay_linked_pos_ci',
        dispatch_id: 'D_PAY_CI',
        collected_by_user_id: 'u_driver_pay_ci',
        collected_by_user_name: 'CI Şoför',
        amount: 50,
        method: 'POS',
      })
    );

    const closed = await c.query(
      `SELECT public.close_dispatch($1::jsonb) AS r`,
      [
        JSON.stringify({
          dispatch_id: 'D_PAY_CI',
          closed_by_user_id: 'u_driver_pay_ci',
          remaining_full_counted: {},
          actual_cash_in_pocket: 100,
          actual_pos_slips_total: 50,
          collected_empty_damacana: 0,
          collected_empty_cam_damacana: 0,
          collected_empty_tup: 0,
          notes: 'CI kasa',
        }),
      ]
    );
    check(
      'gun sonu nakit toplami sefer tahsilatini icerir',
      Number(closed.rows[0]?.r?.total_cash_collected) === 100,
      JSON.stringify(closed.rows[0]?.r)
    );
    check(
      'gun sonu POS toplami sefer tahsilatini icerir',
      Number(closed.rows[0]?.r?.total_pos_collected) === 50
    );
    check(
      'standalone nakit ayrica raporlanir',
      Number(closed.rows[0]?.r?.total_standalone_cash) === 100
    );

    const closedPayment = await expectError(
      c,
      payload({
        payment_id: 'pay_after_close_ci',
        dispatch_id: 'D_PAY_CI',
        collected_by_user_id: 'u_driver_pay_ci',
        collected_by_user_name: 'CI Şoför',
      }),
      /DISPATCH_NOT_OPEN/
    );
    check('kapanmis sefere tahsilat reddedildi', closedPayment);
  } finally {
    await c.query('ROLLBACK');
  }

  await c.end();
  console.log(`\nSonuç: ${passed} başarılı, ${failed} başarısız`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
