-- =============================================================================
-- 20261124 — Denetim/düzeltme kayıtlarının kaldırılması
--
-- * Tahsilat düzeltmesi request_id yerine beklenen değer (expected_amount /
--   expected_method) kontrolü kullanır. Not alanı ve corrected_* alanları
--   güncellenmez.
-- * Alım iptali fiziksel silmedir (purchase_items cascade ile silinir).
-- * Alım fonksiyonları purchase_audit kaydı yazmaz.
-- * 60 günlük temizlik denetim tablolarını, customer_operations ve
--   retention_archive tablolarını saymaz/silmez.
-- * rpc_authorization_ready denetim tablosu yetkilerini kontrol etmez.
--
-- Denetim tablolarının kendisi bu dosyada düşürülmez; sonraki adımda kaldırılır.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Tahsilat düzeltme/iptal
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- 2) Satın alım oluşturma (denetim kaydı yok)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_purchase(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id TEXT := p->>'id';
  v_supplier_id TEXT := p->>'supplier_id';
  v_description TEXT := NULLIF(BTRIM(COALESCE(p->>'description', '')), '');
  v_dispatch_id TEXT := NULLIF(p->>'dispatch_id', '');
  v_actor_id TEXT := p->>'actor_user_id';
  v_actor_name TEXT := p->>'actor_user_name';
  v_item JSONB;
  v_line INTEGER := 1;
  v_product_id TEXT;
  v_quantity INTEGER;
  v_unit_price NUMERIC(12, 2);
  v_product_name TEXT;
  v_unit TEXT;
  v_line_total NUMERIC(12, 2);
  v_total NUMERIC(12, 2) := 0;
  v_has_price BOOLEAN := false;
  v_total_amount NUMERIC(12, 2);
  v_inserted TEXT;
  v_dispatch_driver TEXT;
  v_dispatch_status TEXT;
BEGIN
  IF v_id IS NULL OR v_id !~ '^pur_[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: id';
  END IF;
  IF v_supplier_id IS NULL OR v_actor_id IS NULL OR v_actor_name IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;

  IF EXISTS (SELECT 1 FROM public.purchases WHERE id = v_id) THEN
    RETURN jsonb_build_object(
      'duplicate', true,
      'purchase', public.purchase_to_json(v_id)
    );
  END IF;

  PERFORM 1
    FROM public.suppliers
   WHERE id = v_supplier_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPLIER_NOT_FOUND';
  END IF;

  IF v_dispatch_id IS NOT NULL THEN
    SELECT driver_id, status
      INTO v_dispatch_driver, v_dispatch_status
      FROM public.dispatches
     WHERE id = v_dispatch_id;
    IF NOT FOUND
       OR v_dispatch_driver IS DISTINCT FROM v_actor_id
       OR v_dispatch_status <> 'in_transit' THEN
      RAISE EXCEPTION 'INVALID_DISPATCH_LINK';
    END IF;
  END IF;

  IF jsonb_typeof(COALESCE(p->'items', '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p->'items', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: items';
  END IF;

  INSERT INTO public.purchases (
    id, supplier_id, description, status,
    created_by_user_id, created_by_user_name, dispatch_id
  ) VALUES (
    v_id, v_supplier_id, v_description, 'active',
    v_actor_id, v_actor_name, v_dispatch_id
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN jsonb_build_object(
      'duplicate', true,
      'purchase', public.purchase_to_json(v_id)
    );
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p->'items') LOOP
    v_product_id := v_item->>'product_id';

    BEGIN
      v_quantity := (v_item->>'quantity')::int;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: quantity';
    END;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: quantity';
    END IF;

    IF v_item ? 'unit_price'
       AND v_item->>'unit_price' IS NOT NULL
       AND v_item->>'unit_price' <> '' THEN
      BEGIN
        v_unit_price := ROUND((v_item->>'unit_price')::numeric, 2);
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: unit_price';
      END;
      IF v_unit_price < 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: unit_price';
      END IF;
    ELSE
      v_unit_price := NULL;
    END IF;

    SELECT name, COALESCE(unit, 'Adet')
      INTO v_product_name, v_unit
      FROM public.products
     WHERE id = v_product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND:%', COALESCE(v_product_id, '');
    END IF;

    v_line_total := CASE
      WHEN v_unit_price IS NULL THEN NULL
      ELSE ROUND(v_quantity * v_unit_price, 2)
    END;

    IF v_line_total IS NOT NULL THEN
      v_has_price := true;
      v_total := v_total + v_line_total;
    END IF;

    INSERT INTO public.purchase_items (
      purchase_id, line_no, product_id, product_name,
      quantity, unit, unit_price, line_total
    ) VALUES (
      v_id, v_line, v_product_id, v_product_name,
      v_quantity, v_unit, v_unit_price, v_line_total
    );
    v_line := v_line + 1;
  END LOOP;

  v_total_amount := CASE
    WHEN v_has_price THEN ROUND(v_total, 2)
    ELSE NULL
  END;

  UPDATE public.purchases
     SET total_amount = v_total_amount,
         updated_at = now()
   WHERE id = v_id;

  RETURN jsonb_build_object(
    'duplicate', false,
    'purchase', public.purchase_to_json(v_id)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 3) Satın alım düzeltme (denetim kaydı yok)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_purchase(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id TEXT := p->>'id';
  v_supplier_id TEXT := p->>'supplier_id';
  v_description TEXT := NULLIF(BTRIM(COALESCE(p->>'description', '')), '');
  v_actor_id TEXT := p->>'actor_user_id';
  v_actor_name TEXT := p->>'actor_user_name';
  v_is_admin BOOLEAN := COALESCE((p->>'is_admin')::boolean, false);
  v_creator TEXT;
  v_status TEXT;
  v_item JSONB;
  v_line INTEGER := 1;
  v_product_id TEXT;
  v_quantity INTEGER;
  v_unit_price NUMERIC(12, 2);
  v_product_name TEXT;
  v_unit TEXT;
  v_line_total NUMERIC(12, 2);
  v_total NUMERIC(12, 2) := 0;
  v_has_price BOOLEAN := false;
  v_total_amount NUMERIC(12, 2);
BEGIN
  IF v_id IS NULL OR v_supplier_id IS NULL OR v_actor_id IS NULL OR v_actor_name IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;

  SELECT created_by_user_id, status
    INTO v_creator, v_status
    FROM public.purchases
   WHERE id = v_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PURCHASE_NOT_FOUND';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'PURCHASE_CANCELLED';
  END IF;
  IF NOT v_is_admin AND v_creator <> v_actor_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  PERFORM 1 FROM public.suppliers WHERE id = v_supplier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPLIER_NOT_FOUND';
  END IF;

  IF jsonb_typeof(COALESCE(p->'items', '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p->'items', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: items';
  END IF;

  DELETE FROM public.purchase_items WHERE purchase_id = v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p->'items') LOOP
    v_product_id := v_item->>'product_id';

    BEGIN
      v_quantity := (v_item->>'quantity')::int;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: quantity';
    END;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: quantity';
    END IF;

    IF v_item ? 'unit_price'
       AND v_item->>'unit_price' IS NOT NULL
       AND v_item->>'unit_price' <> '' THEN
      BEGIN
        v_unit_price := ROUND((v_item->>'unit_price')::numeric, 2);
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: unit_price';
      END;
      IF v_unit_price < 0 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: unit_price';
      END IF;
    ELSE
      v_unit_price := NULL;
    END IF;

    SELECT name, COALESCE(unit, 'Adet')
      INTO v_product_name, v_unit
      FROM public.products
     WHERE id = v_product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND:%', COALESCE(v_product_id, '');
    END IF;

    v_line_total := CASE
      WHEN v_unit_price IS NULL THEN NULL
      ELSE ROUND(v_quantity * v_unit_price, 2)
    END;

    IF v_line_total IS NOT NULL THEN
      v_has_price := true;
      v_total := v_total + v_line_total;
    END IF;

    INSERT INTO public.purchase_items (
      purchase_id, line_no, product_id, product_name,
      quantity, unit, unit_price, line_total
    ) VALUES (
      v_id, v_line, v_product_id, v_product_name,
      v_quantity, v_unit, v_unit_price, v_line_total
    );
    v_line := v_line + 1;
  END LOOP;

  v_total_amount := CASE
    WHEN v_has_price THEN ROUND(v_total, 2)
    ELSE NULL
  END;

  UPDATE public.purchases
     SET supplier_id = v_supplier_id,
         description = v_description,
         total_amount = v_total_amount,
         updated_at = now()
   WHERE id = v_id;

  RETURN jsonb_build_object(
    'duplicate', false,
    'purchase', public.purchase_to_json(v_id)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4) Satın alım iptali: fiziksel silme (purchase_items cascade)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_purchase(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id TEXT := p->>'id';
  v_actor_id TEXT := p->>'actor_user_id';
  v_actor_name TEXT := p->>'actor_user_name';
  v_is_admin BOOLEAN := COALESCE((p->>'is_admin')::boolean, false);
  v_creator TEXT;
BEGIN
  IF v_id IS NULL OR v_actor_id IS NULL OR v_actor_name IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR';
  END IF;

  SELECT created_by_user_id
    INTO v_creator
    FROM public.purchases
   WHERE id = v_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PURCHASE_NOT_FOUND';
  END IF;
  IF NOT v_is_admin AND v_creator <> v_actor_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  DELETE FROM public.purchases WHERE id = v_id;

  RETURN jsonb_build_object(
    'duplicate', false,
    'purchase', null,
    'deleted', true,
    'id', v_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_purchase(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_purchase(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_purchase(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_purchase(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_purchase(jsonb) TO service_role;

-- -----------------------------------------------------------------------------
-- 5) 60 günlük temizlik: denetim tabloları ve customer_operations/retention_archive
--    sayılmaz ve silinmez. Operasyonel kayıtlar aynı kalır.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.purge_retention(
  p_dry_run BOOLEAN,
  p_dispatch_ids TEXT[],
  p_delivery_ids TEXT[],
  p_retention_days INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_started      TIMESTAMPTZ := clock_timestamp();
  v_cutoff       DATE;
  v_cutoff_ts    TIMESTAMPTZ;
  v_run_id       TEXT := 'ret_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  v_disp         INTEGER := 0;
  v_del          INTEGER := 0;
  v_di           INTEGER := 0;
  v_recon        INTEGER := 0;
  v_ditem        INTEGER := 0;
  v_cont         INTEGER := 0;
  v_pay          INTEGER := 0;
  v_arch         INTEGER := 0;
  v_purch        INTEGER := 0;
  v_pitem        INTEGER := 0;
  v_deleted      INTEGER;
  v_counts       JSONB;
BEGIN
  IF NOT pg_try_advisory_xact_lock(620260102) THEN
    RAISE EXCEPTION 'RETENTION_LOCKED';
  END IF;

  IF p_retention_days IS NULL OR p_retention_days < 1 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: retention_days';
  END IF;

  v_cutoff := (now() AT TIME ZONE 'UTC')::date - p_retention_days;
  v_cutoff_ts := v_cutoff::timestamp AT TIME ZONE 'UTC';

  PERFORM set_config('app.retention_purge', 'on', true);

  CREATE TEMP TABLE tmp_purge_disp ON COMMIT DROP AS
    SELECT d.id FROM public.dispatches d
    WHERE d.id = ANY (COALESCE(p_dispatch_ids, ARRAY[]::text[]))
      AND d.date < v_cutoff::text;

  CREATE TEMP TABLE tmp_purge_del ON COMMIT DROP AS
    SELECT d.id FROM public.deliveries d
    WHERE d.dispatch_id IN (SELECT id FROM tmp_purge_disp)
      OR (d.dispatch_id IS NULL AND d.timestamp < v_cutoff_ts)
      OR (
        d.id = ANY (COALESCE(p_delivery_ids, ARRAY[]::text[]))
        AND (d.dispatch_id IS NULL OR d.dispatch_id IN (SELECT id FROM tmp_purge_disp))
      );

  SELECT count(*) INTO v_disp  FROM tmp_purge_disp;
  SELECT count(*) INTO v_del   FROM tmp_purge_del;
  SELECT count(*) INTO v_di    FROM public.dispatch_items WHERE dispatch_id IN (SELECT id FROM tmp_purge_disp);
  SELECT count(*) INTO v_recon FROM public.dispatch_reconciliation_items WHERE dispatch_id IN (SELECT id FROM tmp_purge_disp);
  SELECT count(*) INTO v_ditem FROM public.delivery_items WHERE delivery_id IN (SELECT id FROM tmp_purge_del);
  SELECT count(*) INTO v_cont  FROM public.delivery_container_returns WHERE delivery_id IN (SELECT id FROM tmp_purge_del);

  SELECT count(*) INTO v_pay FROM public.customer_payments WHERE collected_at < v_cutoff_ts;

  SELECT count(*) INTO v_purch FROM public.purchases WHERE purchased_at < v_cutoff_ts;
  SELECT count(*) INTO v_pitem
    FROM public.purchase_items pi
    JOIN public.purchases p ON p.id = pi.purchase_id
   WHERE p.purchased_at < v_cutoff_ts;

  v_arch := 0;

  v_counts := jsonb_build_object(
    'dispatches', v_disp,
    'deliveries', v_del,
    'dispatch_items', v_di,
    'dispatch_reconciliation_items', v_recon,
    'delivery_items', v_ditem,
    'delivery_container_returns', v_cont,
    'customer_payments', v_pay,
    'purchases', v_purch,
    'purchase_items', v_pitem,
    'archived_rows', v_arch
  );

  IF NOT p_dry_run THEN
    DELETE FROM public.customer_payments WHERE collected_at < v_cutoff_ts;

    DELETE FROM public.purchases WHERE purchased_at < v_cutoff_ts;

    LOOP
      DELETE FROM public.deliveries
      WHERE ctid IN (
        SELECT d.ctid FROM public.deliveries d
        JOIN tmp_purge_del t ON t.id = d.id
        LIMIT 500
      );
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
      EXIT WHEN v_deleted = 0;
    END LOOP;

    LOOP
      DELETE FROM public.dispatches
      WHERE ctid IN (
        SELECT p.ctid FROM public.dispatches p
        JOIN tmp_purge_disp t ON t.id = p.id
        LIMIT 500
      );
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
      EXIT WHEN v_deleted = 0;
    END LOOP;
  END IF;

  UPDATE public.retention_state SET
    last_started_at = v_started,
    last_finished_at = now(),
    last_success_at = now(),
    last_dry_run = p_dry_run,
    last_error = NULL,
    last_threshold_date = v_cutoff,
    retention_days = p_retention_days,
    last_counts = v_counts,
    last_archived_rows = v_arch,
    updated_at = now()
  WHERE id = true;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'dry_run', p_dry_run,
    'threshold_date', v_cutoff,
    'retention_days', p_retention_days,
    'counts', v_counts,
    'archived_rows', v_arch,
    'purged_dispatches', CASE WHEN p_dry_run THEN 0 ELSE v_disp END,
    'purged_deliveries', CASE WHEN p_dry_run THEN 0 ELSE v_del END,
    'purged_customer_payments', CASE WHEN p_dry_run THEN 0 ELSE v_pay END,
    'purged_purchases', CASE WHEN p_dry_run THEN 0 ELSE v_purch END,
    'purged_purchase_items', CASE WHEN p_dry_run THEN 0 ELSE v_pitem END
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6) RPC yetki denetimi: denetim tablosu yetki kontrolleri kaldırıldı
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_authorization_ready()
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.apply_delivery(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.update_dispatch_loading(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cancel_dispatch(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.close_dispatch(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.admin_update_customer(jsonb)', 'EXECUTE')
  THEN
    RETURN false;
  END IF;

  IF has_function_privilege('anon', 'public.apply_delivery(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.update_dispatch_loading(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cancel_dispatch(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.close_dispatch(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_update_customer(jsonb)', 'EXECUTE')
  THEN
    RETURN false;
  END IF;

  IF has_function_privilege('authenticated', 'public.apply_delivery(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.update_dispatch_loading(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cancel_dispatch(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.close_dispatch(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admin_update_customer(jsonb)', 'EXECUTE')
  THEN
    RETURN false;
  END IF;

  IF has_table_privilege('anon', 'public.deliveries', 'INSERT')
     OR has_table_privilege('anon', 'public.deliveries', 'UPDATE')
     OR has_table_privilege('anon', 'public.deliveries', 'DELETE')
     OR has_table_privilege('anon', 'public.customers', 'UPDATE')
     OR has_table_privilege('anon', 'public.dispatches', 'UPDATE')
  THEN
    RETURN false;
  END IF;

  IF has_table_privilege('authenticated', 'public.deliveries', 'INSERT')
     OR has_table_privilege('authenticated', 'public.deliveries', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.deliveries', 'DELETE')
     OR has_table_privilege('authenticated', 'public.customers', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.dispatches', 'UPDATE')
  THEN
    RETURN false;
  END IF;

  IF NOT has_table_privilege('service_role', 'public.deliveries', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.customers', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.dispatches', 'UPDATE')
  THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_authorization_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_authorization_ready() TO service_role;

COMMIT;
