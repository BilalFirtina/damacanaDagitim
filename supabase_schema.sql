-- ==============================================================================
-- Dağıtım & Mutabakat - Supabase PostgreSQL Veritabanı Şeması
-- Supabase Panelinde "SQL Editor" sekmesine yapıştırıp "Run" butonuna basınız.
-- ==============================================================================

-- 1. KULLANICILAR TABLOSU (users)
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

-- 2. ÜRÜN KATALOĞU TABLOSU (products)
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('damacana', 'pet', 'soda', 'tup', 'bardak')),
  default_unit_price NUMERIC NOT NULL DEFAULT 100,
  is_deposit BOOLEAN DEFAULT false,
  deposit_type TEXT DEFAULT 'none' CHECK (deposit_type IN ('damacana', 'tup', 'none')),
  unit TEXT NOT NULL DEFAULT 'Adet',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. MÜŞTERİLER TABLOSU (customers)
CREATE TABLE IF NOT EXISTS public.customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  emails JSONB DEFAULT '[]'::jsonb, -- Çoklu e-posta adresleri (e-fatura, cari mutabakat bildirimleri)
  is_account_customer BOOLEAN DEFAULT true,
  current_balance_tl NUMERIC DEFAULT 0,
  empty_deposit_damacana INTEGER DEFAULT 0,
  empty_deposit_tup INTEGER DEFAULT 0,
  custom_prices JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  created_date TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Var olan veritabanlarında eksik 'emails' kolonunu güvenle ekle, varsa 'district' verilerini taşı ve 'district' kolonunu kaldır
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS emails JSONB DEFAULT '[]'::jsonb;

UPDATE public.customers 
SET emails = jsonb_build_array(district)
WHERE (emails IS NULL or emails = '[]'::jsonb) 
  AND district IS NOT NULL 
  AND district != '' 
  AND district LIKE '%@%';

ALTER TABLE public.customers DROP COLUMN IF EXISTS district;


