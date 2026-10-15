import React, { useState } from 'react';
import { Product, ProductCategory, DepositType, User } from '../../types';
import {
  Package,
  Plus,
  Search,
  Edit2,
  Trash2,
  Droplet,
  Coffee,
  Boxes,
  Flame,
  CheckCircle2,
  Info,
  Tag,
  AlertCircle
} from 'lucide-react';
import { createProduct, updateProduct, deleteProduct } from '../../services/api';

interface ProductManagementProps {
  products: Product[];
  onProductsUpdated: (products: Product[]) => void;
  currentUser?: User;
}

export const ProductManagement: React.FC<ProductManagementProps> = ({
  products,
  onProductsUpdated,
  currentUser,
}) => {
  const canManage = currentUser?.role === 'admin' || currentUser?.canLoadVehicle;
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  
  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);

  // Form states
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<ProductCategory>('damacana');
  const [formPrice, setFormPrice] = useState('100');
  const [formUnit, setFormUnit] = useState('Adet');
  const [formIsDeposit, setFormIsDeposit] = useState(true);
  const [formDepositType, setFormDepositType] = useState<DepositType>('damacana');
  const [formDescription, setFormDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const resetForm = () => {
    setFormName('');
    setFormCategory('damacana');
    setFormPrice('100');
    setFormUnit('Adet');
    setFormIsDeposit(true);
    setFormDepositType('damacana');
    setFormDescription('');
    setErrorMsg(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowAddModal(true);
  };

  const openEditModal = (p: Product) => {
    setEditingProduct(p);
    setFormName(p.name);
    setFormCategory(p.category);
    setFormPrice(p.defaultUnitPrice.toString());
    setFormUnit(p.unit || 'Adet');
    setFormIsDeposit(p.isDeposit);
    setFormDepositType(p.depositType || 'none');
    setFormDescription(p.description || '');
    setErrorMsg(null);
  };

  // Auto-adjust deposit when category changes in form
  const handleCategoryChange = (cat: ProductCategory) => {
    setFormCategory(cat);
    if (cat === 'damacana') {
      setFormIsDeposit(true);
      setFormDepositType('damacana');
      setFormUnit('Adet');
    } else if (cat === 'tup') {
      setFormIsDeposit(true);
      setFormDepositType('tup');
      setFormUnit('Adet');
    } else if (cat === 'bardak') {
      setFormIsDeposit(false);
      setFormDepositType('none');
      setFormUnit('Paket');
    } else if (cat === 'pet' || cat === 'soda') {
      setFormIsDeposit(false);
      setFormDepositType('none');
      setFormUnit('Koli');
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setErrorMsg('Lütfen ürün adını giriniz');
      return;
    }
    const priceNum = parseFloat(formPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      setErrorMsg('Geçerli bir satış fiyatı giriniz');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const payload: Partial<Product> = {
        name: formName.trim(),
        category: formCategory,
        defaultUnitPrice: priceNum,
        isDeposit: formIsDeposit,
        depositType: formIsDeposit ? formDepositType : 'none',
        unit: formUnit.trim() || 'Adet',
        description: formDescription.trim(),
      };

      if (editingProduct) {
        const updated = await updateProduct(editingProduct.id, payload);
        onProductsUpdated(products.map((p) => (p.id === editingProduct.id ? updated : p)));
        setSuccessMsg(`"${updated.name}" başarıyla güncellendi.`);
        setEditingProduct(null);
      } else {
        const created = await createProduct(payload);
        onProductsUpdated([...products, created]);
        setSuccessMsg(`"${created.name}" ürün listesine eklendi.`);
        setShowAddModal(false);
      }
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Ürün kaydedilirken bir hata oluştu');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteProduct = async () => {
    if (!deletingProduct) return;
    setIsSubmitting(true);
    try {
      await deleteProduct(deletingProduct.id);
      onProductsUpdated(products.filter((p) => p.id !== deletingProduct.id));
      setSuccessMsg(`"${deletingProduct.name}" silindi.`);
      setDeletingProduct(null);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      alert(err.message || 'Ürün silinemedi');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtering
  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.unit.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (!matchesSearch) return false;
    if (selectedCategory !== 'all' && p.category !== selectedCategory) return false;
    return true;
  });

  const getCategoryBadge = (cat: ProductCategory) => {
    switch (cat) {
      case 'damacana':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300">
            <Droplet className="w-3 h-3" /> Damacana Su
          </span>
        );
      case 'bardak':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <Coffee className="w-3 h-3" /> Bardak & Sarf
          </span>
        );
      case 'pet':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300">
            <Boxes className="w-3 h-3" /> Pet Şişe Su
          </span>
        );
      case 'soda':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <Boxes className="w-3 h-3" /> Soda & İçecek
          </span>
        );
      case 'tup':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300">
            <Flame className="w-3 h-3" /> Gaz Tüpü
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300">
            <Package className="w-3 h-3" /> Diğer
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 w-full max-w-full min-w-0">
      {/* Top Banner & Info Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4 w-full max-w-full">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Ürün Kataloğu & Fiyat Listesi
            </h2>
            <span className="px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 text-xs font-bold font-mono">
              {products.length} Çeşit
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Farklı su markaları (Hayat, Sırma vb.) ve farklı ambalaj boyutları (3000'li koli bardak, 50'li paket bardak vb.) ayrı ürünler olarak tanımlanır.
          </p>
        </div>

        {canManage ? (
          <button
            onClick={openAddModal}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            Yeni Ürün Ekle
          </button>
        ) : (
          <span className="text-[11px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl">
            Ürün Ekleme / Düzenleme: Depo Yöneticisi ve Yetkili Şoför Yetkisindedir
          </span>
        )}
      </div>

      {/* Success Banner */}
      {successMsg && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Guidance Cards for Multiple Brands & Cup Packaging */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Damacana Brand Guidance */}
        <div className="bg-sky-50/60 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/40 rounded-2xl p-4 flex gap-3">
          <div className="w-8 h-8 rounded-xl bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 flex items-center justify-center shrink-0">
            <Droplet className="w-4 h-4" />
          </div>
          <div className="text-xs">
            <h4 className="font-bold text-sky-900 dark:text-sky-200 mb-1">
              Damacana Markaları (Hayat vs. Sırma)
            </h4>
            <p className="text-sky-800/80 dark:text-sky-300/80 leading-relaxed">
              Her su markası (<strong>Hayat 19L</strong> ve <strong>Sırma 19L</strong>) sistemde kendi adı ve kendi birim fiyatıyla ayrı bir ürün olarak yer alır. Her ikisi de <em>"Damacana Depozitosu"</em>na bağlı olduğu için şoför araçtan hangi markayı verirse versin, boş 19L damacana iadesi tek bir ortak emanet havuzunda müşteriden otomatik tahsil edilir.
            </p>
          </div>
        </div>

        {/* Paper Cup Packaging Guidance */}
        <div className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 rounded-2xl p-4 flex gap-3">
          <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
            <Coffee className="w-4 h-4" />
          </div>
          <div className="text-xs">
            <h4 className="font-bold text-amber-900 dark:text-amber-200 mb-1">
              Karton Bardak (3000'li Koli vs. 50'li Paket)
            </h4>
            <p className="text-amber-800/80 dark:text-amber-300/80 leading-relaxed">
              Toptan koli satışları (<strong>3000'li Koli</strong>, birim: <em>Koli</em>) ile perakende rulo satışları (<strong>50'li Paket</strong>, birim: <em>Paket</em>) <strong>iki ayrı ürün</strong> olarak işlenir. Şoför sahada teslimat yaparken müşterinin ihtiyacına göre koli veya paket seçer, tutarlar ve araç yükleme sayımları ayrı ayrı hesaplanır.
            </p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 scrollbar-none text-xs">
          {[
            { id: 'all', label: 'Tüm Ürünler' },
            { id: 'damacana', label: '💧 Damacana' },
            { id: 'bardak', label: '🥤 Karton Bardak' },
            { id: 'pet', label: '📦 Pet Su' },
            { id: 'soda', label: '🍾 Soda' },
            { id: 'tup', label: '🔥 Gaz Tüpü' },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors whitespace-nowrap shrink-0 ${
                selectedCategory === cat.id
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-64 shrink-0">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Ürün adı veya açıklama ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500/20"
          />
        </div>
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredProducts.map((p) => {
          return (
            <div
              key={p.id}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex flex-col justify-between hover:border-sky-300 dark:hover:border-sky-700 transition-all"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  {getCategoryBadge(p.category)}
                  {canManage && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditModal(p)}
                        className="p-1.5 text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        title="Düzenle"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeletingProduct(p)}
                        className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        title="Sil"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                  {p.name}
                </h3>
                
                {p.description && (
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                    {p.description}
                  </p>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-end justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                    Satış Fiyatı ({p.unit})
                  </span>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="text-xl font-extrabold font-mono text-slate-900 dark:text-white">
                      {p.defaultUnitPrice.toLocaleString('tr-TR')} ₺
                    </span>
                    <span className="text-[11px] text-slate-500 font-medium">
                      / {p.unit}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  {p.isDeposit ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/40 px-2 py-0.5 rounded-md">
                      {p.depositType === 'damacana' ? '🔄 19L Boş Emanet' : '🔥 Boş Tüp Emanet'}
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-slate-400 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                      Depozitosuz
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredProducts.length === 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center text-slate-400 text-xs">
          Arama kriterine uygun ürün bulunamadı.
        </div>
      )}

      {/* Add / Edit Product Modal */}
      {(showAddModal || editingProduct) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editingProduct ? 'Ürünü Düzenle' : 'Yeni Ürün Tanımla'}
              </h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingProduct(null);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg font-bold"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Ürün adını, satış birimini (Adet, Paket, Koli) ve depozito kuralını belirleyin
            </p>

            {errorMsg && (
              <div className="mb-4 p-2.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSaveProduct} className="space-y-3.5 text-xs">
              {/* Product Name */}
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Ürün Adı ve Markası *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Örn: 19 Litre Sırma Damacana Su veya Karton Bardak 6.5 oz (50'li Paket)"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </div>

              {/* Category & Unit in grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Kategori *
                  </label>
                  <select
                    value={formCategory}
                    onChange={(e) => handleCategoryChange(e.target.value as ProductCategory)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                  >
                    <option value="damacana">💧 Damacana Su</option>
                    <option value="bardak">🥤 Karton Bardak & Sarf</option>
                    <option value="pet">📦 Pet Şişe Su</option>
                    <option value="soda">🍾 Soda & İçecek</option>
                    <option value="tup">🔥 Mutfak / Piknik Tüpü</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Satış Birimi (Ambalaj) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Adet, Paket, Koli, Rulo..."
                    value={formUnit}
                    onChange={(e) => setFormUnit(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Örn: 3000'li için "Koli", 50'li için "Paket", damacana için "Adet"
                  </span>
                </div>
              </div>

              {/* Price & Deposit in grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Varsayılan Satış Fiyatı (₺) *
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      required
                      placeholder="100"
                      value={formPrice}
                      onChange={(e) => setFormPrice(e.target.value)}
                      className="w-full p-2.5 pr-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-slate-400">
                      ₺
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Müşteriye özel fiyatlar müşteri kartından ayarlanır.
                  </span>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Depozito / Boş Kap İadesi
                  </label>
                  <select
                    value={formIsDeposit ? formDepositType : 'none'}
                    onChange={(e) => {
                      const val = e.target.value as DepositType;
                      if (val === 'none') {
                        setFormIsDeposit(false);
                        setFormDepositType('none');
                      } else {
                        setFormIsDeposit(true);
                        setFormDepositType(val);
                      }
                    }}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                  >
                    <option value="none">Depozitosuz (Geri İade Yok)</option>
                    <option value="damacana">🔄 19L Boş Damacana İadesi Zorunlu</option>
                    <option value="tup">🔥 Boş Tüp İadesi Zorunlu</option>
                  </select>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Açıklama / Paket Detayı (Opsiyonel)
                </label>
                <textarea
                  rows={2}
                  placeholder="Örn: 50 adetlik rulo paket perakende satış, sebil uyumlu karton bardak"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingProduct(null);
                  }}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl shadow-xs transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Kaydediliyor...' : editingProduct ? 'Güncelle' : 'Ürünü Ekle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-800 text-center animate-in fade-in zoom-in-95">
            <div className="w-12 h-12 rounded-2xl bg-red-100 dark:bg-red-950/60 text-red-600 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Ürünü Silmek İstediğinize Emin misiniz?
            </h3>
            <p className="text-xs text-slate-500 mt-1 mb-5">
              <strong>"{deletingProduct.name}"</strong> ürün katalogdan kaldırılacaktır. Geçmiş teslimat kayıtları etkilenmez.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setDeletingProduct(null)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs"
              >
                Vazgeç
              </button>
              <button
                onClick={handleDeleteProduct}
                disabled={isSubmitting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
              >
                {isSubmitting ? 'Siliniyor...' : 'Evet, Sil'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
