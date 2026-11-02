# MEMORY — damacanaDagitim

> **Ara verildi: 2026-11-02**
> Bu dosya, çalışmaya ara verildiğinde kaldığımız yeri, ürün kararlarını ve
> devam adımlarını saklar. Yeni oturumda önce bunu, sonra `HANDOFF.md` ve
> `git log`u oku.

---

## 1. Git durumu (KRİTİK)

| Konum | Commit | Durum |
|---|---|---|
| `origin/main` | `d507a97` | PR #3 merge edildi. `56d4f30` + `66dca12` + `68f7fa1` dahil. |
| `origin/feat/agents-compliance` | `10acd99` + hafıza commit'leri | Tahsilat implementasyonu + MEMORY/HANDOFF. **Merge edilmedi.** |
| Yerel çalışma ağacı | — | `68f7fa1` içeriğine geri alınmış; implementasyon dosyaları diskte **YOK**. |

- `10acd99` = `feat: sofor tahsilati ve pesin musteri borcu` (implementasyon)
- Sonraki commit'ler yalnızca `MEMORY.md`, `HANDOFF.md` ve trail learning'i ekler.
- Dalın tam ucu için `git log -1 --oneline origin/feat/agents-compliance` kullan.

> **CI notu:** `.github/workflows/ci.yml` yalnızca `main`e push ve `main`e açılan
> PR'larda çalışır. Bu nedenle dal push'unda CI koşmadı; `10acd99`/`48615a0`
> için henüz yeşil sonuç yok. Test için **main'e PR açılması** gerekir.

### Working tree uyarısı

Şu an `git status` şunları gösterir:

- **Silinmiş:** `migrations/20261106_cash_customer_debt.sql`,
  `migrations/20261107_customer_payment_dispatch.sql`,
  `src/components/driver/DriverPaymentModal.tsx`
- **Geri alınmış:** `server.ts`, `src/server/db.ts`, `src/App.tsx`,
  `src/services/api.ts`, `DeliveryModal.tsx`, `DriverView.tsx`,
  `EndOfDayView.tsx`, rapor bileşenleri, CI testleri, `HANDOFF.md`

Bu, `10acd99`'un bilerek geri alınmış olmasından kaynaklanıyor olabilir.
**`git add -A` veya `git commit -a` yapma:** mevcut çalışma ağacı, implementasyonu
silen bir commit oluşturur.

### İmplementasyonu geri yükleme (devam ederken)

Artık `HEAD` (`48615a0`) implementasyonu ve bu hafıza dosyalarını birlikte
içeriyor. `.gitignore` kullanıcı değişikliğini koruyarak çalışma ağacını
`HEAD`e getir:

```bash
git restore --source=HEAD -- . ':(exclude).gitignore'
```

Bu komut, implementasyonu (`server.ts`, migration'lar, `DriverPaymentModal.tsx`
vb.) geri getirir; `MEMORY.md` ve güncel `HANDOFF.md`'yi korur; `.gitignore`
değişikliğine dokunmaz. Sonrasında `git status` ile kontrol et.

> `.gitignore` dışında başka bir kullanıcı değişikliği varsa yukarıdaki komut
> onu da ezer. Önce `git status` ve `git diff` ile kontrol et; gerekirse
> dosya bazında `git restore --source=HEAD -- <yol>` kullan.

### Neden önemli

- `10acd99` çalışma ağacında yok; yalnızca git geçmişinde ve uzak dalda duruyor.
- Yeni bir `git checkout`/`reset` ile kaybolmasın. Önce bu commit'i incele.
- CI bu commit için **hiç çalışmadı**; testlerin geçtiği doğrulanmadı.

---

## 2. Ürün kararları (bu oturumda netleşti)

### 2.1 Tahsilat modeli

- Şoförler **hem peşin hem faturalı** müşteriden tahsilat yapabilir.
- Her tahsilat raporda görünmeli; tahsil eden kullanıcı (şoför) belirtilmeli.
- **Faturalı müşteri:** ürünün birim fiyatı şoför için gereksizdir; fiyat
  girişi/özel fiyat bilgisi şoför ekranında gösterilmemeli. Tutar, tahsilat ve
  rapor için sistemde son/default fiyattan hesaplanmaya devam eder.
- **Peşin müşteri:** kısmi/veresiye kabul edilir; kalan tutar cari borca yazılır.
- Şoför bir sonraki teslimatta veya uğradığında **kalan bütün borcu** görmeli.
- Şoför **ürün vermeden** de tahsilat kaydedebilmeli.
- Peşin müşteride **son satış fiyatı** görünmeli; fiyat geçmişi tutulmasına
  gerek yok. Son fiyat, iptal edilmiş teslimattan gelmiş olsa bile kabul.
- Faturalı/faturalı ayrımı yalnızca **şoförün bakiyeyi görüp görmemesini**
  belirler; borç kaydı her iki türde de oluşur.

### 2.2 Sefer modeli

