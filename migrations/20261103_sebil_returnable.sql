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

-- 3. deposit_type CHECK kısıtını 'sebil' değerini kapsayacak şekilde yenile.
--    20261018 bu kısıtı dört değerle tanımlamıştı; yeni tür reddedilmemeli.
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute att
      ON att.attrelid = c.conrelid
     AND att.attnum = ANY (c.conkey)
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'products'
      AND c.contype = 'c'
      AND att.attname = 'deposit_type'
  LOOP
    EXECUTE format('ALTER TABLE public.products DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE public.products
  ADD CONSTRAINT products_deposit_type_check
  CHECK (deposit_type IN ('damacana', 'cam_damacana', 'tup', 'sebil', 'none'));

-- 4. Fiyatsız ürün tanımı (yüklemeye diğer ürünler gibi girer)
INSERT INTO public.products
  (id, name, category, default_unit_price, is_deposit, deposit_type, unit, description, is_active)
VALUES
  ('prod_sebil', 'Su Sebili', 'sebil', 0, true, 'sebil', 'Adet',
   'Müşteriye ücretsiz emanet verilen su sebili. Parasal depozito yoktur; adet takip edilir.', true)
ON CONFLICT (id) DO NOTHING;

COMMIT;
