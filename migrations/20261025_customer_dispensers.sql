-- =============================================================================
-- 20261025 — Müşteri sebil kayıtları
--
-- * Müşteride bulunan sebillere ait adet, marka, model ve açıklama bilgisi.
-- * Fiyat, tahsilat, bakiye, seri numarası veya depozito tutarı tutulmaz.
-- * Aynı marka/model birden fazla kayıtta bulunabilir; tekil kısıt yoktur.
-- * Tablo yalnızca hizmet rolüyle erişilebilir; RLS açık ve politika yoktur.
-- * Saklama (retention) işlemleri bu tabloya dokunmaz.
-- =============================================================================

BEGIN;

CREATE TABLE public.customer_dispensers (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id TEXT NOT NULL,
  updated_by_user_name TEXT NOT NULL
);

CREATE INDEX idx_customer_dispensers_customer_id
  ON public.customer_dispensers(customer_id);

ALTER TABLE public.customer_dispensers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.customer_dispensers FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.customer_dispensers FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.customer_dispensers FROM authenticated';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_dispensers TO service_role';
  END IF;
END $$;

COMMIT;
