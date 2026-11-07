-- =============================================================================
-- BÜYÜK / KÜÇÜK TÜP İÇİN AYRI DEPOZİTO TAKİBİ
--
-- Amaç:
--   * Büyük tüp (12 kg) ve küçük tüp (2 kg) ayrı iade edilebilir kalem türü olur.
--   * Müşteri boş tüp bakiyesi iki tür için ayrı tutulur.
--   * Teslimat boş tüp hareketleri iki tür olarak kaydedilir.
--
-- Not:
--   * Teslimat RPC'si (apply_delivery) boş kap türlerini `empty_deltas` ve
--     `container_returns` üzerinden genel okur; yeni türler için RPC değişikliği
--     gerekmez.
--   * Gün sonu sevkiyat kolonları (dispatches.collected_empty_tup) ortak toplam
--     olarak kalır; müşteri bakiyesi ve rapor kırılımı iki türü ayrı tutar.
--   * Eski `tup` bakiyeleri deneme verisidir; migration bunları temizler.
--     Eski `delivery_container_returns` satırları silinmez.
-- =============================================================================

BEGIN;

-- 1) İade edilebilir kalem türleri
INSERT INTO public.deposit_types (code, label_tr, is_returnable, sort_order)
VALUES
  ('tup_buyuk', 'Büyük Tüp', true, 31),
  ('tup_kucuk', 'Küçük Tüp', true, 32)
ON CONFLICT (code) DO NOTHING;

-- 2) products.deposit_type kısıtını yeni türleri kapsayacak şekilde yenile.
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
  CHECK (deposit_type IN (
    'damacana', 'cam_damacana', 'tup', 'tup_buyuk', 'tup_kucuk', 'sebil', 'none'
  ));

-- 3) Boş kap tablolarında deposit_type kısıtı varsa yeni türleri kapsayacak
--    şekilde yenile. Kısıt yoksa güvenli biçimde oluşturulur.
DO $$
DECLARE
  tbl text;
  con record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['customer_empty_balances', 'delivery_container_returns']
  LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      CONTINUE;
    END IF;

    FOR con IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      JOIN pg_attribute att
        ON att.attrelid = c.conrelid
       AND att.attnum = ANY (c.conkey)
      WHERE nsp.nspname = 'public'
        AND rel.relname = tbl
        AND c.contype = 'c'
        AND att.attname = 'deposit_type'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', tbl, con.conname);
    END LOOP;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (deposit_type IN (%L, %L, %L, %L, %L, %L, %L))',
      tbl,
      tbl || '_deposit_type_check',
      'damacana', 'cam_damacana', 'tup', 'tup_buyuk', 'tup_kucuk', 'sebil', 'none'
    );
  END LOOP;
END $$;

-- 4) Mevcut iki tüp ürününü boyutlu türlere bağla.
UPDATE public.products
   SET deposit_type = 'tup_buyuk'
 WHERE id = 'prod_tup_12kg'
   AND deposit_type <> 'tup_buyuk';

UPDATE public.products
   SET deposit_type = 'tup_kucuk'
 WHERE id = 'prod_tup_2kg'
   AND deposit_type <> 'tup_kucuk';

-- 5) Eski tek tüp müşteri bakiyeleri deneme verisidir; yeni türlere taşınmaz.
DELETE FROM public.customer_empty_balances
 WHERE deposit_type = 'tup';

COMMIT;

-- Doğrulama:
-- SELECT code, label_tr FROM public.deposit_types
--  WHERE code IN ('tup_buyuk', 'tup_kucuk') ORDER BY sort_order;
--
-- SELECT id, name, deposit_type FROM public.products
--  WHERE id IN ('prod_tup_12kg', 'prod_tup_2kg') ORDER BY id;
--
-- SELECT count(*) FROM public.customer_empty_balances WHERE deposit_type = 'tup';
-- Beklenen: 0
