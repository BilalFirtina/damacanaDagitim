-- =============================================================================
-- 20261024 — Boş kap bakiyelerinde negatif değere izin ver
--
-- * customer_empty_balances.quantity üzerindeki tüm CHECK kısıtlarını kaldırır.
--   Yalnızca quantity içeren CHECK'ler hedeflenir; dispatch_items ve
--   delivery_items kısıtlarına dokunulmaz.
-- * apply_delivery ve cancel_or_replace_delivery içindeki negatif bakiye
--   reddi kaldırılır. Boş kap bakiyesi eksiye düşebilir.
-- * admin_update_customer mutlak yazımda negatif değeri korur.
-- * close_dispatch, yalnızca boş kap alınan (kalemsiz) bilinçli teslimatların
--   kapatmayı engellemesini önler; eski eksik kalem koruması sürer.
-- * Fonksiyon yetkileri yeniden daraltılır: yalnızca service_role.
-- =============================================================================

BEGIN;

-- 1) quantity üzerindeki CHECK kısıtlarını dinamik olarak kaldır.
DO $$
DECLARE
  v_constraint RECORD;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.customer_empty_balances'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%quantity%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.customer_empty_balances DROP CONSTRAINT %I',
      v_constraint.conname
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.customer_empty_balances'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%quantity%'
  ) THEN
    RAISE EXCEPTION 'EMPTY_BALANCE_QUANTITY_CONSTRAINT_REMAINS';
  END IF;
END $$;

