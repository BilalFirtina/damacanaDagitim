// Müşteri aramaları için Türkçe karakter ve büyük/küçük harf duyarsız ortak
// normalizasyon. Ürün aramasındaki normalizeProductSearch ile aynı dil ayarını
// kullanır; farklı olarak aksanlı harfleri de katlar.

const TR_LETTER_FOLD: Record<string, string> = {
  ı: "i",
  İ: "i",
  ş: "s",
  ğ: "g",
  ü: "u",
  ö: "o",
  ç: "c",
  â: "a",
  î: "i",
  û: "u",
};

/**
 * Aramada kullanılacak metni sadeleştirir:
 * - Türkçe kurallarıyla küçük harfe çevirir (I -> ı, İ -> i)
 * - Aksanlı harfleri katlar (ı/İ -> i, ş -> s, ğ -> g, ü -> u, ö -> o, ç -> c)
 * - Sonradan oluşabilecek birleşik noktayı (U+0307) kaldırır
 * - Boşlukları tek boşluğa indirir ve baştaki/sondaki boşlukları atar
 */
export function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\u0307/g, "")
    .replace(/[ışğüöçâîû]/g, (letter) => TR_LETTER_FOLD[letter] ?? letter)
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePhoneDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function canonicalPhoneDigits(value: unknown): string {
  let digits = normalizePhoneDigits(value);
  if (digits.startsWith("0090")) digits = digits.slice(4);
  else if (digits.startsWith("90") && digits.length > 10) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length > 1) digits = digits.slice(1);
  return digits;
}

function phoneSearchVariants(normalizedTerm: string): string[] {
  const digits = normalizePhoneDigits(normalizedTerm);
  if (!digits) return [];
  const variants = new Set<string>([digits]);
  if (digits.startsWith("0") && digits.length > 1) variants.add(digits.slice(1));

  // Kullanıcı ülke kodunu yazarak aradığında yerel numarayla eşleşsin.
  const compact = normalizedTerm.replace(/[\s().-]/g, "");
  if (compact.startsWith("+90") && digits.length > 2) variants.add(digits.slice(2));
  if (compact.startsWith("0090") && digits.length > 4) variants.add(digits.slice(4));

  return Array.from(variants).filter((variant) => variant.length > 0);
}

export interface CustomerSearchFields {
  name?: string;
  address?: string;
  phone?: string;
  emails?: string[];
}

function includesNormalized(value: unknown, normalizedTerm: string): boolean {
  return normalizeSearchText(value).includes(normalizedTerm);
}

/**
 * Normalize edilmiş arama terimini müşteri alanlarında arar.
 * Ad, adres ve e-postada harf katlamalı metin araması; telefon numarasında
 * yalnızca rakam karşılaştırması yapılır. Böylece "0532 123 45 67",
 * "0532-123-45-67" ve "5321234567" birbirini bulur.
 */
export function matchCustomerSearch(
  customer: CustomerSearchFields,
  normalizedTerm: string,
): boolean {
  if (!normalizedTerm) return true;

  if (
    includesNormalized(customer.name, normalizedTerm) ||
    includesNormalized(customer.address, normalizedTerm) ||
    (customer.emails ?? []).some((email) =>
      includesNormalized(email, normalizedTerm),
    )
  ) {
    return true;
  }

  const digits = normalizePhoneDigits(normalizedTerm);
  const isPhoneLike = /^[\d\s()+.-]+$/.test(normalizedTerm);
  if (isPhoneLike && digits.length > 0) {
    const phoneDigits = canonicalPhoneDigits(customer.phone);
    if (
      phoneSearchVariants(normalizedTerm).some((variant) =>
        phoneDigits.includes(variant),
      )
    ) {
      return true;
    }
  }

  return false;
}
