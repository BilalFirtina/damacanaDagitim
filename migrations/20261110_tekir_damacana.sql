-- =============================================================================
-- TEKİR DAMACANA ÜRÜNÜ
--
-- Amaç:
--   * Yükleme ve teslimat ekranlarında Hayat/Sırma damacanalarla aynı
--     özelliklere sahip Tekir Damacana ürününü kataloğa ekler.
--   * Ürün, mevcut `damacana` depozito türünü kullanır; boş damacana
--     bakiyesi Hayat/Sırma ile aynı havuzda izlenir.
--
-- TAMAMEN ADDITIVE: mevcut ürün, müşteri, sefer, teslimat veya fiyat
-- kayıtları değiştirilmez. Aynı ID ile ikinci kez çalıştırılabilir.
-- =============================================================================

BEGIN;

INSERT INTO public.products
  (id, name, category, default_unit_price, is_deposit, deposit_type, unit, description, is_active)
VALUES
  ('prod_damacana_tekir_19l', 'Tekir Damacana', 'damacana', 100, true, 'damacana', 'Adet',
   'Tekir doğal kaynak suyu 19L - depozitolu', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Doğrulama:
-- SELECT id, name, category, default_unit_price, is_deposit, deposit_type, unit, is_active
--   FROM public.products
--  WHERE id = 'prod_damacana_tekir_19l';
-- Beklenen: 1 satır, fiyat 100, depozitolu, deposit_type = damacana, aktif.
