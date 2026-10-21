import { negativeEmptyMessages } from '../src/services/emptyBalanceDisplay';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}`, detail ?? '');
  }
}

function equals(name: string, actual: unknown, expected: unknown): void {
  check(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    { actual, expected }
  );
}

console.log('\n[negative empty balance display verification]');

console.log('\n1) No negative balance');
equals(
  'sifir bakiye mesaj uretmez',
  negativeEmptyMessages({ damacana: 0, camDamacana: 0, tup: 0 }),
  []
);
equals(
  'pozitif bakiye mesaj uretmez',
  negativeEmptyMessages({ damacana: 4, camDamacana: 2, tup: 1 }),
  []
);
equals('bos bakiye mesaj uretmez', negativeEmptyMessages(undefined), []);
equals('null bakiye mesaj uretmez', negativeEmptyMessages(null), []);

console.log('\n2) Each pool');
equals(
  'negatif damacana mesaji',
  negativeEmptyMessages({ damacana: -3, camDamacana: 0, tup: 0 }),
  ['Müşteriye 3 boş damacana borcumuz var']
);
equals(
  'negatif cam damacana mesaji',
  negativeEmptyMessages({ damacana: 0, camDamacana: -2, tup: 0 }),
  ['Müşteriye 2 boş cam damacana borcumuz var']
);
equals(
  'negatif tup mesaji',
  negativeEmptyMessages({ damacana: 0, camDamacana: 0, tup: -1 }),
  ['Müşteriye 1 boş tüp borcumuz var']
);

console.log('\n3) Mixed pools');
equals(
  'negatif havuzlar ayri ve sirayla gosterilir',
  negativeEmptyMessages({ damacana: -3, camDamacana: -2, tup: -1 }),
  [
    'Müşteriye 3 boş damacana borcumuz var',
    'Müşteriye 2 boş cam damacana borcumuz var',
    'Müşteriye 1 boş tüp borcumuz var',
  ]
);
equals(
  'pozitif havuz negatif mesaja karismaz',
  negativeEmptyMessages({ damacana: 5, camDamacana: -2, tup: 1 }),
  ['Müşteriye 2 boş cam damacana borcumuz var']
);

console.log(`\nSONUC: ${passed} gecti, ${failed} basarisiz`);
if (failed > 0) process.exit(1);
