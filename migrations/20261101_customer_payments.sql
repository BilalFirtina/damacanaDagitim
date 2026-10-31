-- =============================================================================
-- MÜŞTERİ TAHSİLATLARI (teslimat dışı ödeme)
--
-- AGENTS.md Bölüm 6:
--   * Müşteri ürün almadan borcunu ödeyebilmelidir (sonraki ziyaret tahsilatı).
--   * Her ödeme doğru müşteriye ve bekleyen hesap bakiyesine bağlanır.
--   * Bakiye; satış + tahsilat + yetkili düzeltmelerden hesaplanır.
--   * Tahsilat, satış geliriyle karıştırılmaz.
--
-- TAMAMEN ADDITIVE:
--   * Yeni 1 tablo + 1 RPC + 1 trigger fonksiyonu.
--   * Mevcut tablolarda yapısal değişiklik yok; yalnızca
--     public.customers.current_balance_tl güncellenir (mevcut davranışla aynı).
--   * Geri alma: DROP TABLE public.customer_payments;
--
-- ÖNEMLİ: Bu dosya canlıya OTOMATİK uygulanmaz. Supabase SQL Editor'de
-- tek transaction olarak çalıştırılmalıdır.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_payments (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES public.customers(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('CASH', 'POS', 'TRANSFER')),
  note TEXT NOT NULL DEFAULT '',
  collected_by_user_id TEXT NOT NULL,
  collected_by_user_name TEXT NOT NULL,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_payments_customer
  ON public.customer_payments(customer_id, collected_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_payments_date
  ON public.customer_payments(collected_at DESC);

-- RLS: mevcut denetim tablolarıyla aynı desen.
ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_payments_select ON public.customer_payments;
DROP POLICY IF EXISTS customer_payments_insert ON public.customer_payments;
CREATE POLICY customer_payments_select ON public.customer_payments FOR SELECT USING (true);
CREATE POLICY customer_payments_insert ON public.customer_payments FOR INSERT WITH CHECK (true);

-- Tahsilat kayıtları değiştirilemez/silinemez (denetim izi).
CREATE OR REPLACE FUNCTION public.prevent_customer_payment_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CUSTOMER_PAYMENT_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_payments_no_update_delete ON public.customer_payments;
CREATE TRIGGER trg_customer_payments_no_update_delete
  BEFORE UPDATE OR DELETE ON public.customer_payments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_customer_payment_mutation();

DROP TRIGGER IF EXISTS trg_customer_payments_no_truncate ON public.customer_payments;
CREATE TRIGGER trg_customer_payments_no_truncate
  BEFORE TRUNCATE ON public.customer_payments
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_customer_payment_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.customer_payments FROM PUBLIC;

-- Atomik tahsilat: bakiye + ödeme kaydı + denetim izi tek transaction.
-- p = {
--   payment_id, customer_id, amount, method, note,
--   collected_by_user_id, collected_by_user_name
-- }
CREATE OR REPLACE FUNCTION public.record_customer_payment(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_payment_id TEXT := p->>'payment_id';
  v_customer_id TEXT := p->>'customer_id';
  v_amount NUMERIC := COALESCE((p->>'amount')::numeric, 0);
  v_method TEXT := COALESCE(p->>'method', 'CASH');
  v_note TEXT := COALESCE(p->>'note', '');
  v_user_id TEXT := p->>'collected_by_user_id';
  v_user_name TEXT := p->>'collected_by_user_name';
  v_previous NUMERIC;
  v_new NUMERIC;
  v_existing RECORD;
BEGIN
  IF v_payment_id IS NULL OR v_payment_id = '' THEN
    RAISE EXCEPTION 'PAYMENT_ID_REQUIRED';
  END IF;
  IF v_customer_id IS NULL OR v_customer_id = '' THEN
    RAISE EXCEPTION 'CUSTOMER_REQUIRED';
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'PAYMENT_AMOUNT_INVALID';
  END IF;
  IF v_method NOT IN ('CASH', 'POS', 'TRANSFER') THEN
    RAISE EXCEPTION 'PAYMENT_METHOD_INVALID';
  END IF;
  IF v_user_id IS NULL OR v_user_name IS NULL THEN
    RAISE EXCEPTION 'ACTOR_REQUIRED';
  END IF;

  -- Idempotency: aynı payment_id tekrar gönderilirse bakiye İKİ KEZ düşmez.
  SELECT id, amount, customer_id INTO v_existing
  FROM public.customer_payments
  WHERE id = v_payment_id;

  IF FOUND THEN
    SELECT current_balance_tl INTO v_new
    FROM public.customers
    WHERE id = v_existing.customer_id;

    RETURN jsonb_build_object(
      'payment_id', v_existing.id,
      'already_applied', true,
      'balance', v_new
    );
  END IF;

  SELECT current_balance_tl INTO v_previous
  FROM public.customers
  WHERE id = v_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  v_previous := COALESCE(v_previous, 0);
  v_new := v_previous - v_amount;

  UPDATE public.customers
  SET current_balance_tl = v_new
  WHERE id = v_customer_id;

  INSERT INTO public.customer_payments
    (id, customer_id, amount, method, note, collected_by_user_id, collected_by_user_name)
  VALUES
    (v_payment_id, v_customer_id, v_amount, v_method, v_note, v_user_id, v_user_name);

  -- Denetim izi: bakiye değişikliği kim tarafından ve neden yapıldı.
  INSERT INTO public.customer_financial_audit
    (customer_id, changed_by_user_id, changed_by_user_name, reason, previous_balance, new_balance)
  VALUES
    (
      v_customer_id,
      v_user_id,
      v_user_name,
      'Tahsilat (' || v_method || ')' || CASE WHEN v_note <> '' THEN ': ' || v_note ELSE '' END,
      v_previous,
      v_new
    );

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'already_applied', false,
    'previous_balance', v_previous,
    'balance', v_new
  );
END;
$$;

COMMIT;
