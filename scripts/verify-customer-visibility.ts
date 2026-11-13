/**
 * AGENTS.md 6.1 — Peşin / faturalı müşteri finansal görünürlüğü.
 *
 * Run:  npx tsx scripts/verify-customer-visibility.ts
 */
import {
  isAccountCustomerDelivery,
  maskCustomerFinancialsForDriver,
} from '../src/services/customerVisibility.ts';
import type { Customer } from '../src/types/index.ts';

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

function customer(isAccountCustomer: boolean): Customer {
  return {
    id: 'c1',
    name: 'Test Müşteri',
    phone: '05000000000',
    address: 'Test',
    emails: [],
    isAccountCustomer,
    currentBalanceTL: 500,
    emptyDepositBalance: { damacana: 2, camDamacana: 1, tupBuyuk: 3, tupKucuk: 2, sebil: 1 },
    customPrices: {},
    notes: '',
    createdDate: '2026-11-01',
  };
}

console.log('1) Faturalı müşteri');
check(
  'yönetici bakiyeyi görür',
  maskCustomerFinancialsForDriver(customer(true), { role: 'admin' }).currentBalanceTL,
  500
);
check(
  'şoför bakiyeyi göremez',
  maskCustomerFinancialsForDriver(customer(true), { role: 'driver' }).currentBalanceTL,
  0
);
check(
  'şoför emanet kalemlerini görür',
  maskCustomerFinancialsForDriver(customer(true), { role: 'driver' }).emptyDepositBalance,
  { damacana: 2, camDamacana: 1, tupBuyuk: 3, tupKucuk: 2, sebil: 1 }
);

console.log('2) Peşin müşteri');
check(
  'şoför bakiyeyi görür',
  maskCustomerFinancialsForDriver(customer(false), { role: 'driver' }).currentBalanceTL,
  500
);
check(
  'yönetici bakiyeyi görür',
  maskCustomerFinancialsForDriver(customer(false), { role: 'admin' }).currentBalanceTL,
  500
);

console.log('3) Oturum yok (iç çağrı)');
check(
  'maskeleme yapılmaz',
  maskCustomerFinancialsForDriver(customer(true), undefined).currentBalanceTL,
  500
);

console.log('4) Teslimat müşteri türü');
check(
  'sunucu işareti faturalı',
  isAccountCustomerDelivery(
    { customerId: 'c1', isAccountCustomer: true },
    [customer(false)]
  ),
  true
);
check(
  'sunucu işareti peşin',
  isAccountCustomerDelivery(
    { customerId: 'c1', isAccountCustomer: false },
    [customer(true)]
  ),
  false
);
check(
  'işaret yoksa müşteri listesinden faturalı',
  isAccountCustomerDelivery({ customerId: 'c1' }, [customer(true)]),
  true
);
check(
  'işaret yoksa müşteri listesinden peşin',
  isAccountCustomerDelivery({ customerId: 'c1' }, [customer(false)]),
  false
);

console.log(`\nSonuç: ${passed} başarılı, ${failed} başarısız`);
if (failed > 0) process.exit(1);
