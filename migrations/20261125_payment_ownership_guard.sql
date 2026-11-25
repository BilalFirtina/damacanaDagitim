-- =============================================================================
-- 20261125 — Tahsilat düzeltme/iptal sahipliği
--
-- * Bir tahsilatı yalnızca kaydeden kullanıcı düzeltebilir/iptal edebilir.
-- * Yönetici kendi tahsilatını yalnızca aynı UTC gününde değiştirebilir.
-- * Şoför kendi tahsilatını yalnızca bağlı sefer `in_transit` iken değiştirebilir.
-- * Yönetici, şoförün tahsilatını hiçbir koşulda değiştiremez.
--
-- Beklenen tutar kontrolü, fiziksel silme ve denetimsiz iptal davranışı korunur.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.amend_customer_payment(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id TEXT := p->>'payment_id';
  v_mode TEXT := COALESCE(p->>'mode', 'update');
  v_amount NUMERIC := COALESCE((p->>'amount')::numeric, 0);
  v_method TEXT := COALESCE(p->>'method', '');
  v_expected_amount NUMERIC := NULLIF(p->>'expected_amount', '')::numeric;
  v_expected_method TEXT := NULLIF(p->>'expected_method', '');
  v_actor_id TEXT := NULLIF(p->>'actor_id', '');
  v_actor_name TEXT := NULLIF(p->>'actor_name', '');
  v_actor_role TEXT;
  v_existing RECORD;
  v_dispatch_status TEXT;
  v_previous NUMERIC;
  v_new_balance NUMERIC;
  v_delta NUMERIC;
BEGIN
  IF v_payment_id IS NULL OR btrim(v_payment_id) = '' THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
  END IF;
  IF v_actor_id IS NULL OR v_actor_name IS NULL THEN
    RAISE EXCEPTION 'ACTOR_REQUIRED';
  END IF;
  IF v_mode NOT IN ('update', 'cancel') THEN
    RAISE EXCEPTION 'PAYMENT_MODE_INVALID';
  END IF;

  IF v_mode = 'update' THEN
    IF v_expected_amount IS NULL OR v_expected_method IS NULL THEN
      RAISE EXCEPTION 'EXPECTATION_REQUIRED';
    END IF;
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'PAYMENT_AMOUNT_INVALID';
    END IF;
    IF v_method NOT IN ('CASH', 'POS', 'TRANSFER') THEN
      RAISE EXCEPTION 'PAYMENT_METHOD_INVALID';
    END IF;
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

  -- Yalnızca tahsilatı kaydeden kullanıcı düzeltebilir/iptal edebilir.
  IF v_existing.collected_by_user_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.users
  WHERE id = v_actor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_actor_role = 'admin' THEN
    -- Yönetici kendi tahsilatını yalnızca aynı UTC gününde değiştirebilir.
    IF (v_existing.collected_at AT TIME ZONE 'UTC')::date
       <> (now() AT TIME ZONE 'UTC')::date THEN
      RAISE EXCEPTION 'CORRECTION_WINDOW_CLOSED';
    END IF;

    -- Yönetici tahsilatı sefere bağlıysa kapanmış sefer koruması geçerlidir.
    IF v_existing.dispatch_id IS NOT NULL THEN
      SELECT status INTO v_dispatch_status
      FROM public.dispatches
      WHERE id = v_existing.dispatch_id
      FOR UPDATE;

      IF v_dispatch_status IS DISTINCT FROM 'in_transit' THEN
        RAISE EXCEPTION 'DISPATCH_CLOSED';
      END IF;
    END IF;
  ELSIF v_actor_role = 'driver' THEN
    -- Şoför yalnızca kendi aktif seferine bağlı tahsilatı değiştirebilir.
    IF v_existing.dispatch_id IS NULL THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    SELECT status INTO v_dispatch_status
    FROM public.dispatches
    WHERE id = v_existing.dispatch_id
    FOR UPDATE;

    IF v_dispatch_status IS DISTINCT FROM 'in_transit' THEN
      RAISE EXCEPTION 'DISPATCH_CLOSED';
    END IF;
  ELSE
    RAISE EXCEPTION 'NOT_AUTHORIZED';
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
    -- Tahsilat bakiyeyi azaltmıştı; iptalde aynı tutar geri eklenir.
    v_new_balance := v_previous + v_existing.amount;

    UPDATE public.customers
    SET current_balance_tl = v_new_balance
    WHERE id = v_existing.customer_id;

    PERFORM set_config('app.payment_correction', 'on', true);
    DELETE FROM public.customer_payments WHERE id = v_payment_id;
    PERFORM set_config('app.payment_correction', 'off', true);

    RETURN jsonb_build_object(
      'payment_id', v_payment_id,
      'already_applied', false,
      'previous_balance', v_previous,
      'balance', v_new_balance,
      'status', 'deleted'
    );
  END IF;

  -- Kayıt zaten istenen değerlerde ise bakiye ve satır değişmez.
  IF v_existing.amount = v_amount AND v_existing.method = v_method THEN
    RETURN jsonb_build_object(
      'payment_id', v_payment_id,
      'already_applied', true,
      'balance', v_previous,
      'status', 'active'
    );
  END IF;

  -- Beklenen değer tutmuyorsa kayıt başka biri tarafından değişmiş demektir.
  IF v_existing.amount IS DISTINCT FROM v_expected_amount
     OR v_existing.method IS DISTINCT FROM v_expected_method THEN
    RAISE EXCEPTION 'PAYMENT_CHANGED';
  END IF;

  v_delta := v_amount - v_existing.amount;
  v_new_balance := v_previous - v_delta;

  UPDATE public.customers
  SET current_balance_tl = v_new_balance
  WHERE id = v_existing.customer_id;

  PERFORM set_config('app.payment_correction', 'on', true);

  UPDATE public.customer_payments
  SET amount = v_amount,
      method = v_method
  WHERE id = v_payment_id;

  PERFORM set_config('app.payment_correction', 'off', true);

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'already_applied', false,
    'previous_balance', v_previous,
    'balance', v_new_balance,
    'status', 'active'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.amend_customer_payment(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amend_customer_payment(jsonb) TO service_role;

COMMIT;
