# MEMORY — damacanaDagitim

> **Son güncelleme: 2026-11-04 (yeniden başlama incelemesi)**
> Bu dosya, kaldığımız yeri, ürün kararlarını ve devam adımlarını saklar.
> Yeni oturumda önce bunu, sonra `HANDOFF.md` ve `git log`u oku.

---

## 1. Git durumu (KRİTİK)

| Konum | Commit | Durum |
|---|---|---|
| `origin/main` | `d507a97` | PR #3 merge edildi. `56d4f30` + `66dca12` + `68f7fa1` dahil. |
| `origin/feat/agents-compliance` | `10acd99` + hafıza commit'leri | Tahsilat implementasyonu + MEMORY/HANDOFF. **Merge edilmedi.** |
| Yerel çalışma ağacı | `HEAD` | **2026-11-04'te geri yüklendi.** İmplementasyon diskte var; yalnızca `.gitignore` farkı ve line-ending stat gürültüsü var. |

- `10acd99` = `feat: sofor tahsilati ve pesin musteri borcu` (implementasyon)
- Sonraki commit'ler yalnızca `MEMORY.md`, `HANDOFF.md` ve trail learning'i ekler.
- Dalın tam ucu için `git log -1 --oneline origin/feat/agents-compliance` kullan.

> **CI notu:** `.github/workflows/ci.yml` yalnızca `main`e push ve `main`e açılan
> PR'larda çalışır. Bu nedenle dal push'unda CI koşmadı; `10acd99`/`48615a0`
> için henüz yeşil sonuç yok. Test için **main'e PR açılması** gerekir.

### Working tree durumu (2026-11-04)

- `git restore --source=HEAD -- . ':(exclude).gitignore'` çalıştırıldı.
- İmplementasyon artık diskte: `server.ts`, `src/server/db.ts`,
  `migrations/20261106...`, `20261107...`, `DriverPaymentModal.tsx` vb.
- `git diff` yalnızca `.gitignore` gösteriyor. Üç dosyada (`scripts/ci/customer-dispensers-pg-test.ts`,
  `CustomerPaymentModal.tsx`, `DriverPaymentModal.tsx`) yalnızca line-ending
  kaynaklı `M` görünebilir; içerik `git diff`te boş.
- `git status` içinde `.claude/`, `.gemini/`, `AGENTS.md`, `opencode.json`,
  `.trail/` gibi untracked dosyalar var. Körlemesine `git add -A` yapma;
  hangilerinin commit edileceğine karar ver.

### Bir daha resetlenirse geri yükleme

`HEAD`, implementasyonu ve hafıza dosyalarını birlikte içeriyor:

```bash
git restore --source=HEAD -- . ':(exclude).gitignore'
```

Bu komut implementasyonu geri getirir; `.gitignore` değişikliğine dokunmaz.
`.gitignore` dışında başka kullanıcı değişikliği varsa önce `git status` ve
`git diff` ile kontrol et; gerekirse dosya bazında restore et.

### Neden önemli

- `10acd99` çalışma ağacında yoktu; yalnızca git geçmişinde ve uzak dalda duruyordu.
- Yeni bir `git checkout`/`reset` ile kaybolmasın. Önce bu commit'i incele.
- CI bu commit için **henüz çalışmadı**; testlerin geçtiği doğrulanmadı.

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

### 3.1. 2026-11-04 faturalı fiyat gizleme — TAMAMLANDI

Commit: `8891e21` — `feat: faturali musteri fiyat ve borclarini arayuzde gizle`

- `DeliveryModal.tsx`: faturalıda birim fiyat, fiyat düzenleme ve satır tutarı
  gizlendi. Faturalıda varsayılan ödeme “Tahsilat Alınmadı”; şoför tahsilat
  aldıysa tutarı manuel girer. “Tam Tahsilat” ve cari borç metni gösterilmez.
- `DriverView.tsx`, `LiveTeamFeed.tsx`, `EndOfDayView.tsx`: faturalı teslimatta
  birim fiyat, mal tutarı ve cari borç gizli; nakit/POS tahsilatları görünür.
- `CustomersManagement.tsx`: faturalıda “Cari TL Borç” ve “Özel Fiyat
  Hafızası” gizli; TL borç filtresi/sayısı faturalıyı kapsamaz.
