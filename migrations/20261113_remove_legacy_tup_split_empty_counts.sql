-- =============================================================================
-- ESKİ TEK TÜP (tup) TAMAMEN KALDIRILIR
--
-- * Yalnızca Büyük Tüp (tup_buyuk) ve Küçük Tüp (tup_kucuk) kalır.
-- * Eski tup bakiyeleri/satırları silinir.
-- * Gün sonu kapatma artık boş tüpü boyuta göre ayrı saklar.
-- * Sebil akışına dokunulmaz.
-- =============================================================================

BEGIN;

-- 1) Eski tek tüp verilerini temizle
DELETE FROM public.customer_empty_balances WHERE deposit_type = 'tup';
DELETE FROM public.delivery_container_returns WHERE deposit_type = 'tup';

-- 2) Tüp kategorisinin varsayılanı artık Büyük Tüp
UPDATE public.product_categories
   SET default_deposit_type = 'tup_buyuk'
 WHERE code = 'tup';

-- 3) Eski tek tüp referans türünü kaldır (önce bağımlı satırlar temizlendi)
DELETE FROM public.deposit_types WHERE code = 'tup';

-- 4) Sefer kapatma için boyutlu boş tüp kolonları
ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS collected_empty_tup_buyuk INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS collected_empty_tup_kucuk INTEGER NOT NULL DEFAULT 0;

-- 5) Mevcut seferler için aktif teslimatlardan boyutlu geri doldurma
UPDATE public.dispatches d
   SET collected_empty_tup_buyuk = COALESCE((
         SELECT SUM(r.received_qty)::int
         FROM public.delivery_container_returns r
         JOIN public.deliveries del ON del.id = r.delivery_id
         WHERE del.dispatch_id = d.id
           AND del.cancelled_at IS NULL
           AND r.deposit_type = 'tup_buyuk'
       ), 0),
       collected_empty_tup_kucuk = COALESCE((
         SELECT SUM(r.received_qty)::int
         FROM public.delivery_container_returns r
         JOIN public.deliveries del ON del.id = r.delivery_id
         WHERE del.dispatch_id = d.id
           AND del.cancelled_at IS NULL
           AND r.deposit_type = 'tup_kucuk'
       ), 0);

