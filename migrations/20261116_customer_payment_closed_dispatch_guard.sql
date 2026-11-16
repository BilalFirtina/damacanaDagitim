-- =============================================================================
-- KAPANMIŞ SEFERDE TAHSİLAT DEĞİŞİKLİĞİNİ ENGELLE
--
-- Kapanmış sefer kesinlikle değiştirilemez. Bir tahsilat bir sefere bağlıysa
-- yalnızca sefer `in_transit` durumundayken iptal/düzeltme yapılabilir.
-- Yönetici dahil hiçbir kullanıcı kapanmış seferdeki tahsilatı değiştiremez.
--
-- Bu migration ayrıca kapanmış seferin kasa/POS toplamlarını güncelleyen
-- blokları kaldırır; kapalı sefere hiçbir koşulda yazılmaz.
-- =============================================================================

BEGIN;

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
  v_delta NUMERIC;
  v_dispatch_status TEXT;
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

  -- Idempotency: düzenleme işlemleri denetim tablosuna request_id yazar.
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

  -- Kapanmış seferde tahsilat iptali/düzeltmesi yapılamaz. Sefere bağlı
  -- olmayan tahsilatlarda bu kontrol uygulanmaz.
  IF v_existing.dispatch_id IS NOT NULL THEN
    SELECT status INTO v_dispatch_status
    FROM public.dispatches
    WHERE id = v_existing.dispatch_id
    FOR UPDATE;

    IF v_dispatch_status IS DISTINCT FROM 'in_transit' THEN
      RAISE EXCEPTION 'DISPATCH_CLOSED';
    END IF;
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

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'PAYMENT_AMOUNT_INVALID';
  END IF;
  IF v_method NOT IN ('CASH', 'POS', 'TRANSFER') THEN
    RAISE EXCEPTION 'PAYMENT_METHOD_INVALID';
  END IF;

  v_new_amount := v_amount;
  v_new_method := v_method;
  v_new_note := v_note;
  v_delta := v_new_amount - v_existing.amount;
  v_new_balance := v_previous - v_delta;

  UPDATE public.customers
  SET current_balance_tl = v_new_balance
  WHERE id = v_existing.customer_id;

  PERFORM set_config('app.payment_correction', 'on', true);

  UPDATE public.customer_payments
  SET amount = v_new_amount,
      method = v_new_method,
      note = v_new_note,
      status = 'active',
      corrected_at = now(),
      corrected_by_user_id = v_actor_id,
      corrected_by_user_name = v_actor_name,
      correction_count = correction_count + 1
  WHERE id = v_payment_id;

  PERFORM set_config('app.payment_correction', 'off', true);

  INSERT INTO public.customer_payment_audit (
    request_id, payment_id, customer_id, action, actor_id, actor_name,
    previous_amount, new_amount, previous_method, new_method,
    previous_note, new_note, previous_status, new_status,
    previous_balance, new_balance
  ) VALUES (
    v_request_id, v_payment_id, v_existing.customer_id, v_mode, v_actor_id, v_actor_name,
    v_existing.amount, v_new_amount, v_existing.method, v_new_method,
    v_existing.note, v_new_note, v_existing.status, 'active',
    v_previous, v_new_balance
  );

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'already_applied', false,
    'previous_balance', v_previous,
    'balance', v_new_balance,
    'status', 'active'
  );
END;
$$;

COMMIT;