- `BalancesReportView.tsx`: faturalı cari borçları listeden ve toplamlardan
  çıkarıldı; iade edilebilir kalemler görünür.
- `CustomerStatementModal.tsx`: faturalıda finansal özet/hareket tutarları
  gizlendi; iade edilebilir kalemler görünür.
- `DailyReportsView.tsx` / `ConsolidatedDailyReport.tsx` /
  `DriverActivityReport.tsx`: faturalı birim fiyat, mal tutarı ve cari borç
  satır/toplamlardan çıkarıldı; nakit/POS tahsilatları ve ürün adetleri kalır.
- `src/server/deliveryInput.ts`: faturalı teslimatta istemci fiyatı yerine
  ürünün **default fiyatı** sunucuda uygulanır; `delivery_items.unit_price` ve
  `customer_product_prices` ileride kullanım için kaydedilmeye devam eder.
- `src/services/customerVisibility.ts`: teslimat bazında faturalı tespiti için
  `isAccountCustomerDelivery` eklendi (eski önbellek kayıtlarında müşteri
  listesinden türetir).
- Testler: `verify-delivery-input-equivalence.ts` faturalı default fiyat/borç
  kontrolleri; `verify-customer-visibility.ts` müşteri türü yardımcısı.
- `npm run lint`, 16 `verify-*`, `npm run build` → geçti.
- PG testleri yerelde çalıştırılamadı; CI/PR gerekli.

**İş kuralı kararı:** Faturalı teslimatta borç, gizli/default birim fiyattan
hesaplanmaya devam eder. Fiyat yalnızca arayüzde gizlenir; Supabase’de kalır.
Nakit/POS tahsilatları gerçek kasa hareketi olduğu için görünür kalır.

---

## 4. İncelenecekler / eksikler

1. **CI çalışmadı.** `10acd99`/`8891e21` için GitHub Actions koşusu yok;
   workflow yalnızca `main`e push/PR'da tetikleniyor. Yerelde `lint`,
   16 `verify-*` ve `build` geçti; PG testleri için `main`e PR açılmalı.
2. **SQL regresyon riski.** `20261106`/`20261107`, `20261024` sürümündeki
   `apply_delivery` / `cancel_or_replace_delivery` / `close_dispatch`
   değişikliklerinin üzerine mi kurulu? Özellikle negatif boş kap davranışı,
   iptal/düzeltme ve yetki grant'leri diff ile karşılaştırılmalı.
3. **Migration'lar canlı Supabase'e uygulanmadı:**
   - `20261105_retention_no_archive.sql` (main'de var, canlıda yok)
   - `20261106_cash_customer_debt.sql` (dalda)
   - `20261107_customer_payment_dispatch.sql` (dalda)
   - `20261104_payment_rpc_hardening.sql` ve güncel `20261103_sebil_returnable.sql`
     daha önce uygulanmış olmalı; yine de teyit et.
4. **Working tree 04.11'de geri yüklendi.** Kod diskte ve derleniyor.
   `HANDOFF.md` hâlâ 02.11 sürümünü anlatıyor; güncel durum bu dosyada.

---

## 5. Devam sırası

1. ✅ `git fetch origin`; `main` = `d507a97`, dal = `10acd99` + hafıza.
2. ✅ `10acd99` çalışma ağacına geri yüklendi (04.11).
3. ✅ Diff incelendi: `20261106 apply_delivery` yalnızca hesap kapısını
   kaldırıyor; `20261107 close_dispatch` yalnızca tüm-müşteri kredi + sefere
   bağlı tahsilat ekliyor. `cancel_or_replace_delivery` `applied_balance_delta_tl`
   üzerinden çalıştığı için uyumlu.
4. ✅ Faturalı fiyat/mal tutarı/cari borç arayüzde gizlendi; sunucu default
   fiyatı uyguluyor (`8891e21`). (Bölüm 3.1.)
5. ✅ `npm run lint`, 16 `verify-*`, `npm run build` geçti (04.11).
   PG testleri yalnızca CI'de (yerelde Docker/psql yok).
6. Değişiklikler commit edildi; ⏳ push + `main`e PR aç.
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
