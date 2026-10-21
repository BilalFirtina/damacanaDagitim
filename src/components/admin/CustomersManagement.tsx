import React, { useState } from 'react';
import { Customer, Product, User } from '../../types';
import {
  Building2,
  Phone,
  MapPin,
  Search,
  Plus,
  Edit2,
  Mail
} from 'lucide-react';
import {
  createCustomer,
  updateCustomer,
  type CustomerUpdate,
} from '../../services/api';
import { negativeEmptyMessages } from '../../services/emptyBalanceDisplay';
import { CustomerDispensersSection } from '../common/CustomerDispensersSection';

interface CustomersManagementProps {
  customers: Customer[];
  products: Product[];
  currentUser: User;
  onCustomersUpdated: (customers: Customer[]) => void;
}

export const CustomersManagement: React.FC<CustomersManagementProps> = ({
  customers,
  products,
  currentUser,
  onCustomersUpdated,
}) => {
  const isAdmin = currentUser.role === 'admin';
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'account' | 'deposit_debt' | 'cash_debt'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // New customer form state
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newEmails, setNewEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [newIsAccount, setNewIsAccount] = useState(true);
  const [newNotes, setNewNotes] = useState('');

  // Edit customer form state
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editEmails, setEditEmails] = useState<string[]>([]);
  const [editEmailInput, setEditEmailInput] = useState('');
  const [editIsAccount, setEditIsAccount] = useState(true);
  const [editNotes, setEditNotes] = useState('');
  const [editEmptyDamacana, setEditEmptyDamacana] = useState('0');
  const [editEmptyCamDamacana, setEditEmptyCamDamacana] = useState('0');
  const [editEmptyTup, setEditEmptyTup] = useState('0');

  // Helper to add emails from input (supports comma/semicolon/space separation)
  const addEmailsToNewList = () => {
    if (!emailInput.trim()) return;
    const parts = emailInput
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0 && s.includes('@'));

    if (parts.length === 0) {
      alert('Lütfen geçerli bir e-posta adresi giriniz (örn: muhasebe@sirket.com)');
      return;
    }

    setNewEmails((prev) => {
      const merged = [...prev];
      parts.forEach((p) => {
        if (!merged.includes(p)) merged.push(p);
      });
      return merged;
    });
    setEmailInput('');
  };

  const removeEmailFromNewList = (emailToRemove: string) => {
    setNewEmails((prev) => prev.filter((e) => e !== emailToRemove));
  };

  const addEmailsToEditList = () => {
    if (!editEmailInput.trim()) return;
    const parts = editEmailInput
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0 && s.includes('@'));

    if (parts.length === 0) {
      alert('Lütfen geçerli bir e-posta adresi giriniz (örn: muhasebe@sirket.com)');
      return;
    }

    setEditEmails((prev) => {
      const merged = [...prev];
      parts.forEach((p) => {
        if (!merged.includes(p)) merged.push(p);
      });
      return merged;
    });
    setEditEmailInput('');
  };

  const removeEmailFromEditList = (emailToRemove: string) => {
    setEditEmails((prev) => prev.filter((e) => e !== emailToRemove));
  };

  const handleOpenCreateModal = () => {
    setNewName('');
    setNewPhone('');
    setNewAddress('');
    setNewEmails([]);
    setEmailInput('');
    setNewIsAccount(true);
    setNewNotes('');
    setShowCreateModal(true);
  };

  const handleOpenEditModal = (cust: Customer) => {
    setEditingCustomer(cust);
    setEditName(cust.name);
    setEditPhone(cust.phone || '');
    setEditAddress(cust.address || '');
    setEditEmails(cust.emails || []);
    setEditEmailInput('');
    setEditIsAccount(cust.isAccountCustomer);
    setEditNotes(cust.notes || '');
    setEditEmptyDamacana(String(Number(cust.emptyDepositBalance?.damacana) || 0));
    setEditEmptyCamDamacana(
      String(
        Number(
          cust.emptyDepositBalance?.camDamacana ??
            cust.emptyDepositBalance?.cam_damacana
        ) || 0
      )
    );
    setEditEmptyTup(String(Number(cust.emptyDepositBalance?.tup) || 0));
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!newName.trim()) return;

    // Flush any pending email in the input field
    let finalEmails = [...newEmails];
    if (emailInput.trim() && emailInput.includes('@')) {
      const pending = emailInput
        .split(/[,;\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0 && s.includes('@'));
      pending.forEach((p) => {
        if (!finalEmails.includes(p)) finalEmails.push(p);
      });
    }

    try {
      setIsSubmitting(true);
      const created = await createCustomer({
        name: newName.trim(),
        phone: newPhone.trim(),
        address: newAddress.trim(),
        emails: finalEmails,
        isAccountCustomer: newIsAccount,
        notes: newNotes.trim(),
      });
      onCustomersUpdated([...customers, created]);
      setShowCreateModal(false);
    } catch (err: any) {
      // Form verileri korunur; kullanıcı düzeltip tekrar deneyebilir.
      alert(err.message || 'Müşteri eklenemedi');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer || !editName.trim()) return;

    // Flush any pending email in the edit input field
    let finalEmails = [...editEmails];
    if (editEmailInput.trim() && editEmailInput.includes('@')) {
      const pending = editEmailInput
        .split(/[,;\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0 && s.includes('@'));
      pending.forEach((p) => {
        if (!finalEmails.includes(p)) finalEmails.push(p);
      });
    }

    const originalEmpty = {
      damacana: Number(editingCustomer.emptyDepositBalance?.damacana) || 0,
      camDamacana:
        Number(
          editingCustomer.emptyDepositBalance?.camDamacana ??
            editingCustomer.emptyDepositBalance?.cam_damacana
        ) || 0,
      tup: Number(editingCustomer.emptyDepositBalance?.tup) || 0,
    };
    const nextEmpty = {
      damacana: Number(editEmptyDamacana),
      camDamacana: Number(editEmptyCamDamacana),
      tup: Number(editEmptyTup),
    };
    if (
      !Number.isInteger(nextEmpty.damacana) ||
      !Number.isInteger(nextEmpty.camDamacana) ||
      !Number.isInteger(nextEmpty.tup)
    ) {
      alert('Boş kap bakiyeleri tam sayı olmalıdır.');
      return;
    }
    const emptyChanged =
      nextEmpty.damacana !== originalEmpty.damacana ||
      nextEmpty.camDamacana !== originalEmpty.camDamacana ||
      nextEmpty.tup !== originalEmpty.tup;

    const updates: CustomerUpdate = {
      name: editName.trim(),
      phone: editPhone.trim(),
      address: editAddress.trim(),
      emails: finalEmails,
      isAccountCustomer: editIsAccount,
      notes: editNotes.trim(),
    };
    if (emptyChanged) {
      updates.emptyDepositBalance = nextEmpty;
      updates.expectedEmptyDepositBalance = originalEmpty;
    }

    try {
      const updated = await updateCustomer(editingCustomer.id, updates);
      onCustomersUpdated(customers.map((c) => (c.id === editingCustomer.id ? updated : c)));
      setEditingCustomer(null);
    } catch (err: any) {
      alert(err.message || 'Müşteri güncellenemedi');
    }
  };

  const handleToggleAccountCustomer = async (cust: Customer) => {
    try {
      const updated = await updateCustomer(cust.id, {
        isAccountCustomer: !cust.isAccountCustomer,
      });
      onCustomersUpdated(customers.map((c) => (c.id === cust.id ? updated : c)));
    } catch (err: any) {
      alert(err.message || 'Güncellenemedi');
    }
  };

  const handleClearDeposit = async (cust: Customer) => {
    if (!isAdmin) {
      alert('Boş kap bakiyesi sıfırlama yalnızca depo yöneticisi tarafından yapılabilir.');
      return;
    }
    if (!confirm(`${cust.name} için boş kap bakiyesini sıfırlamak istediğinize emin misiniz?`)) return;
    try {
      const updated = await updateCustomer(cust.id, {
        emptyDepositBalance: { damacana: 0, camDamacana: 0, tup: 0 },
        expectedEmptyDepositBalance: {
          damacana: cust.emptyDepositBalance?.damacana || 0,
          camDamacana:
            cust.emptyDepositBalance?.camDamacana ??
            cust.emptyDepositBalance?.cam_damacana ??
            0,
          tup: cust.emptyDepositBalance?.tup || 0,
        },
      });
      onCustomersUpdated(customers.map((c) => (c.id === cust.id ? updated : c)));
    } catch (err: any) {
      alert(err.message || 'Güncellenemedi');
    }
  };

  const handleClearBalanceTL = async (cust: Customer) => {
    if (!isAdmin) {
      alert('Cari bakiye sıfırlama yalnızca depo yöneticisi tarafından yapılabilir.');
      return;
    }
    if (!confirm(`${cust.name} için cari TL borcunu kapalı (0 ₺) olarak işaretlemek istediğinize emin misiniz?`)) return;
    try {
      const updated = await updateCustomer(cust.id, {
        currentBalanceTL: 0,
        expectedBalanceTL: cust.currentBalanceTL || 0,
      });
      onCustomersUpdated(customers.map((c) => (c.id === cust.id ? updated : c)));
    } catch (err: any) {
      alert(err.message || 'Güncellenemedi');
    }
  };

  const filtered = customers.filter((c) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      c.name.toLowerCase().includes(term) ||
      c.address.toLowerCase().includes(term) ||
      c.phone.includes(term) ||
      (c.emails && c.emails.some((em) => em.toLowerCase().includes(term)));

    if (!matchesSearch) return false;
    if (filterType === 'account') return c.isAccountCustomer;
    if (filterType === 'deposit_debt')
      return (
        (c.emptyDepositBalance?.damacana || 0) > 0 ||
        (c.emptyDepositBalance?.camDamacana || 0) > 0 ||
        (c.emptyDepositBalance?.tup || 0) > 0
      );
    if (filterType === 'cash_debt') return c.currentBalanceTL > 0;
    return true;
  });

  return (
    <div className="space-y-6 w-full max-w-full min-w-0">
      {/* Top Banner & Search */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4 w-full max-w-full">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-sky-600 shrink-0" />
            <span>Müşteri Rehberi & Çoklu E-Posta Yönetimi</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            E-Fatura, muhasebe ve sipariş için birden fazla e-posta adresi tanımlama, cari bakiye ve boş damacana takibi
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto">
          <div className="relative flex-1 md:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Ad, adres, telefon veya e-posta ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <button
            onClick={handleOpenCreateModal}
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Müşteri Ekle</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 py-1 text-xs w-full max-w-full">
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
          Boş Kap Borcu Olanlar ({customers.filter((c) => ((c.emptyDepositBalance?.damacana || 0) + (c.emptyDepositBalance?.camDamacana || 0) + (c.emptyDepositBalance?.tup || 0)) > 0).length})
        </button>

        <button
          onClick={() => setFilterType('cash_debt')}
          className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-colors ${
            filterType === 'cash_debt'
              ? 'bg-red-600 text-white'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
          }`}
        >
          TL Bakiye Borcu Olanlar ({customers.filter((c) => (c.currentBalanceTL || 0) > 0).length})
        </button>
      </div>

      {/* Customer Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((c) => {
          const emails = c.emails || [];
          const negativeEmpty = negativeEmptyMessages(c.emptyDepositBalance);
          const positiveEmptyParts = [
            (c.emptyDepositBalance?.damacana || 0) > 0
              ? `${c.emptyDepositBalance.damacana} Damacana`
              : null,
            (c.emptyDepositBalance?.camDamacana || 0) > 0
              ? `${c.emptyDepositBalance.camDamacana} Cam Damacana`
              : null,
            (c.emptyDepositBalance?.tup || 0) > 0
              ? `${c.emptyDepositBalance.tup} Tüp`
              : null,
          ].filter((part): part is string => part !== null);

          return (
            <div
              key={c.id}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex flex-col justify-between hover:shadow-md transition-shadow"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Building2 className="w-4 h-4 text-sky-600 shrink-0" />
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate min-w-0" title={c.name}>
                      {c.name}
                    </h3>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleOpenEditModal(c)}
                      className="p-1.5 text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                      title="Müşteriyi ve E-postaları Düzenle"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleToggleAccountCustomer(c)}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md transition-colors shrink-0 ${
                        c.isAccountCustomer
                          ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                      title="Cari Hesap Durumu"
                    >
                      {c.isAccountCustomer ? 'Cari Yetkili' : 'Peşin Müşteri'}
                    </button>
                  </div>
                </div>

                {/* Contact Info: Phone, Address, Emails */}
                <div className="mt-2.5 space-y-1.5 text-xs text-slate-500">
                  {c.phone && (
                    <div className="flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{c.phone}</span>
                    </div>
                  )}

                  <div className="flex items-start gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span className="line-clamp-2">{c.address || 'Adres belirtilmemiş'}</span>
                  </div>

                  {/* Multiple Email Addresses Display */}
                  <div className="flex items-start gap-1.5 pt-0.5">
                    <Mail className="w-3.5 h-3.5 text-sky-500 shrink-0 mt-0.5" />
                    {emails.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {emails.map((em, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 font-mono text-[11px] border border-sky-100 dark:border-sky-900/60"
                          >
                            {em}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400 italic">E-posta tanımlanmamış</span>
                    )}
                  </div>
                </div>

                {/* Balances */}
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                  <div className="min-w-0">
                    <span className="text-[10px] text-slate-400 block">Emanet Boş Kap:</span>
                    {negativeEmpty.length > 0 && (
                      <div className="space-y-0.5">
                        {negativeEmpty.map((message) => (
                          <span
                            key={message}
                            className="block font-semibold text-sky-700 dark:text-sky-300"
                          >
                            ℹ️ {message}
                          </span>
                        ))}
                      </div>
                    )}
                    {positiveEmptyParts.length > 0 ? (
                      <span className="font-mono font-bold text-orange-600">
                        {positiveEmptyParts.join(', ')}
                      </span>
                    ) : (
                      negativeEmpty.length === 0 && (
                        <span className="font-mono font-bold text-orange-600">
                          0 Damacana
                        </span>
                      )
                    )}
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block">Cari TL Borç:</span>
                    <span
                      className={`font-mono font-bold ${
                        (c.currentBalanceTL || 0) > 0 ? 'text-red-600' : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {(c.currentBalanceTL || 0).toLocaleString('tr-TR')} ₺
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

                <CustomerDispensersSection
                  customerId={c.id}
                  customerName={c.name}
                  className="mt-3"
                />
              </div>

              {/* Quick Actions (bakiye/boş kap sıfırlama yalnızca yöneticiye) */}
              {isAdmin && (
                <div className="mt-4 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px]">
                  {((c.emptyDepositBalance?.damacana || 0) !== 0 ||
                    (c.emptyDepositBalance?.camDamacana || 0) !== 0 ||
                    (c.emptyDepositBalance?.tup || 0) !== 0) && (
                    <button
                      onClick={() => handleClearDeposit(c)}
                      className="text-orange-600 hover:underline"
                    >
                      Boşları Sıfırla
                    </button>
                  )}
                  {(c.currentBalanceTL || 0) > 0 && (
                    <button
                      onClick={() => handleClearBalanceTL(c)}
                      className="text-red-600 hover:underline ml-auto"
                    >
                      Borcu Kapat
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 1. Create Customer Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-800 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Yeni Müşteri Tanımla
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Müşteri bilgilerini ve çoklu e-posta adreslerini giriniz
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="space-y-4 text-xs mt-4">
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
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Telefon Numarası
                  </label>
                  <input
                    type="text"
                    placeholder="0216 450 11 22"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
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
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              {/* Multiple Emails Input Section */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Mail className="w-4 h-4 text-sky-600" />
                    <span>Müşteri E-Posta Adresleri (Birden Fazla)</span>
                  </label>
                  <span className="text-[10px] text-slate-400">E-Fatura & Muhasebe</span>
                </div>

                {/* Email Tag Pills */}
                {newEmails.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 py-1">
                    {newEmails.map((em) => (
                      <span
                        key={em}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 font-mono text-xs border border-sky-200 dark:border-sky-800"
                      >
                        <span>{em}</span>
                        <button
                          type="button"
                          onClick={() => removeEmailFromNewList(em)}
                          className="hover:text-red-600 font-bold ml-0.5"
                          title="Sil"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    placeholder="muhasebe@sirket.com (Enter veya Ekle'ye basın)"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addEmailsToNewList();
                      }
                    }}
                    className="flex-1 p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <button
                    type="button"
                    onClick={addEmailsToNewList}
                    className="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs transition-colors shrink-0"
                  >
                    + Ekle
                  </button>
                </div>
                <p className="text-[10px] text-slate-400">
                  Virgül (,) ile ayırarak birden fazla e-postayı tek seferde de yapıştırabilirsiniz.
                </p>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Müşteri Notu
                </label>
                <input
                  type="text"
                  placeholder="Örn: Sabah 10:00 dan önce teslimat, zile basılmasın"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div className="pt-1">
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

              <div className="pt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="w-1/2 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-1/2 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold shadow-md active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Edit Customer Modal */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-800 my-auto max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Müşteri Bilgilerini Düzenle
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {editingCustomer.name} için adres ve çoklu e-posta adreslerini güncelleyin
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingCustomer(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateCustomer} className="space-y-4 text-xs mt-4">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Müşteri / İşletme Adı *
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Telefon Numarası
                  </label>
                  <input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Adres
                  </label>
                  <input
                    type="text"
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              {/* Multiple Emails Edit Section */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Mail className="w-4 h-4 text-sky-600" />
                    <span>Müşteri E-Posta Adresleri ({editEmails.length})</span>
                  </label>
                  <span className="text-[10px] text-slate-400">E-Fatura & Muhasebe</span>
                </div>

                {/* Email Tag Pills */}
                {editEmails.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 py-1">
                    {editEmails.map((em) => (
                      <span
                        key={em}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-800 dark:text-sky-300 font-mono text-xs border border-sky-200 dark:border-sky-800"
                      >
                        <span>{em}</span>
                        <button
                          type="button"
                          onClick={() => removeEmailFromEditList(em)}
                          className="hover:text-red-600 font-bold ml-0.5"
                          title="Sil"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    placeholder="Yeni e-posta ekle (Enter veya Ekle)"
                    value={editEmailInput}
                    onChange={(e) => setEditEmailInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addEmailsToEditList();
                      }
                    }}
                    className="flex-1 p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <button
                    type="button"
                    onClick={addEmailsToEditList}
                    className="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs transition-colors shrink-0"
                  >
                    + Ekle
                  </button>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Müşteri Notu
                </label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div className="p-3.5 rounded-xl bg-orange-50/50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900/60 space-y-2">
                <div>
                  <label className="font-bold text-orange-900 dark:text-orange-300 block">
                    Emanet Boş Kap Bakiyesi
                  </label>
                  <p className="text-[10px] text-orange-700 dark:text-orange-400 mt-0.5">
                    Negatif değer, müşteriye borcumuz olan boş kap sayısını gösterir.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                      Boş Damacana
                    </label>
                    <input
                      type="number"
                      step="1"
                      value={editEmptyDamacana}
                      onChange={(e) => setEditEmptyDamacana(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-orange-200 dark:border-orange-800 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                      Boş Cam Damacana
                    </label>
                    <input
                      type="number"
                      step="1"
                      value={editEmptyCamDamacana}
                      onChange={(e) => setEditEmptyCamDamacana(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-orange-200 dark:border-orange-800 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                      Boş Tüp
                    </label>
                    <input
                      type="number"
                      step="1"
                      value={editEmptyTup}
                      onChange={(e) => setEditEmptyTup(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-orange-200 dark:border-orange-800 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-1">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={editIsAccount}
                    onChange={(e) => setEditIsAccount(e.target.checked)}
                    className="w-4 h-4 rounded text-sky-600"
                  />
                  <span>Cari Açık Hesap (Tahsil edilmeyen tutarlar borç bakiyesine işlensin)</span>
                </label>
              </div>

              <div className="pt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditingCustomer(null)}
                  className="w-1/2 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="w-1/2 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold shadow-md active:scale-95 transition-all"
                >
                  Güncelle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
