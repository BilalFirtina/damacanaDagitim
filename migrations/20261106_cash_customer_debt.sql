-- =============================================================================
-- PEŞİN MÜŞTERİDE KALAN TUTAR DA CARİ BORCA YAZILIR
--
-- Ürün kararı:
--   * Peşin/faturalı ayrımı yalnızca şoförün bakiyeyi görüp görmemesini
--     belirler. Kısmi veya ödenmemiş teslimatta kalan tutar HER İKİ müşteri
--     türünde de current_balance_tl alanına borç olarak eklenir.
--   * applied_balance_delta_tl artık tüm müşterilerde kalan tutarı taşır;
--     böylece teslimat iptali/düzeltmesi doğru tutarı geri alır.
--   * Gün sonu mutabakatındaki total_credit_added tüm müşterileri kapsar.
--
-- Bu dosya 20261024'teki apply_delivery ve close_dispatch fonksiyonlarını
-- değiştirir. Additive ve geriye dönük uyumludur; mevcut satırları değiştirmez.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_delivery(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id              TEXT := p->>'id';
  v_dispatch_id     TEXT := p->>'dispatch_id';
  v_customer_id     TEXT := p->>'customer_id';
  v_status          TEXT;
  v_inserted        INTEGER;
  v_diff            NUMERIC := COALESCE((p->>'diff_uncollected')::numeric, 0);
  v_type            TEXT;
  v_delta_text      TEXT;
  v_delta           INTEGER;
  v_qty             INTEGER;
  v_item            JSONB;
  v_row             JSONB;
  v_line_no         INTEGER := 0;
BEGIN
  IF v_id IS NULL OR btrim(v_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: delivery id required';
  END IF;
  IF v_dispatch_id IS NULL OR v_customer_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: dispatch and customer required';
  END IF;

  -- 1) Hızlı idempotency kontrolü: mevcut ID için kilit alınmaz.
  IF EXISTS (SELECT 1 FROM public.deliveries WHERE id = v_id) THEN
    RETURN jsonb_build_object('duplicate', true, 'delivery_id', v_id);
  END IF;

  -- 2) Sefer kilidi: kapalıysa hiçbir teslimat uygulanmaz.
  SELECT status INTO v_status
  FROM public.dispatches
  WHERE id = v_dispatch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DISPATCH_NOT_FOUND';
  END IF;
  IF v_status IS NULL OR v_status NOT IN ('pending_confirmation', 'in_transit') THEN
    RAISE EXCEPTION 'DISPATCH_CLOSED';
  END IF;

  -- 3) Ödeme tutarlılığı: istemci toplamları birbiriyle ve mal bedeliyle
  --    uyuşmalıdır. Eski şema kayıtlarında varsayılan 0/sıfır alanlarının
  --    sessizce kapatmaya yansımasını engeller.
  IF abs(
       COALESCE((p->>'total_collected')::numeric, 0)
       - COALESCE((p->>'cash_amount')::numeric, 0)
       - COALESCE((p->>'pos_amount')::numeric, 0)
     ) > 0.01
     OR abs(
       COALESCE((p->>'total_collected')::numeric, 0)
       + v_diff
       - COALESCE((p->>'delivered_grand_total')::numeric, 0)
     ) > 0.01
  THEN
    RAISE EXCEPTION 'PAYMENT_DATA_INCONSISTENT';
  END IF;

  -- 4) Araç stoğu: sefer kilidi altında yüklenen - önceden teslim edilen
  --    miktardan fazlası teslim edilemez. Aynı ürünün çoklu satırları toplanır.
  IF EXISTS (
    WITH new_items AS (
      SELECT (i->>'product_id') AS product_id,
             SUM(COALESCE((i->>'quantity')::int, 0)) AS qty
      FROM jsonb_array_elements(COALESCE(p->'items', '[]'::jsonb)) AS i
      GROUP BY 1
    ), delivered AS (
      SELECT di.product_id, SUM(di.quantity) AS qty
      FROM public.delivery_items di
      JOIN public.deliveries d ON d.id = di.delivery_id
      WHERE d.dispatch_id = v_dispatch_id
        AND d.cancelled_at IS NULL
      GROUP BY di.product_id
    )
    SELECT 1
    FROM new_items n
    LEFT JOIN public.dispatch_items li
      ON li.dispatch_id = v_dispatch_id AND li.product_id = n.product_id
    LEFT JOIN delivered d ON d.product_id = n.product_id
    WHERE n.qty < 0
       OR n.qty > GREATEST(COALESCE(li.quantity, 0) - COALESCE(d.qty, 0), 0)
  ) THEN
    RAISE EXCEPTION 'INSUFFICIENT_VEHICLE_STOCK';
  END IF;

  -- 5) Müşteri kilidi: aynı müşteriye eşzamanlı yazımlar sıraya girer.
  PERFORM 1
  FROM public.customers
  WHERE id = v_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  -- 6) Teslimat satırı: aynı ID eşzamanlı geldiyse çakışma burada tekilleşir.
  INSERT INTO public.deliveries (
    id, dispatch_id, driver_id, driver_name, vehicle_plate,
    customer_id, customer_name, customer_address, customer_phone,
    timestamp, delivered_grand_total, payment_method,
    cash_amount, pos_amount, total_collected, diff_uncollected,
    payment_status, notes, is_offline_sync, applied_balance_delta_tl
  ) VALUES (
    v_id, v_dispatch_id, p->>'driver_id', COALESCE(p->>'driver_name', ''),
    COALESCE(p->>'vehicle_plate', ''),
    v_customer_id, COALESCE(p->>'customer_name', ''),
    COALESCE(p->>'customer_address', ''), COALESCE(p->>'customer_phone', ''),
    COALESCE((p->>'timestamp')::timestamptz, now()),
    COALESCE((p->>'delivered_grand_total')::numeric, 0),
    COALESCE(p->>'payment_method', 'UNPAID'),
    COALESCE((p->>'cash_amount')::numeric, 0),
    COALESCE((p->>'pos_amount')::numeric, 0),
    COALESCE((p->>'total_collected')::numeric, 0),
    v_diff,
    COALESCE(p->>'payment_status', 'unpaid'),
    p->>'notes',
    COALESCE((p->>'is_offline_sync')::boolean, false),
    v_diff
  )
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('duplicate', true, 'delivery_id', v_id);
  END IF;

  -- 4) Cari bakiye: peşin ve faturalı ayrımı olmadan kalan tutar borca yazılır.
  IF v_diff <> 0 THEN
    UPDATE public.customers
       SET current_balance_tl = COALESCE(current_balance_tl, 0) + v_diff,
           updated_at = now()
     WHERE id = v_customer_id;
  END IF;

  -- 5) Boş kap bakiyeleri: delta + negatif koruması.
  FOR v_type, v_delta_text IN
    SELECT key, value FROM jsonb_each_text(COALESCE(p->'empty_deltas', '{}'::jsonb))
  LOOP
    v_delta := COALESCE(v_delta_text::int, 0);
    CONTINUE WHEN v_delta = 0;

    SELECT quantity INTO v_qty
    FROM public.customer_empty_balances
    WHERE customer_id = v_customer_id AND deposit_type = v_type
    FOR UPDATE;

    IF NOT FOUND THEN
      v_qty := 0;
    END IF;

    v_qty := v_qty + v_delta;

    INSERT INTO public.customer_empty_balances (customer_id, deposit_type, quantity)
    VALUES (v_customer_id, v_type, v_qty)
    ON CONFLICT (customer_id, deposit_type)
    DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();
  END LOOP;

  -- 6) Teslimat kalemleri
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p->'items', '[]'::jsonb))
  LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO public.delivery_items (
      delivery_id, line_no, product_id, product_name,
      quantity, unit_price, line_total
    ) VALUES (
      v_id,
      COALESCE((v_item->>'line_no')::int, v_line_no),
      v_item->>'product_id',
      COALESCE(v_item->>'product_name', ''),
      COALESCE((v_item->>'quantity')::int, 0),
      COALESCE((v_item->>'unit_price')::numeric, 0),
      COALESCE((v_item->>'line_total')::numeric, 0)
    );
  END LOOP;

  -- 7) Boş kap hareketleri
  FOR v_row IN
    SELECT value FROM jsonb_array_elements(COALESCE(p->'container_returns', '[]'::jsonb))
  LOOP
    INSERT INTO public.delivery_container_returns (
      delivery_id, deposit_type, received_qty, diff_qty
    ) VALUES (
      v_id,
      v_row->>'deposit_type',
      COALESCE((v_row->>'received_qty')::int, 0),
      COALESCE((v_row->>'diff_qty')::int, 0)
    );
  END LOOP;

  -- 8) Müşteri son fiyatları: yalnızca upsert, silme yok.
  FOR v_row IN
    SELECT value FROM jsonb_array_elements(COALESCE(p->'prices', '[]'::jsonb))
  LOOP
    INSERT INTO public.customer_product_prices (customer_id, product_id, unit_price)
    VALUES (
      v_customer_id,
      v_row->>'product_id',
      COALESCE((v_row->>'unit_price')::numeric, 0)
    )
    ON CONFLICT (customer_id, product_id)
    DO UPDATE SET unit_price = EXCLUDED.unit_price, updated_at = now();
  END LOOP;

  RETURN jsonb_build_object('duplicate', false, 'delivery_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_dispatch(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_dispatch_id   TEXT := p->>'dispatch_id';
  v_status        TEXT;
  v_total_value   NUMERIC := 0;
  v_total_cash    NUMERIC := 0;
  v_total_pos     NUMERIC := 0;
  v_total_credit  NUMERIC := 0;
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
         collected_empty_tup = GREATEST(COALESCE((p->>'collected_empty_tup')::int, 0), 0),
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
    'total_credit_added', v_total_credit
  );
END;
$$;

COMMIT;
