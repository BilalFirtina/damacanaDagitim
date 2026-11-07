Proje Talimatları: Su ve LPG Tüpü Dağıtım, Envanter, Muhasebe ve PWA Uygulaması
1. Proje Amacı

Damacana (iade edilebilir su damacanaları), LPG tüpleri, PET şişe su (Pet Su), karton bardak, plastik bardak ve yapılandırılabilir diğer ürünleri dağıtan bir şirket için güvenli ve güvenilir bir dağıtım takibi, envanter yönetimi ve muhasebe uygulaması geliştirin.

Uygulama; depo envanterini, sabah araç yüklemesini, günlük teslimatları, müşteri hesaplarını, müşteri borçlarını, iade edilebilir kalem takibini, tahsilatları, şoför sorumluluğunu, gün sonu raporlarını ve operasyon geçmişini yönetmelidir.

Uygulama duyarlı (responsive), mobil öncelikli ve Aşamalı Web Uygulaması (PWA) olarak yüklenebilir olmalıdır.

Uygulamanın kullanıcıya dönük tüm arayüzü Türkçe olmalıdır. Tüm menüler, düğmeler, etiketler, formlar, bildirimler, doğrulama mesajları, raporlar, tablolar, panolar, yükleme durumları ve hata mesajları doğru Türkçe terminolojiyi ve karakterleri (ç, ğ, ı, İ, ö, ş, ü) kullanmalıdır. Arayüzde, teknik olarak zorunlu olan kullanıcıya dönük olmayan tanımlayıcılar dışında İngilizce metin bulunmamalıdır.

Veri bütünlüğüne, kullanılabilirliğe, mobil erişilebilirliğe, güvenli rol tabanlı erişim kontrolüne ve desteklenen yerlerde güvenilir çevrimdışı davranışa öncelik verin.

1.1. Temel İş Modeli

Bu proje araç merkezli bir dağıtım modeliyle çalışır. Depo stoğu tutulmaz. Modelin dört temel unsuru:

Araca yüklenen ürünler (sabah yüklemesi).
Geri gelmesi gereken iade edilebilir (depozito) kalemler: boş damacana, cam damacana, tüp ve sebil.
Gün sonunda araçta kalan ürünler; sayım, mutabakat ve depoya iade.
Tahsilatlar: teslimat sırasında alınan ödemeler ve sonraki ziyaretlerde alınan tahsilatlar.

Araç stoku = yüklenen ürünler − teslim edilen ürünler ± iade ve yetkili düzeltmeler.
İade edilebilir kalem miktarları parasal bakiyeden bağımsız, yalnızca adet olarak izlenir.

1.2. Operasyonel İş Akışı

Sistem aşağıdaki sırayı uygular. Depo stoğu tutulmaz; stok yalnızca araç bazında izlenir.

1.2.1. Sabah Araç Yüklemesi
Depo yöneticisi şoförü ve araç plakasını seçer.
Araca yüklenen ürünler ve miktarlar girilir. Su sebili de diğer ürünler gibi yüklemeye girer; fiyatı yoktur.
Yükleme kaydı onaylanır ve araç stoku bu miktarlar kadar artar.
Yükleme; tarih, şoför, plaka, ürünler, miktarlar ve yetkilendiren kullanıcı ile denetlenebilir biçimde saklanır.
Şoför, onaylanmış yükleme olmadan dağıtıma başlayamaz.

1.2.2. Dağıtım
Şoför her müşteri ziyaretini kaydeder: teslim edilen ürünler, tahsilat, müşteriden alınan boş kaplar ve sebil.
Teslim edilen ürünler araç stokundan düşer. Teslim edilmeyen ürünler araçta kalır.
Araç stoku aşılamaz.
Tahsilat tam, kısmi veya ödenmemiş olabilir. Kısmi veya ödenmemiş kalan tutar, müşteri türünden bağımsız olarak (peşin ve faturalı) müşteri cari borcuna işlenir; tahsil edilmiş sayılmaz.

1.2.3. İade Edilebilir Kalemler (boş damacana, cam damacana, tüp, sebil)
Her kalem türü müşteri bazında ayrı adet bakiyesi olarak izlenir.
Müşteriye bırakılan miktar bakiyeyi artırır, müşteriden alınan miktar azaltır.
Fazla iade, müşteriye borcumuz anlamında negatif bakiye oluşturabilir.
Parasal depozito, kira veya bedel hesaplanmaz; yalnızca adet tutulur.
Müşterinin parasal borcu ile iade edilebilir kalem adetleri hiçbir zaman tek bakiyede birleştirilmez.

1.2.4. Su Sebili Özel Akışı
Su sebili müşteriye ücretsiz emanet verilir; satış ürünü değildir ve fiyatı 0'dır.
Araca yüklenir, müşteriye teslim edilir ve müşteriden geri alınır.
Teslim sırasında sebilin markası, modeli ve nereye bırakıldığına dair açıklama metni kaydedilebilir. Bu detaylar yalnızca veritabanında saklanır; raporlara eklenmez. Şoför, müşterinin emanet sebil bilgilerini ihtiyaç duyduğunda görüntüleyebilir.
Müşteride kalan sebil adedi ayrı bir emanet bakiyesi olarak izlenir.
Gün sonu raporunda toplanan sebil adedi ayrı satırda gösterilir; raporda yalnızca verilen ve alınan sebil adedi yer alır.
Sebil için ayrı bir yönetim ekranı zorunlu değildir; sebil yükleme ve teslimat ekranlarında diğer ürünlerle birlikte görünür.

1.2.5. Gün Sonu ve Araçta Kalan Ürünler
Şoför, araçta kalan ürünleri sayar; beklenen (yüklenen − teslim edilen) ile sayılan karşılaştırılır.
Fark varsa açıklama istenir; uyuşmazlık raporlanır.
Toplanan boş damacana, cam damacana, tüp ve sebil adetleri rapora yazılır.
Nakit kasa ve POS slip toplamları teslim edilen tutarlarla mutabık hale getirilir.
Rapor; toplam satış, tahsil edilen ödeme ve bekleyen borcu ayrı gösterir.
Rapor gönderilip sefer kapatılmadan şoför yeni sefer başlatamaz.

1.2.6. Tahsilatlar
Teslimat sırasında alınan ödemeler teslimat kaydına işlenir.
Şoförler hem peşin hem faturalı müşteriden tahsilat yapabilir.
Teslimat dışı (sonraki ziyaret) tahsilatlar ayrı kaydedilir; bakiye ve denetim izi tek işlemde güncellenir.
Şoförün teslimat dışı tahsilatı yalnızca kendi aktif (Dağıtımda) seferi varken kaydedilebilir ve sefere bağlanır; sefer 60 gün sonra silinse bile tahsilat kaydı korunur.
Her tahsilat; tutar, yöntem (nakit/POS), tahsil eden kullanıcı, tarih, varsa not ve sefer referansı ile saklanır.
Aynı tahsilat kimliğiyle tekrar gönderim bakiyeyi ikinci kez düşürmez.
Günlük raporda teslimat tahsilatları ve teslimat dışı tahsilatlar ayrı toplanır; şoför filtresinde yalnızca o şoförün tahsilatları görünür.
Faturalı müşteride birim fiyat/mal tutarı gösterilmediği için tahsilat tutarı manuel girilir; otomatik "tam tahsilat" kullanılmaz.
Faturalı tahsilatları kasa/POS toplamlarında görünür; mal tutarı ve cari borç toplamları gösterilmez.
Tahsilat, satış geliriyle karıştırılmaz; ödenmemiş satış nakit olarak sayılmaz.

1.2.7. Sefer Durumları
Yükleme Bekleniyor.
Dağıtımda.
Dağıtım Tamamlandı.
Durum geçişleri uygulama ve veritabanı tarafından doğrulanır; şoför ve yönetici aynı durumu görür.

