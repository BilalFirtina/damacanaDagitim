/**
 * Teslimat dışı tahsilat düzeltme/iptal — statik doğrulama.
 *
 * CI'de veritabanı olmadan çalışır; migration ve sunucu rotalarının gerekli
 * güvenlik/denetim parçalarını içerdiğini doğrular.
 *
 * Run: npx tsx scripts/verify-payment-corrections.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve('migrations/20261116_customer_payment_corrections.sql'),
  'utf8'
);
const hardDeleteMigration = fs.readFileSync(
  path.resolve('migrations/20261116_customer_payment_hard_delete.sql'),
  'utf8'
);
const closedDispatchGuardMigration = fs.readFileSync(
  path.resolve('migrations/20261116_customer_payment_closed_dispatch_guard.sql'),
  'utf8'
);
const dbSource = fs.readFileSync(path.resolve('src/server/db.ts'), 'utf8');
const server = fs.readFileSync(path.resolve('server.ts'), 'utf8');
const statementRules = fs.readFileSync(
  path.resolve('src/services/statementRules.ts'),
  'utf8'
);
const driverView = fs.readFileSync(
  path.resolve('src/components/driver/DriverView.tsx'),
  'utf8'
);
const statsStrip = fs.readFileSync(
  path.resolve('src/components/driver/DriverStatsStrip.tsx'),
  'utf8'
);

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
  'customer_payments status alanı ekleniyor',
  /ALTER TABLE public\.customer_payments[\s\S]*ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'/i.test(
    migration
  )
);
check(
  'status yalnızca active/cancelled olabilir',
  /CHECK \(status IN \('active', 'cancelled'\)\)/i.test(migration)
);
check(
  'customer_payment_audit tablosu oluşturuluyor',
  /CREATE TABLE IF NOT EXISTS public\.customer_payment_audit/i.test(migration)
);
check(
  'denetim kaydı request_id ile idempotent',
  /request_id TEXT NOT NULL UNIQUE/i.test(migration)
);
check(
  'denetim kaydı payment silinince temizleniyor',
  /REFERENCES public\.customer_payments\(id\) ON DELETE CASCADE/i.test(migration)
);
check(
  'denetim tablosu değiştirilemez',
  /prevent_customer_payment_audit_mutation/i.test(migration)
);
check(
  'tahsilat trigger yalnızca kontrollü düzeltmeye izin veriyor',
  /current_setting\('app\.payment_correction', true\) = 'on'/i.test(migration)
);
check(
  'amend_customer_payment SECURITY DEFINER',
  /FUNCTION public\.amend_customer_payment\(p jsonb\)[\s\S]*SECURITY DEFINER/i.test(
    migration
  )
);
check(
  'amend_customer_payment yalnızca service_role için açık',
  /REVOKE EXECUTE ON FUNCTION public\.amend_customer_payment\(jsonb\)[\s\S]*FROM PUBLIC, anon, authenticated/i.test(
    migration
  ) &&
    /GRANT EXECUTE ON FUNCTION public\.amend_customer_payment\(jsonb\)[\s\S]*TO service_role/i.test(
      migration
    )
);
check(
  'close_dispatch iptal edilen tahsilatı kasa/POS toplamına katmıyor',
  /FROM public\.customer_payments[\s\S]*WHERE dispatch_id = v_dispatch_id[\s\S]*AND status = 'active'/i.test(
    migration
  )
);
check(
  'GET /api/payments rotası var',
  /app\.get\('\/api\/payments'/.test(server)
);
check(
  'PUT /api/payments/:id rotası var',
  /app\.put\('\/api\/payments\/:id'/.test(server)
);
check(
  'POST /api/payments/:id/cancel rotası var',
  /app\.post\('\/api\/payments\/:id\/cancel'/.test(server)
);
check(
  'şoför yalnızca aktif seferde düzeltebilir',
  /dispatch\.status !== 'in_transit'/.test(server) &&
    /return payment\.collectedByUserId === session\.userId \? null : 'NOT_AUTHORIZED';/.test(
      server
    )
);
check(
  'admin kapalı seferde tahsilatı düzeltemez',
  /if \(!payment\.dispatchId\) return session\.role === 'admin' \? null : 'NOT_AUTHORIZED';/.test(
    server
  ) &&
    /if \(!dispatch \|\| dispatch\.status !== 'in_transit'\) return 'DISPATCH_CLOSED';/.test(
      server
    ) &&
    /getPaymentCorrectionDenial\(existing, session\)/.test(server)
);
check(
  'migration tek transaction içinde',
  /BEGIN;/.test(migration) && /COMMIT;/.test(migration)
);

check(
  'fiziksel silme migration dosyası var',
  /DELETE FROM public\.customer_payments WHERE id = v_payment_id/i.test(
    hardDeleteMigration
  )
);
check(
  'iptal işlemi status deleted döner',
  /'status', 'deleted'/i.test(hardDeleteMigration)
);
check(
  'iptal işlemi finansal denetim yazmaz',
  !/INSERT INTO public\.customer_financial_audit/i.test(hardDeleteMigration)
);
check(
  'tahsilat oluşturma finansal denetim yazmaz',
  !/INSERT INTO public\.customer_financial_audit/i.test(hardDeleteMigration)
);
check(
  'iptal silmesi trigger tarafından izinli',
  /TG_OP = 'DELETE'[\s\S]*current_setting\('app\.payment_correction', true\) = 'on'/i.test(
    hardDeleteMigration
  )
);
check(
  'mevcut iptal kayıtları temizleniyor',
  /DELETE FROM public\.customer_payments WHERE status = ''cancelled''/i.test(
    hardDeleteMigration
  )
);
check(
  'eski tahsilat denetim satırları temizleniyor',
  /Tahsilat iptali/.test(hardDeleteMigration) &&
    /DELETE FROM public\.customer_financial_audit/i.test(hardDeleteMigration)
);
check(
  'payments rotası iptal edilenleri istemez',
  !/getCustomerPaymentsByDate\(date, true\)/.test(server)
);
check(
  'payments rotası dispatchId destekler',
  /req\.query\.dispatchId/.test(server) &&
    /getCustomerPaymentsByDispatch\(dispatchId\)/.test(server)
);
check(
  'iptal rotası kayıt yoksa başarı döner',
  /Tahsilat zaten silinmiş/.test(server)
);
check(
  'statement aktif tahsilatları kullanır',
  /getCustomerPaymentsForStatement/.test(server) &&
    /payments: payments\.map/.test(server) &&
    /isLegacyPaymentAudit/.test(statementRules)
);
check(
  'şoför görünümü aktif sefere göre tahsilat çeker',
  /fetchPayments\(\{ dispatchId: activeDispatchId \}\)/.test(driverView) &&
    !/fetchPayments\(\{\s*date: todayStr/.test(driverView)
);
check(
  'nakit/POS göstergesi teslimat dışı tahsilatı içerir',
  /payments\s*\.filter/.test(statsStrip) &&
    /payment\.method === 'CASH'/.test(statsStrip) &&
    /payment\.method === 'POS'/.test(statsStrip)
);
check(
  'kapanmış seferde tahsilat guard migration var',
  /DISPATCH_CLOSED/.test(closedDispatchGuardMigration) &&
    /v_dispatch_status IS DISTINCT FROM 'in_transit'/.test(
      closedDispatchGuardMigration
    )
);
check(
  'kapalı seferin kasa/POS toplamları güncellenmez',
  !/d\.status = 'completed'/.test(closedDispatchGuardMigration)
);
check(
  'DISPATCH_CLOSED sunucu hatasına eşlenir',
  /DISPATCH_CLOSED/.test(dbSource) &&
    /Kapanmış seferde tahsilat iptal veya düzeltmesi yapılamaz/.test(dbSource)
);
check(
  'DISPATCH_CLOSED 409 döner',
  /code === 'DISPATCH_CLOSED'/.test(server)
);

console.log(`\nSonuç: ${passed} başarılı, ${failed} başarısız`);
if (failed > 0) process.exit(1);
