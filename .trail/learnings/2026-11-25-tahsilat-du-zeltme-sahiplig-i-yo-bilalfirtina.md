---
title: "Tahsilat düzeltme sahipliği: yönetici şoförün kaydını değiştiremez"
author: BilalFirtina
date: 2026-11-25
branch: main
id: l-740134c2
scope: repo
status: active
src: agent
touches:
  - server.ts
  - src/server/db.ts
  - src/components/driver/DriverView.tsx
  - migrations/20261125_payment_ownership_guard.sql
---

Karar: Bir tahsilatı yalnızca kaydeden kullanıcı düzeltebilir/iptal edebilir. Yönetici şoförün tahsilatını hiçbir koşulda değiştiremez; yönetici kendi tahsilatını yalnızca aynı UTC gününde, şoför kendi tahsilatını yalnızca bağlı sefer in_transit iken değiştirebilir. Yönetici tahsilatı sefere bağlanamaz; POST /api/customers/:id/payments dispatchId gönderirse 400 DISPATCH_NOT_ALLOWED döner.

Neden: Tahsilat düzeltme/iptal özelliği ilk eklendiği 3261ab1 commit'inden beri yöneticiye geniş yetki veriyordu ve 6c33d6d yalnızca kapanmış sefer koruması ekledi; yönetici şoförün canlı seferdeki tahsilatını değiştirebiliyordu. Kaydı giren kullanıcı sahipliği, sorumluluğu ve beklenen tutar denetimini korur.

Nerede: server.ts getPaymentCorrectionDenial/evaluatePaymentCorrection, GET /api/payments ve GET /api/customers/:id/payments canCorrect, POST tahsilat admin dispatch reddi; src/server/db.ts paymentError ve mapCustomerPayment (pg Date -> ISO); DriverView Düzelt/İptal koşulu collectedByUserId === currentUser.id; migrations/20261125_payment_ownership_guard.sql amend_customer_payment içinde users.role, aynı UTC günü ve in_transit kontrolleri.

Yan bulgu: getCustomerPaymentsByDate pg yolunda collected_at Date geldiği için isSameUtcDate filtresi tüm satırları eliyordu; paymentTimestampIso ile düzeltildi. Denetim kaydı yok, iptal fiziksel silme, beklenen tutar kontrolü korunur.