- Bir şoförün **en fazla 1 tamamlanmamış seferi** olabilir.
- Bu garanti iki katmanda uygulanıyor:
  - Sunucu: aktif sefer kontrolü (`server.ts`)
  - Veritabanı: `ux_dispatches_active_driver` + `ux_dispatches_active_plate`
    partial unique index (`pending_confirmation`, `in_transit`)
- Aynı gün kapatma **zorunlu değil**; bugün yüklenen araçla yarın teslimat
  yapılabilir.
- Sistem seferi **gece yarısı otomatik kapatmaz**, şoför adına otomatik rapor
  oluşturmaz. Kapanana kadar yeni sefer açılamaz; §9.1 uyarısı gösterilir.
- Tek aktif sefer garantisi CI'de PG testiyle sabitlendi (`68f7fa1`).

### 2.3 60 günlük saklama

- **Arşiv yok.** 60 günden eski sefer/teslimat doğrudan silinir.
- Eşikten eski **tüm durumlar** silinir:
  `pending_confirmation`, `in_transit`, `completed`.
- Askıda kalan sefer 60 gün sonra temizlenir.
- **Korunur:** müşteri cari bakiyesi, iade edilebilir kalem adetleri, sebil
  detayları, son satış fiyatı (`customer_product_prices`), tahsilatlar
  (`customer_payments`), denetim kayıtları.
- Temizlik 23:00 **Türkiye saati** (UTC+3).
- Canlıda `RETENTION_DRY_RUN=false`.

---

## 3. `10acd99` commit'inde ne var

Bu commit, yukarıdaki tahsilat modelinin bir implementasyonudur:

- `migrations/20261106_cash_customer_debt.sql`
  - `apply_delivery`: `is_account_customer` kapısı kaldırılmış; kalan tutar
    (`diff_uncollected`) tüm müşterilerde bakiyeye yazılıyor.
  - `applied_balance_delta_tl` tüm müşterilerde kalan tutarı taşıyor.
  - `close_dispatch`: `total_credit_added` tüm müşterileri kapsıyor.
- `migrations/20261107_customer_payment_dispatch.sql`
  - `customer_payments.dispatch_id` kolonu + FK (`ON DELETE SET NULL`).
  - `record_customer_payment` RPC: şoför tahsilatını aktif sefere bağlıyor.
  - Sefer silinse bile tahsilat korunuyor.
- `server.ts`
  - `POST /api/customers/:id/payments` → `requireAdminOrDriver`.
  - Faturalı müşteride şoföre `balance: null`, `balanceHidden: true`.
  - `GET /api/dispatches/:id/payments` (şoför kendi seferi).
  - Günlük raporda teslimat dışı tahsilatlar şoför filtresine göre süzülüyor.
  - Gün sonu kasa/POS mutabakatına sefere bağlı tahsilatlar ekleniyor.
- UI
  - `DriverPaymentModal.tsx` (müşteri arama + tahsilat).
  - `CustomerPaymentModal`: `hideBalance` + `dispatchId` desteği, idempotent
    `paymentId`.
  - `DeliveryModal`: faturalıda **özel fiyat ön dolgusu ve rozeti** gizli.
  - `DriverView`: “Tahsilat Al” butonu.
  - `ConsolidatedDailyReport`: şoför bazında tahsilat dökümü.
- Testler
  - PG: peşin borç, sefere bağlı tahsilat, retention koruması.
  - İlgili CI testleri güncellenmiş.

`10acd99` sürümündeki `HANDOFF.md` bu işi “TAMAMLANDI” olarak anlatır; ancak
aşağıdaki eksikler ve CI durumu nedeniyle **kesin tamamlandı kabul etme.**

---

## 4. İncelenecekler / eksikler

1. **CI çalışmadı.** `10acd99` için GitHub Actions koşusu yok; workflow yalnızca
   `main`e push/PR'da tetikleniyor. `lint`, `verify-*`, `build` ve PG testleri
   doğrulanmadı. Test için `main`e PR açılmalı.
2. **Faturalıda birim fiyat girişi hâlâ görünüyor.** Commit yalnızca özel fiyat
   ön dolgusunu/rozetini gizliyor. Son gereksinime göre faturalı müşteride
   birim fiyat alanı tamamen gizlenmeli; sistem son/default fiyatı kullanmalı.
3. **SQL regresyon riski.** `20261106`/`20261107`, `20261024` sürümündeki
   `apply_delivery` / `cancel_or_replace_delivery` / `close_dispatch`
   değişikliklerinin üzerine mi kurulu? Özellikle negatif boş kap davranışı,
   iptal/düzeltme ve yetki grant'leri diff ile karşılaştırılmalı.
