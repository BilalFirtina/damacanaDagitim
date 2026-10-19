/**
 * Verification for cam_damacana deposit classification.
 *
 * Run:  npx tsx scripts/verify-cam-damacana.ts
 *
 * This script is intentionally PURE: it exercises the extracted deposit
 * classification helpers with synthetic fixtures and performs NO database
 * writes. An optional read-only live check can be enabled with CHECK_LIVE=1
 * to print the current classification of `prod_cam_damacana` in Supabase.
 */
import {
  computeDeliveredDeposits,
  computeEmptyContainersDiff,
} from '../src/server/db.ts';

interface FixtureProduct {
  id: string;
  depositType: string;
}

const PRODUCTS: FixtureProduct[] = [
  { id: 'plastic', depositType: 'damacana' },
  { id: 'glass', depositType: 'cam_damacana' },
  { id: 'tup', depositType: 'tup' },
  { id: 'pet', depositType: 'none' },
];

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

const ZERO = { damacana: 0, camDamacana: 0, tup: 0 };

console.log('\n[cam_damacana deposit classification verification]\n');

// 1 & 3. Delivery classification is preserved by canonical deposit_type (no name logic).
console.log('1) Delivery deposit attribution');
check(
  'glass -> camDamacana, plastic -> damacana, tup -> tup, pet -> none',
  computeDeliveredDeposits(
    [
      { productId: 'glass', quantity: 2 },
      { productId: 'plastic', quantity: 1 },
      { productId: 'tup', quantity: 1 },
      { productId: 'pet', quantity: 5 },
    ],
    PRODUCTS
  ),
  { damacana: 1, camDamacana: 2, tup: 1 }
);

// 2. Returning a glass damacana only reduces the glass outstanding count.
console.log('\n2) Glass return isolation');
check(
  'delivered glass 2, returned 1 glass -> camDamacana 1 (plastic untouched)',
  computeEmptyContainersDiff({ damacana: 0, camDamacana: 2, tup: 0 }, { camDamacana: 1 }),
  { damacana: 0, camDamacana: 1, tup: 0 }
);

// 3. Returning a plastic damacana only reduces the plastic outstanding count.
console.log('\n3) Plastic return isolation');
check(
  'delivered plastic 2, returned 1 plastic -> damacana 1 (glass untouched)',
  computeEmptyContainersDiff({ damacana: 2, camDamacana: 0, tup: 0 }, { damacana: 1 }),
  { damacana: 1, camDamacana: 0, tup: 0 }
);

// 4. Plastic returns never offset glass liabilities and vice versa.
console.log('\n4) Cross-type isolation');
check(
  'glass 2 + plastic 2 delivered, 2 plastic returned -> plastic 0, glass 2',
  computeEmptyContainersDiff({ damacana: 2, camDamacana: 2, tup: 0 }, { damacana: 2 }),
  { damacana: 0, camDamacana: 2, tup: 0 }
);

// 5. Other deposit types are unaffected.
console.log('\n5) Other deposit types unaffected');
check(
  'tup 3 delivered, 1 returned -> tup 2, damacana/camDamacana 0',
  computeEmptyContainersDiff({ damacana: 0, camDamacana: 0, tup: 3 }, { tup: 1 }),
  { damacana: 0, camDamacana: 0, tup: 2 }
);

// 6. Legacy `cam_damacana` key in received payload is treated as camDamacana.
console.log('\n6) Legacy key alias');
check(
  "received { cam_damacana: 2 } is handled like { camDamacana: 2 }",
  computeEmptyContainersDiff({ damacana: 0, camDamacana: 2, tup: 0 }, { cam_damacana: 2 }),
  { damacana: 0, camDamacana: 0, tup: 0 }
);

// 7. Unknown product IDs are not silently attributed to any deposit bucket.
console.log('\n7) Unknown product ignored by helper (validated by server separately)');
check(
  'unknown product contributes to no bucket',
  computeDeliveredDeposits([{ productId: 'does-not-exist', quantity: 5 }], PRODUCTS),
  ZERO
);

// 8. Non-deposit products never accumulate deposit balances.
console.log('\n8) Non-deposit product has no deposit effect');
check(
  'pet product only -> all zero',
  computeDeliveredDeposits([{ productId: 'pet', quantity: 10 }], PRODUCTS),
  ZERO
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);

if (process.env.CHECK_LIVE === '1') {
  // Read-only: prints the live classification of prod_cam_damacana. No writes.
  try {
    const { getProducts } = await import('../src/server/db.ts');
    const products = await getProducts();
    const cam = products.find((p) => p.id === 'prod_cam_damacana');
    console.log('[live check, read-only] prod_cam_damacana =>', cam
      ? { id: cam.id, name: cam.name, depositType: cam.depositType }
      : 'NOT FOUND');
    if (cam && cam.depositType !== 'cam_damacana') {
      console.log('  NOTE: migration not yet applied (deposit_type is still not cam_damacana).');
    }
  } catch (err: any) {
    console.log('[live check] skipped:', err?.message || err);
  }
}

process.exit(failed === 0 ? 0 : 1);