-- 4. ARAÇ YÜKLEMELERİ & SEFERLER TABLOSU (dispatches)
CREATE TABLE IF NOT EXISTS public.dispatches (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL, -- YYYY-MM-DD
  driver_id TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  vehicle_plate TEXT NOT NULL,
  loaded_by_user_id TEXT NOT NULL,
  loaded_by_user_name TEXT NOT NULL,
  driver_confirmed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending_confirmation' CHECK (status IN ('pending_confirmation', 'in_transit', 'completed')),
  loaded_items JSONB DEFAULT '[]'::jsonb,
  end_of_day_reconciliation JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. MÜŞTERİ TESLİMATLARI & EKİP CANLI AKIŞ TABLOSU (deliveries)
CREATE TABLE IF NOT EXISTS public.deliveries (
  id TEXT PRIMARY KEY,
  dispatch_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  vehicle_plate TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_address TEXT,
  customer_phone TEXT,
  timestamp TIMESTAMPTZ DEFAULT now(),
  delivered_items JSONB DEFAULT '[]'::jsonb,
  delivered_grand_total NUMERIC DEFAULT 0,
  collected_payment JSONB DEFAULT '{}'::jsonb,
  empty_containers_received JSONB DEFAULT '{"damacana": 0, "tup": 0}'::jsonb,
  empty_containers_diff JSONB DEFAULT '{"damacana": 0, "tup": 0}'::jsonb,
  notes TEXT,
  is_offline_sync BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Performans İndeksleri
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_dispatches_date ON public.dispatches(date);
CREATE INDEX IF NOT EXISTS idx_dispatches_driver ON public.dispatches(driver_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_timestamp ON public.deliveries(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_dispatch ON public.deliveries(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_customer ON public.deliveries(customer_id);

-- RLS (Row Level Security) İzinleri (Anonim anahtarla tam okuma/yazma)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public all access on users" ON public.users;
CREATE POLICY "Allow public all access on users" ON public.users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public all access on products" ON public.products;
CREATE POLICY "Allow public all access on products" ON public.products FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public all access on customers" ON public.customers;
CREATE POLICY "Allow public all access on customers" ON public.customers FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public all access on dispatches" ON public.dispatches;
CREATE POLICY "Allow public all access on dispatches" ON public.dispatches FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public all access on deliveries" ON public.deliveries;
CREATE POLICY "Allow public all access on deliveries" ON public.deliveries FOR ALL USING (true) WITH CHECK (true);

-- ==============================================================================
-- BAŞLANGIÇ VERİLERİ (SEED DATA - Otomatik olarak eklenir)
-- ==============================================================================

-- Kullanıcılar (Kullanıcı adı ve Şifre/PIN Supabase Tablosundan yönetilebilir)
-- İzinli Araç Plakaları: 01 FV 823, 06 GB 357, 01 AVH 886
INSERT INTO public.users (id, name, username, role, can_load_vehicle, assigned_plate, pin, phone)
VALUES
  ('usr_admin', 'Uğur Fırtına', 'yonetici', 'admin', true, '', '1234', '0532 555 10 00'),
  ('usr_driver_1', 'Ahmet Yılmaz', 'ahmet', 'driver', true, '01 FV 823', '1010', '0533 555 20 01'),
  ('usr_driver_2', 'Mehmet Kaya', 'mehmet', 'driver', false, '06 GB 357', '2020', '0535 555 30 02'),
  ('usr_driver_3', 'Serkan Aydın', 'serkan', 'driver', false, '01 AVH 886', '3030', '0536 555 40 03')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  username = EXCLUDED.username,
  pin = EXCLUDED.pin,
  role = EXCLUDED.role,
  assigned_plate = EXCLUDED.assigned_plate;

-- ==============================================================================
-- ŞOFÖR VE KULLANICI YÖNETİMİ (SUPABASE SQL / TABLO EDİTÖRÜ KULLANIMI)
-- ==============================================================================
-- 1. Şoför Şifresini veya Kullanıcı Adını Değiştirmek İçin:
--    UPDATE public.users SET pin = '9999' WHERE username = 'ahmet';
--
-- 2. Yeni Şoför Tanımlamak İçin:
--    INSERT INTO public.users (id, name, username, role, can_load_vehicle, assigned_plate, pin, phone)
--    VALUES ('usr_driver_yeni', 'Murat Can', 'murat', 'driver', false, '01 FV 823', '5555', '0532 111 22 33');
--
-- 3. Yetkili Şoför Yapmak (Depo yüklemesi girebilen şoför):
--    UPDATE public.users SET can_load_vehicle = true WHERE username = 'ahmet';

-- Ürünler
INSERT INTO public.products (id, name, category, default_unit_price, is_deposit, deposit_type, unit, description)
VALUES
  ('prod_damacana_19l', '19L Damacana Su (Polikarbon)', 'damacana', 100, true, 'damacana', 'Adet', 'Doğal kaynak damacana su - depozitolu 19 litre'),
  ('prod_pet_05l_24', '0.5L Pet Su (24''lü Koli)', 'pet', 120, false, 'none', 'Koli', '24 adet 500ml pet şişe doğal kaynak suyu'),
  ('prod_pet_15l_12', '1.5L Pet Su (12''li Koli)', 'pet', 110, false, 'none', 'Koli', '12 adet 1.5 litre pet şişe su'),
  ('prod_soda_beypazari_24', 'Beypazarı Maden Suyu (24''lü Koli)', 'soda', 180, false, 'none', 'Koli', 'Doğal maden suyu 200ml cam şişe'),
  ('prod_soda_kizilay_24', 'Kızılay Maden Suyu (24''lü Koli)', 'soda', 175, false, 'none', 'Koli', '24 adet 200ml sade maden suyu'),
  ('prod_tup_12kg', 'Mutfak Tüpü (12 Kg - Tombul/Uzun)', 'tup', 750, true, 'tup', 'Adet', 'Ev tipi 12kg gaz tüpü - depozitolu boş tüp iadeli'),
  ('prod_tup_2kg', 'Piknik Tüpü (2 Kg)', 'tup', 160, true, 'tup', 'Adet', '2kg piknik gaz tüpü - depozitolu'),
  ('prod_bardak_3000', 'Karton Bardak 7oz (3000''li Koli)', 'bardak', 320, false, 'none', 'Koli', 'Sıcak ve soğuk su sebili uyumlu tek kullanımlık bardak')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  default_unit_price = EXCLUDED.default_unit_price;

-- Müşteriler
INSERT INTO public.customers (id, name, phone, address, emails, is_account_customer, current_balance_tl, empty_deposit_damacana, empty_deposit_tup, custom_prices, notes, created_date)
VALUES
  ('cust_1', 'Yıldız Cafe & Bistro', '0216 450 11 22', 'Moda Cad. No: 42, Kadıköy', '["yildiz@cafe.com"]'::jsonb, true, 0, 4, 0, '{"prod_damacana_19l": 85, "prod_soda_beypazari_24": 165}', 'Arka kapıdan mutfağa bırakılacak. Sabah 10:00 dan önce teslimat.', '2026-09-01'),
  ('cust_2', 'Boğaziçi Unlu Mamülleri', '0216 340 33 44', 'Hakimiyeti Milliye Cad. No: 18, Üsküdar', '["bogazici@unlu.com"]'::jsonb, true, 350, 6, 1, '{"prod_damacana_19l": 85, "prod_pet_05l_24": 110}', 'Fırın ustası Mehmet Bey teslim alıyor.', '2026-09-10'),
  ('cust_3', 'Demir Hukuk & Mimarlık', '0216 570 55 66', 'Varyap Meridian B Blok Kat: 12, Ataşehir', '["info@demirhukuk.com"]'::jsonb, true, 285, 3, 0, '{"prod_damacana_19l": 95}', 'Danışma sekreteryaya bırakılıyor.', '2026-09-15'),
  ('cust_4', 'Marmara Balıkçısı', '0216 380 77 88', 'Sahil Yolu No: 85, Maltepe', '["marmara@balik.com"]'::jsonb, false, 0, 8, 2, '{"prod_damacana_19l": 90, "prod_soda_kizilay_24": 160}', 'Kasa görevlisi Ayhan Bey peşin ödüyor.', '2026-09-20'),
  ('cust_5', 'Ayşe Hanım (Ev Abonesi)', '0532 111 22 33', 'Bağdat Cad. Çiçek Apt. D: 5, Bostancı', '["ayse@hanim.com"]'::jsonb, false, 0, 1, 0, '{}', 'Zil bozuk, gelince cepten aranacak.', '2026-09-25'),
  ('cust_6', 'Çağdaş Spor Kompleksi', '0216 488 99 00', 'Atalar Mah. Spor Cad. No: 14, Kartal', '["cagdas@spor.com"]'::jsonb, true, 600, 12, 0, '{"prod_damacana_19l": 80, "prod_pet_05l_24": 105, "prod_bardak_3000": 290}', 'Giriş resepsiyonu ve spor salonu sebilleri için.', '2026-09-28')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  phone = EXCLUDED.phone;

-- ==============================================================================
-- MİGRASYON / GÜNCELLEME NOTU (Eski veritabanlarında district -> emails taşıma)
-- Eğer veritabanınızda daha önceden district kolonunda e-postalar tutulduysa,
-- aşağıdaki SQL komutunu çalıştırarak verileri güvenle emails (JSONB) kolonuna taşıyabilir
-- ve district kolonunu silebilirsiniz:
-- 
-- ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS emails JSONB DEFAULT '[]'::jsonb;
-- 
-- UPDATE public.customers 
-- SET emails = jsonb_build_array(district)
-- WHERE (emails IS NULL or emails = '[]'::jsonb) 
--   AND district IS NOT NULL 
--   AND district != '' 
--   AND district LIKE '%@%';
-- 
-- ALTER TABLE public.customers DROP COLUMN IF EXISTS district;
-- ==============================================================================