4. **Migration'lar canlı Supabase'e uygulanmadı:**
   - `20261105_retention_no_archive.sql` (main'de var, canlıda yok)
   - `20261106_cash_customer_debt.sql` (dalda)
   - `20261107_customer_payment_dispatch.sql` (dalda)
   - `20261104_payment_rpc_hardening.sql` ve güncel `20261103_sebil_returnable.sql`
     daha önce uygulanmış olmalı; yine de teyit et.
5. **Working tree eski sürümde.** `HANDOFF.md` çalışma ağacı sürümü, bu işi
   içermiyor; güncel durum bu dosyada.

---

## 5. Devam sırası

1. `git fetch origin`; `main` ve dalın güncel olduğunu doğrula.
2. `10acd99`'u çalışma ağacına geri yükle (yukarıdaki komut).
3. `10acd99` diff'ini incele; özellikle:
   - `apply_delivery` / `close_dispatch` / `cancel_or_replace_delivery`
   - faturalı fiyat alanının gizlenmesi
   - rapor filtreleri ve kasa mutabakatı
4. Faturalı fiyat girişini tamamen gizle; gerekirse sunucuda fiyatı
   son/default fiyatla sabitle.
5. `npm run lint`, tüm `npx tsx scripts/verify-*.ts`, `npm run build`.
   PG testleri yalnızca CI'de (yerelde Docker/psql yok).
6. Değişiklikleri commit et, push et, `main`e PR aç.
7. CI yeşil olunca merge et.
8. Migration'ları **onay alarak** Supabase SQL Editor'de uygula:
   `20261105`, `20261106`, `20261107`.
9. Render deploy sonrası:
   - `GET /api/health` → `status: ok`, `connected: true`
   - Temizlik ekranı / retention durumu
   - Peşin kısmi teslimat → borç
   - Ürün vermeden tahsilat → bakiye düşüşü
   - Faturalı teslimatta fiyat gizli + tahsilat çalışıyor
   - Günlük raporda tahsil eden şoför görünüyor
10. `HANDOFF.md` ve bu dosyayı son duruma göre güncelle.

---

## 6. Canlı test kontrol listesi

- [ ] Şoför girişi; aktif sefer yokken yeni sefer açılamıyor.
- [ ] Aynı şoföre ikinci aktif sefer DB'de reddediliyor (`23505`).
- [ ] Bugün yüklenen araçla yarın teslimat yapılabiliyor.
- [ ] Peşin müşteri: kısmi teslimat → kalan borç `current_balance_tl`de.
- [ ] Peşin müşteri: sonraki ziyarette borç görünüyor.
- [ ] Peşin müşteri: ürün vermeden tahsilat → bakiye düşüyor.
- [ ] Peşin müşteri: son satış fiyatı görünüyor.
- [ ] Faturalı müşteri: birim fiyat/özel fiyat görünmüyor.
- [ ] Faturalı müşteri: tahsilat kaydedilebiliyor; şoföre bakiye dönmüyor.
- [ ] Günlük raporda teslimat dışı tahsilat + tahsil eden şoför.
- [ ] Konsolide raporda tahsilat dökümü.
- [ ] Gün sonu kasa/POS, sefere bağlı tahsilatları içeriyor.
- [ ] 60 gün sonra sefer/teslimat siliniyor; bakiye/emanet/son fiyat/tahsilat
      ve denetim kayıtları korunuyor.
- [ ] Mobil 320–430px: yatay kaydırma yok.

---

## 7. Ortam notları

- Canlı: `https://damacanadagitim.onrender.com` (Render free).
- Render: “After CI Checks Pass”; `RETENTION_DRY_RUN=false`.
- Supabase projesi/URL/anahtarları **değiştirilmedi**; RLS zayıflatılmadı.
- Yerelde Docker, psql ve gh yok; PG testleri CI'de çalışır.
- `node.exe`'lerin tamamını öldürme (trail MCP'yi de öldürür); yalnızca
  3000 portunu dinleyen PID'i öldür.
- `AGENTS.md` bağlayıcı; tüm kullanıcı metinleri Türkçe.
- Test kullanıcı bilgileri bu dosyaya yazılmadı.

---

## 8. İlgili dosyalar

| Dosya | İçerik |
|---|---|
| `HANDOFF.md` | Proje genel durumu (çalışma ağacı sürümü eski) |
| `MEMORY.md` | Bu dosya; güncel kaldığımız yer |
| `migrations/20261105_retention_no_archive.sql` | Arşivsiz 60 gün temizliği |
| `migrations/20261106_cash_customer_debt.sql` | Peşin borç (dalda, uygulanmadı) |
| `migrations/20261107_customer_payment_dispatch.sql` | Tahsilatı sefere bağlama (dalda) |
| `server.ts` | Rotalar, yetki, rapor filtreleri |
| `src/server/db.ts` | Supabase/Postgres veri katmanı |
| `src/server/deliveryInput.ts` | Teslimat girdisi normalizasyonu |
| `src/components/driver/DeliveryModal.tsx` | Teslimat + fiyat/tahsilat |
| `src/components/driver/DriverPaymentModal.tsx` | Şoför tahsilatı (dalda) |
| `src/components/admin/CustomerPaymentModal.tsx` | Ortak tahsilat modalı |
| `src/components/admin/DailyReportsView.tsx` | Günlük rapor |
| `src/components/admin/ConsolidatedDailyReport.tsx` | Konsolide rapor |
| `src/components/admin/DriverActivityReport.tsx` | Şoför faaliyeti |
| `scripts/ci/*-pg-test.ts` | PostgreSQL CI testleri |
