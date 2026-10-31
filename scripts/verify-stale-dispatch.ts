/**
 * AGENTS.md Bölüm 9.1 — Sonlandırılmamış sefer tespiti doğrulaması.
 *
 * Run:  npx tsx scripts/verify-stale-dispatch.ts
 *
 * SAF: yalnızca paylaşılan iş kurallarını sentetik verilerle çalıştırır;
 * veritabanı erişimi veya yazma işlemi yapmaz.
 */
import {
  findOldestStaleOpenDispatch,
  findStaleOpenDispatch,
  isStaleDispatch,
} from '../src/services/dispatchRules.ts';

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}\n        beklenen ${e}\n        gelen    ${a}`);
  }
}

const TODAY = '2026-10-31';

type Fixture = { id: string; date: string; driverId: string; status: string };

const fixture = (
  id: string,
  date: string,
  status: string,
  driverId = 'drv_1'
): Fixture => ({ id, date, driverId, status });

console.log('\n[sonlandırılmamış sefer doğrulaması]\n');

// ---------------------------------------------------------------------------
// 1) isStaleDispatch
// ---------------------------------------------------------------------------
console.log('1) isStaleDispatch');

check(
  'dün açık sefer eski (stale) sayılır',
  isStaleDispatch(fixture('d1', '2026-10-30', 'in_transit'), TODAY),
  true
);
check(
  'dün onay bekleyen sefer eski sayılır',
  isStaleDispatch(fixture('d2', '2026-10-30', 'pending_confirmation'), TODAY),
  true
);
check(
  'bugünün açık seferi eski sayılmaz',
  isStaleDispatch(fixture('d3', TODAY, 'in_transit'), TODAY),
  false
);
check(
  'dün kapatılmış sefer eski sayılmaz',
  isStaleDispatch(fixture('d4', '2026-10-30', 'completed'), TODAY),
  false
);
check(
  'gelecek tarihli sefer eski sayılmaz',
  isStaleDispatch(fixture('d5', '2026-11-01', 'in_transit'), TODAY),
  false
);
check('boş kayıt güvenli', isStaleDispatch(null, TODAY), false);

// ---------------------------------------------------------------------------
// 2) findStaleOpenDispatch
// ---------------------------------------------------------------------------
console.log('\n2) findStaleOpenDispatch');

const yesterdayOpen = fixture('d_yesterday', '2026-10-30', 'in_transit');
check(
  'dün açık sefer bulunur',
  findStaleOpenDispatch([yesterdayOpen], 'drv_1', TODAY)?.id,
  'd_yesterday'
);
check(
  'bugün açık sefer stale sonucuna girmez',
  findStaleOpenDispatch([fixture('d_today', TODAY, 'in_transit')], 'drv_1', TODAY),
  null
);
check(
  'kapatılmış sefer stale sonucuna girmez',
  findStaleOpenDispatch([fixture('d_closed', '2026-10-29', 'completed')], 'drv_1', TODAY),
  null
);
check(
  'başka şoförün açık seferi bu şoföre dönmez',
  findStaleOpenDispatch([fixture('d_other', '2026-10-30', 'in_transit', 'drv_2')], 'drv_1', TODAY),
  null
);

const multiple: Fixture[] = [
  fixture('d_28', '2026-10-28', 'in_transit'),
  fixture('d_30', '2026-10-30', 'pending_confirmation'),
  fixture('d_29', '2026-10-29', 'in_transit'),
  fixture('d_today', TODAY, 'in_transit'),
];
check(
  'birden fazla açık seferde en eski seçilir',
  findStaleOpenDispatch(multiple, 'drv_1', TODAY)?.id,
  'd_28'
);
check(
  'sıralama girdi sırasından bağımsızdır',
  findStaleOpenDispatch([...multiple].reverse(), 'drv_1', TODAY)?.id,
  'd_28'
);
check(
  'açık sefer yoksa null döner',
  findStaleOpenDispatch(
    [fixture('d_closed', '2026-10-30', 'completed'), fixture('d_today', TODAY, 'in_transit')],
    'drv_1',
    TODAY
  ),
  null
);
check('boş listede null döner', findStaleOpenDispatch([], 'drv_1', TODAY), null);

// ---------------------------------------------------------------------------
// 3) Yönetici görünümü: tüm şoförler arasında en eski açık sefer
// ---------------------------------------------------------------------------
console.log('\n3) findOldestStaleOpenDispatch');

const allDrivers: Fixture[] = [
  fixture('d_drv1', '2026-10-29', 'in_transit', 'drv_1'),
  fixture('d_drv2', '2026-10-27', 'pending_confirmation', 'drv_2'),
  fixture('d_today', TODAY, 'in_transit', 'drv_1'),
];
check(
  'yönetici için tüm şoförler içinde en eski açık sefer seçilir',
  findOldestStaleOpenDispatch(allDrivers, TODAY)?.id,
  'd_drv2'
);
check(
  'yönetici için açık eski sefer yoksa null döner',
  findOldestStaleOpenDispatch([fixture('d_today', TODAY, 'in_transit')], TODAY),
  null
);

// ---------------------------------------------------------------------------
// 4) Ay/yıl sınırı: YYYY-MM-DD metin karşılaştırması kronolojiktir
// ---------------------------------------------------------------------------
console.log('\n4) Tarih sınırı');

check(
  'ay sınırı doğru karşılaştırılır (09-30 < 10-01)',
  isStaleDispatch(fixture('d_prev_month', '2026-09-30', 'in_transit'), '2026-10-01'),
  true
);
check(
  'yıl sınırı doğru karşılaştırılır (2025-12-31 < 2026-01-01)',
  isStaleDispatch(fixture('d_prev_year', '2025-12-31', 'in_transit'), '2026-01-01'),
  true
);

console.log(`\nSonuç: ${passed} başarılı, ${failed} başarısız`);
if (failed > 0) process.exit(1);