1.2.8. Tek Aktif Sefer ve Ertesi Gün Teslimatı
Bir şoförün aynı anda en fazla bir tamamlanmamış seferi olabilir; aynı araç plakası da aynı anda yalnızca bir aktif seferde kullanılabilir.
Bu kural yalnızca arayüzde değil, sunucu kontrolü ve veritabanındaki kısmi tekil indekslerle de garanti edilir.
Seferin aynı gün kapatılması zorunlu değildir; bugün yüklenen araçla ertesi gün teslimat yapılabilir.
Sistem seferi gece yarısı otomatik kapatmaz ve şoför adına otomatik rapor oluşturmaz. Şoför önceki seferi sonlandırmadan yeni sefer açamaz; uyarı ve kapatma yolu Bölüm 9.1'e göre uygulanır.

2. Kullanıcı Rolleri ve Yetkiler

Uygulama, en az iki rolle rol tabanlı erişim kontrolü uygulamalıdır: Depo Yöneticisi ve Şoför.

2.1. Depo Yöneticisi

Depo yöneticisi, depo operasyonlarını yönetmekten ve tüm dağıtım ekibini denetlemekten sorumludur.

Depo yöneticisi şunları yapabilmelidir:

Depo envanterini, ürünleri, şoförleri, müşterileri ve operasyon kayıtlarını yönetmek.
Ürün tanımlarını uygun şekilde oluşturmak, düzenlemek ve devre dışı bırakmak.
Müşteri kayıtlarını yönetmek; peşin müşteri hesap bakiyelerini, avanslarını ve işlem geçmişlerini görüntülemek; faturalı müşteride iade edilebilir kalemleri ve operasyon kayıtlarını görmek (faturalı cari tutarlar arayüzde FATURALI olarak yazılır).
Her dağıtım seferini yapmaya yetkili şoförü seçmek.
Sabah yüklemesi sırasında aracın plakasını seçmek.
Araç yükleme kayıtlarını, gün sonu araçta kalan ürün sayımlarını ve bunların düzeltmelerini kaydetmek ve onaylamak.
Sabah araç yüklemesini denetlemek ve her araca yüklenen miktarları doğrulamak.
Teslimat kayıtlarını, müşteri ödemelerini, peşin müşteri bekleyen borçlarını, iade edilen ürünleri ve iade edilebilir kalem miktarlarını incelemek; faturalı cari tutarların sistem içinde hesaplandığını bilmek.
Tüm şoförlerin faaliyetlerini ve dağıtım seferlerini görüntülemek.
Gün sonu raporlarını incelemek ve onaylamak, uyuşmazlıkları araştırmak.
Dağıtım ekibinin günlük operasyonlarını yönetmek.

Depo yöneticisi teslimat yapmamalı veya şoför olarak çalışmamalıdır. Yöneticinin rolü operasyonları yönetmek, denetlemek ve onaylamaktır.

2.2. Şoför

Şoförler, dağıtım işlemlerini yalnızca depo yöneticisi tarafından yetkilendirildiklerinde veya seçildiklerinde gerçekleştirebilir.

Şoförler şunları yapabilmelidir:

Kendilerine atanan dağıtım seferini, seçilen araç plakasını ve yüklenen ürünleri görüntülemek.
Dağıtım sırasında araçtaki mevcut stoku görüntülemek.
Müşteri ziyaretlerini ve teslim edilen ürünleri kaydetmek.
Teslim edilmeyen ürünleri ve ürün iadelerini kaydetmek.
Hem peşin hem faturalı müşterilerden alınan ödemeleri; tam, kısmi ve teslimat dışı tahsilatlar dahil kaydetmek.
Müşterilerde bırakılan ve müşterilerden alınan iade edilebilir kalemleri kaydetmek.
Peşin müşterinin önceki borcunu, avansını ve son satış fiyatını; faturalı müşteride yalnızca iade edilebilir kalemleri görüntülemek.
Gün sonu mutabakatını tamamlamak ve dağıtım raporunu göndermek.

Şoförler şunları yapamamalıdır:

Diğer şoförleri veya kullanıcı rollerini yönetmek.
Şirket genelindeki ayarları veya yetkilendirme kurallarını değiştirmek.
Yetkisiz depo envanter düzeltmeleri yapmak.
Diğer şoförlere atanan dağıtım seferlerine erişmek veya bunları değiştirmek.
Onaylanmış geçmiş işlemleri yetkili bir düzeltme süreci olmadan değiştirmek.
Önceki seferi başarıyla sonlandırılmadan yeni bir dağıtım seferi başlatmak.

Tüm yetkiler sunucu tarafında ve uygun olduğunda veritabanı yetkilendirme politikaları aracılığıyla uygulanmalıdır. Düğmeleri veya menü öğelerini arayüzde gizlemek yeterli değildir.

3. Ürün Yönetimi ve Ürün Kategorileri

Sistem, yapılandırılabilir ürünleri desteklemeli ve sıradan satılabilir ürünler ile iade edilebilir kalemleri birbirinden ayırmalıdır.

3.1. Satılabilir Ürünler

Örnekler:

Damacana su
Tüp
Pet su
Karton bardak
Plastik bardak
Soda
Gazoz
Gelecekte eklenebilecek diğer ürünler

Her ürünün yapılandırılabilir özellikleri olmalıdır:

Ürün adı
Ürün kategorisi
Ölçü birimi (adet, paket veya koli gibi)
Satış fiyatı
Aktif veya pasif durumu
Envanter takip ayarları
Ürünün iade edilebilir olup olmadığı veya müşteride kalan ekipmanla ilişkili olup olmadığı

Ürün türleri, fiyatlar ve kategoriler kalıcı olarak koda gömülmemelidir. Yetkili kullanıcılar ürün tanımlarını uygulama üzerinden yönetebilmelidir.

Ürün kataloğu/genel satış fiyatı yönetici tarafından yönetilmeye devam eder ve peşin müşteri fiyatlandırmasında kullanılır. Faturalı müşteriye ait birim fiyat, mal tutarı ve geçmiş fiyat arayüzde gösterilmez; sistem faturalı teslimatta ürün default fiyatını kullanır.

3.2. İade Edilebilir Kalemler ve Müşteride Bulunan Ekipman

Sistem, iade edilebilir kalemleri ve müşterilerde kalan ekipmanı ayrı olarak takip etmelidir.

Örnekler:

Boş damacanalar
Şirketin iade ve değişim sürecine uygun olan yerlerde LPG tüpleri
Su sebilleri
Yapılandırılabilir diğer iade edilebilir kaplar veya ekipmanlar

Uygulama, bir müşteriye satılan ürün ile müşteride bırakılan ve iade edilmesi beklenen kalem veya ekipman arasında ayrım yapmalıdır.

Parasal depozito takibi gerekmemektedir. Sistem, parasal depozito ücretlerini, depozito iadelerini veya bekleyen parasal depozito bakiyelerini hesaplamamalı, kaydetmemeli veya raporlamamalıdır.

Yalnızca müşterilerde bırakılan, müşterilerden alınan ve şu anda bekleyen iade edilebilir kalemlerin miktarları takip edilmelidir.

4. Sabah Araç Yüklemesi

Her dağıtım seferi, yetkilendirilmiş bir araç yükleme süreciyle başlamalıdır.

Depo yöneticisi, dağıtımı yapacak şoförü seçer.
Depo yöneticisi, o sefer için araç plakasını girer veya seçer.
Depo yöneticisi, araca yüklenen ürünleri ve miktarları kaydeder.
Depo yöneticisi yükleme işlemini onaylar.
Onaylandıktan sonra araç stoku ilgili miktarlar kadar artar. Depo stoğu ayrıca tutulmaz.
Sistem; tarihi, şoförü, plakayı, ürünleri, miktarları ve yüklemeyi yetkilendiren kullanıcıyı kaydeder.

Araç plakaları dinamik olmalıdır. Koda gömülmemeli veya belirli bir şoföre kalıcı olarak atanmamalıdır. Depo yöneticisi, yükleme sırasında plakayı girebilmeli veya seçebilmelidir.

