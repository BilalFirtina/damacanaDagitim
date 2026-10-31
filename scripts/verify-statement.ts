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
    audits: [],
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
    audits: [],
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
    audits: [],
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
    audits: [],
    from: '2026-10-11',
    to: '2026-10-31',
  });
  check('açılış 200', r.openingBalance, 200);
  check('kapanış 200 (hareket aralık dışında)', r.closingBalance, 200);
}

console.log('5) Yetkili düzeltme bakiyeye yansır');
{
  const r = buildCustomerStatement({
    currentBalance: 150,
    deliveries: [delivery('d1', '2026-10-10', 1000, 1000)],
    audits: [
      {
        id: 1,
        changedAt: '2026-10-12T09:00:00.000Z',
        changedByUserName: 'Depo Yöneticisi',
        reason: 'Fatura düzeltmesi',
        previousBalance: 0,
        newBalance: 150,
      },
    ],
    from: '2026-10-01',
    to: '2026-10-31',
  });
  check('kapanış 150', r.closingBalance, 150);
  check('düzeltme toplamı 150', r.totalAdjustments, 150);
  check('3 hareket', r.entries.length, 3);
  check(
    'düzeltme açıklaması',
    r.entries[2].description,
    'Fatura düzeltmesi'
  );
}

console.log('6) Sıfır tutarlı kayıt hareket üretmez');
{
  const r = buildCustomerStatement({
    currentBalance: 0,
    deliveries: [delivery('d1', '2026-10-10', 0, 0)],
    audits: [],
    from: '2026-10-01',
    to: '2026-10-31',
  });
  check('hareket yok', r.entries.length, 0);
}

console.log('7) Aynı anda satış tahsilattan önce gösterilir');
{
  const r = buildCustomerStatement({
    currentBalance: 0,
    deliveries: [delivery('d1', '2026-10-10', 100, 100)],
    audits: [],
    from: '2026-10-01',
    to: '2026-10-31',
  });
  check('ilk hareket satış', r.entries[0].type, 'sale');
  check('ikinci hareket tahsilat', r.entries[1].type, 'payment');
  check('satış sonrası bakiye 100', r.entries[0].balanceAfter, 100);
  check('tahsilat sonrası bakiye 0', r.entries[1].balanceAfter, 0);
}

console.log('8) Müşteri avansı (negatif bakiye) korunur');
{
  const r = buildCustomerStatement({
    currentBalance: -250,
    deliveries: [delivery('d1', '2026-10-10', 500, 750)],
    audits: [],
    from: '2026-10-01',
    to: '2026-10-31',
  });
  check('kapanış -250', r.closingBalance, -250);
  check('satış 500', r.totalSales, 500);
  check('tahsilat 750', r.totalPayments, 750);
}

console.log('9) Teslimat dışı tahsilat, düzeltme değil tahsilat olarak sınıflanır');
{
  const r = buildCustomerStatement({
    currentBalance: 300,
    deliveries: [delivery('d1', '2026-10-05', 500, 0)],
    audits: [
      {
        id: 7,
        changedAt: '2026-10-20T12:00:00.000Z',
        changedByUserName: 'Depo Yöneticisi',
        reason: 'Tahsilat (CASH): Geçen haftaki borç',
        previousBalance: 500,
        newBalance: 300,
      },
    ],
    from: '2026-10-01',
    to: '2026-10-31',
  });
  check('tahsilat türü', r.entries[1].type, 'payment');
  check('tahsilat toplamı 200', r.totalPayments, 200);
  check('düzeltme toplamı 0', r.totalAdjustments, 0);
  check('kapanış 300', r.closingBalance, 300);
}

console.log(`\nSonuç: ${passed} başarılı, ${failed} başarısız`);
if (failed > 0) process.exit(1);
