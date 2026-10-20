-- =============================================================================
-- Teslimat iptali / düzenlemesi (soft-cancel) ve değiştirilemez denetim kaydı
--
-- ÖNEMLİ: Bu dosya yalnızca referanstır. Canlı Supabase veritabanında
-- ÇALIŞTIRILMAMIŞTIR. Uygulanması için yönetici onayı ve yetkili bir migration
-- çalıştırması gerekir.
--
-- Bu migration:
--   * deliveries tablosuna additive iptal kolonları ekler.
--   * delivery_cancellation_audit adında değiştirilemez bir denetim tablosu ekler.
--   * Tek bir atomik cancel_or_replace_delivery(jsonb) RPC'si ekler.
--   * apply_delivery içinde YALNIZCA iki değişiklik yapar:
--       1) Araç stoğu hesabında iptal edilmiş teslimatları hariç tutar.
--       2) Uygulanan bakiye deltasını applied_balance_delta_tl kolonuna yazar.
--   * Mevcut tabloları DROP etmez, mevcut iş verisini silmez.
--   * Auth yapılandırmasını, RLS politikalarını veya retention mantığını değiştirmez.
--
-- Eski migration dosyaları DEĞİŞTİRİLMEMİŞTİR.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Additive iptal/düzenleme kolonları
-- -----------------------------------------------------------------------------
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_name TEXT,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS replaced_by_delivery_id TEXT,
  ADD COLUMN IF NOT EXISTS applied_balance_delta_tl NUMERIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deliveries_status_check'
      AND conrelid = 'public.deliveries'::regclass
  ) THEN
    ALTER TABLE public.deliveries
      ADD CONSTRAINT deliveries_status_check
      CHECK (status IN ('active', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deliveries_cancellation_fields_check'
      AND conrelid = 'public.deliveries'::regclass
  ) THEN
    ALTER TABLE public.deliveries
      ADD CONSTRAINT deliveries_cancellation_fields_check
      CHECK (
        (
          status = 'active'
          AND cancelled_at IS NULL
          AND cancelled_by_user_id IS NULL
          AND cancelled_by_user_name IS NULL
          AND cancel_reason IS NULL
        )
        OR
        (
          status = 'cancelled'
          AND cancelled_at IS NOT NULL
          AND cancelled_by_user_id IS NOT NULL
          AND btrim(cancelled_by_user_id) <> ''
          AND cancelled_by_user_name IS NOT NULL
          AND btrim(cancelled_by_user_name) <> ''
          AND cancel_reason IS NOT NULL
          AND btrim(cancel_reason) <> ''
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deliveries_active_dispatch
  ON public.deliveries(dispatch_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_deliveries_active_customer
  ON public.deliveries(customer_id)
  WHERE status = 'active';

-- -----------------------------------------------------------------------------
-- 2. Değiştirilemez teslimat iptal/düzenleme denetim kaydı
--
-- delivery_id ve dispatch_id üzerinde FK YOKTUR: 60 günlük saklama temizliği
-- eski kayıtları sildiğinde denetim kaydı korunmalıdır.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_cancellation_audit (
  id BIGSERIAL PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  dispatch_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('cancel', 'replace')),
  performed_by_user_id TEXT NOT NULL,
  performed_by_user_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  replacement_delivery_id TEXT,
  previous_balance NUMERIC,
  new_balance NUMERIC,
  reversed_balance NUMERIC,
  previous_empty JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_empty JSONB NOT NULL DEFAULT '{}'::jsonb,
  reversed_empty JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivery_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_cancellation_audit_delivery
  ON public.delivery_cancellation_audit(delivery_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_cancellation_audit_created
  ON public.delivery_cancellation_audit(created_at DESC);

ALTER TABLE public.delivery_cancellation_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delivery_cancellation_audit_select
  ON public.delivery_cancellation_audit;
DROP POLICY IF EXISTS delivery_cancellation_audit_insert
  ON public.delivery_cancellation_audit;

CREATE POLICY delivery_cancellation_audit_select
  ON public.delivery_cancellation_audit
  FOR SELECT USING (true);

CREATE POLICY delivery_cancellation_audit_insert
  ON public.delivery_cancellation_audit
  FOR INSERT WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_delivery_cancellation_audit_no_update_delete
  ON public.delivery_cancellation_audit;
CREATE TRIGGER trg_delivery_cancellation_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON public.delivery_cancellation_audit
  FOR EACH ROW EXECUTE FUNCTION public.prevent_dispatch_reopen_audit_mutation();

DROP TRIGGER IF EXISTS trg_delivery_cancellation_audit_no_truncate
  ON public.delivery_cancellation_audit;
CREATE TRIGGER trg_delivery_cancellation_audit_no_truncate
  BEFORE TRUNCATE ON public.delivery_cancellation_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_dispatch_reopen_audit_mutation();

REVOKE ALL ON TABLE public.delivery_cancellation_audit FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.delivery_cancellation_audit FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.delivery_cancellation_audit FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.delivery_cancellation_audit FROM service_role';
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.delivery_cancellation_audit TO service_role';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.delivery_cancellation_audit_id_seq TO service_role';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Atomik ve idempotent iptal / düzenleme fonksiyonu
--
-- Kilit sırası apply_delivery ile aynıdır: dispatch -> delivery -> customer ->
-- boş kap satırları. Aynı sefere gelen yeni teslimat, kapatma veya ikinci iptal
-- bu sırayla serileşir.
--
-- Düzenleme = eski teslimatı iptal et + yeni teslimatı aynı transaction içinde
-- apply_delivery ile uygula. Herhangi bir adım hata verirse tüm işlem geri alınır.
-- -----------------------------------------------------------------------------
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
  v_replacement_dispatch TEXT;
  v_replacement_customer TEXT;
  v_replacement_driver  TEXT;
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

  -- Boş kap deltalarını geri al. Sonradan yapılan hareketler negatife
  -- düşürecekse hiçbir değişiklik uygulanmaz; transaction tamamen geri alınır.
  FOR v_row IN
    SELECT deposit_type, diff_qty
    FROM public.delivery_container_returns
    WHERE delivery_id = v_id
    ORDER BY deposit_type
  LOOP
    IF COALESCE(v_row.diff_qty, 0) = 0 THEN
      CONTINUE;
    END IF;

    SELECT quantity INTO v_current_qty
    FROM public.customer_empty_balances
    WHERE customer_id = v_customer_id AND deposit_type = v_row.deposit_type
    FOR UPDATE;

    IF NOT FOUND THEN
      v_current_qty := 0;
    END IF;

    v_next_qty := v_current_qty - v_row.diff_qty;
    IF v_next_qty < 0 THEN
      RAISE EXCEPTION 'EMPTY_REVERSAL_CONFLICT:%', v_row.deposit_type;
    END IF;

    INSERT INTO public.customer_empty_balances (customer_id, deposit_type, quantity)
    VALUES (v_customer_id, v_row.deposit_type, v_next_qty)
    ON CONFLICT (customer_id, deposit_type)
    DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();

    v_reversed_empty := v_reversed_empty || jsonb_build_object(
      v_row.deposit_type, v_row.diff_qty
    );
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
    v_apply_result := public.apply_delivery(v_replacement);
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

REVOKE EXECUTE ON FUNCTION public.cancel_or_replace_delivery(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_or_replace_delivery(jsonb)
  TO service_role;

-- -----------------------------------------------------------------------------
-- 4. apply_delivery: yalnızca iki minimal değişiklik
--    (1) stok kontrolünde iptal edilmiş teslimatları hariç tut
--    (2) uygulanan bakiye deltasını kalıcı olarak yaz
-- -----------------------------------------------------------------------------
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
    IF v_qty < 0 THEN
      RAISE EXCEPTION 'EMPTY_BALANCE_NEGATIVE:%', v_type;
    END IF;

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
