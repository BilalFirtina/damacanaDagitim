/**
 * Şoför onaylı araç stok aşımı — statik doğrulama.
 *
 * Gerçek PostgreSQL semantiği CI'daki migration testleriyle; bu betik ise
 * migration, sunucu ve arayüz bağlantılarının yerinde olduğunu doğrular.
 *
 * Run: npx tsx scripts/verify-delivery-stock-override.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve('migrations/20261116_delivery_stock_override.sql'),
  'utf8'
);
const server = fs.readFileSync(path.resolve('server.ts'), 'utf8');
const deliveryInput = fs.readFileSync(
  path.resolve('src/server/deliveryInput.ts'),
  'utf8'
);
const deliveryModal = fs.readFileSync(
  path.resolve('src/components/driver/DeliveryModal.tsx'),
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
  'deliveries.stock_override alanı ekleniyor',
  /ADD COLUMN IF NOT EXISTS stock_override BOOLEAN NOT NULL DEFAULT false/i.test(
    migration
  )
);
check(
  'stock_override_details alanı ekleniyor',
  /ADD COLUMN IF NOT EXISTS stock_override_details JSONB/i.test(migration)
);
check(
  'apply_delivery stock_override bayrağını okuyor',
  /p->>'stock_override'/i.test(migration)
);
check(
  'negatif miktar her zaman reddediliyor',
  /quantity'\)::int, 0\) < 0[\s\S]*INSUFFICIENT_VEHICLE_STOCK/i.test(migration)
);
check(
  'onaysız aşım reddediliyor',
  /jsonb_array_length\(v_override_details\) > 0 AND NOT v_stock_override[\s\S]*INSUFFICIENT_VEHICLE_STOCK/i.test(
    migration
  )
);
check(
  'aşım detayı ürün bazında saklanıyor',
  /'oversell'[\s\S]*'requested'|'requested'[\s\S]*'oversell'/i.test(migration)
);
check(
  'teslimat kaydına stock_override yazılıyor',
  /stock_override, stock_override_details/i.test(migration)
);
check(
  'sunucu allowStockOverride bayrağını kabul ediyor',
  /allowStockOverrideRaw/.test(server) && /allowStockOverride/.test(server)
);
check(
  'sunucu stok kontrolüne override iletiyor',
  /assertVehicleStockAvailable\([\s\S]*allowStockOverride[\s\S]*\)/i.test(
    server
  ) || /assertVehicleStockAvailable\([\s\S]*stockOverride === true[\s\S]*\)/i.test(server)
);
check(
  'deliveryInput stockOverride alanını taşıyor',
  /stockOverride:\s*!!allowStockOverride/.test(deliveryInput)
);
check(
  'şoför onay penceresi var',
  /Stok Aşımını Onayla/.test(deliveryModal) &&
    /Onayla ve Kaydet/.test(deliveryModal)
);
check(
  'onay sonrası allowStockOverride gönderiliyor',
  /allowStockOverride,/.test(deliveryModal)
);

console.log(`\nSonuç: ${passed} başarılı, ${failed} başarısız`);
if (failed > 0) process.exit(1);
