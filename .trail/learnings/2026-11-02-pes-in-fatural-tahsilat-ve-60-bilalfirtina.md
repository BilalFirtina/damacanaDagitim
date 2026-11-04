---
title: Peşin/faturalı tahsilat ve 60 gün saklama kararları
author: BilalFirtina
date: 2026-11-02
branch: feat/agents-compliance
id: l-3567e668
scope: repo
status: active
src: agent
touches:
  - server.ts
  - src/server/db.ts
  - migrations/20261106_cash_customer_debt.sql
  - migrations/20261107_customer_payment_dispatch.sql
  - src/components/driver/DeliveryModal.tsx
  - src/components/driver/DriverPaymentModal.tsx
---

Karar: Peşin/faturalı ayrımı yalnızca şoförün cari bakiyeyi görüp görmemesini belirler. Kısmi/ödenmemiş teslimatta kalan tutar (diff_uncollected) HER İKİ müşteri türünde de current_balance_tl'ye borç yazılır. Peşin müşteride şoför borcu ve son satış fiyatını görür; ürün vermeden tahsilat yapabilir. Faturalıda şoför birim fiyat/özel fiyat görmez, sadece tahsilat kaydeder; bakiye dönmez.

Neden: Faturalı müşterinin fiyatı yönetici/fatura tarafında belirlenir; şoförün fiyat girmesi gereksiz ve yanlış borç riski taşır. Peşin müşteride ise kalan tutar müşteri cari borcunda takip edilmezse muhasebe kaybolur. Tahsilatların raporda tahsil eden şoförle görünmesi gerekir.

Nerede: server.ts içinde teslimat bakiyesi, POST /api/customers/:id/payments ve /api/reports/daily; src/server/db.ts içinde close_dispatch fallback ve payment sorguları; migrations/20261106_cash_customer_debt.sql apply_delivery/close_dispatch; migrations/20261107_customer_payment_dispatch.sql customer_payments.dispatch_id + RPC; DeliveryModal/DriverPaymentModal fiyat ve tahsilat UI.

Ek kararlar: 60 günlük saklama arşivsiz ve durum bağımsızdır; müşteri bakiyesi, emanet adetleri, son fiyat, tahsilat ve denetim korunur. Bir şoförün en fazla bir tamamlanmamış seferi olabilir; aynı gün kapatma zorunlu değildir, bugün yüklenen araçla yarın teslimat yapılabilir, otomatik kapatma yoktur.

Durum notu: Bu modelin implementasyon denemesi 10acd99 commit'indedir; CI çalışmamış, merge edilmemiştir. Yerel çalışma ağacı 68f7fa1 içeriğine geri alınmıştır; ayrıntı ve devam adımları MEMORY.md'dedir. Faturalıda birim fiyat girişinin tamamen gizlenmesi ve 20261024 SQL değişiklikleriyle regresyon kontrolü açık iştir.
