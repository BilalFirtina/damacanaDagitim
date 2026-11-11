/**
 * Müşteri arama normalizasyonu doğrulaması.
 *
 * Çalıştır:  npx tsx scripts/verify-customer-search.ts
 *
 * SAF: yalnızca ortak arama yardımcılarını sentetik verilerle dener;
 * veritabanına erişmez ve yazma yapmaz.
 */
import {
  matchCustomerSearch,
  normalizePhoneDigits,
  normalizeSearchText,
} from "../src/services/searchText.ts";

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

const customer = {
  name: "Şükrü Çağrı IŞIK",
  address: "İstanbul, Kadıköy Moda Caddesi",
  phone: "0532 123 45 67",
  emails: ["muhasebe@ornek.com"],
};

function matches(search: string): boolean {
  return matchCustomerSearch(customer, normalizeSearchText(search));
}

console.log("\n[müşteri arama doğrulaması]\n");

console.log("1) Türkçe harf normalizasyonu");
check("İstanbul -> istanbul", normalizeSearchText("İstanbul"), "istanbul");
check("IŞIK -> isik", normalizeSearchText("IŞIK"), "isik");
check("ışık -> isik", normalizeSearchText("ışık"), "isik");
check("Şükrü Çağrı -> sukru cagri", normalizeSearchText("Şükrü Çağrı"), "sukru cagri");
check("fazla boşluklar sadeleşir", normalizeSearchText("  Ali   Veli  "), "ali veli");
check("boş değer boş metin döner", normalizeSearchText(undefined), "");
check("İ birleşik nokta bırakmaz", normalizeSearchText("İĞÜŞÖÇ"), "igusoc");

console.log("2) Büyük/küçük harf ve aksan duyarsız eşleşme");
check("istanbul -> İstanbul adres", matches("istanbul"), true);
check("ISTANBUL -> İstanbul adres", matches("ISTANBUL"), true);
check("sukru -> Şükrü", matches("sukru"), true);
check("SUKRU -> Şükrü", matches("SUKRU"), true);
check("cagri -> Çağrı", matches("cagri"), true);
check("isik -> IŞIK", matches("isik"), true);
check("kadikoy -> Kadıköy", matches("kadikoy"), true);
check("ali sonuç vermez", matches("ali"), false);

console.log("3) Telefon biçimi duyarsız eşleşme");
check("5321234567 numarayı bulur", matches("5321234567"), true);
check("0532 123 45 67 numarayı bulur", matches("0532 123 45 67"), true);
check("0532-123-45-67 numarayı bulur", matches("0532-123-45-67"), true);
check("+90 532 123 numarayı bulur", matches("+90 532 123"), true);
check("532 kısmi eşleşir", matches("532"), true);
check("999 numarayı bulmaz", matches("999"), false);
check("harfli arama telefonla eşleşmez", matches("ahmet 532"), false);
check("telefon rakamları ayrıştırılır", normalizePhoneDigits("+90 (532) 123-45-67"), "905321234567");

console.log("4) E-posta ve boş terim");
check("e-posta ile arama", matches("muhasebe@ornek.com"), true);
check("e-posta alan adı ile arama", matches("ornek.com"), true);
check("boş terim tüm listeyi döndürür", matches(""), true);
check("sadece boşluk tüm listeyi döndürür", matches("   "), true);

console.log(`\nSonuç: ${passed} geçti, ${failed} başarısız\n`);
process.exit(failed === 0 ? 0 : 1);
