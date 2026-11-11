---
title: Konsolide raporda damacana/cam satır ayrımı
author: BilalFirtina
date: 2026-11-11
branch: main
id: l-5d4c0b43
scope: repo
status: active
src: agent
touches:
  - src/components/admin/ConsolidatedDailyReport.tsx
---

Konsolide raporun IV. bölümünde (şoför bazında müşteri dökümü) plastik damacana ile cam damacana aynı hücrede alt alta gösterilmemeli. Kullanıcı beklentisi gerçek tablo satırı: plastik için bir <tr>, cam için altında ikinci <tr>; müşteri adı her iki satırda tekrar eder, adres yalnızca ilk satırda kalır. Tutar, tahsilat, cari borç, not, saat, sıra no ve teslim edilen ürünler rowSpan ile iki satırı kapsar; böylece finansal değerler mükerrer yazılmaz.

Dolu sütununda plastik adet düz sayı, cam için "C.D - x". Boş sütununda plastik adet düz sayı, cam için "C.B - x". Sadece bir tür varsa tek satır; ikisi de yoksa "-" satırı. Mobil kart görünümü değişmez; orada Dolu/Boş değerleri ayrı bloklarda zaten görünür.

Bu, da6cccb commit'indeki "her ürün ayrı satırda" ifadesinin hücre içi blok olarak uygulanmasının düzeltmesidir; beklenen tablo satırıydı. Hesaplama katmanına (consolidatedReportRules.ts) dokunulmadı; damacanaFull/camDamacanaFull zaten ayrı toplanıyor.
