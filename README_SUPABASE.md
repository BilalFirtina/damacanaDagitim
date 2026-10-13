# SuDağıtım Pro - Supabase PostgreSQL Kurulum Rehberi

Projeniz **Supabase PostgreSQL** veritabanına bağlanacak şekilde tam olarak hazırlandı. Render, Railway veya kendi sunucunuzda çalıştırmak için aşağıdaki 3 adımı uygulamanız yeterlidir:

---

### 1. Adım: Supabase'de Proje Açma
1. [supabase.com](https://supabase.com) adresine gidin ve ücretsiz bir hesap açıp **"New Project"** deyin.
2. Projenize bir isim verin (Örn: `sudagitim-pro`) ve veritabanı şifrenizi belirleyin.

---

### 2. Adım: Veritabanı Tablolarını Oluşturma (Tek Tıkla)
1. Supabase panelinde sol menüden **"SQL Editor"** simgesine tıklayın.
2. Projenin ana dizininde bulunan **`supabase_schema.sql`** dosyasının tüm içeriğini kopyalayıp buraya yapıştırın.
3. Sağ alttaki yeşil **"Run"** butonuna basın.

Bu işlem saniyeler içinde şu tabloları, ilişkileri ve başlangıç verilerini oluşturur:
- `users`: Şoförler ve Firma Sahibi (Uğur Fırtına vb.)
- `products`: 19L Damacana, Pet Su, Soda, Tüp, Bardak
- `customers`: Müşteri carileri, adresleri ve emanet boş damacana borçları
- `dispatches`: Günlük araç yüklemeleri ve gün sonu mutabakat kayıtları
- `deliveries`: Saha teslimatları, nakit/POS tahsilatları ve alınan boş kaplar

---

### 3. Adım: Supabase Anahtarlarını Render / Railway'e Ekleme
1. Supabase panelinde sol alttaki **Project Settings (Çark simgesi) → API** bölümüne gidin.
2. Buradaki 2 bilgiyi kopyalayın:
   - **Project URL** (Örn: `https://xyzabc.supabase.co`)
   - **Project API keys → anon / public** (Örn: `eyJhbGciOi...`)
3. Render.com veya Railway.app üzerindeki servisinizin **Environment Variables (Ortam Değişkenleri)** bölümüne ekleyin:
   - `SUPABASE_URL` = `https://xyzabc.supabase.co`
   - `SUPABASE_ANON_KEY` = `eyJhbGciOi...`

---

### Nasıl Çalışır?
- Eğer `SUPABASE_URL` ve `SUPABASE_ANON_KEY` tanımlanmışsa, sistem otomatik olarak **Supabase PostgreSQL**'i aktif eder ve tüm teslimat, yükleme ve müşteri kayıtlarını doğrudan bulut veritabanına yazar.
- Eğer bu değişkenler henüz girilmemişse (örneğin yerel geliştirme veya test ortamında), sistem çökmeyip otomatik olarak yerel `data_store.json` dosyasını kullanarak çalışmaya devam eder.
