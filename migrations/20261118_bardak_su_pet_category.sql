-- =============================================================================
-- BARDAK SU KATEGORİSİ: PET SU
--
-- Amaç:
--   * "Bardak Su (60'lı Koli)" ürününün kategorisini "bardak" → "pet" yapar.
--   * Ürün bundan böyle tüm ekran ve raporlarda Pet Su kategorisi içinde,
--     pet ürünleriyle birlikte Türkçe alfabetik sırada değerlendirilir.
--
-- Yalnızca kategori güncellenir; fiyat, birim, depozito ve diğer alanlar
-- dokunulmaz. Aynı dosya ikinci kez çalıştırılabilir (idempotent).
-- =============================================================================

BEGIN;

UPDATE public.products
   SET category = 'pet'
 WHERE id = 'prod_bardak_su_60'
   AND category <> 'pet';

COMMIT;

-- Doğrulama:
-- SELECT id, name, category, unit, default_unit_price, is_deposit, deposit_type
--   FROM public.products
--  WHERE id = 'prod_bardak_su_60';
-- Beklenen: category = 'pet'.
--
-- SELECT name FROM public.products WHERE category = 'pet' AND is_active = true ORDER BY name;
-- Beklenen: "Bardak Su (60'lı Koli)" pet ürünleri arasında alfabetik olarak ilk sırada.
