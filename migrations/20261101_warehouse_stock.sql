-- =============================================================================
-- DEPO STOĞU VE STOK HAREKET DEFTERİ
--
-- !! BU ÖZELLİK KALDIRILDI !!
-- Depo stoğu bu projenin iş modeline dahil değildir; araç merkezli model
-- geçerlidir. Bu dosya yalnızca tarihsel kayıt için tutulmuştur.
-- Kaldırma: migrations/20261102_drop_warehouse_stock.sql
-- =============================================================================
--
-- AGENTS.md Bölüm 4 ve 8:
--   * Depo stoku ürün bazında tutulur.
--   * Onaylanan yükleme depo stoğundan düşer.
--   * Stok negatife düşemez.
--   * Her stok hareketi; tarih, miktar, kaynak, hedef, neden ve sorumlu
--     kullanıcı ile kaydedilir.
--   * Mükerrer işleme engellenir (idempotent kaynak kimliği).
--
-- TAMAMEN ADDITIVE:
--   * Mevcut hiçbir tablo silinmez/değiştirilmez.
--   * Yalnızca 2 yeni tablo, 1 trigger fonksiyonu ve 3 RPC eklenir.
--   * Geri alma: DROP TABLE public.stock_movements; DROP TABLE public.warehouse_stock;
--     (fonksiyonlar CASCADE ile gider)
--
-- ÖNEMLİ: Bu dosya canlıya OTOMATİK uygulanmaz. Supabase SQL Editor'de
-- tek transaction olarak çalıştırılmalıdır.
-- =============================================================================

BEGIN;

-- 1. Ürün bazlı depo stoğu ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.warehouse_stock (
  product_id TEXT PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id TEXT,
  updated_by_user_name TEXT
);

