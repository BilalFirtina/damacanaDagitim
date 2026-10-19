-- =============================================================================
-- RPC ve tablo erişim yetkilerinin sunucu rolüne kilitlenmesi
--
-- ÖNEMLİ: Bu dosya yalnızca referanstır. Canlı Supabase veritabanında
-- ÇALIŞTIRILMAMIŞTIR. 20261019_delivery_atomic_and_reopen.sql uygulandıktan
-- SONRA, tek bir transaction içinde uygulanmalıdır.
--
-- Ön koşul:
--   * Sunucuda SUPABASE_SERVICE_ROLE_KEY (veya SUPABASE_SECRET_KEY) tanımlı
--     olmalıdır. Anon/publishable anahtar ile uygulama yazma yapamaz.
--   * Uygulama istemcisi Supabase'e doğrudan bağlanmıyor; tüm erişim Express
--     sunucusu üzerinden yapılıyor.
--
-- Bu migration:
--   * Beş kritik RPC'nin PUBLIC/anon/authenticated EXECUTE yetkisini kaldırır.
--   * EXECUTE yetkisini yalnızca service_role'e verir.
--   * public şemasındaki tablo/sequence DML yetkilerini anon/authenticated ve
--     PUBLIC'ten kaldırır; service_role'e verir.
--   * Denetim tablolarını yalnızca eklenebilir/okunabilir tutar.
--   * Sunucunun çağıracağı rpc_authorization_ready() denetim fonksiyonunu ekler.
--   * RLS politikalarını silmez veya zayıflatmaz.
-- =============================================================================

BEGIN;

-- 1) Kritik RPC'ler: yalnızca güvenilir sunucu rolü.
REVOKE EXECUTE ON FUNCTION public.apply_delivery(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_dispatch_loading(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.close_dispatch(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reopen_dispatch(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_update_customer(jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_delivery(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_dispatch_loading(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_dispatch(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reopen_dispatch(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_customer(jsonb) TO service_role;

-- 2) Doğrudan PostgREST erişimi: tüm iş tabloları ve sequence'ler yalnızca
--    sunucu rolüne açılır. İstemci Supabase'e doğrudan bağlanmaz.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
  END IF;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Denetim tabloları değiştirilemez kalır: service_role yalnızca okur/ekler.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.dispatch_reopen_audit FROM service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.customer_financial_audit FROM service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.dispatch_loading_audit FROM service_role;
GRANT SELECT, INSERT ON TABLE public.dispatch_reopen_audit TO service_role;
GRANT SELECT, INSERT ON TABLE public.customer_financial_audit TO service_role;
GRANT SELECT, INSERT ON TABLE public.dispatch_loading_audit TO service_role;

-- 3) Sunucunun her yazma öncesi çağırdığı yetki denetimi.
--    false dönerse uygulama 503 ile fail-closed davranır.
CREATE OR REPLACE FUNCTION public.rpc_authorization_ready()
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.apply_delivery(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.update_dispatch_loading(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.close_dispatch(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.reopen_dispatch(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.admin_update_customer(jsonb)', 'EXECUTE')
  THEN
    RETURN false;
  END IF;

  IF has_function_privilege('anon', 'public.apply_delivery(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.update_dispatch_loading(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.close_dispatch(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.reopen_dispatch(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_update_customer(jsonb)', 'EXECUTE')
  THEN
    RETURN false;
  END IF;

  IF has_function_privilege('authenticated', 'public.apply_delivery(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.update_dispatch_loading(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.close_dispatch(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reopen_dispatch(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admin_update_customer(jsonb)', 'EXECUTE')
  THEN
    RETURN false;
  END IF;

  IF has_table_privilege('anon', 'public.deliveries', 'INSERT')
     OR has_table_privilege('anon', 'public.deliveries', 'UPDATE')
     OR has_table_privilege('anon', 'public.deliveries', 'DELETE')
     OR has_table_privilege('anon', 'public.customers', 'UPDATE')
     OR has_table_privilege('anon', 'public.dispatches', 'UPDATE')
     OR has_table_privilege('anon', 'public.customer_financial_audit', 'INSERT')
     OR has_table_privilege('anon', 'public.dispatch_reopen_audit', 'INSERT')
     OR has_table_privilege('anon', 'public.dispatch_loading_audit', 'INSERT')
  THEN
    RETURN false;
  END IF;

  IF has_table_privilege('authenticated', 'public.deliveries', 'INSERT')
     OR has_table_privilege('authenticated', 'public.deliveries', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.deliveries', 'DELETE')
     OR has_table_privilege('authenticated', 'public.customers', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.dispatches', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.customer_financial_audit', 'INSERT')
     OR has_table_privilege('authenticated', 'public.dispatch_reopen_audit', 'INSERT')
     OR has_table_privilege('authenticated', 'public.dispatch_loading_audit', 'INSERT')
  THEN
    RETURN false;
  END IF;

  IF NOT has_table_privilege('service_role', 'public.deliveries', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.customers', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.dispatches', 'UPDATE')
  THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_authorization_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_authorization_ready() TO service_role;

COMMIT;
