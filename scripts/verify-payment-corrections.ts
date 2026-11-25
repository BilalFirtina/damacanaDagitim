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
const correctionMigration = fs
  .readFileSync(
    path.resolve('migrations/20261124_remove_correction_audits_payments_purchases.sql'),
    'utf8'
  )
  .replace(/--.*$/gm, '');
const closedDispatchGuardMigration = fs.readFileSync(
  path.resolve('migrations/20261116_customer_payment_closed_dispatch_guard.sql'),
  'utf8'
);
const ownershipGuardMigration = fs.readFileSync(
  path.resolve('migrations/20261125_payment_ownership_guard.sql'),
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
  'tahsilat trigger yalnızca kontrollü düzeltmeye izin veriyor',
  /current_setting\('app\.payment_correction', true\) = 'on'/i.test(migration)
);
check(
  'yeni migration request_id kullanmıyor',
  !/request_id/i.test(correctionMigration)
);
check(
  'yeni migration customer_payment_audit yazmıyor',
  !/INSERT INTO public\.customer_payment_audit/i.test(correctionMigration)
);
check(
  'yeni migration customer_financial_audit yazmıyor',
  !/INSERT INTO public\.customer_financial_audit/i.test(correctionMigration)
);
check(
  'yeni migration beklenen tutar kontrolü içeriyor (EXPECTATION_REQUIRED)',
  /EXPECTATION_REQUIRED/.test(correctionMigration)
);
check(
  'yeni migration beklenen tutar uyuşmazlığını reddediyor (PAYMENT_CHANGED)',
  /PAYMENT_CHANGED/.test(correctionMigration)
);
check(
  'yeni düzeltme yalnızca tutar ve yöntemi günceller (not değişmez)',
  /SET amount = v_amount,\s*method = v_method\s*WHERE id = v_payment_id/.test(
    correctionMigration
  )
);
check(
  'amend_customer_payment SECURITY DEFINER',
  /FUNCTION public\.amend_customer_payment\(p jsonb\)[\s\S]*SECURITY DEFINER/i.test(
    correctionMigration
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
  'tahsilatı yalnızca kaydeden kullanıcı düzeltebilir',
  /payment\.collectedByUserId !== session\.userId/.test(server) &&
    /evaluatePaymentCorrection\(/.test(server)
);
check(
  'şoför yalnızca aktif seferde düzeltebilir',
  /if \(!payment\.dispatchId\) return 'NOT_AUTHORIZED';/.test(server) &&
    /if \(dispatchStatus !== 'in_transit'\) return 'DISPATCH_CLOSED';/.test(server)
);
check(
  'yönetici kendi tahsilatını yalnızca aynı UTC gününde düzeltebilir',
  /paymentUtcDate\(payment\.collectedAt\) !== getTodayDateStr\(\)/.test(server) &&
    /CORRECTION_WINDOW_CLOSED/.test(server)
);
check(
  'yönetici tahsilatı sefere bağlanamaz',
  /session\.role === 'admin' && requestedDispatchId/.test(server) &&
    /DISPATCH_NOT_ALLOWED/.test(server)
);
check(
  'yönetici şoförün tahsilatını düzeltemez',
  /payment\.collectedByUserId !== session\.userId/.test(server) &&
    /paymentCorrectionDenialResponse/.test(server)
);
check(
  'şoför görünümü yalnızca kendi tahsilatında düğme gösterir',
  /payment\.collectedByUserId === currentUser\.id/.test(driverView)
);
check(
  'sahiplik migration veritabanında zorunlu',
  /v_existing\.collected_by_user_id IS DISTINCT FROM v_actor_id/.test(
    ownershipGuardMigration
  ) && /RAISE EXCEPTION 'NOT_AUTHORIZED'/.test(ownershipGuardMigration)
);
check(
  'yönetici aynı gün kuralı migration içinde',
  /CORRECTION_WINDOW_CLOSED/.test(ownershipGuardMigration) &&
    /AT TIME ZONE 'UTC'/.test(ownershipGuardMigration)
);
check(
  'sahiplik migration denetim kaydı yazmaz',
  !/INSERT INTO public\.customer_payment_audit/i.test(ownershipGuardMigration) &&
    !/INSERT INTO public\.customer_financial_audit/i.test(ownershipGuardMigration)
);
check(
  'CORRECTION_WINDOW_CLOSED sunucu hatasına eşlenir',
  /CORRECTION_WINDOW_CLOSED/.test(dbSource) &&
    /Tahsilat yalnızca kaydedildiği gün düzeltilebilir veya iptal edilebilir/.test(
      dbSource
    )
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
    !/audits/.test(statementRules)
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
