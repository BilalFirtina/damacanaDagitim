---
title: Müşteri aramasında Türkçe karakter normalizasyonu
author: BilalFirtina
date: 2026-11-11
branch: main
id: l-5eda1ef1
scope: repo
status: active
src: agent
touches:
  - src/components/admin/CustomersManagement.tsx
  - src/components/driver/DeliveryModal.tsx
  - src/components/driver/DriverPaymentModal.tsx
---

Müşteri arama kutuları `toLowerCase()` kullandığı için Türkçe I/İ eşleşmesi bozuktu: "istanbul" araması "İstanbul" kaydını, "ışık" araması "IŞIK" kaydını bulmuyordu. Ayrıca aksanlı harfler katlanmıyordu ("sukru" ≠ "Şükrü") ve telefon biçimi farklıysa arama tutmuyordu.

Çözüm `src/services/searchText.ts` içinde ortaklaştırıldı: `normalizeSearchText` önce `toLocaleLowerCase("tr-TR")` yapar, U+0307 birleşik noktasını temizler, ı/İ→i, ş→s, ğ→g, ü→u, ö→o, ç→c katlar ve boşlukları sadeleştirir. Telefon araması `matchCustomerSearch` içinde rakam bazlıdır; baştaki 0 ile +90/0090 ülke kodu normalize edilir, böylece "0532 123 45 67", "5321234567" ve "+90 532 123" aynı kaydı bulur.

Admin müşteri rehberi, şoför teslimat ekranı ve şoför tahsilat ekranı bu yardımcıya geçirildi. Kelime sırası/yazım hatası toleransı (fuzzy) bilerek eklenmedi; yalnızca harf, boşluk ve telefon biçimi normalize edilir. Ürün aramasındaki `normalizeProductSearch` davranışı değişmedi. Yönetici listesinde sonuç yokken boş durum metni eklendi; sekme filtresi aktifse ipucu gösterilir.
