import {
  buildCustomerDispenserSuggestions,
  CustomerDispenserValidationError,
  normalizeCustomerDispenserInput,
  summarizeCustomerDispenserQuantity,
} from '../src/services/customerDispenserRules';

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
  check(name, JSON.stringify(actual) === JSON.stringify(expected), {
    actual,
    expected,
  });
}

function rejects(
  name: string,
  action: () => unknown,
  expectedMessage?: string
): void {
  try {
    action();
    check(name, false, 'hata bekleniyordu');
  } catch (error: any) {
    const isValidation = error instanceof CustomerDispenserValidationError;
    const messageMatches =
      !expectedMessage || String(error?.message || '').includes(expectedMessage);
    check(name, isValidation && messageMatches, {
      name: error?.name,
      message: error?.message,
    });
  }
}

console.log('\n[musteri sebil kurallari dogrulamasi]');

console.log('\n1) Normalizasyon');
equals(
  'marka, model ve aciklama kirpilir',
  normalizeCustomerDispenserInput({
    brand: '  Hayat ',
    model: '  HT-200  ',
    quantity: 2,
    note: '  mutfakta  ',
  }),
  { brand: 'Hayat', model: 'HT-200', quantity: 2, note: 'mutfakta' }
);
equals(
  'bos aciklama null olur',
  normalizeCustomerDispenserInput({
    brand: 'Sırma',
    model: 'Mini',
    quantity: 1,
    note: '   ',
  }),
  { brand: 'Sırma', model: 'Mini', quantity: 1, note: null }
);
equals(
  'aciklama verilmezse null olur',
  normalizeCustomerDispenserInput({
    brand: 'Sırma',
    model: 'Mini',
    quantity: 1,
  }),
  { brand: 'Sırma', model: 'Mini', quantity: 1, note: null }
);
equals(
  '60 karakter marka ve model kabul edilir',
  normalizeCustomerDispenserInput({
    brand: 'a'.repeat(60),
    model: 'b'.repeat(60),
    quantity: 1,
  }),
  {
    brand: 'a'.repeat(60),
    model: 'b'.repeat(60),
    quantity: 1,
    note: null,
  }
);
check(
  '300 karakter aciklama kabul edilir',
  normalizeCustomerDispenserInput({
    brand: 'Hayat',
    model: 'HT-200',
    quantity: 1,
    note: 'n'.repeat(300),
  }).note?.length === 300
);
equals(
  'Turkce karakterler korunur',
  normalizeCustomerDispenserInput({
    brand: 'Şırma Çelik',
    model: 'Güneş',
    quantity: 3,
    note: 'Çatı katı',
  }),
  {
    brand: 'Şırma Çelik',
    model: 'Güneş',
    quantity: 3,
    note: 'Çatı katı',
  }
);

console.log('\n2) Zorunlu alanlar');
rejects(
  'marka zorunlu',
  () => normalizeCustomerDispenserInput({ model: 'Mini', quantity: 1 }),
  'Marka zorunludur'
);
rejects(
  'model zorunlu',
  () => normalizeCustomerDispenserInput({ brand: 'Sırma', quantity: 1 }),
  'Model zorunludur'
);
rejects(
  'bos marka reddedilir',
  () =>
    normalizeCustomerDispenserInput({ brand: '  ', model: 'Mini', quantity: 1 }),
  'Marka zorunludur'
);
rejects(
  'bos model reddedilir',
  () =>
    normalizeCustomerDispenserInput({ brand: 'Sırma', model: '  ', quantity: 1 }),
  'Model zorunludur'
);
rejects(
  'nesne olmayan girdi reddedilir',
  () => normalizeCustomerDispenserInput(null),
  'geçersiz'
);

console.log('\n3) Uzunluk sinirlari');
rejects(
  '61 karakter marka reddedilir',
  () =>
    normalizeCustomerDispenserInput({
      brand: 'a'.repeat(61),
      model: 'Mini',
      quantity: 1,
    }),
  'en fazla 60'
);
rejects(
  '61 karakter model reddedilir',
  () =>
    normalizeCustomerDispenserInput({
      brand: 'Sırma',
      model: 'b'.repeat(61),
      quantity: 1,
    }),
  'en fazla 60'
);
rejects(
  '301 karakter aciklama reddedilir',
  () =>
    normalizeCustomerDispenserInput({
      brand: 'Sırma',
      model: 'Mini',
      quantity: 1,
      note: 'n'.repeat(301),
    }),
  'en fazla 300'
);
rejects(
  'metin olmayan aciklama reddedilir',
  () =>
    normalizeCustomerDispenserInput({
      brand: 'Sırma',
      model: 'Mini',
      quantity: 1,
      note: 5,
    }),
  'metin olmalıdır'
);

console.log('\n4) Adet kurallari');
check(
  'adet 1 kabul edilir',
  normalizeCustomerDispenserInput({
    brand: 'Sırma',
    model: 'Mini',
    quantity: 1,
  }).quantity === 1
);
check(
  'buyuk tam sayi adet kabul edilir',
  normalizeCustomerDispenserInput({
    brand: 'Sırma',
    model: 'Mini',
    quantity: 999,
  }).quantity === 999
);
rejects(
  'sifir adet reddedilir',
  () =>
    normalizeCustomerDispenserInput({
      brand: 'Sırma',
      model: 'Mini',
      quantity: 0,
    }),
  '1 veya daha büyük'
);
rejects(
  'negatif adet reddedilir',
  () =>
    normalizeCustomerDispenserInput({
      brand: 'Sırma',
      model: 'Mini',
      quantity: -2,
    }),
  '1 veya daha büyük'
);
rejects(
  'ondalik adet reddedilir',
  () =>
    normalizeCustomerDispenserInput({
      brand: 'Sırma',
      model: 'Mini',
      quantity: 1.5,
    }),
  'tam sayı'
);
rejects(
  'metin adet reddedilir',
  () =>
    normalizeCustomerDispenserInput({
      brand: 'Sırma',
      model: 'Mini',
      quantity: '2',
    }),
  'tam sayı'
);
rejects(
  'eksik adet reddedilir',
  () =>
    normalizeCustomerDispenserInput({
      brand: 'Sırma',
      model: 'Mini',
    }),
  'tam sayı'
);

console.log('\n5) Oneriler ve toplam');
equals(
  'marka ve modeller tekillestirilip Turkce siralanir',
  buildCustomerDispenserSuggestions([
    { brand: 'Sırma', model: 'Mini' },
    { brand: 'Hayat', model: 'HT-200' },
    { brand: 'Sırma', model: 'HT-200' },
    { brand: '  ', model: ' ' },
  ]),
  {
    brands: ['Hayat', 'Sırma'],
    models: ['HT-200', 'Mini'],
  }
);
equals(
  'bos oneri listesi',
  buildCustomerDispenserSuggestions([]),
  { brands: [], models: [] }
);
check(
  'sebil adetleri toplanir',
  summarizeCustomerDispenserQuantity([
    { quantity: 2 },
    { quantity: 3 },
    { quantity: 1 },
  ]) === 6
);
check(
  'bos listede toplam sifirdir',
  summarizeCustomerDispenserQuantity([]) === 0
);

console.log(`\nSONUC: ${passed} gecti, ${failed} basarisiz`);
if (failed > 0) process.exit(1);
