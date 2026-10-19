-- ==============================================================================
-- Dağıtım & Mutabakat - Supabase PostgreSQL Veritabanı Şeması (NORMALİZE)
-- Supabase Panelinde "SQL Editor" sekmesine yapıştırıp "Run" butonuna basınız.
-- ==============================================================================
-- ÖNEMLİ:
--   * Bu dosya, uygulamanın beklediği normalleştirilmiş şemanın referansıdır.
--     Canlı veritabanı şeması bu dosyayla uyumlu olacak şekilde uygulanmıştır.
--   * public.users tablosu, kimlik doğrulama ve mevcut kullanıcı kayıtları
--     KORUNUR; bu dosya users/customers için başlangıç verisi EKLEMEZ.
--   * Yalnızca referans verisi (deposit_types, product_categories, products)
--     ekilir. Ürünler uygulama tarafından da (ensureSupabaseSeeded) ekilir.
-- ==============================================================================

-- 1. KULLANICILAR TABLOSU (users) — mevcut yapı korunur
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'driver')),
  can_load_vehicle BOOLEAN DEFAULT false,
  assigned_plate TEXT,
  pin TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. DEPOZİTO TÜRLERİ (deposit_types)
CREATE TABLE IF NOT EXISTS public.deposit_types (
  code TEXT PRIMARY KEY,
  label_tr TEXT NOT NULL,
  is_returnable BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 99
);