Sistem, her yükleme işleminin denetlenebilir bir kaydını tutmalıdır. Onaylanmış yükleme kayıtları sessizce üzerine yazılmamalı veya silinmemelidir.

Şoförün, yetkilendirilmiş ve onaylanmış bir yükleme kaydı olmadan dağıtıma başlamasına izin verilmemelidir.

5. Dağıtım Seferi ve Teslimat İş Akışı

Uygulama aşağıdaki operasyonel sırayı zorunlu kılmalıdır:

Depo Hazırlığı → Şoför ve Araç Seçimi → Araç Yükleme → Dağıtım → Gün Sonu Mutabakatı → Rapor Gönderimi → Sefer Sonlandırma → Sonraki Dağıtım Seferi

Her dağıtım seferinin benzersiz bir tanımlayıcısı ve açıkça tanımlanmış bir durumu olmalıdır.

Önerilen Türkçe durumlar:

Yükleme Bekleniyor
Dağıtımda
Dağıtım Tamamlandı

Durum geçişleri yalnızca kullanıcı arayüzü tarafından değil, uygulamanın iş mantığı ve veritabanı işlemleri tarafından doğrulanmalıdır.

Dağıtım sırasında:

Şoför her müşteri ziyaretini ve teslimatı kaydeder.
Teslim edilen miktarlar araç stokundan düşülür.
Teslim edilmeyen ürünler hesapta tutulmaya devam eder.
İade edilen satılabilir ürünler, nedeni ve uygun envanter işlemiyle kaydedilir.
Ödemeler ilgili müşteriye ve uygun olduğunda ilgili satışa veya teslimata karşı kaydedilir.
Müşterilerde bırakılan iade edilebilir kalemler, sıradan ürün satışlarından ayrı olarak kaydedilir.
Müşterilerden alınan boş kaplar ve diğer iade edilebilir kalemler tür ve miktara göre kaydedilir.
Sistem, açıkça yetkilendirilmiş bir düzeltme süreci uygulanmadıkça, teslimatların mevcut araç stokunu aşmasını engeller.

Tüm envanter hareketleri ve müşteri işlemleri ilgili dağıtım seferine kadar izlenebilir olmalıdır.

Sefer, yapıldığı gün sonlandırılmamış olsa bile hiçbir zaman sessizce kapatılmamalı ve şoför adına otomatik rapor oluşturulmamalıdır. Sonlandırılmamış seferlerin nasıl ele alınacağı Bölüm 9.1'de tanımlıdır.

Şoförün ve yöneticinin gördüğü sefer durumu aynı veriden okunmalıdır. Biri “Dağıtımda”, diğeri “Yükleme Bekleniyor” görmemelidir.

6. Müşteri Borç ve Hesap Bakiyesi Takibi

6.1. Müşteri Türleri

İki müşteri türü vardır ve arayüzde açıkça ayrılır:

Peşin müşteri: Ödemeyi şoför teslimat sırasında veya sonraki ziyarette tahsil eder. Şoför bu müşterinin önceki borcunu, avansını ve son satış fiyatını görebilir.
Faturalı müşteri: Şoför ve yönetici arayüzünde birim fiyat, mal tutarı, cari borç ve geçmiş ürün fiyatı GÖSTERİLMEZ. Şoför yalnızca müşteride bulunan iade edilebilir kalemleri (boş damacana, cam damacana, tüp, sebil) görür; tahsilat kaydedebilir. Faturalı cari borç sistem içinde default fiyattan hesaplanır ve Supabase'de saklanır; ileride görünürlük açılabilir.

Müşteri ekleme ve düzenleme ekranında "Peşin Müşteri" onay kutusu bulunur. İşaretliyse müşteri peşin, işaretsizse faturalıdır.
Bu ayrım sunucu tarafında da uygulanır: şoför oturumunda faturalı müşterinin bakiye alanı sıfırlanarak döndürülür; arayüzde gizlemek yeterli sayılmaz.
Faturalı müşteride fiyat/tutar gizliliği yalnızca arayüz içindir; sunucu hesaplaması, borç kaydı ve raporlama altyapısı korunur. Fiyat bilgisi `delivery_items.unit_price` ve `customer_product_prices` tablolarında ileride kullanım için tutulur.


Sistem, her müşteri için doğru bir finansal hesap tutmalıdır.

Müşteriler normalde teslimat sırasında ödeme yapabilir, ancak sistem ödenmemiş satışları, kısmi ödemeleri ve sonraki ziyaretlerde alınan ödemeleri de desteklemelidir.

Her müşteri için sistem şunları kaydetmelidir:

Teslim edilen ürünler ve satış fiyatları.
Toplam satış tutarı.
Alınan ödemeler.
Bekleyen borç bakiyesi.
Kısmi ödemeler ve daha sonra alınan ödemeler.
Yetkilendirilmiş alacaklar, iadeler ve finansal düzeltmeler (uygulanabilir olduğunda).
İşlem tarihleri ve ilgili dağıtım referansları.
Eksiksiz ve izlenebilir bir hesap geçmişi.

Müşterinin bekleyen borcu; kaydedilmiş satışlardan, ödemelerden ve yetkilendirilmiş finansal düzeltmelerden hesaplanmalıdır.

Örnek:

Bir müşteri 1.000 TL değerinde ürün alır ve 700 TL öder.

Toplam satış: 1.000 TL
Alınan ödeme: 700 TL
Bekleyen müşteri borcu: 300 TL

Müşteri daha sonra kalan 300 TL’yi ödediğinde, bekleyen borç otomatik olarak sıfıra düşmelidir.

Tam ödeme gerçekten kaydedilmedikçe bir satış tamamen ödenmiş olarak işaretlenmemelidir.

Sistem tam ödemeleri, kısmi ödemeleri ve sonraki müşteri ziyaretlerinde alınan ödemeleri desteklemelidir. Her ödeme doğru müşteriye ve uygun olduğunda ilgili satışa veya bekleyen hesap bakiyesine bağlanmalıdır.

Depo yöneticisi, peşin müşterilerin güncel borç bakiyesini, ödeme geçmişini, ödenmemiş satışlarını ve hesap ekstresini görüntüleyebilmelidir. Faturalı müşteride cari tutarlar sistem içinde hesaplanır; şu an arayüzde gösterilmez, iade edilebilir kalemler görünür.

Sistem; satış gelirini, alınan ödemeleri ve bekleyen müşteri borcunu açıkça ayırt etmelidir. Bu değerler birbirinin yerine kullanılmamalıdır.

6.2. Fiyat ve Tutar Görünürlüğü

Peşin müşteride ürün birim fiyatı ve son satış fiyatı şoföre görünür; şoför fiyatı düzenleyebilir. Son fiyat iptal edilmiş bir teslimattan gelmiş olsa bile kullanılabilir; ayrı fiyat geçmişi tutulmaz.
Faturalı müşteride ürün birim fiyatı, mal tutarı, cari borç ve geçmiş ürün fiyatı şoför ve yönetici arayüzünde gösterilmez.
Faturalı teslimatta sistem ürünün default fiyatını kullanarak mal tutarını ve kalan borcu hesaplar; istemciden gelen fiyat kullanılmaz.
Faturalıda tahsilat tutarı manuel girilir; nakit/POS tahsilatları rapor ve kasa toplamlarında görünür.
Ürün kataloğu/genel ürün fiyatları yönetici tarafından yönetilmeye devam eder; bu, faturalı müşteriye ait fiyat görünürlüğünden ayrıdır.
Fiyat bilgisi ileride faturalı müşteri takibi açılabilmesi için Supabase'de saklanır; arayüzde FATURALI olarak yazılır.

7. Müşteride Bulunan İade Edilebilir Kalem ve Ekipman Takibi

Sistem, her müşteride bulunan iade edilebilir kalemler ve ekipman için ayrı bir miktar bakiyesi tutmalıdır.

