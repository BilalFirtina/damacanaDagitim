/**
 * Tahsilat RPC yetkilendirme sertleştirmesi — statik doğrulama.
 *
 * CI'de (unit) veritabanı olmadan çalışır; migration dosyasının gerekli
 * REVOKE/GRANT ifadelerini içerdiğini doğrular.
 *
 * Run:  npx tsx scripts/verify-payment-rpc-hardening.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('migrations/20261104_payment_rpc_hardening.sql');
const sql = fs.readFileSync(file, 'utf8');

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}`);
  }
}

check(
  'record_customer_payment PUBLIC/anon/authenticated yetkisi kaldırılıyor',
  /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.record_customer_payment\(jsonb\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(
    sql
  )
);
check(
  'record_customer_payment yalnızca service_role için açılıyor',
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.record_customer_payment\(jsonb\)\s+TO\s+service_role/i.test(
    sql
  )
);
check(
  'customer_payments tablosu anon için kapatılıyor',
  /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.customer_payments\s+FROM\s+anon/i.test(sql)
);
check(
  'customer_payments tablosu authenticated için kapatılıyor',
  /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.customer_payments\s+FROM\s+authenticated/i.test(
    sql
  )
);
check(
  'service_role tablo izni tanımlı',
  /GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE\s+public\.customer_payments\s+TO\s+service_role/i.test(
    sql
  )
);
check('işlem tek transaction içinde', /BEGIN;/.test(sql) && /COMMIT;/.test(sql));

console.log(`\nSonuç: ${passed} başarılı, ${failed} başarısız`);
if (failed > 0) process.exit(1);
