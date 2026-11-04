-- =============================================================================
-- ŞOFÖR TAHSİLATINI AKTİF SEFERE BAĞLAMA
--
-- Amaç:
--   * Şoförün ürün vermeden aldığı tahsilat, aktif seferiyle ilişkilendirilir.
--   * Gün sonu kasa/POS mutabakatı bu tahsilatları da içerir; böylece
--     şoförün elindeki nakit ile beklenen nakit tutarlı olur.
--   * 60 günlük temizlikte sefer silinse bile tahsilat kaydı korunur:
--     FK ON DELETE SET NULL.
--
-- Additive ve geriye dönük uyumludur. dispatch_id boş olan eski/admin
-- tahsilatları aynen çalışmaya devam eder.
-- =============================================================================

BEGIN;

ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS dispatch_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_payments_dispatch_id_fkey'
      AND conrelid = 'public.customer_payments'::regclass
  ) THEN
    ALTER TABLE public.customer_payments
      ADD CONSTRAINT customer_payments_dispatch_id_fkey
      FOREIGN KEY (dispatch_id) REFERENCES public.dispatches(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_payments_dispatch
  ON public.customer_payments(dispatch_id, collected_at DESC);

CREATE OR REPLACE FUNCTION public.record_customer_payment(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_payment_id TEXT := p->>'payment_id';
  v_customer_id TEXT := p->>'customer_id';
  v_amount NUMERIC := COALESCE((p->>'amount')::numeric, 0);
  v_method TEXT := COALESCE(p->>'method', 'CASH');
  v_note TEXT := COALESCE(p->>'note', '');
  v_user_id TEXT := p->>'collected_by_user_id';
  v_user_name TEXT := p->>'collected_by_user_name';
  v_dispatch_id TEXT := NULLIF(p->>'dispatch_id', '');
  v_dispatch_status TEXT;
  v_previous NUMERIC;
  v_new NUMERIC;
  v_existing RECORD;
BEGIN
  IF v_payment_id IS NULL OR v_payment_id = '' THEN
    RAISE EXCEPTION 'PAYMENT_ID_REQUIRED';
  END IF;
  IF v_customer_id IS NULL OR v_customer_id = '' THEN
    RAISE EXCEPTION 'CUSTOMER_REQUIRED';
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'PAYMENT_AMOUNT_INVALID';
  END IF;
  IF v_method NOT IN ('CASH', 'POS', 'TRANSFER') THEN
    RAISE EXCEPTION 'PAYMENT_METHOD_INVALID';
  END IF;
  IF v_user_id IS NULL OR v_user_name IS NULL THEN
    RAISE EXCEPTION 'ACTOR_REQUIRED';
  END IF;

  -- Şoför tahsilatı aktif seferine bağlanır; böylece gün sonu kasa
  -- mutabakatına ve rapora dahil edilebilir.
  IF v_dispatch_id IS NOT NULL THEN
    SELECT status INTO v_dispatch_status
    FROM public.dispatches
    WHERE id = v_dispatch_id
      AND driver_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'DISPATCH_NOT_FOUND';
    END IF;
    IF v_dispatch_status IS DISTINCT FROM 'in_transit' THEN
      RAISE EXCEPTION 'DISPATCH_NOT_OPEN';
    END IF;
  END IF;

  -- Idempotency: aynı payment_id tekrar gönderilirse bakiye İKİ KEZ düşmez.
  SELECT id, amount, customer_id, dispatch_id INTO v_existing
  FROM public.customer_payments
  WHERE id = v_payment_id;

  IF FOUND THEN
    SELECT current_balance_tl INTO v_new
    FROM public.customers
    WHERE id = v_existing.customer_id;

    RETURN jsonb_build_object(
      'payment_id', v_existing.id,
      'already_applied', true,
      'balance', v_new,
      'dispatch_id', v_existing.dispatch_id
    );
  END IF;

  SELECT current_balance_tl INTO v_previous
  FROM public.customers
  WHERE id = v_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  v_previous := COALESCE(v_previous, 0);
  v_new := v_previous - v_amount;

  UPDATE public.customers
  SET current_balance_tl = v_new
  WHERE id = v_customer_id;

  INSERT INTO public.customer_payments
    (id, customer_id, amount, method, note, collected_by_user_id, collected_by_user_name, dispatch_id)
  VALUES
    (v_payment_id, v_customer_id, v_amount, v_method, v_note, v_user_id, v_user_name, v_dispatch_id);

  -- Denetim izi: bakiye değişikliği kim tarafından ve neden yapıldı.
  INSERT INTO public.customer_financial_audit
    (customer_id, changed_by_user_id, changed_by_user_name, reason, previous_balance, new_balance)
  VALUES
    (
      v_customer_id,
      v_user_id,
      v_user_name,
      'Tahsilat (' || v_method || ')' || CASE WHEN v_note <> '' THEN ': ' || v_note ELSE '' END,
      v_previous,
      v_new
    );

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'already_applied', false,
    'previous_balance', v_previous,
    'balance', v_new,
    'dispatch_id', v_dispatch_id
  );
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
    'total_credit_added', v_total_credit,
    'total_standalone_cash', v_standalone_cash,
    'total_standalone_pos', v_standalone_pos,
    'total_standalone_transfer', v_standalone_transfer
  );
END;
$$;

-- Denetim izi korunur; yalnızca 60 günlük temizlikte sefer silinirken FK'nın
-- dispatch_id alanını NULL'a çekmesine izin verilir. Diğer tüm güncelleme ve
-- silme işlemleri reddedilir.
CREATE OR REPLACE FUNCTION public.prevent_customer_payment_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.dispatch_id IS NOT NULL
     AND NEW.dispatch_id IS NULL
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id
     AND NEW.amount IS NOT DISTINCT FROM OLD.amount
     AND NEW.method IS NOT DISTINCT FROM OLD.method
     AND NEW.note IS NOT DISTINCT FROM OLD.note
     AND NEW.collected_by_user_id IS NOT DISTINCT FROM OLD.collected_by_user_id
     AND NEW.collected_by_user_name IS NOT DISTINCT FROM OLD.collected_by_user_name
     AND NEW.collected_at IS NOT DISTINCT FROM OLD.collected_at
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'CUSTOMER_PAYMENT_IMMUTABLE';
END;
$$;

COMMIT;