Örnekler: boş damacanalar, uygun olan yerlerde LPG tüpleri, su sebilleri ve yapılandırılabilir diğer iade edilebilir kalemler.

### 7.1. Su Sebili (özel kural)

Su sebili müşterilere ücretsiz emanet verilir ve fiyatı yoktur (birim fiyat 0).

Su sebili, diğer ürünler gibi araca yüklenir; müşteriye teslim edilir ve müşteriden geri alınır. Bu nedenle:

Araç yükleme ekranında diğer ürünlerle birlikte görünür; ayrı bir sebil yönetim ekranı gerekmez.
Teslim edilen ve geri alınan sebil adetleri teslimat kaydına işlenir.
Müşteride kalan sebil adedi, boş damacana gibi ayrı bir emanet bakiyesi olarak izlenir.
Gün sonu raporunda toplanan sebil adedi ayrı satırda yer alır.
Su sebili için parasal depozito, kira veya bedel hesaplanmaz; yalnızca adet takip edilir.
Sebil bakiyesi müşterinin parasal borcundan bağımsızdır ve onunla birleştirilmez.

Her müşteri ve her iade edilebilir kalem türü için sistem şunları takip etmelidir:

Müşteride bırakılan kalem miktarı.
Müşterinin iade ettiği veya müşteriden alınan miktar.
Müşteride kalan güncel miktar.
Yetkilendirilmiş miktar düzeltmeleri ve nedenleri.
Teslim edilen, müşteride bırakılan, müşteriden alınan veya başka şekilde düzeltilen kalemlerin eksiksiz geçmişi.

Sistem güncel miktarı otomatik olarak hesaplamalıdır:

Müşterideki Güncel Miktar = Müşteride Bırakılan Toplam Miktar − Müşteriden İade Edilen veya Alınan Toplam Miktar ± Yetkilendirilmiş Düzeltmeler

Örnek:

Bir müşteride 10 boş damacana bırakılır.
Aynı müşteride 2 su sebili de bırakılır.
Müşteri daha sonra 4 boş damacana ve 1 su sebili iade eder.

Sistem şunu göstermelidir:

Müşteride kalan boş damacana: 6
Müşteride kalan su sebili: 1

Bakiyeler her kalem türü için ayrı tutulmalıdır. Farklı iade edilebilir kalemler asla tek bir miktarda birleştirilmemelidir.

İade edilebilir kalem miktarları, müşterinin finansal bakiyesinden bağımsız olarak takip edilmelidir.

Örneğin bir müşteri 500 TL borçlu olup 3 boş damacana ve 1 su sebili de bekleyen durumda olabilir. Uygulama parasal borcu ve kalem miktarlarını ayrı ayrı göstermelidir.

Depo yöneticisi, her müşterinin bekleyen iade edilebilir kalem miktarlarını istediği zaman inceleyebilmelidir.

Şoförler, atanan dağıtım seferleri sırasında müşterilerde bırakılan ve müşterilerden alınan kalemleri kaydedebilmelidir.

Sistem, iade edilebilir kalemler teslim edildiğinde veya alındığında parasal depozito işlemi oluşturmamalıdır.

8. Araç Stoku ve İade Edilebilir Kalem Bütünlüğü

Uygulama; araçlar, müşteriler ve dağıtım işlemleri arasında tutarlı kayıtlar tutmalıdır. Depo stoğu bu modelin parçası değildir.

Sistem şunları yapmalıdır:

Araç stokunu dağıtım seferi ve ürün bazında takip etmek.
Teslim edilen ürünleri araç stokundan düşmek.
Gün sonunda araçta kalan ürünleri sayımla doğrulamak ve depoya iade edilen miktarları kaydetmek.
İade edilen veya teslim edilmeyen ürünleri doğru araç stok işlemiyle kaydetmek.
İade edilebilir kalemleri (boş damacana, cam damacana, tüp, sebil) sıradan satılabilir ürünlerden ayrı, müşteri ve kalem türü bazında adet olarak takip etmek.
Özel olarak yetkilendirilmiş bir iş kuralı izin vermedikçe araç stokunun negatife düşmesini engellemek.
Her araç stok hareketini (yükleme, teslimat, iade, düzeltme) tarihi, miktarı, kaynağı, hedefi, nedeni ve sorumlu kullanıcısıyla kaydetmek.
Araç stok hareketlerinin geçmiş kaydını tutmak.
Yükleme, teslimat, iade veya düzeltme işlemlerinin mükerrer işlenmesini engellemek.
Eşzamanlı işlemlerden kaynaklananlar dahil tutarsız güncellemeleri önlemek için veritabanı işlemlerini (transaction) ve uygun kısıtlamaları kullanmak.

Onaylanmış işlemler sessizce üzerine yazılmamalı veya silinmemelidir. Düzeltmeler, yetkili ve denetlenebilir bir süreçle yapılmalıdır.

9. Zorunlu Gün Sonu Raporu

Her dağıtım seferinin sonunda şoför, gün sonu mutabakatını tamamlamalı ve bir rapor göndermelidir.

Rapor en azından şunları içermelidir:

Dağıtım tarihi ve sefer tanımlayıcısı.
Şoför ve araç plakası.
Açılış araç stoku ve yüklenen miktarlar.
Ürün bazında teslim edilen miktarlar.
Teslim edilmeyen ve iade edilen ürün miktarları.
Toplam satış tutarı.
Müşterilerden tahsil edilen ödemeler.
Teslimatlar sonucunda oluşan veya kalan bekleyen borçlar.
Sefer sırasında kaydedilen müşteri hesap işlemleri.
Müşterilerde bırakılan iade edilebilir kalemler.
Müşterilerden alınan iade edilebilir kalemler.
Kapanış araç stoku.
Tahsil edilen nakit ve desteklenen diğer ödeme yöntemleri.
Stok, nakit veya işlem uyuşmazlıkları.
Açıklama gerektiren uyuşmazlıkların açıklamaları.

Faturalı müşteri birim fiyat, mal tutarı ve cari borç toplamları raporda gösterilmez; bu tutarlar toplam satış ve cari toplamlarına dahil edilmez. Faturalı nakit/POS tahsilatları kasa ve tahsilat toplamlarında görünür.

Sistem, raporu göndermeden önce doğrulamalıdır.

Stok miktarları, ödeme toplamları veya diğer gerekli rakamlar uyuşmuyorsa, uygulama uyuşmazlığı tespit etmeli ve şirketin yapılandırılmış kurallarına göre bir açıklama veya yetkili çözüm talep etmelidir.

Rapor; toplam satışlar, tahsil edilen ödemeler ve bekleyen müşteri borcu arasında doğru ayrım yapmalıdır. Ödenmemiş satışlar tahsil edilmiş nakit olarak sayılmamalıdır.

Rapor ayrıca aracın açılış stokunu, yüklemeyi, teslimatları, iadeleri ve kapanış stokunu mutabık hale getirmelidir.

Rapor gönderildikten ve dağıtım seferi başarıyla sonlandırıldıktan sonra sefer kapatılmış olarak işaretlenmelidir.

Şoförün, önceki sefer mutabık hale getirilmeden, gün sonu raporu başarıyla gönderilmeden ve sefer sonlandırılmadan başka bir dağıtım seferi başlatmasına izin verilmemelidir.

Sistem, aynı şoför için mükerrer aktif seferleri engellemelidir.

Gönderilen raporlar ve sonlandırılan seferler geçmiş incelemesi için erişilebilir kalmalıdır. Düzeltmeler, geçmiş kayıtları sessizce değiştirmek yerine yetkili ve denetlenebilir bir süreci izlemelidir.

9.1. Sonlandırılmamış Sefer Uyarısı

Dağıtımın yapıldığı gün gün sonu raporu alınmamış ve sefer sonlandırılmamışsa:

