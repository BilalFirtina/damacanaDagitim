---
title: "Ürün-miktar gösterim kuralı"
author: BilalFirtina
date: 2026-11-10
branch: main
id: l-0c4d86ee
scope: repo
status: active
src: agent
touches:
  - src/components/driver/MorningLoadCard.tsx
  - src/components/admin/ConsolidatedDailyReport.tsx
  - src/services/consolidatedReportRules.ts
  - src/components/admin/VehicleLoadManagement.tsx
  - src/components/admin/DailyReportsView.tsx
---

Ürün adı ile miktar aynı satırda/rozet içinde gösteriliyorsa sıra her zaman 'Ürün Adı - Miktar Birim' olmalı. Birim, ürün kartındaki unit alanından gelir; koda gömülmez. MorningLoadCard.tsx ve VehicleLoadManagement.tsx yükleme rozetlerinde ürün adı split(' ')[0] ile markaya indirgenmemeli; tam ad kullanılmalı. ConsolidatedDailyReport.tsx içindeki LinesCell ve DailyReportsView.tsx ürün hücreleri her ürünü ayrı blok satırda gösterir; iki ürün asla aynı satıra gelmez. Örnek: 'Hayat Damacana - 116 Adet', 'Bardak Su (60'lı Koli) - 4 Koli'.
