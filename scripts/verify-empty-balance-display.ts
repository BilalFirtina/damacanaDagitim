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
  negativeEmptyMessages({ damacana: 0, camDamacana: 0, tupBuyuk: 0, tupKucuk: 0 }),
  []
);
equals(
  'pozitif bakiye mesaj uretmez',
  negativeEmptyMessages({ damacana: 4, camDamacana: 2, tupBuyuk: 1, tupKucuk: 1 }),
  []
);
equals('bos bakiye mesaj uretmez', negativeEmptyMessages(undefined), []);
equals('null bakiye mesaj uretmez', negativeEmptyMessages(null), []);

console.log('\n2) Each pool');
equals(
  'negatif damacana mesaji',
  negativeEmptyMessages({ damacana: -3, camDamacana: 0 }),
  ['Müşteriye 3 boş damacana borcumuz var']
);
equals(
  'negatif cam damacana mesaji',
  negativeEmptyMessages({ damacana: 0, camDamacana: -2 }),
  ['Müşteriye 2 boş cam damacana borcumuz var']
);
equals(
  'negatif buyuk tup mesaji',
  negativeEmptyMessages({ damacana: 0, camDamacana: 0, tupBuyuk: -1, tupKucuk: 0 }),
  ['Müşteriye 1 boş büyük tüp borcumuz var']
);
equals(
  'negatif kucuk tup mesaji',
  negativeEmptyMessages({ damacana: 0, camDamacana: 0, tupBuyuk: 0, tupKucuk: -2 }),
  ['Müşteriye 2 boş küçük tüp borcumuz var']
);

console.log('\n3) Mixed pools');
equals(
  'negatif havuzlar ayri ve sirayla gosterilir',
  negativeEmptyMessages({ damacana: -3, camDamacana: -2, tupBuyuk: -1, tupKucuk: -1 }),
  [
    'Müşteriye 3 boş damacana borcumuz var',
    'Müşteriye 2 boş cam damacana borcumuz var',
    'Müşteriye 1 boş büyük tüp borcumuz var',
    'Müşteriye 1 boş küçük tüp borcumuz var',
  ]
);
equals(
  'pozitif havuz negatif mesaja karismaz',
  negativeEmptyMessages({ damacana: 5, camDamacana: -2, tupKucuk: 1 }),
  ['Müşteriye 2 boş cam damacana borcumuz var']
);

console.log(`\nSONUC: ${passed} gecti, ${failed} basarisiz`);
if (failed > 0) process.exit(1);
