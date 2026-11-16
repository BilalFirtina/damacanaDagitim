-- =============================================================================
-- TAHSİLAT İPTALİ — FİZİKSEL SİLME
--
-- İptal edilen tahsilat artık status='cancelled' olarak tutulmaz; bakiye geri
-- eklenir ve customer_payments satırı fiziksel olarak silinir. İptal için
-- customer_payment_audit veya customer_financial_audit kaydı yazılmaz.
--
-- Ekstre hesaplaması bundan sonra customer_financial_audit metnine değil,
-- aktif customer_payments satırlarına dayanır. Böylece silinen tahsilat
-- ekstrede görünmez ve toplamlar doğru kalır.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Tahsilat denetim tablosu: fiziksel silme sırasında cascade DELETE izni
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_customer_payment_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND (
       current_setting('app.retention_purge', true) = 'on'
       OR current_setting('app.payment_correction', true) = 'on'
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'PAYMENT_AUDIT_IMMUTABLE';
END;
$$;

-- -----------------------------------------------------------------------------
-- 2) Tahsilat mutasyon trigger'ı: iptal RPC'sine DELETE izni
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_customer_payment_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND (
       current_setting('app.retention_purge', true) = 'on'
       OR current_setting('app.payment_correction', true) = 'on'
     ) THEN
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
-- 3) Tahsilat oluşturma: finansal denetim kaydı yazmaz
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_customer_payment(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
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
  -- Silinmiş bir tahsilatın kimliği tekrar kullanılırsa yeni kayıt oluşur;
  -- iptal kaydı tutulmadığı için bu durum kabul edilmiştir.
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

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'already_applied', false,
    'previous_balance', v_previous,
    'balance', v_new,
    'dispatch_id', v_dispatch_id
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4) Tahsilat düzeltme/iptal
--    - update: kayıt güncellenir, düzenleme denetimi yazılır.
--    - cancel: bakiye geri eklenir, kayıt fiziksel silinir, denetim yazılmaz.
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
  v_delta NUMERIC;
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
  -- İptal işlemi denetim yazmadığı için tekrar denemede kayıt bulunamaz;
  -- sunucu rotası bunu "zaten silinmiş" olarak karşılar.
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
    -- Tahsilat bakiyeyi azaltmıştı; iptalde aynı tutar geri eklenir.
    v_new_balance := v_previous + v_existing.amount;

    UPDATE public.customers
    SET current_balance_tl = v_new_balance
    WHERE id = v_existing.customer_id;

    PERFORM set_config('app.payment_correction', 'on', true);
    DELETE FROM public.customer_payments WHERE id = v_payment_id;
    PERFORM set_config('app.payment_correction', 'off', true);

    -- Kapanmış seferin kasa/POS toplamları silinen tahsilata göre yenilenir.
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

-- -----------------------------------------------------------------------------
-- 5) Mevcut veriyi temizle
--    - Daha önce iptal edilmiş tahsilat satırları fiziksel silinir.
--    - Tahsilat kaynaklı eski finansal denetim satırları silinir.
--    Bakiyeler iptal sırasında zaten geri eklenmişti; bu temizlik bakiyeyi
--    değiştirmez.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_payments'
      AND column_name = 'status'
  ) THEN
    PERFORM set_config('app.payment_correction', 'on', true);
    EXECUTE 'DELETE FROM public.customer_payments WHERE status = ''cancelled''';
    PERFORM set_config('app.payment_correction', 'off', true);
  END IF;

  PERFORM set_config('app.retention_purge', 'on', true);
  DELETE FROM public.customer_financial_audit
  WHERE reason ~* '^Tahsilat \((CASH|POS|TRANSFER)\)'
     OR reason ~* '^Tahsilat iptali \('
     OR reason ~* '^Tahsilat düzeltmesi \(';
  PERFORM set_config('app.retention_purge', 'off', true);
END $$;

COMMIT;
