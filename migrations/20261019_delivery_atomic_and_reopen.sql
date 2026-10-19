-- =============================================================================
-- Atomik teslimat kaydı, atomik kapatma, yükleme güncellemesi,
-- denetim kayıtlı sefer yeniden açma ve eşzamanlı-güvenli müşteri düzeltmesi
--
-- ÖNEMLİ: Bu dosya yalnızca referanstır. Canlı Supabase veritabanında
-- ÇALIŞTIRILMAMIŞTIR. Uygulanması için yönetici onayı ve yetkili bir
-- migration çalıştırması gerekir.
--
-- Bu migration:
--   * Mevcut tabloları DROP etmez / mevcut iş verisini silmez.
--   * public.users, kimlik doğrulama ve mevcut tabloların RLS politikalarını
--     değiştirmez.
--   * Yalnızca additive (ek) kolonlar, yeni bir audit tablosu ve fonksiyonlar
--     ekler.
--   * Mevcut normalize tabloların (delivery_items, delivery_container_returns,
--     dispatch_items, dispatch_reconciliation_items, customer_empty_balances,
--     customer_product_prices) varlığını VARSAYAR. Uygulamadan önce
--     scripts/introspect-delivery-rpcs.sql ile doğrulayın.
--
-- ÇALIŞTIRMA: Dosyanın tamamı tek bir PostgreSQL transaction'ında uygulanır.
-- Herhangi bir adım başarısız olursa tüm değişiklikler geri alınır.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Additive ön koşullar
--
-- Aşağıdaki kolonlar uygulama tarafından okunuyor/yazılıyor. Canlı şemada
-- yoksa eklenir; varsa hiçbir şey değişmez. Mevcut veri silinmez.
-- -----------------------------------------------------------------------------
ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by_user_id TEXT,
  ADD COLUMN IF NOT EXISTS closed_by_user_name TEXT,
  ADD COLUMN IF NOT EXISTS collected_empty_damacana INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS collected_empty_cam_damacana INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS collected_empty_tup INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reconciliation_notes TEXT;

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'UNPAID',
  ADD COLUMN IF NOT EXISTS cash_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pos_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_collected NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS diff_uncollected NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid';

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.customer_empty_balances
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.customer_product_prices
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- -----------------------------------------------------------------------------
-- 1. Sefer yeniden açma denetim kaydı
--
-- dispatch_id üzerinde FK YOKTUR: 60 günlük saklama temizliği eski seferleri
-- sildiğinde denetim kaydı korunmalıdır. Bu nedenle audit tablosu sefer
-- silinmesini engellemez ve silinen seferin kimliğini metin olarak saklar.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dispatch_reopen_audit (
  id BIGSERIAL PRIMARY KEY,
  dispatch_id TEXT NOT NULL,
  reopened_by_user_id TEXT NOT NULL REFERENCES public.users(id),
  reopened_by_user_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  reopened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_closed_at TIMESTAMPTZ,
  previous_reconciliation JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Daha önce oluşturulmuş bir sürümde dispatch FK'si varsa kaldır.
DO $$
BEGIN
  IF to_regclass('public.dispatch_reopen_audit') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'dispatch_reopen_audit_dispatch_id_fkey'
         AND conrelid = 'public.dispatch_reopen_audit'::regclass
     ) THEN
    ALTER TABLE public.dispatch_reopen_audit
      DROP CONSTRAINT dispatch_reopen_audit_dispatch_id_fkey;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dispatch_reopen_audit_dispatch
  ON public.dispatch_reopen_audit(dispatch_id, reopened_at DESC);

ALTER TABLE public.dispatch_reopen_audit ENABLE ROW LEVEL SECURITY;

-- Denetim kaydı yalnızca eklenebilir ve okunabilir. Güncelleme/silme/truncate
-- politika ve trigger ile engellenir.
DROP POLICY IF EXISTS "Allow public all access on dispatch_reopen_audit"
  ON public.dispatch_reopen_audit;
DROP POLICY IF EXISTS dispatch_reopen_audit_select ON public.dispatch_reopen_audit;
DROP POLICY IF EXISTS dispatch_reopen_audit_insert ON public.dispatch_reopen_audit;

CREATE POLICY dispatch_reopen_audit_select
  ON public.dispatch_reopen_audit
  FOR SELECT USING (true);

