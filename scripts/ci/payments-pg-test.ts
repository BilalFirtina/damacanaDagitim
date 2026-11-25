/**
 * scripts/ci/payments-pg-test.ts
 *
 * Gerçek PostgreSQL üzerinde teslimat dışı tahsilat RPC'sini doğrular:
 * atomik bakiye güncellemesi, idempotency, tahsilat düzeltme/iptali (denetim yok),
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
const AMEND_FN = 'public.amend_customer_payment';
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

async function callAmend(c: Client, body: Record<string, unknown>) {
  const res = await c.query(`SELECT ${AMEND_FN}($1::jsonb) AS result`, [JSON.stringify(body)]);
  return res.rows[0].result as {
    already_applied?: boolean;
    balance?: number;
    status?: string;
  };
}

async function expectError(
  c: Client,
  body: Record<string, unknown>,
  pattern: RegExp,
  call: (client: Client, payload: Record<string, unknown>) => Promise<unknown> = callPayment
) {
  await c.query('SAVEPOINT payment_error');
  let message = '';
  try {
    await call(c, body);
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

  console.log('\n[2] Atomik tahsilat ve idempotency');
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
       VALUES
         ('u_driver_pay_ci', 'CI Şoför', 'ci_pay_driver', 'driver', true, '1234'),
         ('u_admin', 'Yönetici', 'ci_pay_admin', 'admin', true, '0000')
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

    const adminAmendDriver = await expectError(
      c,
      {
        payment_id: 'pay_linked_ci',
        mode: 'update',
        amount: 90,
        method: 'CASH',
        expected_amount: 100,
        expected_method: 'CASH',
        actor_id: 'u_admin',
        actor_name: 'Yönetici',
      },
      /NOT_AUTHORIZED/,
      callAmend
    );
    check('yönetici şoförün tahsilatını düzenleyemez', adminAmendDriver);

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
          collected_empty_tup_buyuk: 0,
          collected_empty_tup_kucuk: 0,
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

    const closedAmend = await expectError(
      c,
      {
        payment_id: 'pay_linked_ci',
        mode: 'update',
        amount: 90,
        method: 'CASH',
        expected_amount: 100,
        expected_method: 'CASH',
        actor_id: 'u_driver_pay_ci',
        actor_name: 'CI Şoför',
      },
      /DISPATCH_CLOSED/,
      callAmend
    );
    check('kapanmis seferde tahsilat duzeltilemez', closedAmend);
  } finally {
    await c.query('ROLLBACK');
  }

  console.log('\n[6] Tahsilat düzeltme ve iptal: beklenen tutar kontrolü, denetim kaydı yok');
  await c.query('BEGIN');
  try {
    await c.query(
      `INSERT INTO public.users (id, name, username, role, can_load_vehicle, pin)
       VALUES
         ('u_admin', 'Yönetici', 'ci_pay_admin', 'admin', true, '0000'),
         ('u_driver_pay_ci', 'CI Şoför', 'ci_pay_driver', 'driver', true, '1234')
       ON CONFLICT (id) DO NOTHING;`
    );
    await c.query(
      `INSERT INTO public.customers (id, name, current_balance_tl, is_account_customer)
       VALUES ($1, 'CI Düzeltme Müşterisi', 500, true)
       ON CONFLICT (id) DO UPDATE SET current_balance_tl = 500`,
      [CUSTOMER_ID]
    );

    const auditCounts = async () =>
      (
        await c.query(
          `SELECT (SELECT count(*)::int FROM public.customer_payment_audit) AS pay,
                  (SELECT count(*)::int FROM public.customer_financial_audit) AS fin`
        )
      ).rows[0];
    const balanceNow = async () =>
      Number(
        (
          await c.query('SELECT current_balance_tl FROM public.customers WHERE id = $1', [
            CUSTOMER_ID,
          ])
        ).rows[0]?.current_balance_tl
      );
    const auditBefore = await auditCounts();

    await callPayment(c, payload({ payment_id: 'pay_amend_1', amount: 100, method: 'CASH' }));
    check('düzeltme testi tahsilatı sonrası bakiye 400', (await balanceNow()) === 400);

    const amendBody = (overrides: Record<string, unknown> = {}) => ({
      payment_id: 'pay_amend_1',
      mode: 'update',
      amount: 150,
      method: 'POS',
      expected_amount: 100,
      expected_method: 'CASH',
      actor_id: 'u_admin',
      actor_name: 'Yönetici',
      ...overrides,
    });

    check(
      'şoför başka kullanıcının tahsilatını düzenleyemez',
      await expectError(
        c,
        amendBody({ actor_id: 'u_driver_pay_ci', actor_name: 'CI Şoför' }),
        /NOT_AUTHORIZED/,
        callAmend
      )
    );

    check(
      'beklenen tutar yoksa EXPECTATION_REQUIRED',
      await expectError(
        c,
        amendBody({ expected_amount: null }),
        /EXPECTATION_REQUIRED/,
        callAmend
      )
    );
    check(
      'beklenen tutar uyuşmazsa PAYMENT_CHANGED',
      await expectError(c, amendBody({ expected_amount: 90 }), /PAYMENT_CHANGED/, callAmend)
    );
    check(
      'beklenen yöntem uyuşmazsa PAYMENT_CHANGED',
      await expectError(c, amendBody({ expected_method: 'POS' }), /PAYMENT_CHANGED/, callAmend)
    );
    check('uyuşmazlıklarda bakiye değişmedi', (await balanceNow()) === 400);

    const amended = await callAmend(c, amendBody());
    check('düzeltme uygulandı', amended.already_applied === false);
    check(
      'düzeltme bakiye farkını uygular (400 -> 350)',
      Number(amended.balance) === 350 && (await balanceNow()) === 350
    );
    const amendedRow = await c.query(
      `SELECT amount, method, note FROM ${TABLE} WHERE id = 'pay_amend_1'`
    );
    check(
      'düzeltilmiş tutar ve yöntem saklandı',
      Number(amendedRow.rows[0]?.amount) === 150 && amendedRow.rows[0]?.method === 'POS'
    );
    check('düzeltmede not değişmedi', amendedRow.rows[0]?.note === 'CI testi');

    const same = await callAmend(c, amendBody());
    check('aynı değerler already_applied döner', same.already_applied === true);
    check('aynı değerlerde bakiye değişmedi', (await balanceNow()) === 350);

    check(
      'eski beklenen değerle ikinci düzeltme reddedilir',
      await expectError(
        c,
        amendBody({ amount: 200, method: 'CASH', expected_amount: 100, expected_method: 'CASH' }),
        /PAYMENT_CHANGED/,
        callAmend
      )
    );

    await c.query(
      `INSERT INTO public.customer_payments
         (id, customer_id, amount, method, note, collected_by_user_id,
          collected_by_user_name, collected_at)
       VALUES
         ('pay_old_admin_ci', $1, 25, 'CASH', 'Eski gün', 'u_admin', 'Yönetici',
          now() - interval '1 day')`,
      [CUSTOMER_ID]
    );
    check(
      'yönetici önceki günün tahsilatını iptal edemez',
      await expectError(
        c,
        {
          payment_id: 'pay_old_admin_ci',
          mode: 'cancel',
          actor_id: 'u_admin',
          actor_name: 'Yönetici',
        },
        /CORRECTION_WINDOW_CLOSED/,
        callAmend
      )
    );
    const oldRow = await c.query(
      `SELECT count(*)::int AS n FROM ${TABLE} WHERE id = 'pay_old_admin_ci'`
    );
    check('önceki günün tahsilatı silinmedi', Number(oldRow.rows[0]?.n) === 1);

    const cancelled = await callAmend(c, {
      payment_id: 'pay_amend_1',
      mode: 'cancel',
      actor_id: 'u_admin',
      actor_name: 'Yönetici',
    });
    check('iptal tahsilatı siler', cancelled.status === 'deleted');
    check(
      'iptal bakiyeyi geri ekler (350 -> 500)',
      Number(cancelled.balance) === 500 && (await balanceNow()) === 500
    );
    const gone = await c.query(`SELECT count(*)::int AS n FROM ${TABLE} WHERE id = 'pay_amend_1'`);
    check('iptal sonrası tahsilat satırı yok', Number(gone.rows[0]?.n) === 0);
    check(
      'silinmiş tahsilatın tekrar iptali PAYMENT_NOT_FOUND',
      await expectError(
        c,
        { payment_id: 'pay_amend_1', mode: 'cancel', actor_id: 'u_admin', actor_name: 'Yönetici' },
        /PAYMENT_NOT_FOUND/,
        callAmend
      )
    );

    const auditAfter = await auditCounts();
    check(
      'düzeltme ve iptal denetim kaydı yazmadı',
      auditAfter.pay === auditBefore.pay && auditAfter.fin === auditBefore.fin
    );
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
