# HANDOFF — damacanaDagitim

> Son güncelleme: 2026-11-02 (uçtan uca test turu)
> Dal: `feat/agents-compliance` (main'e göre 21 commit ileride)
> Oturum adı: **damacanaDagitim — AGENTS uyum çalışması (sebil + tahsilat)**

---

## 1. Projenin temel modeli (AGENTS.md 1.1 ve 1.2)

Depo stoğu **yoktur**. Model araç merkezlidir:

```
Araç stoku = yüklenen ürünler − teslim edilen ürünler ± iade ve yetkili düzeltmeler
```

Dört temel unsur:

1. **Araca yüklenen ürünler** (sabah yüklemesi)
2. **Geri gelmesi gereken iade edilebilir kalemler**: boş damacana, cam damacana, tüp, su sebili
3. **Gün sonunda araçta kalan ürünler**: sayım, mutabakat, depoya iade
4. **Tahsilatlar**: teslimat sırasında + sonraki ziyaretlerde

İade edilebilir kalemler yalnızca **adet** olarak, müşteri ve tür bazında izlenir. Parasal depozito yoktur. Müşterinin parasal borcu ile kalem adetleri asla birleştirilmez.

### Su sebili (AGENTS.md 7.1)

- Müşteriye **ücretsiz emanet** verilir, fiyatı **0**.
- Diğer ürünler gibi araca yüklenir, teslim edilir, geri alınır.
- Teslim sırasında **marka, model ve nereye bırakıldığı** kaydedilebilir.
- Bu detaylar **yalnızca veritabanında** tutulur; raporlarda **sadece adet** görünür.
- Şoför, teslimat ekranındaki **"Emanet Sebil Bilgileri"** düğmesiyle detayları görüntüler.

---

## 2. Bu çalışmada tamamlananlar

| Konu | Durum | Commit |
|---|---|---|
| Bölüm 9.1 — Sonlandırılmamış sefer uyarısı ve kapatma yolu | ✅ | `25fe7ed` |
| PWA: yatay kilit kaldırıldı, güncelleme bildirimi, çıkışta önbellek temizliği | ✅ | `4579897` |
| Rapor tablolarının mobilde kart görünümü | ✅ | `af2e60a` |
| Cari hesap ekstresi (açılış → satış → tahsilat → düzeltme → kapanış) | ✅ | `5ddcbb3` |
| Cari borç + iade edilebilir kalem bakiye raporu | ✅ | `185dbb0` |
| Şoför faaliyet raporu | ✅ | `cab9347` |
| Depo stoğu kaldırıldı, araç merkezli modele dönüş | ✅ | `327825c` |
| Teslimat dışı tahsilat (idempotent, bakiye + denetim izi tek transaction) | ✅ | `46ca675` |
| Araçta kalan ürün ve kasa uyuşmazlık raporu | ✅ | `4ae62f4` |
| Su sebili: fiyatsız iade edilebilir kalem | ✅ | `7a1b56f` |
| Sebil tesliminde marka/model/nereye bırakıldığı | ✅ | `382961e` |
| Sebil detayları sadece kayıtta, raporlarda sadece adet | ✅ | `a8dc325` |
| Birleşik işlem geçmişi raporu (teslimat/sefer/yükleme) | ✅ | `24701f5` |
| Sıfır fiyatlı ürün hatası (sebil 100 TL görünüyordu) | ✅ | `e59a50f` |

### Eklenen doğrulama betikleri

- `scripts/verify-stale-dispatch.ts` — 18 kontrol
- `scripts/verify-statement.ts` — 29 kontrol
- `scripts/verify-sebil.ts` — 13 kontrol

---

## 3. Yapılması gereken (öncelik sırası)

### 3.1. Sebil migration'ı — TAMAMLANDI ✅

`migrations/20261103_sebil_returnable.sql` uygulandı. Canlıda doğrulandı:

- `deposit_types.code = sebil` (Su Sebili)
- `product_categories.code = sebil` (Su Sebili)
- `products.id = prod_sebil` — Su Sebili, fiyat **0**, `is_deposit: true`, aktif

İçeriği (tamamen additive):

- `deposit_types` → `sebil`
- `product_categories` → `sebil`
- `products` → `prod_sebil` / "Su Sebili" / fiyat 0 / `is_deposit: true`

### 3.2. İşlem geçmişi raporu — TAMAMLANDI ✅

`GET /api/audit/history` + Raporlar > **İşlem Geçmişi** sekmesi. Teslimat iptal/düzeltme, sefer yeniden açma ve yükleme düzeltmeleri tek kronolojik listede; tür filtresi var.

### 3.3. Uçtan uca test — KISMEN TAMAMLANDI

**Doğrulanan (14/14 PASS):**
- Admin ve şoför girişi (uğur/1993, ergün/2558)
- Su Sebili ürünü: fiyat **0**, 
- Test müşterisi oluşturma
- Teslimat dışı tahsilat: bakiye düşüşü, **idempotency** (aynı payment_id ikinci kez düşmüyor)
- Cari hesap ekstresi: tahsilat hareketi + kapanış bakiyesi
- Bakiye raporu: avans negatif
- Günlük rapor: "Teslimat Dışı Tahsilat" toplamı ve kayıt listesi
- İşlem geçmişi endpoint'i

**Engellenen:** Sebil teslimat/gün sonu zinciri.
Ergün Orak'ın **2026-10-21 tarihli açık seferi** var (, 01 FV 823). Sunucu doğru şekilde yeni sefer açılmasını engelliyor. Karar gerekiyor:
1. Bu sefer test amaçlı kapatılsın mı (gün sonu mutabakatı ile)?
2. Yoksa başka bir şoförle mi test edilsin (PIN gerekli)?

> Bu durum aynı zamanda Bölüm 9.1'in gerçek veriyle doğrulanması: şoför uygulamaya girdiğinde "Önceki seferiniz sonlandırılmadı" uyarısını görmeli ve seferi kapatabilmeli.

**Test verileri (temizlenebilir):**
- `cust_1793596793325_v5fb` — müşteri (ödemesiz)
- `cust_1793596847719_iky9` — müşteri (ödemesiz)
- `cust_1793596877990_1kr3` — müşteri + 125,50 TL tahsilat (tahsilat/denetim kaydı silinemez)

### 3.4. (Eski) Uçtan uca test adımları

> Not: Canlı veritabanındaki kullanıcı/PIN seed verisinden farklı olduğu için otomatik giriş yapılamadı. Test, proje sahibinin giriş bilgisiyle yapılmalı.

1. Admin ile giriş
2. Ürünlerde "Su Sebili" görünüyor mu
3. Yükleme → teslimat (sebil + marka/model/açıklama)
4. Sebil iadesi → müşteri bakiyesi
5. Gün sonu → "Toplanan Su Sebili"
6. Tahsilat → bakiye → ekstre
7. Günlük rapor → "Teslimat Dışı Tahsilat"

> Test kayıtları `customer_payments` ve `customer_financial_audit` tablolarında kalıcıdır (immutable trigger). Veritabanı geliştirme aşamasında olduğu için kabul edilebilir.

---

## 4. Açık uyarılar

- **`src/components/driver/DeliveryModal.tsx` commit edilmemiş.** Diff 401 ekleme / 230 silme; incelendiğinde tırnak/format değişiklikleri (`'` → `"`). `tsc` geçiyor, işlevsel değişiklik görünmüyor. Karar: commit et veya `git checkout -- src/components/driver/DeliveryModal.tsx` ile geri al.
- **`AGENTS.md` git'te takipli değil** (`.gitignore`'da). İçeriği diskte güncel, sürüm geçmişinde yok. İstenirse `.gitignore`'dan çıkarılıp commit edilmeli.
- **`DESIGN.md` silindi**; projede tek bir atıf yok (doğrulandı).
- Depo stoğu tabloları canlıda `20261102_drop_warehouse_stock.sql` ile kaldırıldı. `migrations/20261101_warehouse_stock.sql` yalnızca tarihsel kayıt olarak duruyor.

