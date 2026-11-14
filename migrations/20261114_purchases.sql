-- =============================================================================
-- 20261114 — Toptancı satın alımları
--
-- * suppliers   : Yönetici tarafından yönetilen toptancı tanımları.
-- * purchases   : Bir alımın başlığı (tedarikçi, açıklama, girişi yapan).
-- * purchase_items: Alım kalemleri (ürün, miktar, ürün birimi, opsiyonel fiyat).
-- * purchase_audit: Düzeltme/iptal denetim kaydı (gerekçe istenmez).
--
-- Not: Bu özellik araç stoğunu veya dispatch_items tablosunu DEĞİŞTİRMEZ.
-- Dağıtım sırasındaki alımlar yalnızca seferle rapor amaçlı ilişkilendirilir.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Tablolar
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_name_lower
  ON public.suppliers (lower(name));

CREATE INDEX IF NOT EXISTS idx_suppliers_active
  ON public.suppliers (is_active);

CREATE TABLE IF NOT EXISTS public.purchases (
  id TEXT PRIMARY KEY,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  supplier_id TEXT NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  description TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  total_amount NUMERIC(12, 2) NULL CHECK (total_amount IS NULL OR total_amount >= 0),
  created_by_user_id TEXT NOT NULL,
  created_by_user_name TEXT NOT NULL,
  dispatch_id TEXT NULL REFERENCES public.dispatches(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ NULL,
  cancelled_by_user_id TEXT NULL,
  cancelled_by_user_name TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchases_purchased_at
  ON public.purchases (purchased_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchases_supplier
  ON public.purchases (supplier_id);

CREATE INDEX IF NOT EXISTS idx_purchases_dispatch
  ON public.purchases (dispatch_id);

CREATE INDEX IF NOT EXISTS idx_purchases_status
  ON public.purchases (status);

CREATE TABLE IF NOT EXISTS public.purchase_items (
  purchase_id TEXT NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  unit_price NUMERIC(12, 2) NULL CHECK (unit_price IS NULL OR unit_price >= 0),
  line_total NUMERIC(12, 2) NULL CHECK (line_total IS NULL OR line_total >= 0),
  PRIMARY KEY (purchase_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase
  ON public.purchase_items (purchase_id);

CREATE INDEX IF NOT EXISTS idx_purchase_items_product
  ON public.purchase_items (product_id);

CREATE TABLE IF NOT EXISTS public.purchase_audit (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'cancel')),
  actor_user_id TEXT NOT NULL,
  actor_user_name TEXT NOT NULL,
  previous_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_audit_purchase
  ON public.purchase_audit (purchase_id);

CREATE INDEX IF NOT EXISTS idx_purchase_audit_created
  ON public.purchase_audit (created_at DESC);

-- -----------------------------------------------------------------------------
-- 2) RLS ve yetkiler
-- -----------------------------------------------------------------------------

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.suppliers FROM PUBLIC;
REVOKE ALL ON public.purchases FROM PUBLIC;
REVOKE ALL ON public.purchase_items FROM PUBLIC;
REVOKE ALL ON public.purchase_audit FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.suppliers FROM anon';
    EXECUTE 'REVOKE ALL ON public.purchases FROM anon';
    EXECUTE 'REVOKE ALL ON public.purchase_items FROM anon';
    EXECUTE 'REVOKE ALL ON public.purchase_audit FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.suppliers FROM authenticated';
    EXECUTE 'REVOKE ALL ON public.purchases FROM authenticated';
    EXECUTE 'REVOKE ALL ON public.purchase_items FROM authenticated';
    EXECUTE 'REVOKE ALL ON public.purchase_audit FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO service_role';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases TO service_role';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_items TO service_role';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_audit TO service_role';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3) JSON dönüş yardımcısı
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.purchase_to_json(p_purchase_id TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', p.id,
    'purchasedAt', p.purchased_at,
    'supplierId', p.supplier_id,
    'supplierName', s.name,
    'description', p.description,
    'status', p.status,
    'totalAmount', p.total_amount,
    'createdByUserId', p.created_by_user_id,
    'createdByUserName', p.created_by_user_name,
    'dispatchId', p.dispatch_id,
    'dispatchPlate', d.vehicle_plate,
    'cancelledAt', p.cancelled_at,
    'cancelledByUserId', p.cancelled_by_user_id,
    'cancelledByUserName', p.cancelled_by_user_name,
    'createdAt', p.created_at,
    'updatedAt', p.updated_at,
    'items', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'productId', pi.product_id,
            'productName', pi.product_name,
            'quantity', pi.quantity,
            'unit', pi.unit,
            'unitPrice', pi.unit_price,
            'lineTotal', pi.line_total
          )
          ORDER BY pi.line_no
        )
        FROM public.purchase_items pi
        WHERE pi.purchase_id = p.id
      ),
      '[]'::jsonb
    )
  )
  FROM public.purchases p
  JOIN public.suppliers s ON s.id = p.supplier_id
  LEFT JOIN public.dispatches d ON d.id = p.dispatch_id
  WHERE p.id = p_purchase_id;
$$;

REVOKE EXECUTE ON FUNCTION public.purchase_to_json(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_to_json(text) TO service_role;

-- -----------------------------------------------------------------------------
-- 4) Alım oluşturma
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

  INSERT INTO public.purchase_audit (
    id, purchase_id, action, actor_user_id, actor_user_name,
    previous_data, new_data
  ) VALUES (
    'paud_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS') || '_' || substr(md5(random()::text), 1, 8),
    v_id, 'create', v_actor_id, v_actor_name,
    '{}'::jsonb, public.purchase_to_json(v_id)
  );

  RETURN jsonb_build_object(
    'duplicate', false,
    'purchase', public.purchase_to_json(v_id)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 5) Alım düzeltme
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
  v_prev JSONB;
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

  v_prev := public.purchase_to_json(v_id);

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

  INSERT INTO public.purchase_audit (
    id, purchase_id, action, actor_user_id, actor_user_name,
    previous_data, new_data
  ) VALUES (
    'paud_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS') || '_' || substr(md5(random()::text), 1, 8),
    v_id, 'update', v_actor_id, v_actor_name,
    COALESCE(v_prev, '{}'::jsonb), public.purchase_to_json(v_id)
  );

  RETURN jsonb_build_object(
    'duplicate', false,
    'purchase', public.purchase_to_json(v_id)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6) Alım iptali
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
  v_status TEXT;
  v_prev JSONB;
BEGIN
  IF v_id IS NULL OR v_actor_id IS NULL OR v_actor_name IS NULL THEN
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
    RETURN jsonb_build_object(
      'duplicate', true,
      'purchase', public.purchase_to_json(v_id)
    );
  END IF;
  IF NOT v_is_admin AND v_creator <> v_actor_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_prev := public.purchase_to_json(v_id);

  UPDATE public.purchases
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by_user_id = v_actor_id,
         cancelled_by_user_name = v_actor_name,
         updated_at = now()
   WHERE id = v_id;

  INSERT INTO public.purchase_audit (
    id, purchase_id, action, actor_user_id, actor_user_name,
    previous_data, new_data
  ) VALUES (
    'paud_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS') || '_' || substr(md5(random()::text), 1, 8),
    v_id, 'cancel', v_actor_id, v_actor_name,
    COALESCE(v_prev, '{}'::jsonb), public.purchase_to_json(v_id)
  );

  RETURN jsonb_build_object(
    'duplicate', false,
    'purchase', public.purchase_to_json(v_id)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_purchase(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_purchase(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_purchase(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_purchase(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_purchase(jsonb) TO service_role;

COMMIT;
