-- =============================================================================
-- 20261116 — TESLİMAT DIŞI TAHSİLAT DÜZELTME / İPTAL
--
-- * customer_payments: status + düzeltme denetim alanları.
-- * customer_payment_audit: eski/yeni tutar, yöntem, not, bakiye ve aktör.
-- * amend_customer_payment(): bakiye + tahsilat + denetim tek transaction.
-- * close_dispatch(): yalnızca aktif tahsilatları kasa/POS toplamına katar.
--
-- Additive ve geriye uyumludur. Mevcut tahsilat kayıtları 'active' olur.
-- Tahsilatlar silinmez; iptal edilen kayıt status='cancelled' olarak korunur.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) customer_payments — durum ve düzeltme alanları
-- -----------------------------------------------------------------------------

ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS corrected_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS corrected_by_user_name TEXT,
  ADD COLUMN IF NOT EXISTS correction_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_payments_status_check'
      AND conrelid = 'public.customer_payments'::regclass
  ) THEN
    ALTER TABLE public.customer_payments
      ADD CONSTRAINT customer_payments_status_check
      CHECK (status IN ('active', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_payments_correction_count_check'
      AND conrelid = 'public.customer_payments'::regclass
  ) THEN
    ALTER TABLE public.customer_payments
      ADD CONSTRAINT customer_payments_correction_count_check
      CHECK (correction_count >= 0);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2) customer_payment_audit — değiştirilemez denetim kaydı
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.customer_payment_audit (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  payment_id TEXT NOT NULL REFERENCES public.customer_payments(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('update', 'cancel')),
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  previous_amount NUMERIC(14,2) NOT NULL,
  new_amount NUMERIC(14,2) NOT NULL,
  previous_method TEXT NOT NULL,
  new_method TEXT NOT NULL,
  previous_note TEXT NOT NULL DEFAULT '',
  new_note TEXT NOT NULL DEFAULT '',
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  previous_balance NUMERIC(14,2) NOT NULL,
  new_balance NUMERIC(14,2) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_payment_audit_payment
  ON public.customer_payment_audit(payment_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_payment_audit_customer
  ON public.customer_payment_audit(customer_id, changed_at DESC);

ALTER TABLE public.customer_payment_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_payment_audit_select ON public.customer_payment_audit;
DROP POLICY IF EXISTS customer_payment_audit_insert ON public.customer_payment_audit;

CREATE POLICY customer_payment_audit_select
  ON public.customer_payment_audit
  FOR SELECT USING (true);

CREATE POLICY customer_payment_audit_insert
  ON public.customer_payment_audit
  FOR INSERT WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.prevent_customer_payment_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'PAYMENT_AUDIT_IMMUTABLE';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_payment_audit_no_update_delete
  ON public.customer_payment_audit;
CREATE TRIGGER trg_customer_payment_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON public.customer_payment_audit
  FOR EACH ROW EXECUTE FUNCTION public.prevent_customer_payment_audit_mutation();

DROP TRIGGER IF EXISTS trg_customer_payment_audit_no_truncate
  ON public.customer_payment_audit;
CREATE TRIGGER trg_customer_payment_audit_no_truncate
  BEFORE TRUNCATE ON public.customer_payment_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_customer_payment_audit_mutation();

-- Tablo yalnızca sunucu/service_role üzerinden okunup yazılabilir.
REVOKE ALL ON TABLE public.customer_payment_audit FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.customer_payment_audit FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.customer_payment_audit FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.customer_payment_audit TO service_role';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.customer_payment_audit_id_seq TO service_role';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3) Tahsilat mutasyon trigger'ı — yalnızca yetkili RPC istisnası
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_customer_payment_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;

  -- amend_customer_payment() transaction içinde bu bayrağı açar.
  IF TG_OP = 'UPDATE'
     AND current_setting('app.payment_correction', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- 60 günlük temizlik sırasında sefer silinirse dispatch_id NULL'a çekilir.
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

-- -----------------------------------------------------------------------------
-- 4) amend_customer_payment — bakiye + tahsilat + denetim
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.amend_customer_payment(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id TEXT := NULLIF(p->>'request_id', '');
  v_payment_id TEXT := p->>'payment_id';
  v_mode TEXT := COALESCE(p->>'mode', 'update');
  v_amount NUMERIC := COALESCE((p->>'amount')::numeric, 0);
  v_method TEXT := COALESCE(p->>'method', '');
  v_note TEXT := COALESCE(p->>'note', '');
  v_actor_id TEXT := NULLIF(p->>'actor_id', '');
  v_actor_name TEXT := NULLIF(p->>'actor_name', '');
  v_existing RECORD;
  v_audit RECORD;
  v_previous NUMERIC;
  v_new_balance NUMERIC;
  v_new_amount NUMERIC;
  v_new_method TEXT;
  v_new_note TEXT;
  v_new_status TEXT;
  v_delta NUMERIC;
  v_reason TEXT;
BEGIN
  IF v_request_id IS NULL OR btrim(v_request_id) = '' THEN
    RAISE EXCEPTION 'REQUEST_ID_REQUIRED';
  END IF;
  IF v_payment_id IS NULL OR btrim(v_payment_id) = '' THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
  END IF;
  IF v_actor_id IS NULL OR v_actor_name IS NULL THEN
    RAISE EXCEPTION 'ACTOR_REQUIRED';
  END IF;
  IF v_mode NOT IN ('update', 'cancel') THEN
    RAISE EXCEPTION 'PAYMENT_MODE_INVALID';
  END IF;

  -- Idempotency: aynı request_id tekrar gelirse bakiye ikinci kez değişmez.
  SELECT * INTO v_audit
  FROM public.customer_payment_audit
  WHERE request_id = v_request_id;

  IF FOUND THEN
    SELECT current_balance_tl INTO v_new_balance
    FROM public.customers
    WHERE id = v_audit.customer_id;

    RETURN jsonb_build_object(
      'payment_id', v_audit.payment_id,
      'already_applied', true,
      'balance', COALESCE(v_new_balance, 0),
      'status', v_audit.new_status
    );
  END IF;

  SELECT * INTO v_existing
  FROM public.customer_payments
  WHERE id = v_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
  END IF;
  IF v_existing.status = 'cancelled' THEN
    RAISE EXCEPTION 'PAYMENT_ALREADY_CANCELLED';
  END IF;

  SELECT current_balance_tl INTO v_previous
  FROM public.customers
  WHERE id = v_existing.customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;
  v_previous := COALESCE(v_previous, 0);

  IF v_mode = 'cancel' THEN
    -- Tutar tarihsel kayıt olarak korunur; bakiye tahsilat kadar geri eklenir.
    v_new_amount := v_existing.amount;
    v_new_method := v_existing.method;
    v_new_note := v_existing.note;
    v_new_status := 'cancelled';
    v_delta := -v_existing.amount;
    v_reason := 'Tahsilat iptali (' || v_existing.method || ' ' ||
      to_char(v_existing.amount, 'FM999999999999990.00') || ' TL)';
  ELSE
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'PAYMENT_AMOUNT_INVALID';
    END IF;
    IF v_method NOT IN ('CASH', 'POS', 'TRANSFER') THEN
      RAISE EXCEPTION 'PAYMENT_METHOD_INVALID';
    END IF;

    v_new_amount := v_amount;
    v_new_method := v_method;
    v_new_note := v_note;
    v_new_status := 'active';
    v_delta := v_new_amount - v_existing.amount;
    v_reason := 'Tahsilat düzeltmesi (' || v_existing.method || ' ' ||
      to_char(v_existing.amount, 'FM999999999999990.00') || ' TL -> ' ||
      v_new_method || ' ' || to_char(v_new_amount, 'FM999999999999990.00') || ' TL)';
  END IF;

  -- Tahsilat bakiyeyi azaltır; delta pozitifse bakiye artar.
  v_new_balance := v_previous - v_delta;

  UPDATE public.customers
  SET current_balance_tl = v_new_balance
  WHERE id = v_existing.customer_id;

  PERFORM set_config('app.payment_correction', 'on', true);

  UPDATE public.customer_payments
  SET amount = v_new_amount,
      method = v_new_method,
      note = v_new_note,
      status = v_new_status,
      corrected_at = now(),
      corrected_by_user_id = v_actor_id,
      corrected_by_user_name = v_actor_name,
      correction_count = correction_count + 1
  WHERE id = v_payment_id;

  PERFORM set_config('app.payment_correction', 'off', true);

  -- Kapanmış seferin kasa/POS toplamları da düzeltilmiş tahsilata göre yenilenir.
  IF v_existing.dispatch_id IS NOT NULL THEN
    UPDATE public.dispatches d
    SET total_cash_collected = (
          SELECT COALESCE(SUM(del.cash_amount), 0)
          FROM public.deliveries del
          WHERE del.dispatch_id = d.id
            AND del.cancelled_at IS NULL
        ) + (
          SELECT COALESCE(SUM(cp.amount), 0)
          FROM public.customer_payments cp
          WHERE cp.dispatch_id = d.id
            AND cp.status = 'active'
            AND cp.method = 'CASH'
        ),
        total_pos_collected = (
          SELECT COALESCE(SUM(del.pos_amount), 0)
          FROM public.deliveries del
          WHERE del.dispatch_id = d.id
            AND del.cancelled_at IS NULL
        ) + (
          SELECT COALESCE(SUM(cp.amount), 0)
          FROM public.customer_payments cp
          WHERE cp.dispatch_id = d.id
            AND cp.status = 'active'
            AND cp.method = 'POS'
        )
    WHERE d.id = v_existing.dispatch_id
      AND d.status = 'completed';
  END IF;

  INSERT INTO public.customer_payment_audit (
    request_id, payment_id, customer_id, action, actor_id, actor_name,
    previous_amount, new_amount, previous_method, new_method,
    previous_note, new_note, previous_status, new_status,
    previous_balance, new_balance
  ) VALUES (
    v_request_id, v_payment_id, v_existing.customer_id, v_mode, v_actor_id, v_actor_name,
    v_existing.amount, v_new_amount, v_existing.method, v_new_method,
    v_existing.note, v_new_note, v_existing.status, v_new_status,
    v_previous, v_new_balance
  );

  INSERT INTO public.customer_financial_audit (
    customer_id, changed_by_user_id, changed_by_user_name,
    reason, previous_balance, new_balance
  ) VALUES (
    v_existing.customer_id, v_actor_id, v_actor_name,
    v_reason, v_previous, v_new_balance
  );

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'already_applied', false,
    'previous_balance', v_previous,
    'balance', v_new_balance,
    'status', v_new_status
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.amend_customer_payment(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amend_customer_payment(jsonb)
  TO service_role;

-- -----------------------------------------------------------------------------
-- 5) close_dispatch — iptal edilen tahsilatları kasa/POS toplamına katma
-- -----------------------------------------------------------------------------

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

COMMIT;
