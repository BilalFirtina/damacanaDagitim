# Su ve Meşrubat Dağıtım & Ortak Saha Mutabakat Sistemi (SuDağıtım Pro)

Damacana su, pet su, soda, tüp ve karton bardak dağıtımı yapan işletmeler için; **kullanıcı adı ve şifre ile güvenli giriş ekranı & beni hatırla desteği**, yetkili depo araç yüklemesi & şoför teslim alma onayı, ekipler arası anlık saha koordinasyonu, müşteriye göre değişken birim fiyat girişi, esnek tahsilat (sıfır / eksik / fazla tahsilat) & yetkili müşterilerde TL cari bakiye takibi, depozitolu boş damacana/tüp takibi, gün sonu dağıtılan ürünler ve müşterilerin detaylı listesi (ekranda filtreleme, PDF ve Excel dökümü), araçta kalan dolu/boş sayımı ve fiilen toplanan Nakit/POS kasa mutabakatını sağlayan tam yığın sistem.

---

## Kullanıcı İncelemesi & Onaylanan Kararlar

> [!IMPORTANT]
> Kullanıcı geri bildirimleri ve netleştirilen tercihler doğrultusunda kesinleşen mimari kararlar:

- **Kullanıcı Adı & Şifre Giriş Ekranı (Yeni)**:
  - Uygulama ilk açıldığında kullanıcıyı şık ve güvenli bir **Giriş Yap (Login)** sayfası karşılar.
  - Kullanıcılar (Firma Sahibi / Yönetici, Yetkili Şoför, Standart Şoförler) kendilerine ait **Kullanıcı Adı** ve **Şifre / PIN** bilgilerini girerek sisteme giriş yapar.
  - **"Beni Hatırla" (Remember Me)** özelliği ile şoförün oturumu cihaz hafızasında güvenle saklanır; tarayıcı veya uygulama kapatılıp açıldığında oturum korunur.
  - Üst barda aktif kullanıcının adı, rolü ve plakası gösterilir; tek dokunuşla **"Çıkış Yap (Oturumu Kapat)"** seçeneği bulunur.
  - Test süreçlerini hızlandırmak için giriş ekranında tek tıkla hazır hesapları dolduran pratik butonlar (Yönetici, Yetkili Şoför, Standart Şoför) yer alır.
- **Gün Sonu Detaylı Müşteri & Ürün Dağıtım Dökümü (PDF & Excel)**:
  - Gün sonunda dağıtım yapılan tüm müşteriler, ürün adetleri, alınan boşlar ve yapılan tahsilatlar filtrelenir; tek tıkla PDF veya Excel (.csv) olarak dışa aktarılır.
- **Esnek Tahsilat (Sıfır, Eksik, Tam veya Fazla)**:
  - Şoför teslimat anında serbest tahsilat girebilir; yöneticinin yetki verdiği carilerde tahsil edilmeyen tutar müşterinin TL borcuna otomatik yansır.
  - Fiili kasa mutabakatında yalnızca şoförün fiilen tahsil ettiği nakit para ve POS slipleri sayılır.
- **Müşteriye Özel Değişken Birim Fiyat & Son Fiyat Hafızası**:
  - Şoför ürün birim fiyatını teslimat anında değiştirebilir; sistem bu fiyatı hatırlar ve sonraki sefere varsayılan önerir.
- **Depo Yükleme Yetkilendirmesi & Şoför Onayı**:
  - Sabah depodan yüklemeyi sadece Yönetici veya yetkili şoför girer; yetkisiz şoför sayımı kontrol edip onaylayarak sefere başlar.
- **Ekipler Arası Tam Canlı Görünürlük**:
  - Tüm araçlar ve yönetici kimin hangi müşteriye ne teslim ettiğini canlı akışta görür.
- **Depozitolu Boş Damacana & Tüp Takibi**:
  - Alınan boş damacanalar ve boş tüpler takip edilir; eksik teslimler müşteriye boş borcu yazılır, akşam depoya inecek boşlar mutabakatla sayılır.
- **2 Ay (60 Gün) Sonra Otomatik Temizlik**:
  - Dağıtımdan 60 gün geçen sefer ve teslimat kayıtları sistem tarafından otomatik temizlenir.

