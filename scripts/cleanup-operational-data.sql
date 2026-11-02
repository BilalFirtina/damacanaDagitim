-- =============================================================================
-- OPERASYONEL VERİ TEMİZLİĞİ (GELİŞTİRME ORTAMI)
--
-- !!! YIKICI İŞLEM !!!
-- Bu betik günlük işlenen hareketleri siler. Proje temeli korunur.
--
-- SİLİNİR:
--   teslimatlar + kalemleri + boş kap hareketleri
--   seferler + yükleme kalemleri + mutabakat kalemleri
--   müşteri tahsilatları
--   teslimat iptal/düzeltme, sefer yeniden açma, yükleme düzeltme denetimleri
--   müşteri finansal düzeltme denetimleri
--   müşteri boş kap (emanet) bakiyeleri
--   müşteri sebil detayları
--   saklama arşivi
--   müşteri cari bakiyeleri 0'a çekilir
--
-- KORUNUR:
--   users, products, product_categories, deposit_types
--   customers (müşteri listesi) + customer_product_prices (anlaşılmış fiyatlar)
--   retention_state (temizlik durumu)
--
-- NOT: customer_payments ve denetim tablolarındaki silme engelleyen trigger'lar
-- yalnızca bu transaction süresince kapatılır ve sonunda geri açılır.
--
-- ÇALIŞTIRMA: Supabase > SQL Editor > bu dosyanın tamamını yapıştır > Run.
-- Herhangi bir adım hata verirse tüm işlem geri alınır (BEGIN/COMMIT).
-- =============================================================================

BEGIN;

-- 1. Silme engelleyen trigger'ları geçici olarak kapat ---------------------
ALTER TABLE public.customer_payments DISABLE TRIGGER USER;
ALTER TABLE public.customer_financial_audit DISABLE TRIGGER USER;
ALTER TABLE public.delivery_cancellation_audit DISABLE TRIGGER USER;
ALTER TABLE public.dispatch_reopen_audit DISABLE TRIGGER USER;
ALTER TABLE public.dispatch_loading_audit DISABLE TRIGGER USER;

-- 2. Tahsilat ve denetim kayıtları (önce bunlar) -------------------------
DELETE FROM public.customer_payments;
DELETE FROM public.customer_financial_audit;
DELETE FROM public.delivery_cancellation_audit;
DELETE FROM public.dispatch_reopen_audit;
DELETE FROM public.dispatch_loading_audit;

-- 3. Teslimat hareketleri (önce çocuk tablolar) ---------------------------
DELETE FROM public.delivery_container_returns;
DELETE FROM public.delivery_items;
DELETE FROM public.deliveries;

-- 4. Sefer hareketleri ----------------------------------------------------
DELETE FROM public.dispatch_reconciliation_items;
DELETE FROM public.dispatch_items;
DELETE FROM public.dispatches;

-- 5. Müşteri emanet bakiyeleri ve sebil detayları -------------------------
DELETE FROM public.customer_empty_balances;
DELETE FROM public.customer_dispensers;

-- 6. Saklama arşivi (geçmiş operasyonel veri) -----------------------------
DELETE FROM public.retention_archive;

-- 7. Müşteri cari bakiyelerini sıfırla (müşteri kayıtları korunur) --------
UPDATE public.customers
   SET current_balance_tl = 0,
       updated_at = now();

-- 8. Trigger'ları geri aç -------------------------------------------------
ALTER TABLE public.customer_payments ENABLE TRIGGER USER;
ALTER TABLE public.customer_financial_audit ENABLE TRIGGER USER;
ALTER TABLE public.delivery_cancellation_audit ENABLE TRIGGER USER;
ALTER TABLE public.dispatch_reopen_audit ENABLE TRIGGER USER;
ALTER TABLE public.dispatch_loading_audit ENABLE TRIGGER USER;

-- 9. Doğrulama (tüm hareket tabloları 0 olmalı) ---------------------------
SELECT 'deliveries' AS tablo, COUNT(*) AS kalan FROM public.deliveries
UNION ALL SELECT 'delivery_items', COUNT(*) FROM public.delivery_items
UNION ALL SELECT 'delivery_container_returns', COUNT(*) FROM public.delivery_container_returns
UNION ALL SELECT 'dispatches', COUNT(*) FROM public.dispatches
UNION ALL SELECT 'dispatch_items', COUNT(*) FROM public.dispatch_items
UNION ALL SELECT 'dispatch_reconciliation_items', COUNT(*) FROM public.dispatch_reconciliation_items
UNION ALL SELECT 'customer_payments', COUNT(*) FROM public.customer_payments
UNION ALL SELECT 'customer_financial_audit', COUNT(*) FROM public.customer_financial_audit
UNION ALL SELECT 'delivery_cancellation_audit', COUNT(*) FROM public.delivery_cancellation_audit
UNION ALL SELECT 'dispatch_reopen_audit', COUNT(*) FROM public.dispatch_reopen_audit
UNION ALL SELECT 'dispatch_loading_audit', COUNT(*) FROM public.dispatch_loading_audit
UNION ALL SELECT 'customer_empty_balances', COUNT(*) FROM public.customer_empty_balances
UNION ALL SELECT 'customer_dispensers', COUNT(*) FROM public.customer_dispensers
UNION ALL SELECT 'retention_archive', COUNT(*) FROM public.retention_archive;

-- Proje temeli korunmuş olmalı (bu sayılar sıfırdan büyük olmalı)
SELECT 'users' AS tablo, COUNT(*) AS korunan FROM public.users
UNION ALL SELECT 'products', COUNT(*) FROM public.products
UNION ALL SELECT 'product_categories', COUNT(*) FROM public.product_categories
UNION ALL SELECT 'deposit_types', COUNT(*) FROM public.deposit_types
UNION ALL SELECT 'customers', COUNT(*) FROM public.customers;

COMMIT;