CREATE POLICY dispatch_reopen_audit_insert
  ON public.dispatch_reopen_audit
  FOR INSERT WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.prevent_dispatch_reopen_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_IMMUTABLE';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_reopen_audit_no_update_delete
  ON public.dispatch_reopen_audit;
CREATE TRIGGER trg_dispatch_reopen_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON public.dispatch_reopen_audit
  FOR EACH ROW EXECUTE FUNCTION public.prevent_dispatch_reopen_audit_mutation();

DROP TRIGGER IF EXISTS trg_dispatch_reopen_audit_no_truncate
  ON public.dispatch_reopen_audit;
CREATE TRIGGER trg_dispatch_reopen_audit_no_truncate
  BEFORE TRUNCATE ON public.dispatch_reopen_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_dispatch_reopen_audit_mutation();

-- Minimum yetkiler: yalnızca SELECT + INSERT. UPDATE/DELETE/TRUNCATE yok.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.dispatch_reopen_audit FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.dispatch_reopen_audit FROM anon';
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.dispatch_reopen_audit TO anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.dispatch_reopen_audit FROM authenticated';
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.dispatch_reopen_audit TO authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.dispatch_reopen_audit FROM service_role';
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.dispatch_reopen_audit TO service_role';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.dispatch_reopen_audit_id_seq') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON SEQUENCE public.dispatch_reopen_audit_id_seq FROM PUBLIC';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.dispatch_reopen_audit_id_seq TO anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.dispatch_reopen_audit_id_seq TO authenticated';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.dispatch_reopen_audit_id_seq TO service_role';
    END IF;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1b. Müşteri finansal düzeltme denetim kaydı
--
-- Bakiye ve boş kap düzeltmeleri yalnızca yönetici tarafından yapılabilir.
-- Eski/yeni değerler, düzelten kullanıcı ve gerekçe değiştirilemez biçimde
-- saklanır. Dispatch FK'si yoktur; 60 günlük temizlik bu kaydı silmez.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_financial_audit (
  id BIGSERIAL PRIMARY KEY,
  customer_id TEXT NOT NULL,
  changed_by_user_id TEXT NOT NULL,
  changed_by_user_name TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  previous_balance NUMERIC,
  new_balance NUMERIC,
  previous_empty JSONB,
  new_empty JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_financial_audit_customer
  ON public.customer_financial_audit(customer_id, changed_at DESC);

ALTER TABLE public.customer_financial_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_financial_audit_select ON public.customer_financial_audit;
DROP POLICY IF EXISTS customer_financial_audit_insert ON public.customer_financial_audit;

CREATE POLICY customer_financial_audit_select
  ON public.customer_financial_audit
  FOR SELECT USING (true);

CREATE POLICY customer_financial_audit_insert
  ON public.customer_financial_audit
  FOR INSERT WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_customer_financial_audit_no_update_delete
  ON public.customer_financial_audit;
CREATE TRIGGER trg_customer_financial_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON public.customer_financial_audit
  FOR EACH ROW EXECUTE FUNCTION public.prevent_dispatch_reopen_audit_mutation();

DROP TRIGGER IF EXISTS trg_customer_financial_audit_no_truncate
  ON public.customer_financial_audit;