Sistem seferi otomatik olarak kapatmamalı ve şoför adına otomatik rapor oluşturmamalıdır. Sayım, mutabakat ve rapor şoförün sorumluluğunda kalır.
Şoför ertesi gün (veya sonraki herhangi bir gün) uygulamaya girdiğinde, açık kalan önceki seferi sonlandırması gerektiğini bildiren belirgin bir Türkçe uyarı görmelidir. Örnek: “Önceki seferiniz sonlandırılmadı. Yeni sefere başlamadan önce gün sonunu tamamlayın.”
Uyarı, önceki sefer sonlandırılana kadar şoför her uygulamaya girdiğinde gösterilmelidir.
Şoför, açık kalan önceki seferin gün sonu ekranına uyarıdan doğrudan ulaşabilmeli ve seferi oradan sonlandırabilmelidir. Şoförün ekranı yalnızca bugünün tarihli seferini seçmemeli; tarihi geçmiş olsa bile açık seferi göstermelidir.
Önceki sefer sonlandırılana kadar şoför yeni bir dağıtım seferine başlayamaz (Bölüm 2.2 ve Bölüm 9 kuralları aynen geçerlidir). Bu kural sunucu tarafında da uygulanmalıdır.
Depo yöneticisi, günü içinde sonlandırılmamış seferleri “Önceki gün sonlandırılmadı” şeklinde görünür bir etiketle görmelidir. Yönetici ve şoför aynı sefer durumunu görmelidir.

9.2. 60 Günlük Saklama ve Temizlik

Dağıtım tarihinden 60 gün sonra günlük dağıtım faaliyetlerinden doğan tüm hareketler arşivlenmeden doğrudan silinir.
Temizlik, durumdan bağımsız olarak eşikten eski tüm seferleri kapsar: Yükleme Bekleniyor, Dağıtımda ve Dağıtım Tamamlandı.
Silinenler: seferler, teslimatlar, teslimat kalemleri, boş kap hareketleri, tahsilatlar, cari/boş kap denetim kayıtları, iptal/yeniden açma/yükleme denetimleri ve müşteri işlem denetimleri.
Korunanlar: müşteri kaydı (ad, telefon, adres, e-posta, not, tür), nihai cari borç (`current_balance_tl`), nihai iade edilebilir kalem adetleri (`customer_empty_balances`), son satış fiyatı (`customer_product_prices`) ve sebil marka/model/adet/açıklama detayları (`customer_dispensers`).
Temizlik her gün 23:00 Türkiye saatinde (UTC+3) otomatik çalışır; üretimde gerçek silme modu kullanılır.
Yöneticiye manuel temizlik ekranı sunulmaz; temizlik yalnızca zamanlanmış sunucu işiyle yürütülür.
Temizlik seferi otomatik kapatmaz ve şoför adına rapor oluşturmaz; yalnızca süresi geçmiş hareketleri temizler.
Tahsilat kaydı da 60 gün sonra silinir; müşterinin nihai borç bakiyesi korunur.

10. Müşteri Hesap Ekstreleri ve Operasyonel Raporlar

Depo yöneticisi, günlük operasyonları ve müşteri hesap yönetimini destekleyen raporlara erişebilmelidir.

10.1. Müşteri Hesap Ekstresi

Seçilen bir müşteri ve tarih aralığı için sistem şunları göstermelidir:

Açılış müşteri borç bakiyesi.
Teslim edilen ürünler ve fiyatları.
Toplam satışlar.
Alınan ödemeler.
Kısmi ve sonraki ödemeler.
Yetkilendirilmiş alacaklar, iadeler ve düzeltmeler.
Kapanış bekleyen borç bakiyesi.
Kalem türüne göre güncel iade edilebilir kalem miktarları.
Müşteride bırakılan ve müşteriden alınan geçmiş miktarlar.

Müşterinin finansal bakiyesi ve iade edilebilir kalem miktarları her zaman ayrı gösterilmelidir.

Faturalı müşteride yukarıdaki finansal tutarlar, birim fiyatlar ve cari borç gösterilmez; yalnızca iade edilebilir kalem miktarları ve geçmişi gösterilir. Faturalı cari tutarlar sistem içinde hesaplanmaya devam eder.

10.2. Depo ve Dağıtım Raporları

Sistem ayrıca şunları sağlamalıdır:

Güncel araç stoku ve yükleme geçmişi.
Günlük satış ve tahsilat raporları.
Bekleyen müşteri borç raporları.
Müşteri bazında iade edilebilir kalem bakiyeleri.
Şoför faaliyet ve dağıtım seferi raporları.
Gün sonu mutabakat raporları.
Stok uyuşmazlığı ve işlem geçmişi raporları.

Faturalı müşteri birim fiyat, mal tutarı ve cari borç toplamları raporlanmaz; bu tutarlar günlük/konsolide rapor toplamlarına ve şoför faaliyet raporu cirosuna dahil edilmez. Bakiye raporunda faturalı cari borç satırları ve toplamları gösterilmez; iade edilebilir kalem miktarları görünür. Faturalı nakit/POS tahsilatları ve tahsil eden kullanıcı raporlanır.

Raporlar Türkçe etiketler, Türk lirası (TRY) için doğru para biçimlendirmesi ve Türk kullanıcılara uygun tarih ve sayı biçimlerini kullanmalıdır.

11. Duyarlı Tasarım ve Mobil Kullanılabilirlik

Uygulama; cep telefonlarında, tabletlerde, dizüstü bilgisayarlarda ve masaüstü bilgisayarlarda doğru çalışan, tamamen duyarlı ve mobil öncelikli bir kullanıcı arayüzü sunmalıdır.

Mobil ekranlarda uygulamanın tamamı yalnızca dikey kaydırılmalıdır. Sayfalarda gezinmek veya sıradan uygulama içeriğini görüntülemek için yatay kaydırma gerekmemelidir.

Aşağıdaki gereksinimleri uygulayın:

Mobil cihazlarda yatay sayfa taşmasını önleyin.
Sayfa düzenlerinin, formların, kartların, gezinme menülerinin, düğmelerin, iletişim kutularının ve panoların mevcut görünüm alanı genişliğine sığmasını sağlayın.
Küçük ekranlara uyum sağlayan, masaüstü boyutlu içeriği mobil cihazlara zorlamayan duyarlı düzenler kullanın.
Yatay alan sınırlı olduğunda form alanlarını ve içerik bölümlerini dikey olarak yığın.
Tüm düğmelerin, girdi alanlarının, açılır listelerin ve diğer etkileşimli kontrollerin dokunmatik ekranlarda kullanılabilir kalmasını sağlayın.
Okunabilir yazı boyutları ve etkileşimli öğeler arasında yeterli boşluk kullanın.
Tabloları duyarlı hale getirin. Küçük ekranlarda geniş tabloları yığılmış kayıtlara veya kartlara dönüştürün ya da tüm temel bilgileri yatay sayfa kaydırması gerektirmeden erişilebilir tutan başka bir mobil dostu düzen kullanın.
Uzun ürün adlarının, müşteri adlarının, adreslerin ve işlem açıklamalarının sayfayı görünüm alanının ötesine genişletmesini önleyin.
İletişim kutularının, onay pencerelerinin, açılır menülerin ve formların görünür ekran alanı içinde kalmasını ve mobil cihazlarda kullanılabilmesini sağlayın.
Gezinmeyi küçük ekranlarda kullanılabilir tutun; gerektiğinde uygun bir kompakt menü veya çekmece (drawer) kullanın.
Sanal klavyenin önemli form işlemlerine erişimi engellememesini sağlayın.
Yatay taşmaya neden olan sabit genişlikli düzenlerden ve bileşenlerden kaçının.
Dikey ve yatay ekran yönlerini destekleyin.
Uygulamayı yaklaşık 320px, 360px, 375px, 390px ve 430px dahil yaygın mobil görünüm alanı genişliklerinde test edin.

