/**
 * Verification for separate damacana / cam damacana / tup deposit pools.
 *
 * Run:  npx tsx scripts/verify-deposit-difference.ts
 *
 * This script is intentionally PURE: it exercises the extracted deposit
 * helpers with synthetic fixtures and performs NO database writes.
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
  { id: 'prod_damacana_19l', depositType: 'damacana' },
  { id: 'prod_damacana_sirma_19l', depositType: 'damacana' },
  { id: 'prod_cam_damacana', depositType: 'cam_damacana' },
  { id: 'prod_tup_12kg', depositType: 'tup' },
  { id: 'prod_tup_2kg', depositType: 'tup' },
  { id: 'prod_pet_hayat_0_5l_12', depositType: 'none' },
  { id: 'prod_bardak_karton_6_5oz_50', depositType: 'none' },
];

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
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

function delivered(...items: Array<{ productId: string; quantity: number }>) {
  return computeDeliveredDeposits(items, PRODUCTS);
}

function diff(
  deliveredCounts: { damacana: number; camDamacana: number; tup: number },
  received: Record<string, number | undefined>
) {
  return computeEmptyContainersDiff(deliveredCounts, received);
}

console.log('\n[deposit difference verification]\n');

console.log('1) Delivered deposit classification');
check(
  'Hayat plastic -> damacana only',
  delivered({ productId: 'prod_damacana_19l', quantity: 1 }),
  { damacana: 1, camDamacana: 0, tup: 0 }
);
check(
  'Sırma plastic -> damacana only',
  delivered({ productId: 'prod_damacana_sirma_19l', quantity: 1 }),
  { damacana: 1, camDamacana: 0, tup: 0 }
);
check(
  'Hayat + Sırma share the same plastic pool',
  delivered(
    { productId: 'prod_damacana_19l', quantity: 1 },
    { productId: 'prod_damacana_sirma_19l', quantity: 1 }
  ),
  { damacana: 2, camDamacana: 0, tup: 0 }
);
check(
  'Cam damacana -> camDamacana only',
  delivered({ productId: 'prod_cam_damacana', quantity: 1 }),
  { damacana: 0, camDamacana: 1, tup: 0 }
);
check(
  'Both tup products -> tup only',
  delivered(
    { productId: 'prod_tup_12kg', quantity: 1 },
    { productId: 'prod_tup_2kg', quantity: 1 }
  ),
  { damacana: 0, camDamacana: 0, tup: 2 }
);
check(
  'Mixed products stay in their own pools',
  delivered(
    { productId: 'prod_damacana_19l', quantity: 2 },
    { productId: 'prod_cam_damacana', quantity: 1 },
    { productId: 'prod_tup_12kg', quantity: 3 }
  ),
  { damacana: 2, camDamacana: 1, tup: 3 }
);
check(
  'Non-deposit products contribute to no pool',
  delivered(
    { productId: 'prod_pet_hayat_0_5l_12', quantity: 5 },
    { productId: 'prod_bardak_karton_6_5oz_50', quantity: 3 }
  ),
  ZERO
);
check(
  'Unknown product IDs are not silently attributed',
  delivered({ productId: 'does-not-exist', quantity: 5 }),
  ZERO
);
check(
  'Zero quantity contributes nothing',
  delivered({ productId: 'prod_damacana_19l', quantity: 0 }),
  ZERO
);

console.log('\n2) Delivered minus received differences');
check(
  'Plastic delivered 3, no returns -> plastic 3',
  diff({ damacana: 3, camDamacana: 0, tup: 0 }, {}),
  { damacana: 3, camDamacana: 0, tup: 0 }
);
check(
  'Cam delivered 2, no returns -> cam 2',
  diff({ damacana: 0, camDamacana: 2, tup: 0 }, {}),
  { damacana: 0, camDamacana: 2, tup: 0 }
);
check(
  'Tup delivered 2, no returns -> tup 2',
  diff({ damacana: 0, camDamacana: 0, tup: 2 }, {}),
  { damacana: 0, camDamacana: 0, tup: 2 }
);
check(
  'Plastic exact return -> zero',
  diff({ damacana: 2, camDamacana: 0, tup: 0 }, { damacana: 2 }),
  ZERO
);
check(
  'Cam exact return -> zero',
  diff({ damacana: 0, camDamacana: 2, tup: 0 }, { camDamacana: 2 }),
  ZERO
);
check(
  'Tup exact return -> zero',
  diff({ damacana: 0, camDamacana: 0, tup: 2 }, { tup: 2 }),
  ZERO
);
check(
  'Plastic over-return -> negative plastic only',
  diff({ damacana: 1, camDamacana: 0, tup: 0 }, { damacana: 3 }),
  { damacana: -2, camDamacana: 0, tup: 0 }
);
check(
  'Cam over-return -> negative cam only',
  diff({ damacana: 0, camDamacana: 1, tup: 0 }, { camDamacana: 3 }),
  { damacana: 0, camDamacana: -2, tup: 0 }
);

console.log('\n3) Cross-pool isolation');
check(
  'Cam delivered + plastic returned: plastic decreases, cam untouched',
  diff({ damacana: 0, camDamacana: 2, tup: 0 }, { damacana: 2 }),
  { damacana: -2, camDamacana: 2, tup: 0 }
);
check(
  'Plastic delivered + cam returned: cam decreases, plastic untouched',
  diff({ damacana: 2, camDamacana: 0, tup: 0 }, { camDamacana: 2 }),
  { damacana: 2, camDamacana: -2, tup: 0 }
);
check(
  'Tup delivered + cam returned: cam decreases, tup untouched',
  diff({ damacana: 0, camDamacana: 0, tup: 1 }, { camDamacana: 2 }),
  { damacana: 0, camDamacana: -2, tup: 1 }
);
check(
  'Mixed delivered + mixed returns stay independent',
  diff(
    { damacana: 2, camDamacana: 1, tup: 3 },
    { damacana: 1, camDamacana: 1, tup: 5 }
  ),
  { damacana: 1, camDamacana: 0, tup: -2 }
);
check(
  'One over-returned pool does not offset another',
  diff(
    { damacana: 0, camDamacana: 2, tup: 1 },
    { damacana: 4, camDamacana: 0, tup: 0 }
  ),
  { damacana: -4, camDamacana: 2, tup: 1 }
);

console.log('\n4) Legacy aliases and explicit zero inputs');
check(
  'Legacy cam_damacana key is treated as camDamacana',
  diff({ damacana: 0, camDamacana: 2, tup: 0 }, { cam_damacana: 2 }),
  ZERO
);
check(
  'Explicit zero received keys keep delivered values',
  diff(
    { damacana: 1, camDamacana: 1, tup: 1 },
    { damacana: 0, camDamacana: 0, tup: 0 }
  ),
  { damacana: 1, camDamacana: 1, tup: 1 }
);
check(
  'Empty received object keeps delivered values',
  diff({ damacana: 1, camDamacana: 1, tup: 1 }, {}),
  { damacana: 1, camDamacana: 1, tup: 1 }
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);

process.exit(failed === 0 ? 0 : 1);