---

## 1. Genel Bakış ve Giriş Akışı

### A. Giriş (Login) ve Oturum Döngüsü

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          GİRİŞ & OTURUM AÇMA SÜRECİ                         │
│                                                                             │
│  [ Giriş Ekranı ]                                                           │
│  • Kullanıcı Adı (Örn: yonetici, ahmet, mehmet)                             │
│  • Şifre / PIN (Örn: 1234, 1010, 2020)                                      │
│  • [✓] Beni Hatırla (Cihazda oturumu açık tut)                              │
│                                                                             │
│  [ Giriş Yap ] ──► Şifre Doğrulama ( /api/auth/login )                      │
│                          │                                                  │
│                          ├──► Yönetici ──► Tam Yetkili Yönetim & Rapor Paneli│
│                          └──► Şoför    ──► Sabah Yükleme & Saha Dağıtım Paneli│
│                                                                             │
│  [ Çıkış Yap ] ──► Oturum sonlandırılır, tekrar giriş ekranına dönülür       │
└─────────────────────────────────────────────────────────────────────────────┘
```

1. **Giriş Sayfası**:
   - Modern, su ve lojistik temasına uygun, göz yormayan arayüz.
   - Kullanıcı adı ve şifre alanları, şifreyi göster/gizle ikonu.
   - "Beni Hatırla" onay kutusu.
   - Hızlı Giriş Kısayolları (Demo/Test için):
     - `[ 👑 Firma Sahibi (Mustafa Demir) ]`
     - `[ 🚚 Yetkili Şoför (Ahmet - 34 SU 101) ]`
     - `[ 📦 Saha Şoförü (Mehmet - 34 SU 202) ]`
2. **Rol Tabanlı Arayüz Yönlendirmesi**:
   - Şoför giriş yaptığında doğrudan kendi aracının sabah yüklemesi ve saha teslimat ekranına ulaşır.
   - Firma sahibi giriş yaptığında tüm araçların canlı durumu, kasa ciroları ve raporları görür.
3. **Güvenli Çıkış**:
   - Üst bardaki profil menüsünden tek tıkla güvenli çıkış yapılabilir.

---

## 2. Kullanıcı Deneyimi & Arayüz Mimarisi

- **Login Görünümü (`LoginView.tsx`)**:
  - Marka kimliği: SuDağıtım Pro logosu ve sloganı.
  - Hatalı şifre veya kullanıcı adı durumunda kırmızı bilgilendirici uyarı.
  - "Beni Hatırla" seçildiğinde `localStorage` üzerinde oturum jetonu/kullanıcı kimliği saklanır; seçilmediğinde yalnızca tarayıcı oturumu boyunca geçerli kalır (`sessionStorage`).
- **Header Entegrasyonu**:
  - Aktif kullanıcının avatarı, adı, rolü ve plakası.
  - "Çıkış Yap" (Log out) kırmızı çıkış butonu.

---

## 3. Doğrulama & Test Planı

- **Başarılı Giriş Testi**:
  - Kullanıcı adı `ahmet`, şifre `1010` girilir; sistemin Ahmet Yılmaz olarak oturum açtığı doğrulanır.
- **Hatalı Şifre Testi**:
  - Kullanıcı adı `ahmet`, şifre `9999` girilir; "Hatalı kullanıcı adı veya şifre" uyarısının ekrana geldiği teyit edilir.
- **Beni Hatırla Testi**:
  - "Beni Hatırla" işaretlenerek giriş yapılır, sayfa yenilendiğinde tekrar giriş sormadan doğrudan sisteme girdiği doğrulanır.
- **Çıkış Yap Testi**:
  - "Çıkış Yap" butonuna basıldığında oturumun kapandığı ve tekrar giriş ekranına döndüğü teyit edilir.
- **Mevcut Özelliklerin Korunması**:
  - Sabah yükleme onayları, canlı teslimat akışı, müşteri fiyat hafızası, depozitolu boş damacana takibi ve gün sonu PDF/Excel dökümlerinin eksiksiz çalıştığı doğrulanır.
