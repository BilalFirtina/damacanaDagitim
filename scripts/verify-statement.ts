/**
 * AGENTS.md Bölüm 10.1 — Cari hesap ekstresi hesaplama doğrulaması.
 *
 * Run:  npx tsx scripts/verify-statement.ts
 *
 * SAF: yalnızca paylaşılan iş kurallarını sentetik verilerle çalıştırır;
 * veritabanı erişimi veya yazma işlemi yapmaz.
 */
import { buildCustomerStatement } from '../src/services/statementRules.ts';

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

function delivery(
  id: string,
  day: string,
  total: number,
  collected: number,
  items: Array<{ name: string; qty: number; price: number }> = []
) {
  return {
    id,
    timestamp: `${day}T10:00:00.000Z`,
    deliveredGrandTotal: total,
    collectedPayment: {
      totalCollected: collected,
      cashAmount: collected,
      posAmount: 0,
    },
    deliveredItems: items.map((i) => ({
      productId: i.name,
      productName: i.name,
      quantity: i.qty,
      unitPrice: i.price,
      lineTotal: i.qty * i.price,
    })),
  };
}

console.log('1) Tam ödeme — bakiye kapanır');
{
  const r = buildCustomerStatement({
    currentBalance: 0,
    deliveries: [delivery('d1', '2026-10-10', 1000, 1000)],
    from: '2026-10-01',
    to: '2026-10-31',
  });
  check('açılış 0', r.openingBalance, 0);
  check('kapanış 0', r.closingBalance, 0);
  check('toplam satış 1000', r.totalSales, 1000);
  check('toplam tahsilat 1000', r.totalPayments, 1000);
  check('iki hareket (satış + tahsilat)', r.entries.length, 2);
}

console.log('2) Kısmi ödeme — kalan borç kapanışa yansır');
{
  const r = buildCustomerStatement({
    currentBalance: 300,
    deliveries: [delivery('d1', '2026-10-10', 1000, 700)],
    from: '2026-10-01',
    to: '2026-10-31',
  });
  check('kapanış 300', r.closingBalance, 300);
  check('satış 1000', r.totalSales, 1000);
  check('tahsilat 700', r.totalPayments, 700);
}

console.log('3) Aralık öncesi satış açılışa yansır, aralık içi tahsilat kapatır');
{
  const r = buildCustomerStatement({
    currentBalance: 500,
    deliveries: [
      delivery('d1', '2026-09-20', 500, 0),
      delivery('d2', '2026-10-05', 0, 0),
    ],
    from: '2026-10-01',
    to: '2026-10-31',
  });
  check('açılış 500', r.openingBalance, 500);
  check('kapanış 500', r.closingBalance, 500);
  check('aralıkta hareket yok', r.entries.length, 0);
}

console.log('4) Aralık dışı hareketler açılışta korunur');
{
  const r = buildCustomerStatement({
    currentBalance: 200,
    deliveries: [delivery('d1', '2026-10-10', 1000, 800)],
    from: '2026-10-11',
    to: '2026-10-31',
  });
  check('açılış 200', r.openingBalance, 200);
  check('kapanış 200 (hareket aralık dışında)', r.closingBalance, 200);
}

console.log('5) Sıfır tutarlı kayıt hareket üretmez');
{
  const r = buildCustomerStatement({
    currentBalance: 0,
    deliveries: [delivery('d1', '2026-10-10', 0, 0)],
    from: '2026-10-01',
    to: '2026-10-31',
  });
  check('hareket yok', r.entries.length, 0);
}

console.log('6) Aynı anda satış tahsilattan önce gösterilir');
{
  const r = buildCustomerStatement({
    currentBalance: 0,
    deliveries: [delivery('d1', '2026-10-10', 100, 100)],
    from: '2026-10-01',
    to: '2026-10-31',
  });
  check('ilk hareket satış', r.entries[0].type, 'sale');
  check('ikinci hareket tahsilat', r.entries[1].type, 'payment');
  check('satış sonrası bakiye 100', r.entries[0].balanceAfter, 100);
  check('tahsilat sonrası bakiye 0', r.entries[1].balanceAfter, 0);
}

console.log('7) Müşteri avansı (negatif bakiye) korunur');
{
  const r = buildCustomerStatement({
    currentBalance: -250,
    deliveries: [delivery('d1', '2026-10-10', 500, 750)],
    from: '2026-10-01',
    to: '2026-10-31',
  });
  check('kapanış -250', r.closingBalance, -250);
  check('satış 500', r.totalSales, 500);
  check('tahsilat 750', r.totalPayments, 750);
}

console.log('8) Teslimat dışı tahsilat, aktif tahsilat kaydından tahsilat olarak sınıflanır');
{
  const r = buildCustomerStatement({
    currentBalance: 300,
    deliveries: [delivery('d1', '2026-10-05', 500, 0)],
    payments: [
      {
        id: 'p1',
        amount: 200,
        method: 'CASH',
        note: 'Geçen haftaki borç',
        collectedAt: '2026-10-20T12:00:00.000Z',
        collectedByUserName: 'Şoför',
      },
    ],
    from: '2026-10-01',
    to: '2026-10-31',
  });
  check('tahsilat türü', r.entries[1].type, 'payment');
  check('tahsilat toplamı 200', r.totalPayments, 200);
  check('kapanış 300', r.closingBalance, 300);
  check(
    'tahsilat açıklaması',
    r.entries[1].description,
    'Tahsilat (Nakit): Geçen haftaki borç'
  );
}

console.log('9) Aktif tahsilat tek kez sayılır');
{
  const r = buildCustomerStatement({
    currentBalance: 300,
    deliveries: [delivery('d1', '2026-10-05', 500, 0)],
    payments: [
      {
        id: 'p2',
        amount: 200,
        method: 'CASH',
        collectedAt: '2026-10-20T12:00:00.000Z',
        collectedByUserName: 'Şoför',
      },
    ],
    from: '2026-10-01',
    to: '2026-10-31',
  });
  check('kapanış 300', r.closingBalance, 300);
  check('tahsilat 200', r.totalPayments, 200);
  check('iki hareket', r.entries.length, 2);
}

console.log(`\nSonuç: ${passed} başarılı, ${failed} başarısız`);
if (failed > 0) process.exit(1);