-- 2. Değiştirilemez stok hareket defteri ----------------------------------
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id BIGSERIAL PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES public.products(id),
  delta INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
  reason TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL,           -- 'loading' | 'adjustment' | 'return' | 'release'
  source_id TEXT,                      -- sefer kimliği veya düzeltme kimliği
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product
  ON public.stock_movements(product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_source
  ON public.stock_movements(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_created
  ON public.stock_movements(created_at DESC);

-- 3. RLS ve politikalar (mevcut denetim tablolarıyla aynı desen) ----------
ALTER TABLE public.warehouse_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouse_stock_select ON public.warehouse_stock;
DROP POLICY IF EXISTS warehouse_stock_write ON public.warehouse_stock;
CREATE POLICY warehouse_stock_select ON public.warehouse_stock FOR SELECT USING (true);
CREATE POLICY warehouse_stock_write ON public.warehouse_stock FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS stock_movements_select ON public.stock_movements;
DROP POLICY IF EXISTS stock_movements_insert ON public.stock_movements;
CREATE POLICY stock_movements_select ON public.stock_movements FOR SELECT USING (true);
CREATE POLICY stock_movements_insert ON public.stock_movements FOR INSERT WITH CHECK (true);

-- Defter kayıtları uygulama tarafından değiştirilemez/silinemez.
CREATE OR REPLACE FUNCTION public.prevent_stock_movement_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'STOCK_LEDGER_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_movements_no_update_delete ON public.stock_movements;
CREATE TRIGGER trg_stock_movements_no_update_delete
  BEFORE UPDATE OR DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.prevent_stock_movement_mutation();

DROP TRIGGER IF EXISTS trg_stock_movements_no_truncate ON public.stock_movements;
CREATE TRIGGER trg_stock_movements_no_truncate
  BEFORE TRUNCATE ON public.stock_movements
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_stock_movement_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.stock_movements FROM PUBLIC;

-- 4. Manuel stok düzeltmesi (yalnızca yönetici — yetki sunucuda) ----------
-- p = { product_id, delta, reason, user_id, user_name }
CREATE OR REPLACE FUNCTION public.adjust_warehouse_stock(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_product_id TEXT := p->>'product_id';
  v_delta INTEGER := COALESCE((p->>'delta')::integer, 0);
  v_reason TEXT := COALESCE(p->>'reason', '');
  v_user_id TEXT := p->>'user_id';
  v_user_name TEXT := p->>'user_name';
  v_current INTEGER;
  v_new INTEGER;
BEGIN
  IF v_product_id IS NULL OR v_product_id = '' THEN
    RAISE EXCEPTION 'PRODUCT_REQUIRED';
  END IF;
  IF v_delta = 0 THEN
    RAISE EXCEPTION 'STOCK_DELTA_ZERO';
  END IF;
  IF v_user_id IS NULL OR v_user_name IS NULL THEN
    RAISE EXCEPTION 'ACTOR_REQUIRED';
  END IF;

  INSERT INTO public.warehouse_stock (product_id) VALUES (v_product_id)
  ON CONFLICT (product_id) DO NOTHING;

  SELECT quantity INTO v_current
  FROM public.warehouse_stock
  WHERE product_id = v_product_id
  FOR UPDATE;

  v_new := v_current + v_delta;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_WAREHOUSE_STOCK';
  END IF;

  UPDATE public.warehouse_stock
  SET quantity = v_new,
      updated_at = now(),
      updated_by_user_id = v_user_id,
      updated_by_user_name = v_user_name
  WHERE product_id = v_product_id;

  INSERT INTO public.stock_movements
    (product_id, delta, quantity_after, reason, source_type, source_id, user_id, user_name)
  VALUES
    (v_product_id, v_delta, v_new, v_reason, 'adjustment', p->>'source_id', v_user_id, v_user_name);

  RETURN jsonb_build_object('product_id', v_product_id, 'quantity', v_new);
END;
$$;

-- 5. Yükleme için stok düşümü (idempotent) --------------------------------
-- p = { source_id, items: [{product_id, quantity}], user_id, user_name, reason }
-- Aynı source_id ikinci kez gönderilirse hareket TEKRAR uygulanmaz.
CREATE OR REPLACE FUNCTION public.consume_warehouse_stock(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_id TEXT := p->>'source_id';
  v_user_id TEXT := p->>'user_id';
  v_user_name TEXT := p->>'user_name';
  v_reason TEXT := COALESCE(p->>'reason', 'Araç yüklemesi');
  v_item RECORD;
  v_current INTEGER;
  v_new INTEGER;
  v_applied jsonb := '[]'::jsonb;
BEGIN
  IF v_source_id IS NULL OR v_source_id = '' THEN
    RAISE EXCEPTION 'SOURCE_ID_REQUIRED';
  END IF;
  IF v_user_id IS NULL OR v_user_name IS NULL THEN
    RAISE EXCEPTION 'ACTOR_REQUIRED';
  END IF;

  -- Idempotency: aynı sefer için stok daha önce düşüldüyse tekrar düşme.
  IF EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE source_type = 'loading' AND source_id = v_source_id
  ) THEN
    RETURN jsonb_build_object('already_applied', true, 'source_id', v_source_id);
  END IF;

  -- Kilit sırasını deterministik yapmak için ürün kimliğine göre sırala.
  FOR v_item IN
    SELECT
      item->>'product_id' AS product_id,
      COALESCE((item->>'quantity')::integer, 0) AS quantity
    FROM jsonb_array_elements(COALESCE(p->'items', '[]'::jsonb)) AS item
    ORDER BY item->>'product_id'
  LOOP
    IF v_item.product_id IS NULL OR v_item.product_id = '' THEN
      RAISE EXCEPTION 'PRODUCT_REQUIRED';
    END IF;
    IF v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'QUANTITY_INVALID';
    END IF;

    INSERT INTO public.warehouse_stock (product_id) VALUES (v_item.product_id)
    ON CONFLICT (product_id) DO NOTHING;

    SELECT quantity INTO v_current
    FROM public.warehouse_stock
    WHERE product_id = v_item.product_id
    FOR UPDATE;

    IF v_current < v_item.quantity THEN
      RAISE EXCEPTION 'INSUFFICIENT_WAREHOUSE_STOCK:%', v_item.product_id;
    END IF;

    v_new := v_current - v_item.quantity;

    UPDATE public.warehouse_stock
    SET quantity = v_new,
        updated_at = now(),
        updated_by_user_id = v_user_id,
        updated_by_user_name = v_user_name
    WHERE product_id = v_item.product_id;

    INSERT INTO public.stock_movements
      (product_id, delta, quantity_after, reason, source_type, source_id, user_id, user_name)
    VALUES
      (v_item.product_id, -v_item.quantity, v_new, v_reason, 'loading', v_source_id, v_user_id, v_user_name);

    v_applied := v_applied || jsonb_build_object(
      'product_id', v_item.product_id,
      'quantity', v_new
    );
  END LOOP;

  RETURN jsonb_build_object('already_applied', false, 'source_id', v_source_id, 'items', v_applied);
END;
$$;

-- 6. Yükleme iptali/telafisi için stoğu geri ekleme (idempotent) ----------
-- p = { source_id, items: [{product_id, quantity}], user_id, user_name, reason }
CREATE OR REPLACE FUNCTION public.release_warehouse_stock(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_id TEXT := p->>'source_id';
  v_user_id TEXT := p->>'user_id';
  v_user_name TEXT := p->>'user_name';
  v_reason TEXT := COALESCE(p->>'reason', 'Stok iadesi');
  v_item RECORD;
  v_current INTEGER;
  v_new INTEGER;
BEGIN
  IF v_source_id IS NULL OR v_source_id = '' THEN
    RAISE EXCEPTION 'SOURCE_ID_REQUIRED';
  END IF;
  IF v_user_id IS NULL OR v_user_name IS NULL THEN
    RAISE EXCEPTION 'ACTOR_REQUIRED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE source_type = 'release' AND source_id = v_source_id
  ) THEN
    RETURN jsonb_build_object('already_applied', true, 'source_id', v_source_id);
  END IF;

  FOR v_item IN
    SELECT
      item->>'product_id' AS product_id,
      COALESCE((item->>'quantity')::integer, 0) AS quantity
    FROM jsonb_array_elements(COALESCE(p->'items', '[]'::jsonb)) AS item
    ORDER BY item->>'product_id'
  LOOP
    IF v_item.product_id IS NULL OR v_item.product_id = '' THEN
      RAISE EXCEPTION 'PRODUCT_REQUIRED';
    END IF;
    IF v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'QUANTITY_INVALID';
    END IF;

    INSERT INTO public.warehouse_stock (product_id) VALUES (v_item.product_id)
    ON CONFLICT (product_id) DO NOTHING;

    SELECT quantity INTO v_current
    FROM public.warehouse_stock
    WHERE product_id = v_item.product_id
    FOR UPDATE;

    v_new := v_current + v_item.quantity;

    UPDATE public.warehouse_stock
    SET quantity = v_new,
        updated_at = now(),
        updated_by_user_id = v_user_id,
        updated_by_user_name = v_user_name
    WHERE product_id = v_item.product_id;

    INSERT INTO public.stock_movements
      (product_id, delta, quantity_after, reason, source_type, source_id, user_id, user_name)
    VALUES
      (v_item.product_id, v_item.quantity, v_new, v_reason, 'release', v_source_id, v_user_id, v_user_name);
  END LOOP;

  RETURN jsonb_build_object('already_applied', false, 'source_id', v_source_id);
END;
$$;

COMMIT;
