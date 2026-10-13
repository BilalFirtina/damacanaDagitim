import React, { useState } from 'react';
import { Customer, Product } from '../../types';
import {
  Building2,
  Phone,
  MapPin,
  Search,
  Plus,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Tag,
  Edit2
} from 'lucide-react';
import { createCustomer, updateCustomer } from '../../services/api';

interface CustomersManagementProps {
  customers: Customer[];
  products: Product[];
  onCustomersUpdated: (customers: Customer[]) => void;
}

export const CustomersManagement: React.FC<CustomersManagementProps> = ({
  customers,
  products,
  onCustomersUpdated,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'account' | 'deposit_debt' | 'cash_debt'>('all');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New customer form state
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newDistrict, setNewDistrict] = useState('');
  const [newIsAccount, setNewIsAccount] = useState(true);
  const [newNotes, setNewNotes] = useState('');

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    try {
      const created = await createCustomer({
        name: newName.trim(),
        phone: newPhone.trim(),
        address: newAddress.trim(),
        district: newDistrict.trim(),
        isAccountCustomer: newIsAccount,
        notes: newNotes.trim(),
      });
      onCustomersUpdated([...customers, created]);
      setShowCreateModal(false);
      setNewName('');
      setNewPhone('');
      setNewAddress('');
      setNewDistrict('');
      setNewNotes('');
    } catch (err: any) {
      alert(err.message || 'Müşteri eklenemedi');
    }
  };

  const handleToggleAccountCustomer = async (cust: Customer) => {
    try {
      const updated = await updateCustomer(cust.id, {
        isAccountCustomer: !cust.isAccountCustomer,
      });
      onCustomersUpdated(customers.map((c) => (c.id === cust.id ? updated : c)));
      if (selectedCustomer?.id === cust.id) setSelectedCustomer(updated);
    } catch (err: any) {
      alert(err.message || 'Güncellenemedi');
    }
  };

  const handleClearDeposit = async (cust: Customer) => {
    if (!confirm(`${cust.name} için boş kap bakiyesini sıfırlamak istediğinize emin misiniz?`)) return;
    try {
      const updated = await updateCustomer(cust.id, {
        emptyDepositBalance: { damacana: 0, tup: 0 },
      });
      onCustomersUpdated(customers.map((c) => (c.id === cust.id ? updated : c)));
      if (selectedCustomer?.id === cust.id) setSelectedCustomer(updated);
    } catch (err: any) {
      alert(err.message || 'Güncellenemedi');
    }
  };

  const handleClearBalanceTL = async (cust: Customer) => {
    if (!confirm(`${cust.name} için cari TL borcunu kapalı (0 ₺) olarak işaretlemek istediğinize emin misiniz?`)) return;
    try {
      const updated = await updateCustomer(cust.id, {
        currentBalanceTL: 0,
      });
      onCustomersUpdated(customers.map((c) => (c.id === cust.id ? updated : c)));
      if (selectedCustomer?.id === cust.id) setSelectedCustomer(updated);
    } catch (err: any) {
      alert(err.message || 'Güncellenemedi');
    }
  };

  const filtered = customers.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.includes(searchTerm);

    if (!matchesSearch) return false;
    if (filterType === 'account') return c.isAccountCustomer;
    if (filterType === 'deposit_debt') return c.emptyDepositBalance?.damacana > 0;
    if (filterType === 'cash_debt') return c.currentBalanceTL > 0;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner & Search */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Müşteri Rehberi & Bakiye Takip Masası
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Cari açık hesap yetkileri, özel birim fiyat hafızası ve emanet boş damacana takibi
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto">
          <div className="relative flex-1 md:w-60">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Müşteri adı veya adres ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:outline-none"
            />
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Müşteri Ekle</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-none text-xs">
        <button
          onClick={() => setFilterType('all')}
          className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-colors ${
            filterType === 'all'
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
          }`}
        >
          Tüm Müşteriler ({customers.length})
        </button>

        <button
          onClick={() => setFilterType('account')}
          className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-colors ${
            filterType === 'account'
              ? 'bg-sky-600 text-white'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
          }`}
        >
          Cari Açık Hesaplar ({customers.filter((c) => c.isAccountCustomer).length})
        </button>

        <button
          onClick={() => setFilterType('deposit_debt')}
          className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-colors ${
            filterType === 'deposit_debt'
              ? 'bg-orange-600 text-white'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
          }`}
        >
          Boş Damacana Borcu Olanlar ({customers.filter((c) => c.emptyDepositBalance?.damacana > 0).length})
        </button>

        <button
          onClick={() => setFilterType('cash_debt')}
          className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-colors ${
            filterType === 'cash_debt'
              ? 'bg-red-600 text-white'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
          }`}
        >
          TL Bakiye Borcu Olanlar ({customers.filter((c) => c.currentBalanceTL > 0).length})
        </button>
      </div>

      {/* Customer Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((c) => (
          <div
            key={c.id}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-sky-600 shrink-0" />
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                    {c.name}
                  </h3>
                </div>

                <button
                  onClick={() => handleToggleAccountCustomer(c)}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md transition-colors shrink-0 ${
                    c.isAccountCustomer
                      ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                  title="Yönetici Cari/Veresiye İznini Değiştir"
                >
                  {c.isAccountCustomer ? 'Cari Yetkili' : 'Peşin Müşteri'}
                </button>
              </div>

              <div className="mt-2 space-y-1 text-xs text-slate-500">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{c.address || 'Adres belirtilmemiş'}</span>
                </div>
                {c.phone && (
                  <div className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{c.phone}</span>
                  </div>
                )}
              </div>

              {/* Balances */}
              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 block">Emanet Boş Kap:</span>
                  <span className="font-mono font-bold text-orange-600">
                    {c.emptyDepositBalance?.damacana || 0} Damacana
                    {c.emptyDepositBalance?.tup > 0 ? `, ${c.emptyDepositBalance.tup} Tüp` : ''}
                  </span>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block">Cari TL Borç:</span>
                  <span
                    className={`font-mono font-bold ${
                      c.currentBalanceTL > 0 ? 'text-red-600' : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {c.currentBalanceTL.toLocaleString('tr-TR')} ₺
                  </span>
                </div>
              </div>

              {/* Custom Prices Memory */}
              {c.customPrices && Object.keys(c.customPrices).length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500">
                  <span className="text-[10px] text-slate-400 block mb-0.5">Özel Fiyat Hafızası:</span>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(c.customPrices).map(([pId, price]) => {
                      const p = products.find((prod) => prod.id === pId);
                      return (
                        <span key={pId} className="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-[10px]">
                          {p?.name.split(' ')[0]}: <strong>{price} ₺</strong>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="mt-4 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px]">
              {c.emptyDepositBalance?.damacana > 0 && (
                <button
                  onClick={() => handleClearDeposit(c)}
                  className="text-orange-600 hover:underline"
                >
                  Boşları Sıfırla
                </button>
              )}
              {c.currentBalanceTL > 0 && (
                <button
                  onClick={() => handleClearBalanceTL(c)}
                  className="text-red-600 hover:underline ml-auto"
                >
                  Borcu Kapat
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Create Customer Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
              Yeni Müşteri Tanımla
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Müşteri bilgilerini girin, cari açık hesap durumunu belirleyin
            </p>

            <form onSubmit={handleCreateCustomer} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Müşteri / İşletme Adı *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Örn: Yıldız Cafe & Bistro"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Telefon Numarası
                </label>
                <input
                  type="text"
                  placeholder="0216 450 11 22"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Adres
                </label>
                <input
                  type="text"
                  placeholder="Moda Cad. No: 42, Kadıköy"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={newIsAccount}
                    onChange={(e) => setNewIsAccount(e.target.checked)}
                    className="w-4 h-4 rounded text-sky-600"
                  />
                  <span>Cari Açık Hesap (Tahsil edilmeyen tutarlar borç bakiyesine işlensin)</span>
                </label>
              </div>

              <div className="pt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="w-1/2 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="w-1/2 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold shadow-md"
                >
                  Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
