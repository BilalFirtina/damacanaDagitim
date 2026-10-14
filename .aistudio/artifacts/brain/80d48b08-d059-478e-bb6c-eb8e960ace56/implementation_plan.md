# SuDağıtım Pro - Dinamik Plaka, Şoför Kimlik & Renkli Ekip Akışı Uygulama Planı

Bu plan; giriş ekranındaki demo/hızlı hesap seçim butonlarının kaldırılması, şoförlerin kullanıcı adı ve şifrelerinin Supabase SQL/Tablo üzerinden esnek yönetimi, her gün değişebilen araç plakalarının açılır listeden (01 FV 823, 06 GB 357, 01 AVH 886) seçilmesi ve Ekip Canlı Akışı'nda her şoförün teslimatlarının ayırt edici renklerle vurgulanmasını kapsar.

---

## Kullanıcı Tercihleri & Onaylanan Kararlar

- **Giriş Ekranı Düzenlemesi**:
  - Giriş ekranında yer alan "Hızlı Hesap Seçimi (Test & Tanıtım)" butonları tamamen kaldırılacak.
  - Sadece temiz, kurumsal **Kullanıcı Adı** ve **Şifre / PIN** giriş formu kalacak.
  - Üst menü çubuğundaki (Header) şifresiz kullanıcı geçişi sağlayan dropdown kaldırılacak; yerine kullanıcının kimliğini gösteren güvenli profil rozeti ve doğrudan oturumu kapatan **"Çıkış Yap"** butonu konulacak.
- **Supabase Kullanıcı Adı & Şifre Yönetimi**:
  - Şoförlerin kullanıcı adı, şifre/PIN ve yükleme yetkileri Supabase veritabanındaki `users` tablosu üzerinden doğrudan yönetilebilir olacak.
  - `supabase_schema.sql` dosyası kullanıcıların araç plakalarına bağımlı olmayacak şekilde güncellenecek; şifre/kullanıcı adı yönetimi SQL örnekleriyle belgelenecek.
- **Dinamik Araç Plakası Seçimi (Her Gün Değişen Plakalar)**:
  - Araç plakaları artık şoförlerin profiline sabitlenmeyecek.
  - Sabah depo yüklemesi yapılırken (Yönetici veya yetkili şoför tarafından) sadece belirlenen 3 plaka açılır listeden (dropdown) seçilecek:
    1. **`01 FV 823`**
    2. **`06 GB 357`**
    3. **`01 AVH 886`**
  - Seçilen plaka ilgili günün seferine (`dispatch`) ve o sefer altında yapılan tüm teslimat kayıtlarına (`deliveries`) işlenecek.
- **Ekip Akışında Şoförlere Otomatik Ayırt Edici Renkler**:
  - Ekip canlı teslimat akışında her şoför için otomatik, tutarlı ve yüksek kontrastlı bir renk atanacak (Örn: A şoförü Kırmızı/Rose, B şoförü Mavi/Sky, C şoförü Yeşil/Emerald, D şoförü Mor/Violet vb.).
  - Teslimat kartları sol kenar vurgusu, şoför etiketi ve plaka rozetiyle alt alta sıralandığında şoförler birbirine karışmayacak, gözle bir bakışta ayırt edilebilecek.
  - Akışın üst kısmında hangi şoförün hangi renge sahip olduğunu gösteren dinamik bir şoför renk lejantı yer alacak.

---

## 1. Mimari ve Bileşen Değişiklikleri

### A. Giriş & Güvenlik (`LoginView.tsx` & `Header.tsx`)
1. `src/components/auth/LoginView.tsx`:
   - `handleQuickLogin` ve alt kısımdaki hızlı hesap seçim paneli (`Hızlı Hesap Seçimi`) kaldırılacak.
   - Sadece kullanıcı adı + şifre/PIN inputları, şifre gizle/göster ikonu, "Beni Hatırla" seçeneği ve "Giriş Yap" butonu kalacak.
2. `src/components/common/Header.tsx`:
   - Menüdeki şifresiz kullanıcı değiştirme hover paneli (`Kullanıcı / Rol Değiştir`) kaldırılacak.
   - Aktif kullanıcının adı, rolü ve doğrudan "Çıkış Yap" butonu yer alacak.

