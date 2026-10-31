-- =============================================================================
-- DEPO STOĞU ÖZELLİĞİNİN GERİ ALINMASI
--
-- Depo stoğu bu projenin iş modeline dahil değildir. Araç merkezli model
-- geçerlidir: araca yüklenen ürünler → teslimatlar → araçta kalan ürünler,
-- iade edilebilir (depozito) kalemler ve tahsilatlar.
--
-- Bu dosya, 20261101_warehouse_stock.sql ile eklenen tablo ve fonksiyonları
-- kaldırır. Tablolar boşsa veri kaybı olmaz; doluysa önce yedek alın.
--
-- Geri alma (yeniden kurmak için): 20261101_warehouse_stock.sql
-- =============================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_stock_movements_no_update_delete ON public.stock_movements;
DROP TRIGGER IF EXISTS trg_stock_movements_no_truncate ON public.stock_movements;

DROP FUNCTION IF EXISTS public.adjust_warehouse_stock(jsonb);
DROP FUNCTION IF EXISTS public.consume_warehouse_stock(jsonb);
DROP FUNCTION IF EXISTS public.release_warehouse_stock(jsonb);

DROP TABLE IF EXISTS public.stock_movements;
DROP TABLE IF EXISTS public.warehouse_stock;

DROP FUNCTION IF EXISTS public.prevent_stock_movement_mutation();

COMMIT;