CREATE TRIGGER trg_customer_financial_audit_no_truncate
  BEFORE TRUNCATE ON public.customer_financial_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_dispatch_reopen_audit_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.customer_financial_audit FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.customer_financial_audit FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.customer_financial_audit FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.customer_financial_audit FROM service_role';
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.customer_financial_audit TO service_role';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.customer_financial_audit_id_seq TO service_role';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1c. Sefer yükleme değişiklik denetim kaydı
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dispatch_loading_audit (
  id BIGSERIAL PRIMARY KEY,
  dispatch_id TEXT NOT NULL,
  changed_by_user_id TEXT NOT NULL,
  changed_by_user_name TEXT NOT NULL,
  previous_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  new_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_loading_audit_dispatch
  ON public.dispatch_loading_audit(dispatch_id, changed_at DESC);

ALTER TABLE public.dispatch_loading_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dispatch_loading_audit_select ON public.dispatch_loading_audit;
DROP POLICY IF EXISTS dispatch_loading_audit_insert ON public.dispatch_loading_audit;

CREATE POLICY dispatch_loading_audit_select
  ON public.dispatch_loading_audit
  FOR SELECT USING (true);

CREATE POLICY dispatch_loading_audit_insert
  ON public.dispatch_loading_audit
  FOR INSERT WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_dispatch_loading_audit_no_update_delete
  ON public.dispatch_loading_audit;
CREATE TRIGGER trg_dispatch_loading_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON public.dispatch_loading_audit
  FOR EACH ROW EXECUTE FUNCTION public.prevent_dispatch_reopen_audit_mutation();

DROP TRIGGER IF EXISTS trg_dispatch_loading_audit_no_truncate
  ON public.dispatch_loading_audit;
CREATE TRIGGER trg_dispatch_loading_audit_no_truncate
  BEFORE TRUNCATE ON public.dispatch_loading_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_dispatch_reopen_audit_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.dispatch_loading_audit FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.dispatch_loading_audit FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.dispatch_loading_audit FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.dispatch_loading_audit FROM service_role';
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.dispatch_loading_audit TO service_role';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.dispatch_loading_audit_id_seq TO service_role';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Atomik ve idempotent teslimat uygulama fonksiyonu
--
-- Tasarım:
--   * Önce PK ile mevcut teslimat kontrol edilir; varsa hiçbir kilit/bakiye
--     işlemi yapılmadan {duplicate:true} döner.
--   * Sefer satırı FOR UPDATE ile kilitlenir; kapatma/yeniden açma ile yarış
--     sıraya girer. Yalnızca pending_confirmation ve in_transit kabul edilir.
--   * Kilit altında araç stoğu ve ödeme tutarlılığı doğrulanır.
--   * Müşteri satırı FOR UPDATE ile kilitlenir; bakiye DELTA olarak güncellenir.
--   * Teslimat satırı kilitlerden SONRA eklenir; böylece kapatma ile kilit
--     sırası çakışmaz ve eşzamanlı aynı ID isteği güvenle tekilleşir.
--   * Tüm işlemler tek PostgreSQL transaction'ıdır.
--
-- NOT: Aynı ID ile FARKLI içerik gönderilirse bu fonksiyon yalnızca
-- duplicate=true döner; içerik karşılaştırması uygulama sunucusunda yapılır ve
-- uyuşmazlık HTTP 409 ID_CONFLICT olarak raporlanır.
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
    payment_status, notes, is_offline_sync
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
    COALESCE((p->>'is_offline_sync')::boolean, false)
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

-- -----------------------------------------------------------------------------
-- 3. Atomik yükleme güncellemesi
-- Yükleme kalemleri yalnızca pending_confirmation durumunda değiştirilebilir.
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
  v_prev_items  JSONB := '[]'::jsonb;
BEGIN
  IF v_dispatch_id IS NULL OR btrim(v_dispatch_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: dispatch id required';
  END IF;
  IF v_actor_id IS NULL OR btrim(v_actor_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: user id required';
  END IF;

  SELECT name INTO v_actor_name FROM public.users WHERE id = v_actor_id;
  IF NOT FOUND THEN
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
  IF v_status IS NULL OR v_status <> 'pending_confirmation' THEN
    RAISE EXCEPTION 'INVALID_DISPATCH_STATE';
  END IF;

  -- Teslimat başladıktan sonra yükleme listesi değiştirilemez; aksi halde
  -- gün sonu beklenen stok hesabı geçmiş teslimatlarla tutarsız olur.
  IF EXISTS (
    SELECT 1 FROM public.deliveries WHERE dispatch_id = v_dispatch_id
  ) THEN
    RAISE EXCEPTION 'INVALID_DISPATCH_STATE';
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
-- 4. Atomik gün sonu kapatma
--
-- Toplamlar ve mutabakat kalemleri DB içinde hesaplanır. İstemciden gelen
-- toplamlar kullanılmaz. Kapatan kullanıcı sunucu oturumundan gelir; public.users
-- içindeki kimliği doğrulanarak kalıcı olarak yazılır (şoför veya yönetici).
-- Sefer satırı FOR UPDATE ile kilitlenir; teslimat RPC'si ile yarış sıraya girer.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_dispatch(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_dispatch_id   TEXT := p->>'dispatch_id';
  v_status        TEXT;
  v_total_value   NUMERIC := 0;
  v_total_cash    NUMERIC := 0;
  v_total_pos     NUMERIC := 0;
  v_total_credit  NUMERIC := 0;
  v_loaded        RECORD;
  v_delivered     INTEGER;
  v_expected      INTEGER;
  v_counted       INTEGER;
  v_user_id       TEXT := p->>'closed_by_user_id';
  v_user_name     TEXT;
  v_updated       INTEGER;
BEGIN
  IF v_dispatch_id IS NULL OR btrim(v_dispatch_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: dispatch id required';
  END IF;
  IF v_user_id IS NULL OR btrim(v_user_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: closer id required';
  END IF;

  SELECT name INTO v_user_name
  FROM public.users
  WHERE id = v_user_id;

  IF NOT FOUND THEN
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
  IF v_status IS NULL OR v_status <> 'in_transit' THEN
    RAISE EXCEPTION 'INVALID_DISPATCH_STATE';
  END IF;

  -- Eski şema kayıtlarında kalem veya ödeme alanları eksikse kapatma
  -- varsayılan 0 değerlerle yapılmaz; düzeltme süreci gerekir.
  IF EXISTS (
    SELECT 1
    FROM public.deliveries d
    WHERE d.dispatch_id = v_dispatch_id
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_items di WHERE di.delivery_id = d.id
      )
  ) THEN
    RAISE EXCEPTION 'HISTORICAL_DELIVERY_ITEMS_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.deliveries d
    WHERE d.dispatch_id = v_dispatch_id
      AND (
        abs(COALESCE(d.total_collected, 0)
            - COALESCE(d.cash_amount, 0)
            - COALESCE(d.pos_amount, 0)) > 0.01
        OR abs(COALESCE(d.total_collected, 0)
               + COALESCE(d.diff_uncollected, 0)
               - COALESCE(d.delivered_grand_total, 0)) > 0.01
      )
  ) THEN
    RAISE EXCEPTION 'PAYMENT_DATA_INCONSISTENT';
  END IF;

  -- Cariye eklenen borç yalnızca hesap müşterileri içindir. Hesap dışı
  -- müşterilerde kalan tutar tahsil edilmemiş satıştır; cari borç değildir.
  SELECT
    COALESCE(SUM(COALESCE(d.delivered_grand_total, 0)), 0),
    COALESCE(SUM(COALESCE(d.cash_amount, 0)), 0),
    COALESCE(SUM(COALESCE(d.pos_amount, 0)), 0),
    COALESCE(SUM(
      CASE WHEN COALESCE(c.is_account_customer, false)
           THEN GREATEST(COALESCE(d.diff_uncollected, 0), 0)
           ELSE 0 END
    ), 0)
  INTO v_total_value, v_total_cash, v_total_pos, v_total_credit
  FROM public.deliveries d
  LEFT JOIN public.customers c ON c.id = d.customer_id
  WHERE d.dispatch_id = v_dispatch_id;

  DELETE FROM public.dispatch_reconciliation_items
  WHERE dispatch_id = v_dispatch_id;

  FOR v_loaded IN
    SELECT product_id, quantity
    FROM public.dispatch_items
    WHERE dispatch_id = v_dispatch_id
  LOOP
    SELECT COALESCE(SUM(di.quantity), 0)
    INTO v_delivered
    FROM public.delivery_items di
    JOIN public.deliveries d ON d.id = di.delivery_id
    WHERE d.dispatch_id = v_dispatch_id
      AND di.product_id = v_loaded.product_id;

    v_expected := GREATEST(COALESCE(v_loaded.quantity, 0) - v_delivered, 0);
    v_counted := GREATEST(
      COALESCE((p->'remaining_full_counted'->>(v_loaded.product_id))::int, 0),
      0
    );

    INSERT INTO public.dispatch_reconciliation_items (
      dispatch_id, product_id, expected_qty, counted_qty
    ) VALUES (
      v_dispatch_id, v_loaded.product_id, v_expected, v_counted
    );
  END LOOP;

  UPDATE public.dispatches
     SET status = 'completed',
         closed_at = now(),
         closed_by_user_id = v_user_id,
         closed_by_user_name = v_user_name,
         total_delivered_value = v_total_value,
         total_cash_collected = v_total_cash,
         total_pos_collected = v_total_pos,
         total_credit_added = v_total_credit,
         actual_cash_in_pocket = GREATEST(COALESCE((p->>'actual_cash_in_pocket')::numeric, 0), 0),
         actual_pos_slips_total = GREATEST(COALESCE((p->>'actual_pos_slips_total')::numeric, 0), 0),
         collected_empty_damacana = GREATEST(COALESCE((p->>'collected_empty_damacana')::int, 0), 0),
         collected_empty_cam_damacana = GREATEST(COALESCE((p->>'collected_empty_cam_damacana')::int, 0), 0),
         collected_empty_tup = GREATEST(COALESCE((p->>'collected_empty_tup')::int, 0), 0),
         reconciliation_notes = COALESCE(p->>'notes', '')
   WHERE id = v_dispatch_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'CLOSE_WRITE_NOT_APPLIED';
  END IF;

  RETURN jsonb_build_object(
    'closed', true,
    'dispatch_id', v_dispatch_id,
    'status', 'completed',
    'closed_by_user_id', v_user_id,
    'closed_by_user_name', v_user_name,
    'total_delivered_value', v_total_value,
    'total_cash_collected', v_total_cash,
    'total_pos_collected', v_total_pos,
    'total_credit_added', v_total_credit
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Denetim kayıtlı sefer yeniden açma
--
-- Yalnızca public.users.role = 'admin' olan kullanıcı çağırabilir.
-- Bu fonksiyon yalnızca sertleştirilmiş hizmet rolü tarafından çağrılabilir;
-- anon/authenticated EXECUTE yetkisi ayrı hardening migration'ında kaldırılır.
-- Kapanışta closed_at yoksa eski/doğrulanmamış kayıt yeniden açılmaz.
-- Önceki toplamlar sıfırlanmaz; yeniden kapatma bunları yeniden hesaplar.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_dispatch(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_dispatch_id   TEXT := p->>'dispatch_id';
  v_user_id       TEXT := p->>'reopened_by_user_id';
  v_user_name     TEXT;
  v_reason        TEXT := btrim(COALESCE(p->>'reason', ''));
  v_role          TEXT;
  v_status        TEXT;
  v_prev_closed   TIMESTAMPTZ;
  v_prev_dispatch JSONB;
  v_prev_items    JSONB;
  v_audit_id      BIGINT;
  v_updated       INTEGER;
BEGIN
  IF v_dispatch_id IS NULL OR btrim(v_dispatch_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: dispatch id required';
  END IF;
  IF v_user_id IS NULL OR btrim(v_user_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: manager id required';
  END IF;
  IF length(v_reason) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT role, name INTO v_role, v_user_name
  FROM public.users
  WHERE id = v_user_id;

  IF NOT FOUND OR v_role <> 'admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT status, closed_at INTO v_status, v_prev_closed
  FROM public.dispatches
  WHERE id = v_dispatch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DISPATCH_NOT_FOUND';
  END IF;
  IF v_status <> 'completed' THEN
    RETURN jsonb_build_object('reopened', false, 'code', 'NOT_COMPLETED');
  END IF;
  IF v_prev_closed IS NULL THEN
    RAISE EXCEPTION 'HISTORICAL_REOPEN_BLOCKED';
  END IF;

  SELECT to_jsonb(d) INTO v_prev_dispatch
  FROM public.dispatches d
  WHERE d.id = v_dispatch_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', product_id,
           'expected_qty', expected_qty,
           'counted_qty', counted_qty
         )), '[]'::jsonb)
    INTO v_prev_items
  FROM public.dispatch_reconciliation_items
  WHERE dispatch_id = v_dispatch_id;

  INSERT INTO public.dispatch_reopen_audit (
    dispatch_id, reopened_by_user_id, reopened_by_user_name, reason,
    previous_closed_at, previous_reconciliation
  ) VALUES (
    v_dispatch_id, v_user_id, v_user_name, v_reason,
    v_prev_closed,
    jsonb_build_object(
      'dispatch', COALESCE(v_prev_dispatch, '{}'::jsonb),
      'reconciliation_items', v_prev_items
    )
  )
  RETURNING id INTO v_audit_id;

  UPDATE public.dispatches
     SET status = 'in_transit',
         closed_at = NULL,
         closed_by_user_id = NULL,
         closed_by_user_name = NULL
   WHERE id = v_dispatch_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'REOPEN_WRITE_NOT_APPLIED';
  END IF;

  RETURN jsonb_build_object(
    'reopened', true,
    'dispatch_id', v_dispatch_id,
    'audit_id', v_audit_id
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Eşzamanlı-güvenli müşteri düzeltmesi
--
-- Mutlak bakiye/boş kap yazımı yalnızca çağıranın gördüğü değer hâlâ güncelse
-- uygulanır. Eşzamanlı bir teslimat bakiyeyi değiştirdiyse {conflict:true}
-- döner; hiçbir alan yazılmaz. Profil alanları aynı transaction'da güncellenir.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_customer(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id            TEXT := p->>'customer_id';
  v_current       NUMERIC;
  v_expected      NUMERIC;
  v_next          NUMERIC;
  v_type          TEXT;
  v_current_qty   INTEGER;
  v_expected_qty  INTEGER;
  v_next_text     TEXT;
  v_has_balance   BOOLEAN := (p ? 'new_balance');
  v_has_empty     BOOLEAN := (p ? 'new_empty');
  v_actor_id      TEXT := p->>'changed_by_user_id';
  v_actor_name    TEXT;
  v_actor_role    TEXT;
  v_reason        TEXT := btrim(COALESCE(p->>'reason', ''));
  v_prev_balance  NUMERIC;
  v_prev_empty    JSONB := '{}'::jsonb;
  v_updated       INTEGER;
BEGIN
  IF v_id IS NULL OR btrim(v_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: customer id required';
  END IF;
  IF v_actor_id IS NULL OR btrim(v_actor_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: manager id required';
  END IF;

  SELECT role, name INTO v_actor_role, v_actor_name
  FROM public.users
  WHERE id = v_actor_id;

  IF NOT FOUND OR v_actor_role <> 'admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT current_balance_tl INTO v_current
  FROM public.customers
  WHERE id = v_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;
  v_prev_balance := v_current;

  IF v_has_empty THEN
    SELECT COALESCE(jsonb_object_agg(deposit_type, quantity), '{}'::jsonb)
      INTO v_prev_empty
    FROM public.customer_empty_balances
    WHERE customer_id = v_id;
  END IF;

  IF v_has_balance THEN
    IF NOT (p ? 'expected_balance') OR p->>'expected_balance' IS NULL THEN
      RAISE EXCEPTION 'EXPECTATION_REQUIRED';
    END IF;
    v_expected := (p->>'expected_balance')::numeric;
    v_next := COALESCE((p->>'new_balance')::numeric, 0);
    IF COALESCE(v_current, 0) IS DISTINCT FROM v_expected THEN
      RETURN jsonb_build_object(
        'conflict', true,
        'code', 'BALANCE_CONFLICT',
        'current_balance', COALESCE(v_current, 0)
      );
    END IF;
  END IF;

  IF v_has_empty THEN
    IF NOT (p ? 'expected_empty') OR p->'expected_empty' IS NULL
       OR jsonb_typeof(p->'expected_empty') <> 'object'
       OR jsonb_typeof(p->'new_empty') <> 'object' THEN
      RAISE EXCEPTION 'EXPECTATION_REQUIRED';
    END IF;

    FOR v_type IN
      SELECT key FROM jsonb_each(COALESCE(p->'new_empty', '{}'::jsonb))
    LOOP
      v_expected_qty := COALESCE((p->'expected_empty'->>v_type)::int, 0);

      SELECT quantity INTO v_current_qty
      FROM public.customer_empty_balances
      WHERE customer_id = v_id AND deposit_type = v_type
      FOR UPDATE;

      IF NOT FOUND THEN
        v_current_qty := 0;
      END IF;

      IF v_current_qty IS DISTINCT FROM v_expected_qty THEN
        RETURN jsonb_build_object(
          'conflict', true,
          'code', 'EMPTY_CONFLICT',
          'deposit_type', v_type,
          'current_qty', v_current_qty
        );
      END IF;
    END LOOP;
  END IF;

  UPDATE public.customers
     SET name = CASE WHEN p ? 'name' THEN p->>'name' ELSE name END,
         phone = CASE WHEN p ? 'phone' THEN p->>'phone' ELSE phone END,
         address = CASE WHEN p ? 'address' THEN p->>'address' ELSE address END,
         emails = CASE WHEN p ? 'emails' THEN (p->'emails') ELSE emails END,
         is_account_customer = CASE
           WHEN p ? 'is_account_customer'
           THEN (p->>'is_account_customer')::boolean
           ELSE is_account_customer
         END,
         notes = CASE WHEN p ? 'notes' THEN p->>'notes' ELSE notes END,
         current_balance_tl = CASE
           WHEN v_has_balance THEN v_next
           ELSE current_balance_tl
         END,
         updated_at = now()
   WHERE id = v_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'CUSTOMER_UPDATE_NOT_APPLIED';
  END IF;

  IF v_has_empty THEN
    FOR v_type, v_next_text IN
      SELECT key, value FROM jsonb_each_text(COALESCE(p->'new_empty', '{}'::jsonb))
    LOOP
      INSERT INTO public.customer_empty_balances (customer_id, deposit_type, quantity)
      VALUES (v_id, v_type, GREATEST(COALESCE(v_next_text::int, 0), 0))
      ON CONFLICT (customer_id, deposit_type)
      DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();
    END LOOP;
  END IF;

  IF v_has_balance OR v_has_empty THEN
    INSERT INTO public.customer_financial_audit (
      customer_id, changed_by_user_id, changed_by_user_name, reason,
      previous_balance, new_balance, previous_empty, new_empty
    ) VALUES (
      v_id,
      v_actor_id,
      v_actor_name,
      COALESCE(NULLIF(v_reason, ''), 'Yönetici düzeltmesi'),
      v_prev_balance,
      CASE WHEN v_has_balance THEN v_next ELSE v_prev_balance END,
      v_prev_empty,
      CASE WHEN v_has_empty THEN COALESCE(p->'new_empty', '{}'::jsonb) ELSE v_prev_empty END
    );
  END IF;

  RETURN jsonb_build_object('conflict', false, 'customer_id', v_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 6b. Aynı şoför/plaka için tek aktif sefer güvencesi
--
-- Uygulama katmanı kontrolü eşzamanlı iki sefer açılmasını engelleyemez.
-- Önce mevcut veride çakışma olup olmadığı denetlenir; varsa migration
-- tamamen geri alınır. Operatörün çakışan aktif seferleri güvenli biçimde
-- kapatması/düzeltmesi gerekir.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.dispatches
    WHERE status IN ('pending_confirmation', 'in_transit')
    GROUP BY driver_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ACTIVE_DISPATCH_DUPLICATE_DRIVER';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.dispatches
    WHERE status IN ('pending_confirmation', 'in_transit')
    GROUP BY vehicle_plate HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ACTIVE_DISPATCH_DUPLICATE_PLATE';
  END IF;
END $$;

DROP INDEX IF EXISTS public.ux_dispatches_active_driver;
DROP INDEX IF EXISTS public.ux_dispatches_active_plate;

CREATE UNIQUE INDEX ux_dispatches_active_driver
  ON public.dispatches(driver_id)
  WHERE status IN ('pending_confirmation', 'in_transit');

CREATE UNIQUE INDEX ux_dispatches_active_plate
  ON public.dispatches(vehicle_plate)
  WHERE status IN ('pending_confirmation', 'in_transit');

-- -----------------------------------------------------------------------------
-- 7. RPC EXECUTE yetkileri ve güven sınırı
--
-- PostgreSQL varsayılanı bu fonksiyonları PUBLIC'e EXECUTE açar. Bu dosya
-- tek başına anon ile çalışmaya devam edemez. Üretimde ayrıca
-- 20261020_rpc_authorization_hardening.sql uygulanmalıdır; o migration
-- anon/authenticated EXECUTE yetkilerini kaldırır ve service_role'e verir.
-- Sunucu yalnızca hizmet rolü anahtarıyla bağlanmalıdır.
-- -----------------------------------------------------------------------------

-- =============================================================================
-- SON NOT:
--   * Bu dosya çalıştırılmadan uygulama RPC çağrılarında "fonksiyon bulunamadı"
--     hatası verir. Kod sessizce eski (atomik olmayan) yola DÖNMEZ; 503
--     MIGRATION_REQUIRED döner.
--   * Uygulama öncesi şema doğrulaması için:
--       psql ... -f scripts/introspect-delivery-rpcs.sql
-- =============================================================================

COMMIT;
