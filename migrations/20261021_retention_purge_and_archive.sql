-- ==============================================================================
-- 60 GÜNLÜK SAKLAMA (RETENTION) TEMİZLİĞİ
--   * Kalıcı arşiv tablosu (retention_archive)
--   * Tek satırlık durum tablosu (retention_state)
--   * Atomik + kilitli + arşiv-önce purge fonksiyonu (public.purge_retention)
--
-- YALNIZCA YENİ NESNELER oluşturur. Mevcut tabloları, mevcut RLS
-- politikalarını, mevcut RPC yetkilerini, auth yapılandırmasını veya mevcut
-- veriyi DEĞİŞTİRMEZ / SİLMEZ.
--
-- Bu migration uygulandıktan sonra canlı ilk çalıştırma MUTLAKA dry-run
-- (RETENTION_DRY_RUN=true, varsayılan) ile yapılmalıdır.
--
-- Geçmiş: 20261018, 20261019, 20261020 dosyaları DEĞİŞTİRİLMEMİŞTİR.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Kalıcı arşiv: silinen satırlar JSONB olarak saklanır.
--    Yalnızca ekleme (INSERT) ve okuma (SELECT); güncelleme/silme verilmez.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.retention_archive (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  purge_date DATE NOT NULL,
  retention_days INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_retention_archive_run
  ON public.retention_archive(run_id);
CREATE INDEX IF NOT EXISTS idx_retention_archive_purge_date
  ON public.retention_archive(purge_date DESC);

-- ------------------------------------------------------------------------------
-- 2. Durum tablosu (tek satır). id = true ile tekilleştirilir.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.retention_state (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  last_started_at TIMESTAMPTZ,
  last_finished_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_dry_run BOOLEAN,
  last_error TEXT,
  last_threshold_date DATE,
  retention_days INTEGER NOT NULL DEFAULT 60,
  last_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_archived_rows INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.retention_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 3. Erişim: RLS açık; anon/authenticated erişimi yok; service_role sınırlı.
--    (20261020'deki "ALL TABLES" bloğu bu yeni tabloları kapsamaz, bu yüzden
--    yetkileri burada açıkça veriyoruz.)
-- ------------------------------------------------------------------------------
ALTER TABLE public.retention_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.retention_archive FROM PUBLIC;
REVOKE ALL ON public.retention_state FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.retention_archive FROM anon';
    EXECUTE 'REVOKE ALL ON public.retention_state FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.retention_archive FROM authenticated';
    EXECUTE 'REVOKE ALL ON public.retention_state FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT ON public.retention_archive TO service_role';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.retention_state TO service_role';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.retention_archive_id_seq TO service_role';
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. Atomik purge fonksiyonu.
--
--    * p_dry_run = true ise yalnızca sayar/arşivler, SİLMEZ.
--    * Uygun sefer: status='completed' AND closed_at IS NOT NULL AND date < eşik.
--    * Teslimat: uygun sefere ait TÜM teslimatlar VEYA sahipsiz+eşikten eski.
--    * Arşiv silmeden ÖNCE yazılır ve satır sayıları doğrulanır; uyuşmazsa
--      hata yükseltilir ve HİÇBİR satır silinmez (tek transaction, tam geri alma).
--    * pg_try_advisory_xact_lock ile eşzamanlı ikinci çalışma reddedilir.
--    * p_dispatch_ids/p_delivery_ids istemci tarafından sınırlı okumayla
--      hazırlanır; fonksiyon koşulları yeniden doğrular (savunma amaçlı).
-- ------------------------------------------------------------------------------
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
  v_expected  INTEGER;
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

  -- Uygun seferler (yalnızca kapatılmış, eşikten eski).
  CREATE TEMP TABLE tmp_purge_disp ON COMMIT DROP AS
    SELECT d.id
    FROM public.dispatches d
    WHERE d.id = ANY (COALESCE(p_dispatch_ids, ARRAY[]::text[]))
      AND d.status = 'completed'
      AND d.closed_at IS NOT NULL
      AND d.date < v_cutoff::text;

  -- Silinecek teslimatlar: uygun seferlere ait TÜM teslimatlar (tarihinden
  -- bağımsız) veya sahipsiz+eşikten eski olanlar. Açık sefere ait teslimat asla
  -- seçilmez. p_delivery_ids yalnızca ek güvenlik filtresidir (uygun sefere ait
  -- ya da sahipsiz olma koşuluyla).
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

  -- Arşiv (silmeden ÖNCE).
  INSERT INTO public.retention_archive (run_id, purge_date, retention_days, table_name, row_count, rows)
  SELECT v_run_id, v_cutoff, p_retention_days, 'dispatches', v_disp,
         COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  FROM public.dispatches t WHERE t.id IN (SELECT id FROM tmp_purge_disp);

  INSERT INTO public.retention_archive (run_id, purge_date, retention_days, table_name, row_count, rows)
  SELECT v_run_id, v_cutoff, p_retention_days, 'dispatch_items', v_di,
         COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  FROM public.dispatch_items t WHERE t.dispatch_id IN (SELECT id FROM tmp_purge_disp);

  INSERT INTO public.retention_archive (run_id, purge_date, retention_days, table_name, row_count, rows)
  SELECT v_run_id, v_cutoff, p_retention_days, 'dispatch_reconciliation_items', v_recon,
         COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  FROM public.dispatch_reconciliation_items t WHERE t.dispatch_id IN (SELECT id FROM tmp_purge_disp);

  INSERT INTO public.retention_archive (run_id, purge_date, retention_days, table_name, row_count, rows)
  SELECT v_run_id, v_cutoff, p_retention_days, 'deliveries', v_del,
         COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  FROM public.deliveries t WHERE t.id IN (SELECT id FROM tmp_purge_del);

  INSERT INTO public.retention_archive (run_id, purge_date, retention_days, table_name, row_count, rows)
  SELECT v_run_id, v_cutoff, p_retention_days, 'delivery_items', v_ditem,
         COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  FROM public.delivery_items t WHERE t.delivery_id IN (SELECT id FROM tmp_purge_del);

  INSERT INTO public.retention_archive (run_id, purge_date, retention_days, table_name, row_count, rows)
  SELECT v_run_id, v_cutoff, p_retention_days, 'delivery_container_returns', v_cont,
         COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  FROM public.delivery_container_returns t WHERE t.delivery_id IN (SELECT id FROM tmp_purge_del);

  -- Arşiv doğrulaması: kaydedilen satır sayısı beklenenle birebir eşleşmeli.
  SELECT COALESCE(sum(row_count), 0) INTO v_arch
  FROM public.retention_archive WHERE run_id = v_run_id;
  v_expected := v_disp + v_del + v_di + v_recon + v_ditem + v_cont;
  IF v_arch <> v_expected THEN
    RAISE EXCEPTION 'ARCHIVE_COUNT_MISMATCH: expected % archived %', v_expected, v_arch;
  END IF;

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

-- ------------------------------------------------------------------------------
-- 5. Fonksiyon yetkisi: yalnızca service_role.
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.purge_retention(boolean, text[], text[], integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.purge_retention(boolean, text[], text[], integer) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.purge_retention(boolean, text[], text[], integer) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.purge_retention(boolean, text[], text[], integer) TO service_role';
  END IF;
END $$;

-- ==============================================================================
-- Uygulama sonrası elle (salt-okunur) doğrulama örnekleri:
--   SELECT public.purge_retention(true, ARRAY[]::text[], ARRAY[]::text[], 60);
--   SELECT * FROM public.retention_state;
--   SELECT table_name, row_count FROM public.retention_archive;
-- ==============================================================================
