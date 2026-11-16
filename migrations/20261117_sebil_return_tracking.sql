-- =============================================================================
-- SEBİL İADE TAKİBİ
--
-- * customer_dispensers kayıtlarına kaynak teslimat bağlantısı eklenir.
-- * Kapanışta toplanan sebil adedi dispatch üzerinde saklanır.
-- * "Boşları Sıfırla" işlemi sebil detaylarını da aynı transaction'da siler.
-- =============================================================================

BEGIN;

ALTER TABLE public.customer_dispensers
  ADD COLUMN IF NOT EXISTS source_delivery_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_dispensers_source_delivery
  ON public.customer_dispensers(source_delivery_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_dispensers_source_delivery_fk'
  ) THEN
    ALTER TABLE public.customer_dispensers
      ADD CONSTRAINT customer_dispensers_source_delivery_fk
      FOREIGN KEY (source_delivery_id)
      REFERENCES public.deliveries(id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS collected_empty_sebil INTEGER NULL;

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
  v_total_sebil   INTEGER := 0;
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

  -- Toplanan sebil adedi teslimatlardan hesaplanır; istemciden alınmaz.
  SELECT COALESCE(SUM(COALESCE(r.received_qty, 0)), 0)
  INTO v_total_sebil
  FROM public.deliveries d
  JOIN public.delivery_container_returns r ON r.delivery_id = d.id
  WHERE d.dispatch_id = v_dispatch_id
    AND d.cancelled_at IS NULL
    AND r.deposit_type = 'sebil';

  -- Ürün verilmeden alınan aktif tahsilatlar kasa/POS mutabakatına girer.
  SELECT
    COALESCE(SUM(CASE WHEN method = 'CASH' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN method = 'POS' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN method = 'TRANSFER' THEN amount ELSE 0 END), 0)
  INTO v_standalone_cash, v_standalone_pos, v_standalone_transfer
  FROM public.customer_payments
  WHERE dispatch_id = v_dispatch_id
    AND status = 'active';

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
         collected_empty_sebil = v_total_sebil,
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
    'total_standalone_transfer', v_standalone_transfer,
    'collected_empty_sebil', v_total_sebil
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
  v_clear_dispensers BOOLEAN := COALESCE((p->>'clear_dispensers')::boolean, false);
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

  IF v_clear_dispensers THEN
    DELETE FROM public.customer_dispensers WHERE customer_id = v_id;
  END IF;

  IF v_has_balance OR v_has_empty OR v_clear_dispensers THEN
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

GRANT EXECUTE ON FUNCTION public.close_dispatch(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_customer(jsonb) TO service_role;

COMMIT;
