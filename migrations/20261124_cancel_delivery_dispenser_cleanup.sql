-- =============================================================================
-- Teslimat iptal/düzeltmesinde eski teslimatın verdiği sebil detaylarını sil.
-- Teslimat fiziksel silinmeden önce customer_dispensers kaynak bağlantısı temizlenir.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.cancel_or_replace_delivery(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_mode                TEXT := COALESCE(p->>'mode', '');
  v_id                  TEXT := p->>'delivery_id';
  v_actor_id            TEXT := p->>'actor_id';
  v_actor_role          TEXT;
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
  v_replacement_id      TEXT;
  v_replacement         JSONB;
  v_old_empty_deltas    JSONB := '{}'::jsonb;
  v_new_empty_deltas    JSONB := '{}'::jsonb;
  v_apply_payload       JSONB;
  v_delta_type          TEXT;
  v_old_delta           INTEGER;
  v_new_delta           INTEGER;
  v_current_qty         INTEGER;
  v_final_qty           INTEGER;
  v_apply_result        JSONB;
  v_updated             INTEGER;
BEGIN
  IF v_id IS NULL OR btrim(v_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: delivery id required';
  END IF;
  IF v_mode NOT IN ('cancel', 'replace') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: invalid mode';
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
    IF v_mode = 'replace' AND EXISTS (
         SELECT 1
         FROM public.deliveries
         WHERE id = v_replacement_id
           AND dispatch_id = v_replacement->>'dispatch_id'
           AND customer_id = v_replacement->>'customer_id'
           AND driver_id = v_actor_id
       ) THEN
      RETURN jsonb_build_object(
        'cancelled', true,
        'duplicate', true,
        'delivery_id', v_id,
        'replacement_delivery_id', v_replacement_id
      );
    END IF;
    RAISE EXCEPTION 'DELIVERY_NOT_FOUND';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.users
  WHERE id = v_actor_id;

  IF NOT FOUND OR v_actor_role <> 'driver'
     OR v_delivery_driver_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Eski sürümden kalan iptal edilmiş satırlar için idempotency.
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

  -- Sefer kilidi: kapatma ve yeni teslimatla yarış sıraya girer.
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
    IF v_mode = 'replace' AND EXISTS (
         SELECT 1
         FROM public.deliveries
         WHERE id = v_replacement_id
           AND dispatch_id = v_replacement->>'dispatch_id'
           AND customer_id = v_replacement->>'customer_id'
           AND driver_id = v_actor_id
       ) THEN
      RETURN jsonb_build_object(
        'cancelled', true,
        'duplicate', true,
        'delivery_id', v_id,
        'replacement_delivery_id', v_replacement_id
      );
    END IF;
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

  -- Teslimat fiziksel olarak silinir; kalemler ve boş kap satırları cascade ile gider.
  -- Silme, bakiye geri alma ve yeni teslimat uygulamasından önce yapılır.
  DELETE FROM public.customer_dispensers WHERE source_delivery_id = v_id;
  DELETE FROM public.deliveries WHERE id = v_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'DELIVERY_NOT_FOUND';
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

  RETURN jsonb_build_object(
    'cancelled', true,
    'duplicate', false,
    'delivery_id', v_id,
    'replacement_delivery_id',
      CASE WHEN v_mode = 'replace' THEN v_replacement_id ELSE NULL END,
    'action', v_mode,
    'previous_balance', v_balance,
    'new_balance', v_new_balance,
    'reversed_balance', v_applied_delta,
    'previous_empty', v_prev_empty,
    'new_empty', v_new_empty,
    'reversed_empty', v_reversed_empty
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_or_replace_delivery(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_or_replace_delivery(jsonb)
  TO service_role;

COMMIT;