-- 2) Fonksiyonlar
CREATE OR REPLACE FUNCTION public.cancel_or_replace_delivery(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_mode                TEXT := COALESCE(p->>'mode', '');
  v_id                  TEXT := p->>'delivery_id';
  v_reason              TEXT := btrim(COALESCE(p->>'reason', ''));
  v_actor_id            TEXT := p->>'actor_id';
  v_actor_role          TEXT;
  v_actor_name          TEXT;
  v_dispatch_id         TEXT;
  v_customer_id         TEXT;
  v_delivery_driver_id  TEXT;
  v_status              TEXT;
  v_cancelled_at        TIMESTAMPTZ;
  v_applied_delta       NUMERIC;
  v_replaced_by         TEXT;
  v_dispatch_status     TEXT;
  v_dispatch_driver_id  TEXT;
  v_balance             NUMERIC;
  v_new_balance         NUMERIC;
  v_prev_empty          JSONB := '{}'::jsonb;
  v_new_empty           JSONB := '{}'::jsonb;
  v_reversed_empty      JSONB := '{}'::jsonb;
  v_row                 RECORD;
  v_current_qty         INTEGER;
  v_next_qty            INTEGER;
  v_replacement_id      TEXT;
  v_replacement         JSONB;
  v_old_empty_deltas    JSONB := '{}'::jsonb;
  v_new_empty_deltas    JSONB := '{}'::jsonb;
  v_apply_payload       JSONB;
  v_delta_type          TEXT;
  v_old_delta           INTEGER;
  v_new_delta           INTEGER;
  v_final_qty           INTEGER;
  v_audit_id            BIGINT;
  v_snapshot            JSONB;
  v_apply_result        JSONB;
  v_updated             INTEGER;
BEGIN
  IF v_id IS NULL OR btrim(v_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: delivery id required';
  END IF;
  IF v_mode NOT IN ('cancel', 'replace') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: invalid mode';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;
  IF v_actor_id IS NULL OR btrim(v_actor_id) = '' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_mode = 'replace' THEN
    v_replacement := p->'replacement';
    IF v_replacement IS NULL OR jsonb_typeof(v_replacement) <> 'object' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: replacement required';
    END IF;
    v_replacement_id := v_replacement->>'id';
    IF v_replacement_id IS NULL OR btrim(v_replacement_id) = ''
       OR v_replacement_id = v_id THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: invalid replacement id';
    END IF;
  END IF;

  -- Hızlı idempotency kontrolü. Kilit alınmadan yalnızca durum okunur.
  SELECT dispatch_id, customer_id, driver_id, status, cancelled_at,
         applied_balance_delta_tl, replaced_by_delivery_id
    INTO v_dispatch_id, v_customer_id, v_delivery_driver_id, v_status,
         v_cancelled_at, v_applied_delta, v_replaced_by
  FROM public.deliveries
  WHERE id = v_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_NOT_FOUND';
  END IF;

  SELECT role, name INTO v_actor_role, v_actor_name
  FROM public.users
  WHERE id = v_actor_id;

  IF NOT FOUND OR v_actor_role <> 'driver'
     OR v_delivery_driver_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  v_actor_name := COALESCE(NULLIF(btrim(v_actor_name), ''), 'Şoför');

  IF v_status = 'cancelled' OR v_cancelled_at IS NOT NULL THEN
    IF v_mode = 'cancel' THEN
      RETURN jsonb_build_object(
        'cancelled', true,
        'duplicate', true,
        'delivery_id', v_id
      );
    END IF;
    IF v_replaced_by IS NOT NULL AND v_replaced_by = v_replacement_id THEN
      RETURN jsonb_build_object(
        'cancelled', true,
        'duplicate', true,
        'delivery_id', v_id,
        'replacement_delivery_id', v_replaced_by
      );
    END IF;
    RAISE EXCEPTION 'DELIVERY_ALREADY_CANCELLED';
  END IF;

  IF v_applied_delta IS NULL THEN
    RAISE EXCEPTION 'CANCEL_HISTORICAL_UNSUPPORTED';
  END IF;

  -- Sefer kilidi: kapatma/yeniden açma ve yeni teslimatla yarış sıraya girer.
  SELECT status, driver_id INTO v_dispatch_status, v_dispatch_driver_id
  FROM public.dispatches
  WHERE id = v_dispatch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DISPATCH_NOT_FOUND';
  END IF;
  IF v_dispatch_status NOT IN ('pending_confirmation', 'in_transit') THEN
    RAISE EXCEPTION 'DISPATCH_CLOSED';
  END IF;
  IF v_dispatch_driver_id IS DISTINCT FROM v_actor_id
     OR v_delivery_driver_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Teslimat kilidi ve kilit altında ikinci idempotency kontrolü.
  SELECT status, cancelled_at, applied_balance_delta_tl, replaced_by_delivery_id
    INTO v_status, v_cancelled_at, v_applied_delta, v_replaced_by
  FROM public.deliveries
  WHERE id = v_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_NOT_FOUND';
  END IF;
  IF v_status = 'cancelled' OR v_cancelled_at IS NOT NULL THEN
    IF v_mode = 'cancel' THEN
      RETURN jsonb_build_object(
        'cancelled', true,
        'duplicate', true,
        'delivery_id', v_id
      );
    END IF;
    IF v_replaced_by IS NOT NULL AND v_replaced_by = v_replacement_id THEN
      RETURN jsonb_build_object(
        'cancelled', true,
        'duplicate', true,
        'delivery_id', v_id,
        'replacement_delivery_id', v_replaced_by
      );
    END IF;
    RAISE EXCEPTION 'DELIVERY_ALREADY_CANCELLED';
  END IF;
  IF v_applied_delta IS NULL THEN
    RAISE EXCEPTION 'CANCEL_HISTORICAL_UNSUPPORTED';
  END IF;

  IF v_mode = 'replace' THEN
    IF v_replacement->>'dispatch_id' IS DISTINCT FROM v_dispatch_id
       OR v_replacement->>'customer_id' IS DISTINCT FROM v_customer_id
       OR v_replacement->>'driver_id' IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: replacement context mismatch';
    END IF;
    IF EXISTS (SELECT 1 FROM public.deliveries WHERE id = v_replacement_id) THEN
      RAISE EXCEPTION 'REPLACEMENT_ID_CONFLICT';
    END IF;
  END IF;

  -- Müşteri kilidi: aynı müşteriye eşzamanlı teslimat/iptal işlemleri sıraya girer.
  SELECT current_balance_tl INTO v_balance
  FROM public.customers
  WHERE id = v_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;
  v_balance := COALESCE(v_balance, 0);

  SELECT COALESCE(jsonb_object_agg(deposit_type, quantity), '{}'::jsonb)
    INTO v_prev_empty
  FROM public.customer_empty_balances
  WHERE customer_id = v_customer_id;

  SELECT COALESCE(jsonb_object_agg(deposit_type, diff_qty), '{}'::jsonb)
    INTO v_old_empty_deltas
  FROM public.delivery_container_returns
  WHERE delivery_id = v_id;

  IF v_mode = 'replace' THEN
    SELECT COALESCE(jsonb_object_agg(
             r->>'deposit_type',
             COALESCE((r->>'diff_qty')::int, 0)
           ), '{}'::jsonb)
      INTO v_new_empty_deltas
    FROM jsonb_array_elements(
      COALESCE(v_replacement->'container_returns', '[]'::jsonb)
    ) AS r;
  END IF;

  -- Boş kap net etkisi: mevcut - eski delta + yeni delta. Düzenlemede
  -- eski teslimat geri alınıp yenisi uygulanırken ara adım negatife düşse
  -- bile nihai bakiye negatif değilse işlem geçerlidir. Nihai bakiye
  -- negatifse hiçbir değişiklik yazılmaz; transaction tamamen geri alınır.
  FOR v_delta_type IN
    SELECT key FROM jsonb_each(COALESCE(v_old_empty_deltas, '{}'::jsonb))
    UNION
    SELECT key FROM jsonb_each(COALESCE(v_new_empty_deltas, '{}'::jsonb))
  LOOP
    v_old_delta := COALESCE((v_old_empty_deltas->>v_delta_type)::int, 0);
    v_new_delta := COALESCE((v_new_empty_deltas->>v_delta_type)::int, 0);
    CONTINUE WHEN v_old_delta = 0 AND v_new_delta = 0;

    SELECT quantity INTO v_current_qty
    FROM public.customer_empty_balances
    WHERE customer_id = v_customer_id AND deposit_type = v_delta_type
    FOR UPDATE;

    IF NOT FOUND THEN
      v_current_qty := 0;
    END IF;

    v_final_qty := v_current_qty - v_old_delta + v_new_delta;

    INSERT INTO public.customer_empty_balances (customer_id, deposit_type, quantity)
    VALUES (v_customer_id, v_delta_type, v_final_qty)
    ON CONFLICT (customer_id, deposit_type)
    DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();

    IF v_old_delta <> 0 THEN
      v_reversed_empty := v_reversed_empty || jsonb_build_object(
        v_delta_type, v_old_delta
      );
    END IF;
  END LOOP;

  IF v_applied_delta <> 0 THEN
    UPDATE public.customers
       SET current_balance_tl = COALESCE(current_balance_tl, 0) - v_applied_delta,
           updated_at = now()
     WHERE id = v_customer_id;
  END IF;

  UPDATE public.deliveries
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by_user_id = v_actor_id,
         cancelled_by_user_name = v_actor_name,
         cancel_reason = v_reason,
         replaced_by_delivery_id = CASE
           WHEN v_mode = 'replace' THEN v_replacement_id
           ELSE NULL
         END
   WHERE id = v_id
     AND status = 'active';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'DELIVERY_ALREADY_CANCELLED';
  END IF;

  IF v_mode = 'replace' THEN
    -- Boş kap bakiyeleri yukarıda eski+yeni net etkiyle zaten yazıldı.
    -- apply_delivery yalnızca teslimat/kalem/fiyat/bakiye yazsın diye
    -- empty_deltas boşaltılır; container_returns gerçek değerleriyle kalır.
    v_apply_payload := jsonb_set(
      v_replacement,
      '{empty_deltas}',
      '{}'::jsonb,
      true
    );
    v_apply_result := public.apply_delivery(v_apply_payload);
    IF COALESCE((v_apply_result->>'duplicate')::boolean, false) THEN
      RAISE EXCEPTION 'REPLACEMENT_ID_CONFLICT';
    END IF;
  END IF;

  SELECT current_balance_tl INTO v_new_balance
  FROM public.customers
  WHERE id = v_customer_id;

  SELECT COALESCE(jsonb_object_agg(deposit_type, quantity), '{}'::jsonb)
    INTO v_new_empty
  FROM public.customer_empty_balances
  WHERE customer_id = v_customer_id;

  SELECT jsonb_build_object(
    'delivery', to_jsonb(d),
    'items', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) ORDER BY i.line_no)
      FROM public.delivery_items i
      WHERE i.delivery_id = v_id
    ), '[]'::jsonb),
    'container_returns', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.deposit_type)
      FROM public.delivery_container_returns c
      WHERE c.delivery_id = v_id
    ), '[]'::jsonb)
  )
    INTO v_snapshot
  FROM public.deliveries d
  WHERE d.id = v_id;

  INSERT INTO public.delivery_cancellation_audit (
    delivery_id, dispatch_id, customer_id, action,
    performed_by_user_id, performed_by_user_name, reason,
    replacement_delivery_id, previous_balance, new_balance, reversed_balance,
    previous_empty, new_empty, reversed_empty, delivery_snapshot
  ) VALUES (
    v_id, v_dispatch_id, v_customer_id, v_mode,
    v_actor_id, v_actor_name, v_reason,
    CASE WHEN v_mode = 'replace' THEN v_replacement_id ELSE NULL END,
    v_balance, v_new_balance, v_applied_delta,
    v_prev_empty, v_new_empty, v_reversed_empty, COALESCE(v_snapshot, '{}'::jsonb)
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'cancelled', true,
    'duplicate', false,
    'delivery_id', v_id,
    'replacement_delivery_id',
      CASE WHEN v_mode = 'replace' THEN v_replacement_id ELSE NULL END,
    'action', v_mode,
    'audit_id', v_audit_id,
    'previous_balance', v_balance,
    'new_balance', v_new_balance,
    'reversed_balance', v_applied_delta,
    'previous_empty', v_prev_empty,
    'new_empty', v_new_empty,
    'reversed_empty', v_reversed_empty
  );
