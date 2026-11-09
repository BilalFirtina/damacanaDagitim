-- =============================================================================
-- YÜKLEME DÜZELTME / İPTAL VE REOPEN KALDIRMA
--
-- - Kapatılmış sefer artık yeniden açılamaz.
-- - Yükleme düzeltme/iptali yalnızca depo yöneticisine açıktır.
-- - Aktif teslimat veya sefere bağlı tahsilat varsa düzeltme/iptal kapalıdır.
-- - İptal fiziksel silme + değiştirilemez denetim kaydı ile yapılır.
-- - Boş dispatch_reopen_audit tablosu düşürülür.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Reopen denetim tablosu boşsa düşürülür; doluysa migration durur.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.dispatch_reopen_audit') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.dispatch_reopen_audit) THEN
      RAISE EXCEPTION 'dispatch_reopen_audit tablosu boş değil; önce kontrol edin.';
    END IF;
    EXECUTE 'DROP TABLE public.dispatch_reopen_audit';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.reopen_dispatch(jsonb);

-- -----------------------------------------------------------------------------
-- 2. Yükleme iptali denetim tablosu
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dispatch_cancellation_audit (
  id BIGSERIAL PRIMARY KEY,
  dispatch_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  vehicle_plate TEXT NOT NULL,
  cancelled_by_user_id TEXT NOT NULL,
  cancelled_by_user_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  dispatch_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_cancellation_audit_dispatch
  ON public.dispatch_cancellation_audit(dispatch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_cancellation_audit_created
  ON public.dispatch_cancellation_audit(created_at DESC);

ALTER TABLE public.dispatch_cancellation_audit ENABLE ROW LEVEL SECURITY;

-- Sunucuya özel tablo: istemci rolleri doğrudan erişemez.
REVOKE ALL ON TABLE public.dispatch_cancellation_audit FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.dispatch_cancellation_audit FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.dispatch_cancellation_audit FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.dispatch_cancellation_audit FROM service_role';
    -- Purge fonksiyonu 60 gün sonra silebilmelidir; normalde trigger engeller.
    EXECUTE 'GRANT SELECT, INSERT, DELETE ON TABLE public.dispatch_cancellation_audit TO service_role';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.dispatch_cancellation_audit_id_seq TO service_role';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_dispatch_cancellation_audit_no_update_delete
  ON public.dispatch_cancellation_audit;
CREATE TRIGGER trg_dispatch_cancellation_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON public.dispatch_cancellation_audit
  FOR EACH ROW EXECUTE FUNCTION public.prevent_dispatch_reopen_audit_mutation();

DROP TRIGGER IF EXISTS trg_dispatch_cancellation_audit_no_truncate
  ON public.dispatch_cancellation_audit;
CREATE TRIGGER trg_dispatch_cancellation_audit_no_truncate
  BEFORE TRUNCATE ON public.dispatch_cancellation_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_dispatch_reopen_audit_mutation();

-- -----------------------------------------------------------------------------
-- 3. Yükleme düzeltmesi: yalnızca admin, aktif teslimat/tahsilat yoksa
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_dispatch_loading(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_dispatch_id TEXT := p->>'dispatch_id';
  v_status      TEXT;
  v_item        JSONB;
  v_product_id  TEXT;
  v_quantity    INTEGER;
  v_actor_id    TEXT := p->>'changed_by_user_id';
  v_actor_name  TEXT;
  v_actor_role  TEXT;
  v_prev_items  JSONB := '[]'::jsonb;
BEGIN
  IF v_dispatch_id IS NULL OR btrim(v_dispatch_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: dispatch id required';
  END IF;
  IF v_actor_id IS NULL OR btrim(v_actor_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: user id required';
  END IF;

  SELECT name, role INTO v_actor_name, v_actor_role
  FROM public.users WHERE id = v_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_actor_role <> 'admin' THEN
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
  IF v_status IS NULL OR v_status NOT IN ('pending_confirmation', 'in_transit') THEN
    RAISE EXCEPTION 'INVALID_DISPATCH_STATE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.deliveries
    WHERE dispatch_id = v_dispatch_id
      AND COALESCE(status, 'active') <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'DELIVERIES_EXIST';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_payments
    WHERE dispatch_id = v_dispatch_id
  ) THEN
    RAISE EXCEPTION 'PAYMENTS_EXIST';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p->'loaded_items', '[]'::jsonb)) AS i
    GROUP BY i->>'product_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: duplicate loaded product';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', product_id,
           'quantity', quantity
         ) ORDER BY product_id), '[]'::jsonb)
    INTO v_prev_items
  FROM public.dispatch_items
  WHERE dispatch_id = v_dispatch_id;

  DELETE FROM public.dispatch_items WHERE dispatch_id = v_dispatch_id;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p->'loaded_items', '[]'::jsonb))
  LOOP
    v_product_id := v_item->>'product_id';
    v_quantity := COALESCE((v_item->>'quantity')::int, -1);
    IF v_product_id IS NULL OR btrim(v_product_id) = '' OR v_quantity < 0 THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: invalid loaded item';
    END IF;
    INSERT INTO public.dispatch_items (dispatch_id, product_id, quantity)
    VALUES (v_dispatch_id, v_product_id, v_quantity);
  END LOOP;

  INSERT INTO public.dispatch_loading_audit (
    dispatch_id, changed_by_user_id, changed_by_user_name,
    previous_items, new_items
  ) VALUES (
    v_dispatch_id, v_actor_id, v_actor_name,
    v_prev_items,
    COALESCE(p->'loaded_items', '[]'::jsonb)
  );

  RETURN jsonb_build_object('updated', true, 'dispatch_id', v_dispatch_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Yükleme iptali: fiziksel silme + değiştirilemez denetim kaydı
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_dispatch(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_dispatch_id TEXT := p->>'dispatch_id';
  v_reason      TEXT := btrim(COALESCE(p->>'reason', ''));
  v_actor_id    TEXT := p->>'cancelled_by_user_id';
  v_actor_name  TEXT;
  v_actor_role  TEXT;
  v_status      TEXT;
  v_dispatch    RECORD;
  v_dispatch_snapshot JSONB;
  v_items_snapshot JSONB;
  v_cancelled_deliveries JSONB;
BEGIN
  IF v_dispatch_id IS NULL OR btrim(v_dispatch_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: dispatch id required';
  END IF;
  IF v_reason = '' OR length(v_reason) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;
  IF v_actor_id IS NULL OR btrim(v_actor_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: user id required';
  END IF;

  SELECT name, role INTO v_actor_name, v_actor_role
  FROM public.users WHERE id = v_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  IF v_actor_role <> 'admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT * INTO v_dispatch
  FROM public.dispatches
  WHERE id = v_dispatch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DISPATCH_NOT_FOUND';
  END IF;
  IF v_dispatch.status = 'completed' THEN
    RAISE EXCEPTION 'DISPATCH_ALREADY_COMPLETED';
  END IF;
  IF v_dispatch.status IS NULL
     OR v_dispatch.status NOT IN ('pending_confirmation', 'in_transit') THEN
    RAISE EXCEPTION 'INVALID_DISPATCH_STATE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.deliveries
    WHERE dispatch_id = v_dispatch_id
      AND COALESCE(status, 'active') <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'DELIVERIES_EXIST';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_payments
    WHERE dispatch_id = v_dispatch_id
  ) THEN
    RAISE EXCEPTION 'PAYMENTS_EXIST';
  END IF;

  v_dispatch_snapshot := to_jsonb(v_dispatch);

  SELECT COALESCE(jsonb_agg(to_jsonb(di) ORDER BY di.product_id), '[]'::jsonb)
    INTO v_items_snapshot
  FROM public.dispatch_items di
  WHERE di.dispatch_id = v_dispatch_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.timestamp), '[]'::jsonb)
    INTO v_cancelled_deliveries
  FROM public.deliveries d
  WHERE d.dispatch_id = v_dispatch_id
    AND COALESCE(d.status, 'active') = 'cancelled';

  -- İptal edilmiş teslimat satırları fiziksel olarak silinir; iptal denetim
  -- kayıtları delivery_cancellation_audit içinde korunur.
  DELETE FROM public.deliveries
  WHERE dispatch_id = v_dispatch_id
    AND COALESCE(status, 'active') = 'cancelled';

  INSERT INTO public.dispatch_cancellation_audit (
    dispatch_id, driver_id, driver_name, vehicle_plate,
    cancelled_by_user_id, cancelled_by_user_name, reason, dispatch_snapshot
  ) VALUES (
    v_dispatch.id, v_dispatch.driver_id, v_dispatch.driver_name, v_dispatch.vehicle_plate,
    v_actor_id, v_actor_name, v_reason,
    jsonb_build_object(
      'dispatch', v_dispatch_snapshot,
      'items', v_items_snapshot,
      'cancelled_deliveries', v_cancelled_deliveries
    )
  );

  DELETE FROM public.dispatches WHERE id = v_dispatch_id;

  RETURN jsonb_build_object('cancelled', true, 'dispatch_id', v_dispatch_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. RPC yetki denetimi: reopen kaldırıldı, cancel_dispatch eklendi
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
     OR has_table_privilege('anon', 'public.customer_financial_audit', 'INSERT')
     OR has_table_privilege('anon', 'public.dispatch_cancellation_audit', 'INSERT')
     OR has_table_privilege('anon', 'public.delivery_cancellation_audit', 'INSERT')
     OR has_table_privilege('anon', 'public.dispatch_loading_audit', 'INSERT')
  THEN
    RETURN false;
  END IF;

  IF has_table_privilege('authenticated', 'public.deliveries', 'INSERT')
     OR has_table_privilege('authenticated', 'public.deliveries', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.deliveries', 'DELETE')
     OR has_table_privilege('authenticated', 'public.customers', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.dispatches', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.customer_financial_audit', 'INSERT')
     OR has_table_privilege('authenticated', 'public.dispatch_cancellation_audit', 'INSERT')
     OR has_table_privilege('authenticated', 'public.delivery_cancellation_audit', 'INSERT')
     OR has_table_privilege('authenticated', 'public.dispatch_loading_audit', 'INSERT')
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

-- -----------------------------------------------------------------------------
-- 6. 60 günlük saklama: reopen referansları kaldırıldı, yükleme iptal
--    denetimi eklendi. Fonksiyonun geri kalanı 20261108 sürümüyle aynıdır.
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
  v_fin          INTEGER := 0;
  v_cancel       INTEGER := 0;
  v_disp_cancel  INTEGER := 0;
  v_load         INTEGER := 0;
  v_ops          INTEGER := 0;
  v_archive_del  INTEGER := 0;
  v_arch         INTEGER := 0;
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
    SELECT d.id
    FROM public.dispatches d
    WHERE d.id = ANY (COALESCE(p_dispatch_ids, ARRAY[]::text[]))
      AND d.date < v_cutoff::text;

  CREATE TEMP TABLE tmp_purge_del ON COMMIT DROP AS
    SELECT d.id
    FROM public.deliveries d
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

  SELECT count(*) INTO v_pay FROM public.customer_payments
    WHERE collected_at < v_cutoff_ts;
  SELECT count(*) INTO v_fin FROM public.customer_financial_audit
    WHERE changed_at < v_cutoff_ts;
  SELECT count(*) INTO v_cancel FROM public.delivery_cancellation_audit
    WHERE created_at < v_cutoff_ts;
  SELECT count(*) INTO v_disp_cancel FROM public.dispatch_cancellation_audit
    WHERE created_at < v_cutoff_ts;
  SELECT count(*) INTO v_load FROM public.dispatch_loading_audit
    WHERE changed_at < v_cutoff_ts;
  SELECT count(*) INTO v_archive_del FROM public.retention_archive
    WHERE archived_at < v_cutoff_ts;

  IF to_regclass('public.customer_operations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.customer_operations WHERE created_at < $1'
      INTO v_ops USING v_cutoff_ts;
  ELSE
    v_ops := 0;
  END IF;

  v_arch := 0;

  v_counts := jsonb_build_object(
    'dispatches', v_disp,
    'deliveries', v_del,
    'dispatch_items', v_di,
    'dispatch_reconciliation_items', v_recon,
    'delivery_items', v_ditem,
    'delivery_container_returns', v_cont,
    'customer_payments', v_pay,
    'customer_financial_audit', v_fin,
    'delivery_cancellation_audit', v_cancel,
    'dispatch_cancellation_audit', v_disp_cancel,
    'dispatch_loading_audit', v_load,
    'customer_operations', v_ops,
    'retention_archive', v_archive_del,
    'archived_rows', v_arch
  );

  IF NOT p_dry_run THEN
    DELETE FROM public.customer_payments
      WHERE collected_at < v_cutoff_ts;
    DELETE FROM public.customer_financial_audit
      WHERE changed_at < v_cutoff_ts;
    DELETE FROM public.delivery_cancellation_audit
      WHERE created_at < v_cutoff_ts;
    DELETE FROM public.dispatch_cancellation_audit
      WHERE created_at < v_cutoff_ts;
    DELETE FROM public.dispatch_loading_audit
      WHERE changed_at < v_cutoff_ts;
    DELETE FROM public.retention_archive
      WHERE archived_at < v_cutoff_ts;

    IF to_regclass('public.customer_operations') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.customer_operations WHERE created_at < $1'
        USING v_cutoff_ts;
    END IF;

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
    'purged_customer_financial_audit', CASE WHEN p_dry_run THEN 0 ELSE v_fin END,
    'purged_delivery_cancellation_audit', CASE WHEN p_dry_run THEN 0 ELSE v_cancel END,
    'purged_dispatch_cancellation_audit', CASE WHEN p_dry_run THEN 0 ELSE v_disp_cancel END,
    'purged_dispatch_loading_audit', CASE WHEN p_dry_run THEN 0 ELSE v_load END,
    'purged_customer_operations', CASE WHEN p_dry_run THEN 0 ELSE v_ops END,
    'purged_retention_archive', CASE WHEN p_dry_run THEN 0 ELSE v_archive_del END
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Fonksiyon yetkileri
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.update_dispatch_loading(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_dispatch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_dispatch_loading(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_dispatch(jsonb) TO service_role;

COMMIT;
