-- =============================================================================
-- SU SEBİLİ: FİYATSIZ, İADE EDİLEBİLİR (EMANET) KALEM
--
-- AGENTS.md Bölüm 1.1, 7 ve 9:
--   * Su sebili müşterilere ücretsiz emanet verilir.
--   * Araçla taşınır: araca yüklenir, müşteriye teslim edilir, müşteriden
--     geri alınır ve gün sonunda depoya iade edilir.
--   * Parasal depozito yoktur; yalnızca adet takip edilir.
--   * Fiyatı yoktur (birim fiyat 0).
--
-- TAMAMEN ADDITIVE: mevcut tablo/veri değişmez; yalnızca yeni tür, kategori
-- ve ürün tanımı eklenir.
--
-- ÖNEMLİ: Bu dosya canlıya OTOMATİK uygulanmaz. Supabase SQL Editor'de
-- tek transaction olarak çalıştırılmalıdır.
-- =============================================================================

BEGIN;

-- 1. İade edilebilir kalem türü
INSERT INTO public.deposit_types (code, label_tr, is_returnable, sort_order)
VALUES ('sebil', 'Su Sebili', true, 40)
ON CONFLICT (code) DO NOTHING;

-- 2. Ürün kategorisi
INSERT INTO public.product_categories
  (code, title_tr, sort_order, default_unit, default_is_deposit, default_deposit_type, is_active)
VALUES ('sebil', 'Su Sebili', 40, 'Adet', true, 'sebil', true)
ON CONFLICT (code) DO NOTHING;

-- 3. Fiyatsız ürün tanımı (yüklemeye diğer ürünler gibi girer)
INSERT INTO public.products
  (id, name, category, default_unit_price, is_deposit, deposit_type, unit, description, is_active)
VALUES
  ('prod_sebil', 'Su Sebili', 'sebil', 0, true, 'sebil', 'Adet',
   'Müşteriye ücretsiz emanet verilen su sebili. Parasal depozito yoktur; adet takip edilir.', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;
