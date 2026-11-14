-- 20261114 — 60 günlük temizliğe satın alımları ekle
-- purchases silinince purchase_items ve purchase_audit FK cascade ile silinir.
-- suppliers (toptancı tanımları) korunur.

BEGIN;

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
  v_purch        INTEGER := 0;
  v_pitem        INTEGER := 0;
  v_paudit       INTEGER := 0;
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
  SELECT count(*) INTO v_fin FROM public.customer_financial_audit WHERE changed_at < v_cutoff_ts;
  SELECT count(*) INTO v_cancel FROM public.delivery_cancellation_audit WHERE created_at < v_cutoff_ts;
  SELECT count(*) INTO v_disp_cancel FROM public.dispatch_cancellation_audit WHERE created_at < v_cutoff_ts;
  SELECT count(*) INTO v_load FROM public.dispatch_loading_audit WHERE changed_at < v_cutoff_ts;
  SELECT count(*) INTO v_archive_del FROM public.retention_archive WHERE archived_at < v_cutoff_ts;

  SELECT count(*) INTO v_purch FROM public.purchases WHERE purchased_at < v_cutoff_ts;
  SELECT count(*) INTO v_pitem
    FROM public.purchase_items pi
    JOIN public.purchases p ON p.id = pi.purchase_id
   WHERE p.purchased_at < v_cutoff_ts;
  SELECT count(*) INTO v_paudit
    FROM public.purchase_audit pa
    JOIN public.purchases p ON p.id = pa.purchase_id
   WHERE p.purchased_at < v_cutoff_ts;

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
    'purchases', v_purch,
    'purchase_items', v_pitem,
    'purchase_audit', v_paudit,
    'archived_rows', v_arch
  );

  IF NOT p_dry_run THEN
    DELETE FROM public.customer_payments WHERE collected_at < v_cutoff_ts;
    DELETE FROM public.customer_financial_audit WHERE changed_at < v_cutoff_ts;
    DELETE FROM public.delivery_cancellation_audit WHERE created_at < v_cutoff_ts;
    DELETE FROM public.dispatch_cancellation_audit WHERE created_at < v_cutoff_ts;
    DELETE FROM public.dispatch_loading_audit WHERE changed_at < v_cutoff_ts;
    DELETE FROM public.retention_archive WHERE archived_at < v_cutoff_ts;

    DELETE FROM public.purchases WHERE purchased_at < v_cutoff_ts;

    IF to_regclass('public.customer_operations') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.customer_operations WHERE created_at < $1' USING v_cutoff_ts;
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
    'purged_retention_archive', CASE WHEN p_dry_run THEN 0 ELSE v_archive_del END,
    'purged_purchases', CASE WHEN p_dry_run THEN 0 ELSE v_purch END,
    'purged_purchase_items', CASE WHEN p_dry_run THEN 0 ELSE v_pitem END,
    'purged_purchase_audit', CASE WHEN p_dry_run THEN 0 ELSE v_paudit END
  );
END;
$$;

COMMIT;
