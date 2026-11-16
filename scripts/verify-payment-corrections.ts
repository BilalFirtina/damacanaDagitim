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
const server = fs.readFileSync(path.resolve('server.ts'), 'utf8');

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
  /dispatch\?\.status === 'in_transit'/.test(server)
);
check(
  'admin her aktif tahsilatı düzeltebilir',
  /session\.role === 'admin'/.test(server)
);
check(
  'migration tek transaction içinde',
  /BEGIN;/.test(migration) && /COMMIT;/.test(migration)
);

console.log(`\nSonuç: ${passed} başarılı, ${failed} başarısız`);
if (failed > 0) process.exit(1);