Yatay taşmayı yalnızca kullanıcıların ihtiyaç duyduğu içeriği gizleyerek çözmeyin. Tüm temel bilgilerin ve işlemlerin erişilebilir kalması için düzeni uyarlayın.

Birincil mobil etkileşim biçimi dikey kaydırma olmalıdır. Tek tek kontroller gereksiz yatay kaydırma getirmemeli ve kullanıcıların uygulamayı kullanmak için yana kaydırması gerekmemelidir.

12. Aşamalı Web Uygulaması (PWA) Gereksinimleri

Uygulama, desteklenen mobil cihazlara ve masaüstü tarayıcılara kurulabilmesi için bir Aşamalı Web Uygulaması (PWA) olarak geliştirilmelidir.

Aşağıdaki PWA yeteneklerini uygulayın:

12.1. Kurulabilirlik
Geçerli bir web uygulaması manifestosu sağlayın.
Uygulama adını ve kısa adını Türkçe yapılandırın.
Gerekli boyutlarda uygun uygulama simgeleri ekleyin.
Tema rengini ve arka plan rengini yapılandırın.
Desteklenen yerlerde görüntüleme modunu standalone olarak ayarlayın.
Başlangıç URL’sini ve uygulama kapsamını doğru yapılandırın.
Uygulamanın desteklenen tarayıcılar ve işletim sistemleri üzerinden kurulabilmesini sağlayın.
Ana ekrandan başlatıldığında tutarlı, uygulama benzeri bir deneyim sunun.
12.2. Servis Çalışanı (Service Worker) ve Önbellekleme
Projenin çatısıyla ve derleme araçlarıyla uyumlu, güvenilir ve bakımı yapılan bir PWA yaklaşımı kullanarak bir servis çalışanı uygulayın.
Arayüzün geçici ağ kesintilerinde yüklenebilmesi için temel uygulama kabuğunu ve statik varlıkları önbelleğe alın.
Statik varlıklar ve uygulama verileri için uygun önbellekleme stratejileri kullanın.
Yanlış kullanıcıya eski veya yetkisiz müşteri finansal bilgisi sunmaktan kaçının.
Uygulama güncellemelerini güvenli şekilde yönetin ve bir güncelleme sayfanın yenilenmesini veya uygulamanın yeniden başlatılmasını gerektirdiğinde kullanıcıları Türkçe bilgilendirin.
Servis çalışanı kaydının ve üretim dağıtımının doğru çalışmasını sağlayın.
12.3. Çevrimdışı ve Kararsız Ağ Davranışı

Uygulama geçici bağlantı kayıplarını sorunsuz bir şekilde yönetmelidir.

Mevcut bağlantı ve senkronizasyon durumunu Türkçe olarak açıkça belirtin.
Teknik ve güvenlik açısından uygun olan yerlerde, önbelleğe alınmış uygulama ekranlarının ve daha önce alınmış yetkili verilerin çevrimdışıyken erişilebilir kalmasına izin verin.
Çevrimdışı işlem girişi uygulanıyorsa, bekleyen işlemleri uygun bir kalıcı depolama mekanizmasıyla yerel olarak saklayın.
Senkronize edilmemiş işlemleri açıkça işaretleyin ve her işlemin beklemede, senkronize edilmiş veya başarısız olduğunu gösterin.
Bağlantı geri geldiğinde bekleyen işlemleri sunucuyla senkronize edin.
Bir işlem yeniden denendiğinde mükerrer işlenmesini önleyin.
Çakışan güncellemeleri tespit edin ve güvenli bir çözüm süreci sağlayın.
Sunucu işlemin kalıcı olarak kaydedildiğini onaylamadan bir işlemi başarıyla senkronize edilmiş olarak bildirmeyin.
Yerel olarak saklanan işlemleri sessizce silmeyin.
Bir kullanıcı oturumu kapattığında veya yetkisini kaybettiğinde, yerel olarak önbelleğe alınmış müşteri verilerini ve kullanıcıya özel verileri uygun şekilde temizleyin.

Uygulama, çevrimdışı değişikliklerin merkezi veritabanına zaten yansıdığı izlenimini vermemelidir.

Envanter, müşteri borçları, ödemeler ve dağıtım seferleri muhasebeyi etkilediğinden, sistem çevrimdışı işlemler için güvenli kurallar tanımlamalıdır. Güncel stok veya sunucu tarafı yetkilendirme gerektiren işlemler, senkronize edildiklerinde doğrulanmalıdır. Çakışmalar, mevcut kayıtların sessizce üzerine yazılmak yerine çözüm için işaretlenmelidir.

Çevrimdışı destek, projenin mimarisinin gerçek yeteneklerine göre uygulanmalıdır. Gerekli yerel depolama, senkronizasyon, çakışma yönetimi ve yetkilendirme güvenceleri uygulanmadan ve test edilmeden tam çevrimdışı işlevsellik iddiasında bulunmayın.

12.4. PWA Güvenliği ve Uyumluluğu
Ayrıcalıklı veritabanı anahtarlarını veya gizli bilgileri istemcide açığa çıkarmayın.
Üretimde HTTPS kullanın.
Uygulama kurulu bir PWA olarak başlatıldığında da kimlik doğrulamanın ve rol tabanlı yetkilendirmenin uygulanmaya devam etmesini sağlayın.
Süresi dolmuş oturumları, oturum kapatmayı ve iptal edilmiş erişimi güvenli şekilde yönetin.
PWA’yı desteklenen Android tarayıcılarda ve masaüstü tarayıcılarda, ayrıca desteklenen yerlerde iOS’ta test edin.
Kurulumun, gezinmenin, önbelleklemenin, senkronizasyonun ve uygulama güncellemelerinin üretim ortamında çalıştığından emin olun.
13. Güvenlik, Denetim İzi ve Veri Bütünlüğü

Uygulama, tüm önemli yetkileri ve iş kurallarını sunucu tarafında ve uygun olduğunda veritabanında uygulamalıdır.

Sistem şunları yapmalıdır:

Kullanıcıların kimliğini doğrulamak ve rol tabanlı yetkilendirmeyi uygulamak.
Şoförlerin yalnızca atanan dağıtım seferleri için izin verilen kayıtlara ve işlemlere erişebilmesini sağlamak.
Depo genelindeki yönetim ve yetkilendirme işlevlerini depo yöneticisiyle sınırlamak.
Yükleme ve teslimat işlemlerini onaylamadan önce stok durumunu doğrulamak.
Müşteri ödeme tutarlarını doğrulamak ve hesap bakiyelerini tutarlı şekilde güncellemek.
Her müşteri için doğru iade edilebilir kalem miktarlarını tutmak.
Önemli işlemleri kimin ne zaman gerçekleştirdiğini kaydetmek.
Geçmiş işlemleri ve gönderilen raporları korumak.
Uygun veritabanı işlemleri, kısıtlamaları ve yetkilendirme politikaları kullanmak.
Mükerrer veya çakışan işlemleri önlemek.
Başarı mesajlarını göstermeden önce veritabanı işlemlerinin başarılı olduğunu doğrulamak.
Hassas kimlik bilgilerini veya ayrıcalıklı veritabanı anahtarlarını istemci tarafı kodunda açığa çıkarmaktan kaçınmak.
Yerel olarak önbelleğe alınmış ve çevrimdışı verileri kullanıcının yetki düzeyine göre korumak.
Faturalı teslimatta birim fiyatı istemciden almak yerine ürün default fiyatını sunucuda uygulamak.
Şoförün teslimat dışı tahsilatını yalnızca kendi aktif seferi için kabul etmek ve tahsilatı sefere bağlamak.
Tahsilatı idempotent kimlikle kaydetmek; aynı kimliğin bakiyeyi ikinci kez düşürmesini engellemek.
Tahsilat, bakiye değişikliği ve denetim kaydını tek veritabanı işleminde yazmak.

Bir işlemi arayüzde gizlemek onu güvence altına almak için yeterli değildir. Yetkisiz istekler sunucu veya veritabanı tarafından da reddedilmelidir.