END;
$$;

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
  v_account         BOOLEAN;
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
  SELECT is_account_customer INTO v_account
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
    CASE WHEN COALESCE(v_account, false) THEN v_diff ELSE 0 END
  )
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('duplicate', true, 'delivery_id', v_id);
  END IF;

  -- 4) Cari bakiye: yalnızca hesap müşterisi, delta olarak.
  IF COALESCE(v_account, false) AND v_diff <> 0 THEN
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

  -- Cariye eklenen borç yalnızca hesap müşterileri içindir. Hesap dışı
  -- müşterilerde kalan tutar tahsil edilmemiş satıştır; cari borç değildir.
  SELECT
    COALESCE(SUM(COALESCE(d.delivered_grand_total, 0)), 0),
    COALESCE(SUM(COALESCE(d.cash_amount, 0)), 0),
    COALESCE(SUM(COALESCE(d.pos_amount, 0)), 0),
    COALESCE(SUM(
      CASE WHEN COALESCE(c.is_account_customer, false)
           THEN GREATEST(COALESCE(d.diff_uncollected, 0), 0)
           ELSE 0 END
    ), 0)
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

CREATE OR REPLACE FUNCTION public.admin_update_customer(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id            TEXT := p->>'customer_id';
  v_current       NUMERIC;
  v_expected      NUMERIC;
  v_next          NUMERIC;
  v_type          TEXT;
  v_current_qty   INTEGER;
  v_expected_qty  INTEGER;
  v_next_text     TEXT;
  v_has_balance   BOOLEAN := (p ? 'new_balance');
  v_has_empty     BOOLEAN := (p ? 'new_empty');
  v_actor_id      TEXT := p->>'changed_by_user_id';
  v_actor_name    TEXT;
  v_actor_role    TEXT;
  v_reason        TEXT := btrim(COALESCE(p->>'reason', ''));
  v_prev_balance  NUMERIC;
  v_prev_empty    JSONB := '{}'::jsonb;
  v_updated       INTEGER;
BEGIN
  IF v_id IS NULL OR btrim(v_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: customer id required';
  END IF;
  IF v_actor_id IS NULL OR btrim(v_actor_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: manager id required';
  END IF;

  SELECT role, name INTO v_actor_role, v_actor_name
  FROM public.users
  WHERE id = v_actor_id;

  IF NOT FOUND OR v_actor_role <> 'admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT current_balance_tl INTO v_current
  FROM public.customers
  WHERE id = v_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;
  v_prev_balance := v_current;

  IF v_has_empty THEN
    SELECT COALESCE(jsonb_object_agg(deposit_type, quantity), '{}'::jsonb)
      INTO v_prev_empty
    FROM public.customer_empty_balances
    WHERE customer_id = v_id;
  END IF;

  IF v_has_balance THEN
    IF NOT (p ? 'expected_balance') OR p->>'expected_balance' IS NULL THEN
      RAISE EXCEPTION 'EXPECTATION_REQUIRED';
    END IF;
    v_expected := (p->>'expected_balance')::numeric;
    v_next := COALESCE((p->>'new_balance')::numeric, 0);
    IF COALESCE(v_current, 0) IS DISTINCT FROM v_expected THEN
      RETURN jsonb_build_object(
        'conflict', true,
        'code', 'BALANCE_CONFLICT',
        'current_balance', COALESCE(v_current, 0)
      );
    END IF;
  END IF;

  IF v_has_empty THEN
    IF NOT (p ? 'expected_empty') OR p->'expected_empty' IS NULL
       OR jsonb_typeof(p->'expected_empty') <> 'object'
       OR jsonb_typeof(p->'new_empty') <> 'object' THEN
      RAISE EXCEPTION 'EXPECTATION_REQUIRED';
    END IF;

    FOR v_type IN
      SELECT key FROM jsonb_each(COALESCE(p->'new_empty', '{}'::jsonb))
    LOOP
      v_expected_qty := COALESCE((p->'expected_empty'->>v_type)::int, 0);

      SELECT quantity INTO v_current_qty
      FROM public.customer_empty_balances
      WHERE customer_id = v_id AND deposit_type = v_type
      FOR UPDATE;

      IF NOT FOUND THEN
        v_current_qty := 0;
      END IF;

      IF v_current_qty IS DISTINCT FROM v_expected_qty THEN
        RETURN jsonb_build_object(
          'conflict', true,
          'code', 'EMPTY_CONFLICT',
          'deposit_type', v_type,
          'current_qty', v_current_qty
        );
      END IF;
    END LOOP;
  END IF;

  UPDATE public.customers
     SET name = CASE WHEN p ? 'name' THEN p->>'name' ELSE name END,
         phone = CASE WHEN p ? 'phone' THEN p->>'phone' ELSE phone END,
         address = CASE WHEN p ? 'address' THEN p->>'address' ELSE address END,
         emails = CASE WHEN p ? 'emails' THEN (p->'emails') ELSE emails END,
         is_account_customer = CASE
           WHEN p ? 'is_account_customer'
           THEN (p->>'is_account_customer')::boolean
           ELSE is_account_customer
         END,
         notes = CASE WHEN p ? 'notes' THEN p->>'notes' ELSE notes END,
         current_balance_tl = CASE
           WHEN v_has_balance THEN v_next
           ELSE current_balance_tl
         END,
         updated_at = now()
   WHERE id = v_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'CUSTOMER_UPDATE_NOT_APPLIED';
  END IF;

  IF v_has_empty THEN
    FOR v_type, v_next_text IN
      SELECT key, value FROM jsonb_each_text(COALESCE(p->'new_empty', '{}'::jsonb))
    LOOP
      INSERT INTO public.customer_empty_balances (customer_id, deposit_type, quantity)
      VALUES (v_id, v_type, COALESCE(v_next_text::int, 0))
      ON CONFLICT (customer_id, deposit_type)
      DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();
    END LOOP;
  END IF;

  IF v_has_balance OR v_has_empty THEN
    INSERT INTO public.customer_financial_audit (
      customer_id, changed_by_user_id, changed_by_user_name, reason,
      previous_balance, new_balance, previous_empty, new_empty
    ) VALUES (
      v_id,
      v_actor_id,
      v_actor_name,
      COALESCE(NULLIF(v_reason, ''), 'Yönetici düzeltmesi'),
      v_prev_balance,
      CASE WHEN v_has_balance THEN v_next ELSE v_prev_balance END,
      v_prev_empty,
      CASE WHEN v_has_empty THEN COALESCE(p->'new_empty', '{}'::jsonb) ELSE v_prev_empty END
    );
  END IF;

  RETURN jsonb_build_object('conflict', false, 'customer_id', v_id);
END;
$$;

-- 3) EXECUTE yetkileri: PUBLIC/anon/authenticated kapalı, service_role açık.
REVOKE EXECUTE ON FUNCTION public.cancel_or_replace_delivery(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_or_replace_delivery(jsonb)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.apply_delivery(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_delivery(jsonb)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.close_dispatch(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_dispatch(jsonb)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_update_customer(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_customer(jsonb)
  TO service_role;

COMMIT;
