-- =============================================================================
-- TAHSİLAT RPC YETKİLENDİRME SERTLEŞTİRMESİ
--
-- AGENTS.md Bölüm 13 ve 17:
--   * Ayrıcalıklı işlemler yalnızca güvenilir sunucu rolüyle çalıştırılabilir.
--   * İstemci anahtarıyla doğrudan bakiye değiştirilemez.
--
-- 20261101_customer_payments.sql ile eklenen record_customer_payment()
-- fonksiyonu varsayılan olarak PUBLIC'e açıktı. Bu betik yalnızca service_role
-- rolüne çalıştırma izni verir ve customer_payments tablosunu anon/authenticated
-- rollerinden kapatır.
--
-- TAMAMEN ADDITIVE: mevcut veriyi değiştirmez.
-- =============================================================================

BEGIN;

REVOKE EXECUTE ON FUNCTION public.record_customer_payment(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(jsonb)
  TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.customer_payments FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.customer_payments FROM authenticated';
  END IF;
END $$;

COMMIT;