### B. Dinamik Plaka Seçimi (`VehicleLoadManagement.tsx` & `MorningLoadCard.tsx`)
1. İzin verilen 3 plaka sabiti tanımlanacak:
   ```typescript
   export const AUTHORIZED_VEHICLE_PLATES = [
     '01 FV 823',
     '06 GB 357',
     '01 AVH 886',
   ] as const;
   ```
2. `src/components/admin/VehicleLoadManagement.tsx`:
   - Sabah araç yükleme modalında serbest metin veya şoföre sabit plaka yerine bu 3 plakanın bulunduğu açılır liste (`<select>`) konulacak.
3. `src/components/driver/MorningLoadCard.tsx`:
   - Yetkili şoförün kendi sabah yüklemesini girdiği modalda da bu 3 plakadan birini seçmesi sağlanacak.
4. `src/App.tsx`:
   - Şoförün o günkü seferini (`currentDispatch`) tespit ederken, şoförün aktif seferi varsa doğrudan o sefere ve seçilen plakaya bağlanması sağlanacak.

### C. Ekip Canlı Akışında Şoför Renklendirmesi (`LiveTeamFeed.tsx`)
1. Deterministic şoför renk atama fonksiyonu:
   - Şoför ID veya adına göre tutarlı Tailwind renk şeması (arka plan tonu, kenarlık rengi, metin rengi, rozet rengi) üreten yardımcı fonksiyon oluşturulacak:
     - Kırmızı / Rose (`border-rose-500`, `bg-rose-50 dark:bg-rose-950/40`, `text-rose-700`)
     - Mavi / Sky (`border-sky-500`, `bg-sky-50 dark:bg-sky-950/40`, `text-sky-700`)
     - Yeşil / Emerald (`border-emerald-500`, `bg-emerald-50 dark:bg-emerald-950/40`, `text-emerald-700`)
     - Mor / Violet (`border-violet-500`, `bg-violet-50 dark:bg-violet-950/40`, `text-violet-700`)
     - Turuncu / Amber (`border-amber-500`, `bg-amber-50 dark:bg-amber-950/40`, `text-amber-700`)
2. Canlı Akış Kart Tasarımı:
   - Teslimat kartının sol kenarına 4px kalınlığında şoför rengi vurgusu.
   - Şoför adının yanında şoför renginde dolgulu rozet ve plaka etiketi.
   - Üst çubukta aktif şoförlerin renklerini ve toplam teslimat adetlerini gösteren görsel renk lejantı / hızlı filtre.

### D. Supabase Veritabanı Şeması (`supabase_schema.sql`)
1. `users` tablosundaki `assigned_plate` zorunluluğu kaldırılacak veya opsiyonel yapılacak.
2. Açıklamalı SQL komutları eklenecek:
   - Yeni şoför ekleme: `INSERT INTO users (id, name, username, pin, role, can_load_vehicle) VALUES (...)`
   - Şoför şifresi/PIN değiştirme: `UPDATE users SET pin = '9999' WHERE username = 'ahmet';`
   - Şoför yükleme yetkisi verme: `UPDATE users SET can_load_vehicle = true WHERE username = 'mehmet';`

---

## 2. Doğrulama ve Test Adımları

1. **Giriş Ekranı Testi**:
   - Giriş ekranında hiçbir demo butonunun kalmadığı, sadece kullanıcı adı ve şifre girilerek oturum açılabildiği doğrulanacak.
   - Hatalı kullanıcı adı / şifre girildiğinde doğru hata mesajının görüntülendiği kontrol edilecek.
2. **Plaka Seçim Testi**:
   - Yönetici veya yetkili şoför sabah yüklemesi girerken sadece `01 FV 823`, `06 GB 357` ve `01 AVH 886` plakalarının seçilebildiği doğrulanacak.
   - Farklı günlerde aynı şoförün farklı plakalarla sefere başlayabildiği test edilecek.
3. **Ekip Akışı Renk Testi**:
   - Farklı şoförler tarafından yapılan teslimatların ekip akışında farklı ve ayırt edici renklerde (Örn. Kırmızı, Mavi, Yeşil) listelendiği doğrulanacak.
   - Üst kısımdaki renk lejantının doğru şoförleri gösterdiği teyit edilecek.
4. **Derleme & Hata Denetimi**:
   - Projenin `compile_applet` ile sıfır hatayla derlendiği doğrulanacak.
