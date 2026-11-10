-- =============================================================================
-- MEVCUT SODALARIN BİRİMİ: KOLİ -> PAKET
--
-- Amaç:
--   * Katalogda zaten bulunan Beypazarı, Kızılay, Limonlu ve Elmalı soda
--     ürünlerinin birimini "Paket" yapar.
--   * Ürün adlarındaki "24'lü Koli" ifadesini "24'lü Paket" olarak günceller.
--
-- TAMAMEN ADDITIVE: yalnızca bu dört ürünün adı ve birimi değişir; fiyat,
-- depozito, kategori ve geçmiş teslimat kayıtları korunur.
-- Aynı dosya ikinci kez çalıştırılabilir.
-- =============================================================================

BEGIN;

UPDATE public.products
   SET name = 'Beypazarı Maden Suyu (24''lü Paket)',
       unit = 'Paket'
 WHERE id = 'prod_soda_beypazari_24';

UPDATE public.products
   SET name = 'Kızılay Maden Suyu (24''lü Paket)',
       unit = 'Paket'
 WHERE id = 'prod_soda_kizilay_24';

UPDATE public.products
   SET name = 'Limonlu Soda (24''lü Paket)',
       unit = 'Paket'
 WHERE id = 'prod_soda_limonlu_24';

UPDATE public.products
   SET name = 'Elmalı Soda(24''lü Paket)',
       unit = 'Paket'
 WHERE id = 'prod_1793945884682';

COMMIT;

-- Doğrulama:
-- SELECT id, name, unit FROM public.products
--  WHERE category = 'soda'
--  ORDER BY name;
-- Beklenen: tüm soda adlarında "Paket" ve birim "Paket".
