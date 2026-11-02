/**
 * 23:00 Türkiye saati zamanlama doğrulaması.
 *
 * Run:  npx tsx scripts/verify-retention-schedule.ts
 */
import { getNext2300Time } from '../src/services/dateWindow.ts';

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

function minutesUntil(nowIso: string): number {
  return Math.round(getNext2300Time(new Date(nowIso)).msUntil / 60000);
}

console.log('1) Türkiye saatiyle 23:00 hedefi (UTC+3)');
check(
  '13:00 TR -> aynı gün 23:00 TR (20:00Z)',
  getNext2300Time(new Date('2026-11-02T10:00:00.000Z')).nextDate.toISOString(),
  '2026-11-02T20:00:00.000Z'
);
check('13:00 TR -> 10 saat', minutesUntil('2026-11-02T10:00:00.000Z'), 600);
check(
  '22:59 TR -> 1 dakika sonra',
  getNext2300Time(new Date('2026-11-02T19:59:00.000Z')).nextDate.toISOString(),
  '2026-11-02T20:00:00.000Z'
);
check('22:59 TR -> 1 dakika', minutesUntil('2026-11-02T19:59:00.000Z'), 1);

console.log('2) 23:00 ve sonrası bir sonraki güne kayar');
check(
  'tam 23:00 TR -> ertesi gün 20:00Z',
  getNext2300Time(new Date('2026-11-02T20:00:00.000Z')).nextDate.toISOString(),
  '2026-11-03T20:00:00.000Z'
);
check('tam 23:00 TR -> 24 saat', minutesUntil('2026-11-02T20:00:00.000Z'), 1440);
check(
  '00:00 TR -> ertesi gün 23:00 TR',
  getNext2300Time(new Date('2026-11-02T21:00:00.000Z')).nextDate.toISOString(),
  '2026-11-03T20:00:00.000Z'
);
check('00:00 TR -> 23 saat', minutesUntil('2026-11-02T21:00:00.000Z'), 1380);

console.log('3) Görünen metin');
{
  const result = getNext2300Time(new Date('2026-11-02T10:00:00.000Z'));
  check('tarih ve saat görünür', result.formatted.startsWith('2026-11-02 23:00'), true);
  check('Türkiye saati belirtilir', result.formatted.includes('Türkiye saati'), true);
}

console.log(`\nSonuç: ${passed} başarılı, ${failed} başarısız`);
if (failed > 0) process.exit(1);
