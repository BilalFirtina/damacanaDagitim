---
title: "Sebil kategorisi 'Sebil & Pompa' oldu, depozitosuz Pompa urunu eklendi"
author: BilalFirtina
date: 2026-11-12
branch: main
id: l-d4a9e504
scope: repo
status: active
src: agent
touches:
  - src/types/index.ts
  - src/server/db.ts
  - scripts/verify-product-ordering.ts
---

Veritabaninda product_categories.sebil.title_tr 'Sebil & Pompa' yapildi; kod 'sebil' aynen kaldi. products tablosuna prod_pompa eklendi: category sebil, unit Adet, default_unit_price 100, is_deposit false, deposit_type none, is_active true. Depozito ve iade edilebilir kalem mantigi deposit_type uzerinden yurudugu icin Pompa hicbir bos kap/sebil bakiyesine girmez; mevcut 'Su Sebili' urunu depozitolu kalir. Kategori basligi yalnizca gorunum/ gruplama icin; hicbir is kurali basligi okumaz. Kod tarafinda yalnizca fallback/seed ve test beklentisi guncellendi: PRODUCT_CATEGORY_TITLES.sebil, PRODUCT_CATEGORIES_REF sebil title_tr, verify-product-ordering. Regresyon: verify-product-ordering 31/31, verify-consolidated-report 48/48, verify-report-returns 10/10, lint ve build gecti.