---

## 5. Doğrulama komutları

```bash
npm run lint                                  # tsc --noEmit
npm run build                                 # vite build

# Tüm iş kuralı doğrulamaları (CI bunları çalıştırır)
npx tsx scripts/verify-stale-dispatch.ts
npx tsx scripts/verify-statement.ts
npx tsx scripts/verify-sebil.ts
# ... scripts/verify-*.ts (toplam 15)

# Sunucu + Supabase bağlantısı
npm run dev
curl http://localhost:3000/api/health
```

Beklenen sağlık yanıtı: `{"status":"ok","database":"supabase_api","connected":true}`

---

## 6. Önemli dosyalar

| Dosya | İçerik |
|---|---|
| `AGENTS.md` | Bağlayıcı gereksinimler (Türkçe, araç merkezli model) |
| `migrations/20261103_sebil_returnable.sql` | Uygulanacak sebil migration'ı |
| `src/services/statementRules.ts` | Cari hesap ekstresi hesaplama kuralları |
| `src/services/depositRules.ts` | İade edilebilir kalem hesapları (damacana, cam, tüp, sebil) |
| `src/services/dispatchRules.ts` | Sefer durumu ve sonlandırılmamış sefer kuralları |
| `src/server/deliveryInput.ts` | Teslimat girdisi normalizasyonu ve stok kontrolü |
| `src/server/db.ts` | Supabase + yerel mod veri katmanı |
| `server.ts` | Express rotaları ve yetkilendirme |
| `src/components/driver/DeliveryModal.tsx` | Teslimat ekranı (sebil detayları burada) |
| `src/components/driver/EndOfDayView.tsx` | Gün sonu mutabakatı |
| `src/components/admin/CustomerStatementModal.tsx` | Cari hesap ekstresi |
| `src/components/admin/BalancesReportView.tsx` | Borç + iade bakiyeleri |
| `src/components/admin/DiscrepancyReport.tsx` | Araçta kalan ürün / kasa uyuşmazlıkları |

---

## 7. Notlar

- Tüm kullanıcı metinleri Türkçe; mobilde yatay kaydırma olmadan çalışacak şekilde tasarlandı (320–430px).
- Supabase URL/anahtar/env adları değiştirilmedi; RLS zayıflatılmadı.
- Yeni npm bağımlılığı eklenmedi.
- Sunucu tarafı yetkilendirme: `requireAdmin`, `requireAdminOrDriver`, `requireAdminOrLoader`.
- `customer_payments` ve `customer_financial_audit` kayıtları değiştirilemez/silinemez (trigger).