-- 3. ÜRÜN KATEGORİLERİ (product_categories) — veri odaklı kategori yönetimi
CREATE TABLE IF NOT EXISTS public.product_categories (
  code TEXT PRIMARY KEY,
  title_tr TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 99,
  default_unit TEXT NOT NULL DEFAULT 'Adet',
  default_is_deposit BOOLEAN NOT NULL DEFAULT false,
  default_deposit_type TEXT NOT NULL DEFAULT 'none' REFERENCES public.deposit_types(code),
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- 4. ÜRÜN KATALOĞU (products)
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL REFERENCES public.product_categories(code),
  default_unit_price NUMERIC NOT NULL DEFAULT 100,
  is_deposit BOOLEAN NOT NULL DEFAULT false,
  deposit_type TEXT NOT NULL DEFAULT 'none' REFERENCES public.deposit_types(code),
  unit TEXT NOT NULL DEFAULT 'Adet',
  package_size INTEGER,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. MÜŞTERİLER (customers)
CREATE TABLE IF NOT EXISTS public.customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_account_customer BOOLEAN NOT NULL DEFAULT true,
  current_balance_tl NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_date TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. MÜŞTERİ ÖZEL FİYATLARI (customer_product_prices)
CREATE TABLE IF NOT EXISTS public.customer_product_prices (
  customer_id TEXT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES public.products(id),
  unit_price NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (customer_id, product_id)
);

-- 7. MÜŞTERİDEKİ BOŞ KAP BAKİYELERİ (customer_empty_balances)
CREATE TABLE IF NOT EXISTS public.customer_empty_balances (
  customer_id TEXT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  deposit_type TEXT NOT NULL REFERENCES public.deposit_types(code),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (customer_id, deposit_type)
);

-- 8. ARAÇ YÜKLEMELERİ & SEFERLER (dispatches)
CREATE TABLE IF NOT EXISTS public.dispatches (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL, -- YYYY-MM-DD
  driver_id TEXT NOT NULL REFERENCES public.users(id),
  driver_name TEXT NOT NULL,
  vehicle_plate TEXT NOT NULL,
  loaded_by_user_id TEXT NOT NULL REFERENCES public.users(id),
  loaded_by_user_name TEXT NOT NULL,
  driver_confirmed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending_confirmation'
    CHECK (status IN ('pending_confirmation', 'in_transit', 'completed')),
  -- Gün sonu mutabakatı skaler alanları (canlı şema ile doğrulandı)
  total_delivered_value NUMERIC NOT NULL DEFAULT 0,
  total_cash_collected NUMERIC NOT NULL DEFAULT 0,
  total_pos_collected NUMERIC NOT NULL DEFAULT 0,
  total_credit_added NUMERIC NOT NULL DEFAULT 0,
  actual_cash_in_pocket NUMERIC NOT NULL DEFAULT 0,
  actual_pos_slips_total NUMERIC NOT NULL DEFAULT 0,
  collected_empty_damacana INTEGER NOT NULL DEFAULT 0,
  collected_empty_cam_damacana INTEGER NOT NULL DEFAULT 0,
  collected_empty_tup INTEGER NOT NULL DEFAULT 0,
  reconciliation_notes TEXT,
  -- Kapanışı yapan yönetici; migration ile eklenir ve sunucu oturumundan yazılır.
  closed_by_user_id TEXT REFERENCES public.users(id),
  closed_by_user_name TEXT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8b. SEFER YÜKLENEN KALEMLER (dispatch_items)
CREATE TABLE IF NOT EXISTS public.dispatch_items (
  dispatch_id TEXT NOT NULL REFERENCES public.dispatches(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES public.products(id),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (dispatch_id, product_id)
);

-- 8c. SEFER GÜN SONU MUTABAKAT KALEMLERİ (dispatch_reconciliation_items)
CREATE TABLE IF NOT EXISTS public.dispatch_reconciliation_items (
  dispatch_id TEXT NOT NULL REFERENCES public.dispatches(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES public.products(id),
  expected_qty INTEGER NOT NULL DEFAULT 0 CHECK (expected_qty >= 0),
  counted_qty INTEGER NOT NULL DEFAULT 0 CHECK (counted_qty >= 0),
  PRIMARY KEY (dispatch_id, product_id)
);

-- 9. MÜŞTERİ TESLİMATLARI (deliveries)
CREATE TABLE IF NOT EXISTS public.deliveries (
  id TEXT PRIMARY KEY,
  dispatch_id TEXT NOT NULL REFERENCES public.dispatches(id),
  driver_id TEXT NOT NULL REFERENCES public.users(id),
  driver_name TEXT NOT NULL,
  vehicle_plate TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES public.customers(id),
  customer_name TEXT NOT NULL,
  customer_address TEXT,
  customer_phone TEXT,
  timestamp TIMESTAMPTZ DEFAULT now(),
  delivered_grand_total NUMERIC NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'UNPAID',
  cash_amount NUMERIC NOT NULL DEFAULT 0,
  pos_amount NUMERIC NOT NULL DEFAULT 0,
  total_collected NUMERIC NOT NULL DEFAULT 0,
  diff_uncollected NUMERIC NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  notes TEXT,
  is_offline_sync BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 9b. TESLİMAT KALEMLERİ (delivery_items)
CREATE TABLE IF NOT EXISTS public.delivery_items (
  delivery_id TEXT NOT NULL REFERENCES public.deliveries(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  product_id TEXT NOT NULL REFERENCES public.products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_price NUMERIC NOT NULL DEFAULT 0,
  line_total NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (delivery_id, line_no)
);

-- 9c. TESLİMAT BOŞ KAP HAREKETLERİ (delivery_container_returns)
CREATE TABLE IF NOT EXISTS public.delivery_container_returns (
  delivery_id TEXT NOT NULL REFERENCES public.deliveries(id) ON DELETE CASCADE,
  deposit_type TEXT NOT NULL REFERENCES public.deposit_types(code),
  received_qty INTEGER NOT NULL DEFAULT 0,
  diff_qty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (delivery_id, deposit_type)
);

-- Performans İndeksleri
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category);
CREATE INDEX IF NOT EXISTS idx_dispatches_date ON public.dispatches(date);
CREATE INDEX IF NOT EXISTS idx_dispatches_driver ON public.dispatches(driver_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_timestamp ON public.deliveries(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_dispatch ON public.deliveries(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_customer ON public.deliveries(customer_id);

-- Aynı şoför veya aynı plaka için tek aktif sefer (AGENTS.md 15.5)
CREATE UNIQUE INDEX IF NOT EXISTS ux_dispatches_active_driver
  ON public.dispatches(driver_id) WHERE status IN ('pending_confirmation', 'in_transit');
CREATE UNIQUE INDEX IF NOT EXISTS ux_dispatches_active_plate
  ON public.dispatches(vehicle_plate) WHERE status IN ('pending_confirmation', 'in_transit');

-- RLS (Row Level Security) — anonim anahtarla tam okuma/yazma (mevcut politika korunur)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_empty_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_reconciliation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_container_returns ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','deposit_types','product_categories','products','customers',
    'customer_product_prices','customer_empty_balances','dispatches',
    'dispatch_items','dispatch_reconciliation_items','deliveries',
    'delivery_items','delivery_container_returns'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow public all access on ' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (true) WITH CHECK (true)',
      'Allow public all access on ' || t, t);
  END LOOP;
END $$;

-- ==============================================================================
-- BAŞLANGIÇ REFERANS VERİLERİ (SEED — yalnızca referans; kullanıcı/müşteri EKLENMEZ)
-- ==============================================================================

-- Depozito Türleri
INSERT INTO public.deposit_types (code, label_tr, is_returnable, sort_order) VALUES
  ('damacana', 'Damacana (Plastik/Polikarbon)', true, 1),
  ('cam_damacana', 'Cam Damacana', true, 2),
  ('tup', 'Gaz Tüpü', true, 3),
  ('none', 'Yok', false, 99)
ON CONFLICT (code) DO UPDATE SET
  label_tr = EXCLUDED.label_tr,
  is_returnable = EXCLUDED.is_returnable,
  sort_order = EXCLUDED.sort_order;

-- Ürün Kategorileri
INSERT INTO public.product_categories
  (code, title_tr, sort_order, default_unit, default_is_deposit, default_deposit_type) VALUES
  ('damacana', 'Damacana Su', 1, 'Adet', true, 'damacana'),
  ('pet', 'Pet Su', 2, 'Koli', false, 'none'),
  ('tup', 'Tüp', 3, 'Adet', true, 'tup'),
  ('soda', 'Maden Suyu / İçecek', 4, 'Koli', false, 'none'),
  ('bardak', 'Bardak & Sarf Malzeme', 5, 'Paket', false, 'none')
ON CONFLICT (code) DO UPDATE SET
  title_tr = EXCLUDED.title_tr,
  sort_order = EXCLUDED.sort_order;

-- ==============================================================================
-- NOT: public.users tablosu ve müşteri kayıtları BİLİNÇLİ OLARAK eklenmez.
-- Kullanıcı ve müşteri verileri Supabase üzerinde mevcut haliyle korunur.
-- ==============================================================================

-- ==============================================================================
-- 14. TESLİMAT GÜVENİLİRLİĞİ / ATOMİK RPC NESNELERİ
--
-- Bu dosya yalnızca temel şemayı tanımlar. Aşağıdaki nesneler
-- migrations/20261019_delivery_atomic_and_reopen.sql tarafından eklenir:
--
--   * public.dispatch_reopen_audit  (yalnızca SELECT + INSERT; immutable)
--   * public.customer_financial_audit (yalnızca SELECT + INSERT; immutable)
--   * public.dispatch_loading_audit (yalnızca SELECT + INSERT; immutable)
--   * public.prevent_dispatch_reopen_audit_mutation()
--   * public.apply_delivery(jsonb)              -- atomik + idempotent teslimat
--   * public.update_dispatch_loading(jsonb)     -- yalnızca pending_confirmation
--   * public.close_dispatch(jsonb)              -- atomik gün sonu kapatma
--   * public.reopen_dispatch(jsonb)             -- yönetici + denetim kaydı
--   * public.admin_update_customer(jsonb)       -- beklenen değer kontrollü yazım
--
-- Uygulama sırası (yeni kurulum):
--   1) Bu dosya ile temel şema oluşturulur.
--   2) 20261019_delivery_atomic_and_reopen.sql uygulanır.
--   3) 20261020_rpc_authorization_hardening.sql uygulanır.
--
-- Sunucu SUPABASE_SERVICE_ROLE_KEY (veya SUPABASE_SECRET_KEY) ile çalışmalıdır.
-- Anon/publishable anahtar ile yazma işlemleri 503 RPC_AUTH_REQUIRED döner;
-- 20261020 migration'ı anon/authenticated erişimini kaldırmadan uygulama
-- yazma yapmaz. Kod sessizce atomik olmayan eski yola DÖNMEZ.
--
-- Canlı şemayı uygulamadan önce doğrulamak için (salt-okunur):
--   psql "$DATABASE_URL" -f scripts/introspect-delivery-rpcs.sql
--
-- GÜVEN SINIRI: RPC'ler express ile aynı süreçteki service_role tarafından
-- çağrılır; kimlik/rol kontrolü Express'te, yürütme yetkisi DB'de zorunludur.
-- ==============================================================================
