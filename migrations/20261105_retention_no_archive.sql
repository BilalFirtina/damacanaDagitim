-- =============================================================================
-- 60 GÜNLÜK SAKLAMA: ARŞİVSİZ VE DURUM BAĞIMSIZ SİLME
--
-- Politika değişikliği:
--   * Dispatches/deliveries artık retention_archive'e YAZILMAZ; doğrudan silinir.
--   * Eşikten eski TÜM seferler silinir (completed, in_transit,
--     pending_confirmation dahil). Askıda kalan sefer 60 gün sonra temizlenir.
--   * Müşteri bakiyesi, boş kap adetleri, sebil detayları, son alış fiyatı,
--     tahsilatlar ve denetim kayıtları KORUNUR.
--   * Tek transaction + advisory lock + batch silme korunur.
--
-- Bu dosya 20261022'deki purge_retention fonksiyonunu değiştirir.
-- =============================================================================

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
  v_started   TIMESTAMPTZ := clock_timestamp();
  v_cutoff    DATE := ((now() AT TIME ZONE 'UTC')::date - p_retention_days);
  v_run_id    TEXT := 'ret_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  v_disp      INTEGER := 0;
  v_del       INTEGER := 0;
  v_di        INTEGER := 0;
  v_recon     INTEGER := 0;
  v_ditem     INTEGER := 0;
  v_cont      INTEGER := 0;
  v_arch      INTEGER := 0;
  v_deleted   INTEGER;
  v_counts    JSONB;
BEGIN
  -- Tek eşzamanlı çalışma (transaction sonunda serbest bırakılır).
  IF NOT pg_try_advisory_xact_lock(620260102) THEN
    RAISE EXCEPTION 'RETENTION_LOCKED';
  END IF;

  IF p_retention_days IS NULL OR p_retention_days < 1 THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: retention_days';
  END IF;

  -- Eşikten eski TÜM seferler (durumdan bağımsız: completed/in_transit/pending).
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
      OR (d.dispatch_id IS NULL AND d.timestamp < (v_cutoff::timestamp AT TIME ZONE 'UTC'))
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

  -- Arşivleme yok: veri doğrudan silinir (kullanıcı kararı).
  v_arch := 0;

  v_counts := jsonb_build_object(
    'dispatches', v_disp,
    'deliveries', v_del,
    'dispatch_items', v_di,
    'dispatch_reconciliation_items', v_recon,
    'delivery_items', v_ditem,
    'delivery_container_returns', v_cont,
    'archived_rows', v_arch
  );

  IF NOT p_dry_run THEN
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
    'purged_deliveries', CASE WHEN p_dry_run THEN 0 ELSE v_del END
  );
END;
$$;

COMMIT;
