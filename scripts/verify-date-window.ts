/**
 * Verification for date-boundary logic (UTC work-day definition).
 *
 * Run:  npx tsx scripts/verify-date-window.ts
 *
 * PURE: exercises the shared date helpers with synthetic fixtures and performs
 * NO database access or writes.
 */
import {
  todayUtcDateStr,
  utcDayQueryWindow,
  isSameUtcDate,
} from '../src/services/dateWindow.ts';

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
    console.error(`  FAIL  ${name}\n        expected ${e}\n        actual   ${a}`);
  }
}

console.log('\n[date-boundary verification]\n');

// 1. todayUtcDateStr uses the UTC calendar day.
console.log('1) Today definition (UTC)');
check(
  '23:30 UTC stays on the same UTC day',
  todayUtcDateStr(new Date('2026-10-19T23:30:00.000Z')),
  '2026-10-19'
);
check(
  '00:00 UTC rolls to the next UTC day',
  todayUtcDateStr(new Date('2026-10-20T00:00:00.000Z')),
  '2026-10-20'
);
check(
  'Turkey local +03:00 belongs to the previous UTC day',
  todayUtcDateStr(new Date('2026-10-20T02:00:00+03:00')),
  '2026-10-19'
);

// 2. Query window bounds.
console.log('2) Server-side query window');
check(
  'window is null for an invalid date',
  utcDayQueryWindow('not-a-date'),
  null
);
check(
  'window spans one day back to two days forward (UTC)',
  utcDayQueryWindow('2026-10-19'),
  { lower: '2026-10-18T00:00:00.000Z', upper: '2026-10-21T00:00:00.000Z' }
);

// 3. The window must contain any instant whose UTC calendar day is the target,
//    even for extreme local offsets (UTC-12 .. UTC+14).
const win = utcDayQueryWindow('2026-10-19')!;
const targetDayInstants = [
  '2026-10-19T00:00:00.000Z', // start of UTC day
  '2026-10-19T23:59:59.999Z', // end of UTC day
  '2026-10-19T12:00:00+14:00', // 2026-10-18T22:00Z (UTC+14 local = the 19th)
  '2026-10-19T01:00:00-12:00', // 2026-10-19T13:00Z (UTC-12 local = the 19th)
];
console.log('3) Window covers local offsets');
for (const iso of targetDayInstants) {
  const t = new Date(iso).toISOString();
  check(
    `${iso} is within window`,
    t >= win.lower && t < win.upper,
    true
  );
}
check(
  'a timestamp just outside the window is excluded',
  new Date('2026-10-17T23:59:59.999Z').toISOString() >= win.lower,
  false
);

// 4. Exact day match (in-memory guard).
console.log('4) Exact UTC day match');
check(
  'timestamp with Z on the target date matches',
  isSameUtcDate('2026-10-19T23:59:59.999Z', '2026-10-19'),
  true
);
check(
  'timestamp on the previous date does not match',
  isSameUtcDate('2026-10-18T23:59:59.999Z', '2026-10-19'),
  false
);
check(
  'midnight rollover: 00:00 belongs to the new day',
  isSameUtcDate('2026-10-20T00:00:00.000Z', '2026-10-20'),
  true
);
check(
  'empty timestamp never matches',
  isSameUtcDate('', '2026-10-19'),
  false
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
