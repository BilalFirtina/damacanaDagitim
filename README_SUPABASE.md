# SuDağıtım Pro - Supabase Kurulum Rehberi

Uygulama sunucu tarafında Supabase REST API kullanır. İstemci tarayıcıya Supabase anahtarı gönderilmez.

## 1. Supabase projesi

1. [supabase.com](https://supabase.com) üzerinde proje oluşturun.
2. Proje URL'sini ve sunucu tarafı gizli anahtarını **Project Settings → API** bölümünden alın.

## 2. Veritabanı şeması ve migration'lar

Supabase **SQL Editor** içinde aşağıdaki dosyaları sırasıyla çalıştırın:

1. `supabase_schema.sql`
2. `migrations/20261018_fix_cam_damacana_deposit_type.sql`
3. `migrations/20261019_delivery_atomic_and_reopen.sql`
4. `migrations/20261020_rpc_authorization_hardening.sql`

> Migration 20, anon/authenticated erişimini kaldırır. Yalnızca sunucu tarafı gizli anahtar tanımlandıktan ve doğrulandıktan sonra uygulanmalıdır. Mevcut projede migration 19 uygulanmış, migration 20 henüz uygulanmamıştır.

## 3. Ortam değişkenleri

Sunucuda aşağıdaki değişkenleri tanımlayın:

- `SUPABASE_URL` = Supabase proje URL'si
- `SUPABASE_SECRET_KEY` = Sunucu tarafı gizli anahtar

`SUPABASE_ANON_KEY` yalnızca geriye dönük uyumluluk içindir; migration 20 sonrasında veritabanı erişimi için kullanılamaz. Gizli anahtarı istemci koduna, repoya veya `.env.example` dosyasına yazmayın.

Render/Railway ortamında `SUPABASE_SECRET_KEY` değerini tanımlayıp servisi yeniden başlatın.

## 4. Çalışma biçimi

- `SUPABASE_URL` ve sunucu anahtarı tanımlıysa tüm veri işlemleri Supabase üzerinden yürür.
- Bağlantı yoksa uygulama yerel `data_store.json` dosyasıyla çalışmaya devam eder.
- Sunucu gizli anahtarı yoksa yazma işlemleri güvenli biçimde reddedilir.
