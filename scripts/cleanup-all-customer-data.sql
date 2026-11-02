-- =============================================================================
-- TÜM MÜŞTERİ VERİLERİNİN TEMİZLENMESİ (GELİŞTİRME / DENEME ORTAMI)
--
-- !!! YIKICI İŞLEM !!!
-- Müşteri kayıtları ve müşteriye bağlı TÜM veriler silinir.
-- Kullanıcılar, ürünler, kategoriler ve depozito türleri KORUNUR.
--
-- Bu betik, REST API ile silinemeyen immutable kayıtları (tahsilat ve denetim)
-- temizlemek için trigger'ları yalnızca bu transaction süresince kapatır.
--
-- ÇALIŞTIRMA: Supabase > SQL Editor > bu dosyanın tamamını yapıştır > Run.
-- =============================================================================

BEGIN;

-- 1. Silme engelleyen trigger'ları geçici kapat
ALTER TABLE public.customer_payments DISABLE TRIGGER USER;
ALTER TABLE public.customer_financial_audit DISABLE TRIGGER USER;
ALTER TABLE public.delivery_cancellation_audit DISABLE TRIGGER USER;
ALTER TABLE public.dispatch_reopen_audit DISABLE TRIGGER USER;
ALTER TABLE public.dispatch_loading_audit DISABLE TRIGGER USER;

-- 2. Müşteriye bağlı kalan kayıtlar
DELETE FROM public.customer_payments;
DELETE FROM public.customer_financial_audit;
DELETE FROM public.delivery_cancellation_audit;
DELETE FROM public.dispatch_reopen_audit;
DELETE FROM public.dispatch_loading_audit;

DELETE FROM public.customer_empty_balances;
DELETE FROM public.customer_dispensers;
DELETE FROM public.customer_product_prices;
DELETE FROM public.customers;

-- 3. Trigger'ları geri aç
ALTER TABLE public.customer_payments ENABLE TRIGGER USER;
ALTER TABLE public.customer_financial_audit ENABLE TRIGGER USER;
ALTER TABLE public.delivery_cancellation_audit ENABLE TRIGGER USER;
ALTER TABLE public.dispatch_reopen_audit ENABLE TRIGGER USER;
ALTER TABLE public.dispatch_loading_audit ENABLE TRIGGER USER;

-- 4. Doğrulama: müşteri verileri 0, kurucu veriler korunmuş olmalı
SELECT 'customers' AS tablo, COUNT(*) AS kalan FROM public.customers
UNION ALL SELECT 'customer_payments', COUNT(*) FROM public.customer_payments
UNION ALL SELECT 'customer_financial_audit', COUNT(*) FROM public.customer_financial_audit
UNION ALL SELECT 'customer_empty_balances', COUNT(*) FROM public.customer_empty_balances
UNION ALL SELECT 'customer_dispensers', COUNT(*) FROM public.customer_dispensers
UNION ALL SELECT 'customer_product_prices', COUNT(*) FROM public.customer_product_prices
UNION ALL SELECT 'deliveries', COUNT(*) FROM public.deliveries
UNION ALL SELECT 'dispatches', COUNT(*) FROM public.dispatches;

SELECT 'users' AS tablo, COUNT(*) AS korunan FROM public.users
UNION ALL SELECT 'products', COUNT(*) FROM public.products
UNION ALL SELECT 'product_categories', COUNT(*) FROM public.product_categories
UNION ALL SELECT 'deposit_types', COUNT(*) FROM public.deposit_types;

COMMIT;
