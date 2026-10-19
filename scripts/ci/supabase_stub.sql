-- -----------------------------------------------------------------------------
-- supabase_stub.sql
--
-- Supabase platforminin, migrations ve supabase_schema.sql tarafindan beklenen
-- minimum parcalarini duz PostgreSQL uzerinde taklit eder. Sadece CI ve yerel
-- dogrulama icindir; gercek Supabase projesine UYGULANMAZ.
--
-- Taklit edilenler:
--   * roller: anon, authenticated (NOLOGIN NOINHERIT), service_role (BYPASSRLS)
--   * auth semasi + auth.uid() / auth.role() / auth.jwt() (Supabase benzeri)
--   * public semasina USAGE
--
-- Taklit EDILMEYENLER: RLS politikalari (supabase_schema.sql tanimlar),
-- uzantilar (pgcrypto vb.), PostgREST/GoTrue servisleri.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    -- Gercek Supabase'de service_role RLS'i atlar.
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

-- Supabase'de auth semasi ve JWT yardimci fonksiyonlari platform tarafindan
-- saglanir. Uygulama RLS politikalari bunlari kullanabilir; burada minimal
-- taklitleri verilir.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() ->> 'sub', '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(auth.jwt() ->> 'role', ''), NULLIF(current_setting('role', true), ''), 'anon');
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid(), auth.role() TO anon, authenticated, service_role;