14. Genel Geliştirme Gereksinimleri
Kullanıcıya dönük uygulamanın tamamını Türkçe tutun.
Tüm ekranlarda ve raporlarda net ve tutarlı Türkçe terminoloji kullanın.
Kullanıcı arayüzünü, iş mantığını ve veritabanı işlemlerini ayırın.
Ürünleri, ürün kategorilerini, şoförleri, müşterileri, araç plakalarını ve ilgili operasyonel ayarları yapılandırılabilir hale getirin.
Yetkili kullanıcılar tarafından yönetilmesi gereken iş verilerini koda gömmekten kaçının.
Geçmiş verileri koruyun ve önemli işlemler için bir denetim izi sağlayın.
Günlük dağıtım operasyonları sırasında depo personeli ve şoförler için kullanılabilirliğe öncelik verin.
İş kurallarını uygun uygulama ve veritabanı katmanlarında uygulayın ve doğrulayın.
Bir gereksinim belirsiz olduğunda ek iş kuralları icat etmeyin. Envanteri, müşteri borcunu, iade edilebilir kalem bakiyelerini veya muhasebeyi etkileyebilecek kararları uygulamadan önce açıklama isteyin.
Başarılı bir kullanıcı arayüzü etkileşimini bir veritabanı işleminin başarılı olduğunun kanıtı olarak kabul etmeyin.
Hesaplamaların onaylanmış ve izlenebilir işlemlere dayandığından emin olun.
Uygulamanın küçük ekranlarda yatay sayfa kaydırması olmadan doğru çalıştığını doğrulayın.
PWA kurulumunu, servis çalışanı davranışını ve desteklenen çevrimdışı yetenekleri üretim ortamında doğrulayın.
Mevcut proje bağımlılıkları gerekli işlevselliği güvenle sağlayabildiğinde gereksiz kütüphane eklemekten kaçının.
Yeni gereksinimler uygulanırken mevcut çalışan özellikleri koruyun.
15. Kritik İş Kuralları

Aşağıdaki kurallar zorunludur ve atlanmamalıdır:

Yalnızca depo yöneticisi depo operasyonlarını yetkilendirebilir ve bir dağıtım seferi için şoförü seçebilir.
Depo yöneticisi ekibi denetler ve teslimat yapmaz.
Her dağıtım seferi; yetkili bir şoför, dinamik olarak seçilen bir araç plakası ve onaylanmış bir yükleme kaydı gerektirir.
Araç stoku; yükleme, teslimat, iade ve düzeltme hareketlerinin her biri için tutarlı şekilde güncellenmelidir.
Bir şoför, önceki sefer mutabık hale getirilmeden, gün sonu raporu gönderilmeden ve sefer başarıyla sonlandırılmadan yeni bir dağıtım seferi başlatamaz.
Müşteri borç bakiyeleri; kaydedilmiş satışlara, ödemelere ve yetkilendirilmiş finansal düzeltmelere dayanmalıdır.
Müşteri iade edilebilir kalem bakiyeleri müşteri ve kalem türü bazında ayrı takip edilmelidir.
İade edilebilir kalem takibi yalnızca miktarlara dayanır. Parasal depozito ücretleri, iadeleri ve bakiyeleri uygulanmamalıdır.
Müşterinin finansal borcu ve bekleyen iade edilebilir kalem miktarları asla tek bir bakiyede birleştirilmemelidir.
Tüm önemli işlemler izlenebilir olmalı ve geçmiş kayıtlar sessizce üzerine yazılmamalı veya silinmemelidir.
Mobil cihazlarda uygulama, yatay sayfa kaydırması olmadan dikey kaydırmayla kullanılabilmelidir.
Uygulama, desteklenen platformlarda PWA olarak kurulabilmelidir.
Çevrimdışı işlem desteği, bir işlemin sunucu tarafından senkronize edildiğini veya onaylandığını asla yanlış bir şekilde belirtmemelidir.
PWA kurulum rehberliği, bağlantı durumu, senkronizasyon mesajları ve hata bildirimleri dahil tüm kullanıcıya dönük metinler Türkçe olmalıdır.
Bir sefer, yapıldığı gün sonlandırılmamışsa sistem onu otomatik kapatmaz ve otomatik rapor oluşturmaz. Şoför ertesi gün uygulamaya girdiğinde “önceki gün sonlandırılmadı” uyarısı alır ve önceki sefer sonlandırılana kadar yeni sefere başlayamaz. Yönetici ve şoför aynı sefer durumunu görür (Bölüm 9.1).
Şoförler hem peşin hem faturalı müşteriden tahsilat yapabilir; her tahsilat tahsil eden kullanıcı, tarih ve sefer referansıyla izlenebilir olmalıdır.
Faturalı müşteride birim fiyat, mal tutarı, cari borç ve geçmiş ürün fiyatı arayüzde gösterilmez; sistem default fiyatla borç hesaplamaya devam eder. Fiyat bilgisi Supabase'de ileride kullanım için saklanır.
Peşin müşteride kısmi/veresiye kalan tutar cari borca yazılır; şoför önceki borcu ve son satış fiyatını görür.
Bir şoförün ve bir araç plakasının aynı anda en fazla bir aktif seferi olabilir. Aynı gün kapatma zorunlu değildir; bugün yüklenen araçla ertesi gün teslimat yapılabilir.
60 gün sonra sefer/teslimat kayıtları arşivsiz ve durum bağımsız silinir; müşteri bakiyesi, iade edilebilir kalemler, son fiyat, tahsilatlar ve denetim kayıtları korunur.
16. Genel Hedef

Depo yöneticisinin envanteri ve dağıtım ekibini kontrol etmesini sağlayan, yetkili şoförlerin kendilerine atanan teslimatları yönetmesine izin veren, müşteri borçlarını ve iade edilebilir kalem miktarlarını doğru şekilde takip eden ve yeni bir dağıtım seferi başlamadan önce zorunlu gün sonu mutabakatını uygulayan; güvenli, güvenilir, Türkçe dilinde bir dağıtım ve muhasebe uygulaması geliştirin.

Uygulama; dikey kaydırmalı, gereksiz yatay sayfa taşması olmayan ve PWA kurulum desteği sunan mobil dostu bir deneyim sağlamalıdır. Çevrimdışı erişim ve senkronizasyon, envanterin, müşteri bakiyelerinin, ödemelerin ve geçmiş kayıtların tutarlı ve güvenilir kalması için dikkatle uygulanmalıdır.

17. Supabase Yapılandırması ve Arka Uç Koruması

Mevcut Supabase yapılandırması süregelen geliştirme için kritiktir. Uygulamanın geliştirme süreci boyunca arka uçla iletişim kurmaya devam edebilmesi için mevcut Supabase kurulumunu korumalısınız.

Aşağıdaki gereksinimler zorunludur:

