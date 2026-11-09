---
title: "EOD sebil sayisi normalizeDelivery'de dusuyordu"
author: BilalFirtina
date: 2026-11-09
branch: main
id: l-73376e37
scope: repo
status: active
src: agent
touches:
  - "src/services/api.ts#normalizeDelivery"
  - src/services/consolidatedReportRules.ts
  - src/components/admin/ConsolidatedDailyReport.tsx
---

Gun sonu ekranindaki 'Toplanan Su Sebili' 0 gorunurken konsolide rapor 1 gosteriyordu. Neden: App.tsx tum teslimatlari normalizeDelivery ile normalize ediyor; normalizeDelivery emptyContainersReceived ve emptyContainersDiff icine yalnizca damacana, camDamacana, tup, tupBuyuk, tupKucuk alanlarini kopyaliyor, sebil alanini dusuruyordu. API ve delivery_container_returns.sebil dogruydu. Cozum: normalizeDelivery sebil ve cam_damacana aliaslarini korur; hesaplama degistirilmedi. scripts/verify-delivery-normalization.ts bunu kilitler. Konsolide raporda 'Depoya Iade' bloklari sefer/plaka bazinda her soforun musteri listesinin altinda, yalnizca >0 bos ve kalan urun satirlariyla gosterilir; eski tip tup gosterilmez.
