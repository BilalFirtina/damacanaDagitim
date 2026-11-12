import {
  DeliveryInputError,
  normalizeDispenserReturnDetails,
} from '../src/server/deliveryInput';

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

function rejects(name: string, action: () => unknown, expectedMessage: string): void {
  try {
    action();
    check(name, false, 'hata bekleniyordu');
  } catch (error: any) {
    check(
      name,
      error instanceof DeliveryInputError &&
        String(error.message || '').includes(expectedMessage),
      { name: error?.name, message: error?.message }
    );
  }
}

console.log('\n[sebil iade detaylari dogrulamasi]');

console.log('\n1) Bos ve gecersiz girdiler');
equals('tanimsiz girdi bos dizi', normalizeDispenserReturnDetails(undefined, 2), []);
equals('null girdi bos dizi', normalizeDispenserReturnDetails(null, 2), []);
equals('bos dizi', normalizeDispenserReturnDetails([], 2), []);
equals(
  'tamamen bos satirlar atlanir',
  normalizeDispenserReturnDetails(
    [
      { brand: '  ', model: '', note: '  ' },
      { brand: 'Arçelik', model: '', note: '' },
    ],
    2
  ),
  [{ brand: 'Arçelik', model: '', note: null }]
);
rejects(
  'dizi olmayan girdi reddedilir',
  () => normalizeDispenserReturnDetails({ brand: 'Arçelik' }, 1),
  'geçersiz'
);
rejects(
  'nesne olmayan satir reddedilir',
  () => normalizeDispenserReturnDetails(['Arçelik'], 1),
  'geçersiz'
);

console.log('\n2) Serbest metin normalizasyonu');
equals(
  'marka/model/aciklama kirpilir ve Turkce korunur',
  normalizeDispenserReturnDetails(
    [{ brand: '  Arçelik ', model: ' 1200 A ', note: '  Mutfaktan alındı  ' }],
    1
  ),
  [{ brand: 'Arçelik', model: '1200 A', note: 'Mutfaktan alındı' }]
);
equals(
  'sadece aciklama kabul edilir',
  normalizeDispenserReturnDetails([{ note: 'Musluk kırık' }], 1),
  [{ brand: '', model: '', note: 'Musluk kırık' }]
);
equals(
  'istemciden gelen adet yok sayilir',
  normalizeDispenserReturnDetails(
    [{ brand: 'Vestel', model: 'Mini', quantity: 5 }],
    1
  ),
  [{ brand: 'Vestel', model: 'Mini', note: null }]
);

console.log('\n3) Adet ve uzunluk sinirlari');
rejects(
  'iade adedinden fazla detay reddedilir',
  () =>
    normalizeDispenserReturnDetails(
      [{ brand: 'A' }, { brand: 'B' }],
      1
    ),
  'fazla detay'
);
rejects(
  '61 karakter marka reddedilir',
  () =>
    normalizeDispenserReturnDetails([{ brand: 'x'.repeat(61) }], 1),
  'Marka en fazla 60'
);
rejects(
  '301 karakter aciklama reddedilir',
  () =>
    normalizeDispenserReturnDetails([{ note: 'x'.repeat(301) }], 1),
  'Açıklama en fazla 300'
);

console.log(
  `\nSONUC: ${passed} gecti, ${failed} basarisiz`
);
if (failed > 0) process.exit(1);