-- 6) close_dispatch: eski tek tup yerine iki boyutlu alanlar
CREATE OR REPLACE FUNCTION public.close_dispatch(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_dispatch_id   TEXT := p->>'dispatch_id';
  v_status        TEXT;
  v_total_value   NUMERIC := 0;
  v_total_cash    NUMERIC := 0;
  v_total_pos     NUMERIC := 0;
  v_total_credit  NUMERIC := 0;
  v_standalone_cash     NUMERIC := 0;
  v_standalone_pos      NUMERIC := 0;
  v_standalone_transfer NUMERIC := 0;
  v_loaded        RECORD;
  v_delivered     INTEGER;
  v_expected      INTEGER;
  v_counted       INTEGER;
  v_user_id       TEXT := p->>'closed_by_user_id';
  v_user_name     TEXT;
  v_updated       INTEGER;
BEGIN
  IF v_dispatch_id IS NULL OR btrim(v_dispatch_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: dispatch id required';
  END IF;
  IF v_user_id IS NULL OR btrim(v_user_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: closer id required';
  END IF;

  SELECT name INTO v_user_name
  FROM public.users
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT status INTO v_status
  FROM public.dispatches
  WHERE id = v_dispatch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DISPATCH_NOT_FOUND';
  END IF;
  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'DISPATCH_ALREADY_COMPLETED';
  END IF;
  IF v_status IS NULL OR v_status <> 'in_transit' THEN
    RAISE EXCEPTION 'INVALID_DISPATCH_STATE';
  END IF;

  -- Eski şema kayıtlarında kalem veya ödeme alanları eksikse kapatma
  -- varsayılan 0 değerlerle yapılmaz; düzeltme süreci gerekir. Bilinçli
  -- yalnız-boş-kap teslimatları (en az bir boş kap alınmış) bu kontrolden muaftır.
  IF EXISTS (
    SELECT 1
    FROM public.deliveries d
    WHERE d.dispatch_id = v_dispatch_id
      AND d.cancelled_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_items di WHERE di.delivery_id = d.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.delivery_container_returns dr
        WHERE dr.delivery_id = d.id
          AND COALESCE(dr.received_qty, 0) > 0
      )
  ) THEN
    RAISE EXCEPTION 'HISTORICAL_DELIVERY_ITEMS_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.deliveries d
    WHERE d.dispatch_id = v_dispatch_id
      AND d.cancelled_at IS NULL
      AND (
        abs(COALESCE(d.total_collected, 0)
            - COALESCE(d.cash_amount, 0)
            - COALESCE(d.pos_amount, 0)) > 0.01
        OR abs(COALESCE(d.total_collected, 0)
               + COALESCE(d.diff_uncollected, 0)
               - COALESCE(d.delivered_grand_total, 0)) > 0.01
      )
  ) THEN
    RAISE EXCEPTION 'PAYMENT_DATA_INCONSISTENT';
  END IF;

  -- Kalan tutar müşteri türünden bağımsız olarak cari borca yazılır;
  -- mutabakat toplamı da tüm müşterilerdeki açık tutarı içerir.
  SELECT
    COALESCE(SUM(COALESCE(d.delivered_grand_total, 0)), 0),
    COALESCE(SUM(COALESCE(d.cash_amount, 0)), 0),
    COALESCE(SUM(COALESCE(d.pos_amount, 0)), 0),
    COALESCE(SUM(GREATEST(COALESCE(d.diff_uncollected, 0), 0)), 0)
  INTO v_total_value, v_total_cash, v_total_pos, v_total_credit
  FROM public.deliveries d
  LEFT JOIN public.customers c ON c.id = d.customer_id
  WHERE d.dispatch_id = v_dispatch_id
    AND d.cancelled_at IS NULL;

  -- Ürün verilmeden alınan tahsilatlar da kasa/POS mutabakatına girer.
  SELECT
    COALESCE(SUM(CASE WHEN method = 'CASH' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN method = 'POS' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN method = 'TRANSFER' THEN amount ELSE 0 END), 0)
  INTO v_standalone_cash, v_standalone_pos, v_standalone_transfer
  FROM public.customer_payments
  WHERE dispatch_id = v_dispatch_id;

  v_total_cash := v_total_cash + v_standalone_cash;
  v_total_pos := v_total_pos + v_standalone_pos;

  DELETE FROM public.dispatch_reconciliation_items
  WHERE dispatch_id = v_dispatch_id;

  FOR v_loaded IN
    SELECT product_id, quantity
    FROM public.dispatch_items
    WHERE dispatch_id = v_dispatch_id
  LOOP
    SELECT COALESCE(SUM(di.quantity), 0)
    INTO v_delivered
    FROM public.delivery_items di
    JOIN public.deliveries d ON d.id = di.delivery_id
    WHERE d.dispatch_id = v_dispatch_id
      AND d.cancelled_at IS NULL
      AND di.product_id = v_loaded.product_id;

    v_expected := GREATEST(COALESCE(v_loaded.quantity, 0) - v_delivered, 0);
    v_counted := GREATEST(
      COALESCE((p->'remaining_full_counted'->>(v_loaded.product_id))::int, 0),
      0
    );

    INSERT INTO public.dispatch_reconciliation_items (
      dispatch_id, product_id, expected_qty, counted_qty
    ) VALUES (
      v_dispatch_id, v_loaded.product_id, v_expected, v_counted
    );
  END LOOP;

  UPDATE public.dispatches
     SET status = 'completed',
         closed_at = now(),
         closed_by_user_id = v_user_id,
         closed_by_user_name = v_user_name,
         total_delivered_value = v_total_value,
         total_cash_collected = v_total_cash,
         total_pos_collected = v_total_pos,
         total_credit_added = v_total_credit,
         actual_cash_in_pocket = GREATEST(COALESCE((p->>'actual_cash_in_pocket')::numeric, 0), 0),
         actual_pos_slips_total = GREATEST(COALESCE((p->>'actual_pos_slips_total')::numeric, 0), 0),
         collected_empty_damacana = GREATEST(COALESCE((p->>'collected_empty_damacana')::int, 0), 0),
         collected_empty_cam_damacana = GREATEST(COALESCE((p->>'collected_empty_cam_damacana')::int, 0), 0),
         collected_empty_tup_buyuk = GREATEST(COALESCE((p->>'collected_empty_tup_buyuk')::int, 0), 0),
         collected_empty_tup_kucuk = GREATEST(COALESCE((p->>'collected_empty_tup_kucuk')::int, 0), 0),
         reconciliation_notes = COALESCE(p->>'notes', '')
   WHERE id = v_dispatch_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'CLOSE_WRITE_NOT_APPLIED';
  END IF;

  RETURN jsonb_build_object(
    'closed', true,
    'dispatch_id', v_dispatch_id,
    'status', 'completed',
    'closed_by_user_id', v_user_id,
    'closed_by_user_name', v_user_name,
    'total_delivered_value', v_total_value,
    'total_cash_collected', v_total_cash,
    'total_pos_collected', v_total_pos,
    'total_credit_added', v_total_credit,
    'total_standalone_cash', v_standalone_cash,
    'total_standalone_pos', v_standalone_pos,
    'total_standalone_transfer', v_standalone_transfer
  );
END;
$$;

-- 7) Eski tek tup kolonunu kaldır
ALTER TABLE public.dispatches DROP COLUMN IF EXISTS collected_empty_tup;

-- 8) Check constraint'leri eski tup olmadan yeniden oluştur
ALTER TABLE public.customer_empty_balances
  DROP CONSTRAINT IF EXISTS customer_empty_balances_deposit_type_check;
ALTER TABLE public.customer_empty_balances
  ADD CONSTRAINT customer_empty_balances_deposit_type_check
  CHECK (deposit_type = ANY (ARRAY['damacana','cam_damacana','tup_buyuk','tup_kucuk','sebil','none']));

ALTER TABLE public.delivery_container_returns
  DROP CONSTRAINT IF EXISTS delivery_container_returns_deposit_type_check;
ALTER TABLE public.delivery_container_returns
  ADD CONSTRAINT delivery_container_returns_deposit_type_check
  CHECK (deposit_type = ANY (ARRAY['damacana','cam_damacana','tup_buyuk','tup_kucuk','sebil','none']));

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_deposit_type_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_deposit_type_check
  CHECK (deposit_type = ANY (ARRAY['damacana','cam_damacana','tup_buyuk','tup_kucuk','sebil','none']));

COMMIT;
