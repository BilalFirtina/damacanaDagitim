-- =============================================================================
-- ÜRÜN KATALOĞU GENİŞLETME
--
-- Amaç:
--   * Pet su ürün adlarındaki "Koli" ifadelerini "Paket" olarak günceller.
--   * Depoda satılan eksik ürünleri kataloğa ekler:
--       - Sırma Meyveli Soda (24'lü Paket)
--       - Narlı Soda (24'lü Paket)
--       - Karpuz Çilek Soda (24'lü Paket)
--       - Niğde Gazozu (24'lü Paket)
--       - 0.33 lt Cam Su (12'li Koli)  [depozitosuz]
--       - Dökme Şeker                   [Koli]
--       - Sargılı Şeker                 [Koli]
--       - Tahta Karıştırıcı             [Paket]
--
-- TAMAMEN ADDITIVE: mevcut ürün, müşteri, sefer, teslimat veya fiyat
-- kayıtları silinmez; yalnızca isim güncellemesi ve yeni ürün eklenir.
-- Aynı dosya ikinci kez çalıştırılabilir.
-- =============================================================================

BEGIN;

-- 1) Pet su isimleri: "Koli" -> "Paket"
UPDATE public.products
   SET name = 'Hayat 0.33 lt Pet Su (12''li Paket)'
 WHERE id = 'prod_1794290320342'
   AND name <> 'Hayat 0.33 lt Pet Su (12''li Paket)';

UPDATE public.products
   SET name = 'Hayat 0.5 lt Pet Su (12''li Paket)'
 WHERE id = 'prod_pet_hayat_0_5l_12'
   AND name <> 'Hayat 0.5 lt Pet Su (12''li Paket)';

UPDATE public.products
   SET name = 'Hayat 1.0 lt Pet Su (6''lı Paket)'
 WHERE id = 'prod_1794290594559'
   AND name <> 'Hayat 1.0 lt Pet Su (6''lı Paket)';

UPDATE public.products
   SET name = 'Hayat 1.5 lt Pet Su (6''lı Paket)'
 WHERE id = 'prod_pet_hayat_1_5l_6'
   AND name <> 'Hayat 1.5 lt Pet Su (6''lı Paket)';

-- 2) Eksik ürünler
INSERT INTO public.products
  (id, name, category, default_unit_price, is_deposit, deposit_type, unit, description, is_active)
VALUES
  ('prod_soda_sirma_meyveli_24', 'Sırma Meyveli Soda (24''lü Paket)', 'soda', 350, false, 'none', 'Paket',
   'Sırma marka meyveli soda - 24''lü paket', true),
  ('prod_soda_narli_24', 'Narlı Soda (24''lü Paket)', 'soda', 350, false, 'none', 'Paket',
   'Narlı soda - 24''lü paket', true),
  ('prod_soda_karpuz_cilek_24', 'Karpuz Çilek Soda (24''lü Paket)', 'soda', 350, false, 'none', 'Paket',
   'Karpuz çilek aromalı soda - 24''lü paket', true),
  ('prod_soda_nigde_gazoz_24', 'Niğde Gazozu (24''lü Paket)', 'soda', 350, false, 'none', 'Paket',
   'Niğde gazozu - 24''lü paket', true),
  ('prod_pet_cam_su_0_33_12', '0.33 lt Cam Su (12''li Koli)', 'pet', 400, false, 'none', 'Koli',
   '0.33 litre cam şişe su - 12''li koli (depozitosuz)', true),
  ('prod_seker_dokme', 'Dökme Şeker', 'bardak', 400, false, 'none', 'Koli',
   'Dökme şeker - koli', true),
  ('prod_seker_sargili', 'Sargılı Şeker', 'bardak', 400, false, 'none', 'Koli',
   'Sargılı şeker - koli', true),
  ('prod_tahta_karistirici', 'Tahta Karıştırıcı', 'bardak', 100, false, 'none', 'Paket',
   'Tahta karıştırıcı - paket', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Doğrulama:
-- SELECT id, name, unit FROM public.products WHERE category = 'pet' ORDER BY name;
-- Beklenen: tüm pet adlarında "Paket", birim "Paket".
--
-- SELECT id, name, category, unit, default_unit_price, is_deposit, deposit_type
--   FROM public.products
--  WHERE id IN (
--    'prod_soda_sirma_meyveli_24', 'prod_soda_narli_24',
--    'prod_soda_karpuz_cilek_24', 'prod_soda_nigde_gazoz_24',
--    'prod_pet_cam_su_0_33_12', 'prod_seker_dokme',
--    'prod_seker_sargili', 'prod_tahta_karistirici'
--  )
--  ORDER BY category, name;
-- Beklenen: 8 satır; 0.33 cam depozitosuz ve birimi Koli.