Mevcut Supabase proje yapılandırmasını değiştirmeyin, yenisiyle değiştirmeyin, sıfırlamayın veya kaldırmayın.
Mevcut Supabase proje URL’sini, proje referansını, API anahtarlarını, ortam değişkeni adlarını veya ortam değişkeni yapılandırmasını değiştirmeyin.
Uygulamayı mevcut Supabase projesinden ayırmayın veya farklı bir Supabase projesine, veritabanına ya da arka uç ortamına geçirmeyin.
Mevcut veritabanı tablolarının, şemaların, kayıtların, kimlik doğrulama ayarlarının, Satır Düzeyi Güvenlik (RLS) politikalarının, veritabanı fonksiyonlarının, tetikleyicilerin veya diğer Supabase kaynaklarının üzerine yazmayın, bunları silmeyin, yeniden oluşturmayın veya sıfırlamayın.
Açıkça talep edilmedikçe Supabase kimlik doğrulama sağlayıcılarını, yönlendirme URL’lerini, oturum ayarlarını veya yetkilendirme yapılandırmasını değiştirmeyin.
Geliştirmeyi kolaylaştırmak için RLS’yi devre dışı bırakmayın veya mevcut veritabanı izinlerini zayıflatmayın.
Supabase kimlik bilgilerini, servis rolü anahtarlarını veya diğer gizli bilgileri istemci tarafı kodunda veya kaynak kontrolünde açığa çıkarmayın, yazdırmayın, commit etmeyin ve koda gömmeyin.
Mevcut ortam değişkenlerini ve .env dosyalarını koruyun. Geçerli yapılandırmayı yer tutucu değerlerle veya örnek kimlik bilgileriyle değiştirmeyin.
Mevcut verileri sıfırlayabilecek veya üzerine yazabilecek yıkıcı veritabanı komutları, migration’lar, seed betikleri veya otomatik kurulum prosedürleri çalıştırmayın.
Arka uçla ilgili herhangi bir değişiklik yapmadan önce mevcut Supabase entegrasyonunu, veritabanı şemasını, yetkilendirme politikalarını ve uygulama veri akışını inceleyin.
Geliştirme, test ve doğrulama için mevcut Supabase arka ucunu kullanmaya devam edin. Uygulamada yapılan değişiklikler, şu anda yapılandırılmış arka uçla uyumlu kalmalıdır.
Yeni işlevsellik veritabanı değişiklikleri gerektirdiğinde, geriye dönük uyumlu ve yıkıcı olmayan değişiklikleri tercih edin. Mevcut verileri veya operasyonları etkileyebilecek herhangi bir şema, politika, fonksiyon veya tetikleyici değişikliğini uygulamadan önce önerilen değişiklikleri ve etkilerini açıklayın.
Açık yetkilendirme olmadan veritabanı migration’ı uygulamayın veya üretim verilerini değiştirmeyin.
Kimlik doğrulama, veritabanı sorguları, ekleme, güncelleme ve desteklenen diğer arka uç işlemlerinin geliştirme sırasında çalışmaya devam etmesi için ön uç ile Supabase arasındaki mevcut bağlantıyı koruyun.
Değişiklikleri uyguladıktan sonra uygulamanın mevcut Supabase projesine hâlâ bağlanabildiğini ve ilgili arka uç işlemlerinin doğru çalıştığını doğrulayın.

Birincil hedef: Mevcut Supabase yapılandırmasını, arka uç bağlantısını, veritabanı içeriğini, kimlik doğrulamasını ve yetkilendirme kurallarını koruyarak uygulamayı geliştirmeye ve iyileştirmeye devam edin. Yeni bir özellik uygulamak veya kullanıcı arayüzünü iyileştirmek uğruna mevcut arka uçla iletişim kurma yeteneğinden ödün vermeyin.

17.1. Mevcut Uygulama Sözleşmesi (2026-11-04)

Aşağıdaki davranışlar mevcut uygulamada geçerlidir ve korunmalıdır:

Faturalı/peşin ayrımı `is_account_customer` alanıyla tutulur; `true` faturalı, `false` peşindir.
Faturalı müşteride birim fiyat, mal tutarı, cari borç ve geçmiş fiyat arayüzde FATURALI olarak yazılır; müşteri kartında "Faturalı Müşteri" etiketi kullanılır.
Faturalı teslimatta sunucu, istemci fiyatı yerine ürün default fiyatını uygular; `delivery_items.unit_price` ve `customer_product_prices` ileride kullanım için saklanır.
Peşin müşteride son satış fiyatı gösterilir; kısmi/veresiye kalan tutar `current_balance_tl` alanına borç yazılır.
Şoför teslimat dışı tahsilatı `customer_payments` tablosuna yazılır; `dispatch_id` ile aktif sefere bağlanır. Sefer silinirse 60 günden yeni tahsilat `ON DELETE SET NULL` ile korunur; 60 günü geçen tahsilat temizlikte silinir.
`record_customer_payment` idempotenttir; aynı `payment_id` bakiyeyi ikinci kez düşürmez ve denetim kaydı yazar.
Aktif sefer tekilliği `ux_dispatches_active_driver` ve `ux_dispatches_active_plate` kısmi tekil indeksleriyle korunur.
60 günlük temizlik `20261108_retention_purge_all_movements.sql` ile uygulanır; tüm müşteri borcu `20261106_cash_customer_debt.sql`, sefere bağlı tahsilat `20261107_customer_payment_dispatch.sql` ile yönetilir.
Temizlik 23:00 Türkiye saatinde otomatik çalışır; arşiv yoktur, tüm sefer durumları ve günlük hareket/denetim kayıtları kapsanır. Müşteri kaydı, nihai bakiye, nihai emanet adetleri, son fiyat ve sebil detayları korunur.

<!-- trail:start -->
Trail — depo bağlam grafiği

Bu depo .trail/cache/ içinde indekslenmiştir: her sistemi açıklayan ve tam dosya:satır aralıkları içeren, git aracılığıyla koda senkron tutulan küçük, bağlantılı markdown düğümleri.

Burada HERHANGİ BİR görev için — bir şeyin nasıl çalıştığını anlamak, kodun nerede olduğunu bulmak veya bir değişikliğin kapsamını belirlemek — grep yapmadan veya kaynak dosyaları açmadan önce bağlamı grafikten alın. Serbestçe tekrar sorun (ucuzdur) ve elinizde olan birebir tanımlayıcıları (sembol, hata metni, dosya adı) sorgu olarak yeniden kullanın. Bu depoya yeni misiniz? Önce trail map çalıştırın — token bütçeli bir yönlendirme (dizin kümeleri, merkezler, sıcak noktalar); LLM yok, anahtar yok.

trail ask "<sorunuz>" --source çalıştırın → ilgili kod aralıkları satır içinde verilmiş, sıralanmış düğümler (varsayılan olarak her sonucun ≤8 satırlık özü; öz yetmezse tam tanımlar için --full). Aracı görevin şekline göre seçin: anlamak veya düzenlemek için en üstteki düğüm cevabın kendisidir — covers: dosya:satır aralıklarını alıntılayın ve doğrudan --source çıktısından düzenleyin. Kapsamlı görevler için (“bu kalıbın her geçtiği yer / her çağıran”), sıralı sonuçlar eksiksiz değil, ilk N sonuçtur — bunun yerine trail grep "<birebir ifade>" çalıştırın (indekslenmiş dosyalar üzerinde kapsamlı, çevreleyen sembole göre gruplanmış); yalnızca indekslenmemiş dosyalar için ham grep -rn kullanın.
trail skeleton <dosya> → her tanımın imzası + aralığı, dosyayı okumaktan ~10 kat ucuz; bir API yüzeyine göz atmak için kullanın.
trail callers <sembol> önceden hesaplanmış, kesin bağlantılar verir — bunu kim çağırıyor. Neyi çağırdığını görmek için --direction out, tam etki alanı için geçişli gezinti amacıyla --depth N ekleyin. Yapısal sorular için sıralamayı atlayın ve doğrudan bunu kullanın.
Ya da gezinin: .trail/cache/INDEX.md her düğümü listeler; bağlantıları izleyin.
Monorepolar ve birden çok depo içeren klasörler, alt projeler arasında adil şekilde sıralanır — sonuçlar hangi projeden olduklarını belirten [kapsam/] etiketleri taşır. Nerede çalıştığınızı öğrendikten sonra trail ask "<görev>" --in <kapsam>/ ile daraltın.

Döndürülen bir aralık kesilmişse (“+N satır daha”), son kararınızı vermeden önce dosyayı tam o aralıkta açın. Kaynak dosyaları yalnızca bir düğümde gerekli bir ayrıntı gerçekten eksikse ve o zaman da düğümün işaret ettiği tam dosya:satırda açın — dosyaların tamamını asla yeniden okumayın.

Büyük kod değişikliklerinden sonra grafiği trail build ile yenileyin (deterministik, API anahtarı yok, 0 $).

<!-- trail:end -->