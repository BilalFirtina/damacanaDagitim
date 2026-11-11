---
title: "Konsolide rapor: nihai sütun oranları ve ürün adlarında parantez temizliği"
author: BilalFirtina
date: 2026-11-11
branch: main
id: l-412b9b6f
scope: repo
status: active
replaces: l-89268b68
src: agent
touches:
  - src/components/admin/ConsolidatedDailyReport.tsx
---

Konsolide raporun IV. bölümünde nihai sütun oranları: No %3, Saat %5, Müşteri Adı %20, Dolu %7, Boş %7, Teslim Edilen Ürünler %30, Tahsilat %9, Not %19. Oranlar colgroup ile sabit; print:table-auto yok, print:w-auto yok. Müşteri sütunu masaüstü/PDF 14px (text-sm), mobil kart 12px (text-[12px]). Teslim Edilen Ürünler sütununda ürün adlarının parantez ve içeriği stripParentheses ile silinir; bu yalnızca konsolide rapor görünümünde, ürün kayıtları ve diğer raporlar etkilenmez. A4 718px içerikte 'Karton Bardak 6.5 oz - 3000 Koli' dahil tüm satırlar tek satıra sığdı (Chrome headless).
