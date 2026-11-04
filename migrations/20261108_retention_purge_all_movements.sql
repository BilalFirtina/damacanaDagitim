-- =============================================================================
-- 60 GÜNLÜK SAKLAMA: GÜNLÜK DAĞITIM HAREKETLERİNİN TAMAMINI SİL
--
-- Politika:
--   * Müşteri kaydı (ad, telefon, adres, e-posta, not, tür) KALIR.
--   * Nihai cari borç (customers.current_balance_tl) KALIR.
--   * Nihai iade edilebilir kalem adetleri (customer_empty_balances) KALIR.
--   * Son satış fiyatı (customer_product_prices) KALIR ve her teslimatta güncellenir.
--   * Sebil marka/model/adet/açıklama detayları (customer_dispensers) KALIR.
--
--   * Eşikten eski TÜM sefer/teslimat hareketleri, tahsilatlar ve denetim
--     kayıtları silinir. Arşivleme YOKTUR.
--   * Müşteri ekleme/düzenleme denetim kayıtları (customer_operations) varsa
--     eşikten eski olanlar silinir; müşteri kaydı silinmez.
--
-- Denetim tabloları normalde değiştirilemez/silinemez. Temizlik fonksiyonu
-- yalnızca kendi transaction'ında app.retention_purge='on' ayarını kullanarak
-- silme yapabilir; diğer tüm DELETE/UPDATE işlemleri trigger tarafından
-- reddedilmeye devam eder.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Denetim tablolarında yalnızca retention transaction'ına DELETE izni
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_dispatch_reopen_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AUDIT_IMMUTABLE';
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_customer_payment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;

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

-- Tablo sahipleri zaten DELETE yetkisine sahip olabilir; retention servis
-- rolünün de silebilmesi için açıkça yetki ver.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT DELETE ON TABLE public.customer_payments TO service_role';
    EXECUTE 'GRANT DELETE ON TABLE public.customer_financial_audit TO service_role';
    EXECUTE 'GRANT DELETE ON TABLE public.delivery_cancellation_audit TO service_role';
    EXECUTE 'GRANT DELETE ON TABLE public.dispatch_reopen_audit TO service_role';
    EXECUTE 'GRANT DELETE ON TABLE public.dispatch_loading_audit TO service_role';
    EXECUTE 'GRANT DELETE ON TABLE public.retention_archive TO service_role';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2) Temizlik fonksiyonu
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
  v_reopen       INTEGER := 0;
  v_load         INTEGER := 0;
  v_ops          INTEGER := 0;
  v_archive_del  INTEGER := 0;
  v_arch         INTEGER := 0;
  v_deleted      INTEGER;
  v_counts       JSONB;
BEGIN
  -- Tek eşzamanlı çalışma (transaction sonunda serbest bırakılır).
  IF NOT pg_try_advisory_xact_lock(620260102) THEN
    RAISE EXCEPTION 'RETENTION_LOCKED';
  END IF;

  IF p_retention_days IS NULL OR p_retention_days < 1 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: retention_days';
  END IF;

  v_cutoff := (now() AT TIME ZONE 'UTC')::date - p_retention_days;
  v_cutoff_ts := v_cutoff::timestamp AT TIME ZONE 'UTC';

  -- Denetim tablolarındaki DELETE trigger'ları yalnızca bu transaction'da açılır.
  PERFORM set_config('app.retention_purge', 'on', true);

  -- Eşikten eski TÜM seferler (durumdan bağımsız).
  CREATE TEMP TABLE tmp_purge_disp ON COMMIT DROP AS
    SELECT d.id
    FROM public.dispatches d
    WHERE d.id = ANY (COALESCE(p_dispatch_ids, ARRAY[]::text[]))
      AND d.date < v_cutoff::text;

  -- Silinecek teslimatlar: eşikten eski seferlere ait TÜM teslimatlar
  -- (tarihinden bağımsız) veya sahipsiz+eşikten eski olanlar.
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
  SELECT count(*) INTO v_reopen FROM public.dispatch_reopen_audit
    WHERE reopened_at < v_cutoff_ts;
  SELECT count(*) INTO v_load FROM public.dispatch_loading_audit
    WHERE changed_at < v_cutoff_ts;
  SELECT count(*) INTO v_archive_del FROM public.retention_archive
    WHERE archived_at < v_cutoff_ts;

  -- Gelecekte eklenecek müşteri işlem denetimi varsa onu da kapsa.
  IF to_regclass('public.customer_operations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.customer_operations WHERE created_at < $1'
      INTO v_ops USING v_cutoff_ts;
  ELSE
    v_ops := 0;
  END IF;

  -- Arşivleme yok: sayaç yalnızca geriye dönük uyumluluk için 0.
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
    'dispatch_reopen_audit', v_reopen,
    'dispatch_loading_audit', v_load,
    'customer_operations', v_ops,
    'retention_archive', v_archive_del,
    'archived_rows', v_arch
  );

  IF NOT p_dry_run THEN
    -- Önce tarih bağımsız hareket/denetim kayıtları; ardından sefer/teslimat.
    DELETE FROM public.customer_payments
      WHERE collected_at < v_cutoff_ts;
    DELETE FROM public.customer_financial_audit
      WHERE changed_at < v_cutoff_ts;
    DELETE FROM public.delivery_cancellation_audit
      WHERE created_at < v_cutoff_ts;
    DELETE FROM public.dispatch_reopen_audit
      WHERE reopened_at < v_cutoff_ts;
    DELETE FROM public.dispatch_loading_audit
      WHERE changed_at < v_cutoff_ts;
    DELETE FROM public.retention_archive
      WHERE archived_at < v_cutoff_ts;

    IF to_regclass('public.customer_operations') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.customer_operations WHERE created_at < $1'
        USING v_cutoff_ts;
    END IF;

    -- Batch'ler içinde silme. Tek transaction: herhangi bir hata tümünü geri alır.
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
    'purged_dispatch_reopen_audit', CASE WHEN p_dry_run THEN 0 ELSE v_reopen END,
    'purged_dispatch_loading_audit', CASE WHEN p_dry_run THEN 0 ELSE v_load END,
    'purged_customer_operations', CASE WHEN p_dry_run THEN 0 ELSE v_ops END,
    'purged_retention_archive', CASE WHEN p_dry_run THEN 0 ELSE v_archive_del END
  );
END;
$$;

COMMIT;
