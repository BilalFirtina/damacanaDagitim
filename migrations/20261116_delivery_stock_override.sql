-- =============================================================================
-- 20261116 — ŞOFÖR ONAYLI ARAÇ STOK AŞIMI
--
-- Normalde araç stoğu aşılamaz. Şoför, teslimat formundaki uyarıyı açıkça
-- onaylarsa teslimat kaydedilebilir; bu istisna deliveries.stock_override ve
-- stock_override_details alanlarında denetlenebilir biçimde saklanır.
--
-- Additive ve geriye uyumludur. Mevcut teslimatlar stock_override=false kalır.
-- =============================================================================

BEGIN;

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS stock_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stock_override_details JSONB NOT NULL DEFAULT '[]'::jsonb;

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
  v_stock_override  BOOLEAN := COALESCE((p->>'stock_override')::boolean, false);
  v_override_details JSONB := '[]'::jsonb;
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

  -- 4) Araç stoğu: negatif miktar her zaman reddedilir. Yüklenen - önceki
  --    teslimattan fazlası ise yalnızca şoförün açık onayıyla (stock_override)
  --    kabul edilir; aşım detayı kayda yazılır.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p->'items', '[]'::jsonb)) AS i
    WHERE COALESCE((i->>'quantity')::int, 0) < 0
  ) THEN
    RAISE EXCEPTION 'INSUFFICIENT_VEHICLE_STOCK';
  END IF;

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
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'productId', n.product_id,
               'productName', COALESCE(pr.name, n.product_id),
               'loaded', GREATEST(COALESCE(li.quantity, 0), 0),
               'deliveredBefore', GREATEST(COALESCE(d.qty, 0), 0),
               'remaining', GREATEST(COALESCE(li.quantity, 0) - COALESCE(d.qty, 0), 0),
               'requested', n.qty,
               'oversell', n.qty - GREATEST(COALESCE(li.quantity, 0) - COALESCE(d.qty, 0), 0)
             )
           ),
           '[]'::jsonb
         )
  INTO v_override_details
  FROM new_items n
  LEFT JOIN public.dispatch_items li
    ON li.dispatch_id = v_dispatch_id AND li.product_id = n.product_id
  LEFT JOIN delivered d ON d.product_id = n.product_id
  LEFT JOIN public.products pr ON pr.id = n.product_id
  WHERE n.qty > GREATEST(COALESCE(li.quantity, 0) - COALESCE(d.qty, 0), 0);

  IF jsonb_array_length(v_override_details) > 0 AND NOT v_stock_override THEN
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
    payment_status, notes, is_offline_sync, applied_balance_delta_tl,
    stock_override, stock_override_details
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
    v_diff,
    (v_stock_override AND jsonb_array_length(v_override_details) > 0),
    v_override_details
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

COMMIT;
