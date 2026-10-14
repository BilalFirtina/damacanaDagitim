import React, { useState, useEffect } from 'react';
import { Customer, Product, Dispatch, User } from '../../types';
import {
  Search,
  Plus,
  Check,
  AlertTriangle,
  RotateCcw,
  Edit2,
  Phone,
  MapPin,
  Building2,
  X
} from 'lucide-react';
import { createDelivery, createCustomer } from '../../services/api';

interface DeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  dispatch: Dispatch;
  currentUser: User;
  customers: Customer[];
  products: Product[];
  onDeliveryCreated: (delivery: any, updatedCustomer?: Customer) => void;
}

export const DeliveryModal: React.FC<DeliveryModalProps> = ({
  isOpen,
  onClose,
  dispatch,
  currentUser,
  customers,
  products,
  onDeliveryCreated,
}) => {
  // Step 1: Customer selection
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);

  // New customer inline inputs
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustIsAccount, setNewCustIsAccount] = useState(true);

  // Step 2: Product items & quantities
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [unitPrices, setUnitPrices] = useState<Record<string, number>>({});
  const [editingPriceProductId, setEditingPriceProductId] = useState<string | null>(null);

  // Step 3: Empty containers returned
  const [emptyDamacanaReturned, setEmptyDamacanaReturned] = useState<number>(0);
  const [emptyTupReturned, setEmptyTupReturned] = useState<number>(0);

  // Step 4: Payment
  const [paymentType, setPaymentType] = useState<'full' | 'unpaid' | 'custom'>('full');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'POS' | 'MIXED'>('CASH');
  const [cashAmountInput, setCashAmountInput] = useState<string>('0');
  const [posAmountInput, setPosAmountInput] = useState<string>('0');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // When customer is selected, initialize prices with customer's memory
  useEffect(() => {
    if (selectedCustomer) {
      const initialPrices: Record<string, number> = {};
      products.forEach((p) => {
        initialPrices[p.id] =
          selectedCustomer.customPrices?.[p.id] ?? p.defaultUnitPrice;
      });
      setUnitPrices(initialPrices);
    }
  }, [selectedCustomer, products]);

  // Calculate totals
  const deliveredItems = Object.entries(quantities)
    .filter(([_, q]) => q > 0)
    .map(([productId, quantity]) => {
      const p = products.find((prod) => prod.id === productId)!;
      const unitPrice = unitPrices[productId] ?? p.defaultUnitPrice;
      return {
        productId,
        productName: p.name,
        quantity,
        unitPrice,
        lineTotal: quantity * unitPrice,
      };
    });

  const grandTotal = deliveredItems.reduce((acc, item) => acc + item.lineTotal, 0);

  // Calculate delivered deposit items
  let deliveredDepositDamacana = 0;
  let deliveredDepositTup = 0;
  deliveredItems.forEach((item) => {
    const p = products.find((prod) => prod.id === item.productId);
    if (p?.depositType === 'damacana') deliveredDepositDamacana += item.quantity;
    if (p?.depositType === 'tup') deliveredDepositTup += item.quantity;
  });

  // Automatically sync default empties count when delivered deposit items change
  const handleQuantityChange = (productId: string, newQty: number) => {
    setQuantities((prev) => {
      const updated = { ...prev, [productId]: Math.max(0, newQty) };
      // Auto suggest empties if empty field wasn't manually altered yet
      const p = products.find((prod) => prod.id === productId);
      if (p?.depositType === 'damacana') {
        let totalDam = 0;
        Object.entries(updated).forEach(([pId, q]) => {
          if (products.find((x) => x.id === pId)?.depositType === 'damacana') totalDam += q;
        });
        setEmptyDamacanaReturned(totalDam);
      }
      return updated;
    });
  };

  // Sync payment inputs based on selected paymentType
  useEffect(() => {
    if (paymentType === 'full') {
      if (paymentMethod === 'CASH') {
        setCashAmountInput(grandTotal.toString());
        setPosAmountInput('0');
      } else if (paymentMethod === 'POS') {
        setCashAmountInput('0');
        setPosAmountInput(grandTotal.toString());
      } else {
        // Mixed default
        const half = Math.floor(grandTotal / 2);
        setCashAmountInput(half.toString());
        setPosAmountInput((grandTotal - half).toString());
      }
    } else if (paymentType === 'unpaid') {
      setCashAmountInput('0');
      setPosAmountInput('0');
    }
  }, [paymentType, paymentMethod, grandTotal]);

  const cashVal = Number(cashAmountInput) || 0;
  const posVal = Number(posAmountInput) || 0;
  const totalCollectedVal = cashVal + posVal;
  const uncollectedDiff = grandTotal - totalCollectedVal;

  const handleCreateNewCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;

    try {
      const created = await createCustomer({
        name: newCustName.trim(),
        phone: newCustPhone.trim(),
        address: newCustAddress.trim(),
        isAccountCustomer: newCustIsAccount,
      });
      setSelectedCustomer(created);
      setShowNewCustomerForm(false);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustAddress('');
    } catch (err: any) {
      alert(err.message || 'Müşteri oluşturulamadı');
    }
  };

  const handleSubmitDelivery = async () => {
    if (!selectedCustomer) {
      setErrorMsg('Lütfen önce bir müşteri seçiniz');
      return;
    }
    if (deliveredItems.length === 0) {
      setErrorMsg('En az bir ürün teslim etmelisiniz');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const payload = {
        dispatchId: dispatch.id,
        driverId: currentUser.id,
        customerId: selectedCustomer.id,
        deliveredItems,
        collectedPayment: {
          method:
            paymentType === 'unpaid'
              ? 'UNPAID'
              : cashVal > 0 && posVal > 0
              ? 'MIXED'
              : posVal > 0
              ? 'POS'
              : 'CASH',
          cashAmount: cashVal,
          posAmount: posVal,
          totalCollected: totalCollectedVal,
        },
        emptyContainersReceived: {
          damacana: emptyDamacanaReturned,
          tup: emptyTupReturned,
        },
        notes: notes.trim(),
      };

      const result = await createDelivery(payload);
      onDeliveryCreated(result.delivery, result.updatedCustomer);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Teslimat kaydedilemedi');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const filteredCustomers = customers.filter((c) => {
    const term = customerSearch.toLowerCase();
    return (
      c.name.toLowerCase().includes(term) ||
      c.address.toLowerCase().includes(term) ||
      c.phone.includes(term) ||
      (c.emails && c.emails.some((em) => em.toLowerCase().includes(term)))
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 my-auto max-h-[92vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>Hızlı Teslimat & Tahsilat Girişi</span>
              <span className="text-xs px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 font-mono">
                {dispatch.vehiclePlate}
              </span>
            </h2>
            <p className="text-xs text-slate-500">Müşteri seçin, teslim edilenleri ve tahsilatı girin</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-5 flex-1">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Section 1: Customer Selection */}
          <div>
            <label className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider block mb-2">
              1. Müşteri Seçimi
            </label>

            {!selectedCustomer ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Müşteri adı, adres veya telefon ile ara..."
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowNewCustomerForm(true)}
                    className="px-3 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center gap-1 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Yeni Müşteri</span>
                  </button>
                </div>

                {/* Inline New Customer Form */}
                {showNewCustomerForm && (
                  <div className="p-4 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/20 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-sky-900 dark:text-sky-300">Anında Yeni Müşteri Ekle</span>
                      <button
                        onClick={() => setShowNewCustomerForm(false)}
                        className="text-xs text-slate-400 hover:text-slate-600"
                      >
                        Vazgeç
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <input
                        type="text"
                        placeholder="Müşteri / İşletme Adı *"
                        value={newCustName}
                        onChange={(e) => setNewCustName(e.target.value)}
                        className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                      <input
                        type="text"
                        placeholder="Telefon Numarası"
                        value={newCustPhone}
                        onChange={(e) => setNewCustPhone(e.target.value)}
                        className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                      <input
                        type="text"
                        placeholder="Adres / Kat / Daire"
                        value={newCustAddress}
                        onChange={(e) => setNewCustAddress(e.target.value)}
                        className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white sm:col-span-2"
                      />
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newCustIsAccount}
                          onChange={(e) => setNewCustIsAccount(e.target.checked)}
                          className="rounded text-sky-600 focus:ring-sky-500 w-4 h-4"
                        />
                        <span>Cari / Açık Hesap Müşterisi (Veresiye Takibi Yapılsın)</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleCreateNewCustomer}
                        className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs"
                      >
                        Kaydet & Seç
                      </button>
                    </div>
                  </div>
                )}

                {/* Customer search list */}
                <div className="max-h-48 overflow-y-auto space-y-1.5 border border-slate-100 dark:border-slate-800 rounded-xl p-1 bg-slate-50/50 dark:bg-slate-800/30">
                  {filteredCustomers.length === 0 ? (
                    <div className="p-3 text-center text-xs text-slate-400">
                      Müşteri bulunamadı. "Yeni Müşteri" butonundan hemen ekleyebilirsiniz.
                    </div>
                  ) : (
                    filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedCustomer(c)}
                        className="w-full text-left p-2.5 rounded-lg hover:bg-white dark:hover:bg-slate-800 transition-colors flex items-center justify-between border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                      >
                        <div className="space-y-0.5">
                          <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <span>{c.name}</span>
                            {c.isAccountCustomer && (
                              <span className="text-[10px] font-semibold text-sky-700 bg-sky-50 dark:bg-sky-950 px-1.5 py-0.2 rounded">
                                Cari
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate max-w-sm">{c.address}</div>
                        </div>

                        <div className="text-right shrink-0">
                          {c.emptyDepositBalance?.damacana > 0 && (
                            <div className="text-[10px] font-semibold text-orange-600">
                              {c.emptyDepositBalance.damacana} Boş Borcu
                            </div>
                          )}
                          {c.currentBalanceTL > 0 && (
                            <div className="text-[11px] font-mono font-bold text-red-600">
                              {c.currentBalanceTL.toLocaleString('tr-TR')} ₺ Borç
                            </div>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              /* Selected Customer Card */
              <div className="p-3.5 rounded-xl border-2 border-sky-500/40 bg-sky-50/40 dark:bg-sky-950/30 flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-sky-600" />
                    <span className="text-sm font-bold text-slate-900 dark:text-white">{selectedCustomer.name}</span>
                    {selectedCustomer.isAccountCustomer ? (
                      <span className="text-[10px] font-bold text-sky-700 bg-sky-100 dark:bg-sky-900 px-1.5 py-0.5 rounded">
                        Cari / Açık Hesap
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-600 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                        Peşin Müşteri
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      {selectedCustomer.address}
                    </span>
                    {selectedCustomer.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3 text-slate-400" />
                        {selectedCustomer.phone}
                      </span>
                    )}
                  </div>

                  {/* Customer Badges: Deposit debt & Balance */}
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {(selectedCustomer.emptyDepositBalance?.damacana > 0 ||
                      selectedCustomer.emptyDepositBalance?.tup > 0) && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300">
                        Müşteride Kalan Boş: {selectedCustomer.emptyDepositBalance?.damacana || 0} Damacana
                        {selectedCustomer.emptyDepositBalance?.tup > 0
                          ? `, ${selectedCustomer.emptyDepositBalance.tup} Tüp`
                          : ''}
                      </span>
                    )}

                    {selectedCustomer.currentBalanceTL !== 0 && (
                      <span
                        className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md ${
                          selectedCustomer.currentBalanceTL > 0
                            ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        }`}
                      >
                        {selectedCustomer.currentBalanceTL > 0
                          ? `Önceki Borcu: ${selectedCustomer.currentBalanceTL.toLocaleString('tr-TR')} ₺`
                          : `Avansı: ${Math.abs(selectedCustomer.currentBalanceTL).toLocaleString('tr-TR')} ₺`}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedCustomer(null)}
                  className="text-xs font-semibold text-sky-600 hover:text-sky-800 dark:text-sky-400 hover:underline shrink-0"
                >
                  Değiştir
                </button>
              </div>
            )}
          </div>

          {/* Section 2: Products & Customer-specific Pricing */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                2. Teslim Edilen Ürünler & Birim Fiyatlar
              </label>
              <span className="text-[11px] text-slate-500">
                Fiyat müşteriye göre değiştirilebilir (otomatik hatırlanır)
              </span>
            </div>

            <div className="space-y-2">
              {products.map((p) => {
                const qty = quantities[p.id] || 0;
                const unitPrice = unitPrices[p.id] ?? p.defaultUnitPrice;
                const lineTotal = qty * unitPrice;
                const isEditingPrice = editingPriceProductId === p.id;
                const isCustomerSpecific =
                  selectedCustomer?.customPrices?.[p.id] !== undefined;

                return (
                  <div
                    key={p.id}
                    className={`p-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                      qty > 0
                        ? 'border-sky-300 bg-sky-50/20 dark:border-sky-800 dark:bg-sky-950/20 shadow-xs'
                        : 'border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <span>{p.name}</span>
                        {isCustomerSpecific && (
                          <span className="text-[10px] text-sky-700 font-normal bg-sky-100 dark:bg-sky-900 px-1 py-0.2 rounded">
                            Özel Fiyat
                          </span>
                        )}
                      </div>

                      {/* Price display & inline edit */}
                      <div className="flex items-center gap-2 mt-0.5 text-xs">
                        <span className="text-slate-500">Birim:</span>
                        {isEditingPrice ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={unitPrice}
                              onChange={(e) =>
                                setUnitPrices((prev) => ({
                                  ...prev,
                                  [p.id]: Math.max(0, parseFloat(e.target.value) || 0),
                                }))
                              }
                              className="w-16 h-7 rounded border border-sky-400 font-mono font-bold text-center text-xs bg-white dark:bg-slate-800"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => setEditingPriceProductId(null)}
                              className="p-1 rounded bg-sky-600 text-white"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingPriceProductId(p.id)}
                            className="flex items-center gap-1 font-mono font-bold text-slate-800 dark:text-slate-200 hover:text-sky-600 group"
                            title="Müşteriye özel birim fiyatı değiştir"
                          >
                            <span>{unitPrice} ₺</span>
                            <Edit2 className="w-2.5 h-2.5 text-slate-400 group-hover:text-sky-600" />
                          </button>
                        )}
                        <span className="text-slate-400">· {p.unit}</span>
                      </div>
                    </div>

                    {/* Quantity selectors & line total */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(p.id, qty - 1)}
                          className="w-8 h-8 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center text-sm active:scale-95"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          value={qty === 0 ? '' : qty}
                          onChange={(e) =>
                            handleQuantityChange(p.id, parseInt(e.target.value) || 0)
                          }
                          placeholder="0"
                          className="w-12 h-8 rounded-lg border border-slate-200 dark:border-slate-700 text-center font-bold font-mono text-xs dark:bg-slate-800 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(p.id, qty + 1)}
                          className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950 text-sky-600 font-bold flex items-center justify-center text-sm active:scale-95"
                        >
                          +
                        </button>
                      </div>

                      <div className="w-20 text-right">
                        <span className="font-mono font-bold text-xs tabular-nums text-slate-900 dark:text-white">
                          {lineTotal > 0 ? `${lineTotal.toLocaleString('tr-TR')} ₺` : '-'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 3: Deposit Empties Returned */}
          {(deliveredDepositDamacana > 0 || deliveredDepositTup > 0) && (
            <div className="p-3.5 rounded-xl border border-orange-200 dark:border-orange-900/60 bg-orange-50/40 dark:bg-orange-950/20 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-orange-900 dark:text-orange-300 flex items-center gap-1.5">
                  <RotateCcw className="w-4 h-4 text-orange-600" />
                  <span>3. Müşteriden Alınan Boş Kap Sayısı</span>
                </span>
                <span className="text-[11px] text-orange-700 dark:text-orange-400">
                  Verilen Dolu: {deliveredDepositDamacana} Damacana {deliveredDepositTup > 0 ? `, ${deliveredDepositTup} Tüp` : ''}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {deliveredDepositDamacana > 0 && (
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-orange-100 dark:border-orange-800">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Alınan Boş Damacana
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEmptyDamacanaReturned((prev) => Math.max(0, prev - 1))}
                        className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-700 text-xs font-bold"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        value={emptyDamacanaReturned}
                        onChange={(e) => setEmptyDamacanaReturned(parseInt(e.target.value) || 0)}
                        className="w-12 h-7 rounded border border-orange-200 text-center font-mono font-bold text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setEmptyDamacanaReturned((prev) => prev + 1)}
                        className="w-7 h-7 rounded bg-orange-50 text-orange-600 text-xs font-bold"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}

                {deliveredDepositTup > 0 && (
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-orange-100 dark:border-orange-800">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Alınan Boş Tüp
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEmptyTupReturned((prev) => Math.max(0, prev - 1))}
                        className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-700 text-xs font-bold"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        value={emptyTupReturned}
                        onChange={(e) => setEmptyTupReturned(parseInt(e.target.value) || 0)}
                        className="w-12 h-7 rounded border border-orange-200 text-center font-mono font-bold text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setEmptyTupReturned((prev) => prev + 1)}
                        className="w-7 h-7 rounded bg-orange-50 text-orange-600 text-xs font-bold"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {deliveredDepositDamacana - emptyDamacanaReturned !== 0 && (
                <div className="text-[11px] text-orange-800 dark:text-orange-300">
                  {deliveredDepositDamacana - emptyDamacanaReturned > 0 ? (
                    <span>
                      ⚠️ <strong>{deliveredDepositDamacana - emptyDamacanaReturned} adet boş eksik alındı.</strong> Müşterinin boş damacana borcuna işlenecektir.
                    </span>
                  ) : (
                    <span>
                      ℹ️ Müşteri fazladan <strong>{emptyDamacanaReturned - deliveredDepositDamacana} adet boş teslim etti.</strong> Emanet borcundan düşülecektir.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Section 4: Flexible Collection & Payment */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                4. Tahsilat & Ödeme Girişi
              </label>
              <div className="text-right">
                <span className="text-[11px] text-slate-500">Teslimat Tutarı:</span>
                <span className="font-mono font-extrabold text-base text-slate-900 dark:text-white ml-1.5 tabular-nums">
                  {grandTotal.toLocaleString('tr-TR')} ₺
                </span>
              </div>
            </div>

            {/* Quick Collection Type Buttons */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPaymentType('full')}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                  paymentType === 'full'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                Tam Tahsilat ({grandTotal} ₺)
              </button>

              <button
                type="button"
                onClick={() => setPaymentType('unpaid')}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                  paymentType === 'unpaid'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                Tahsilat Alınmadı (0 ₺)
              </button>

              <button
                type="button"
                onClick={() => setPaymentType('custom')}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                  paymentType === 'custom'
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                Kısmi / Farklı Tutar
              </button>
            </div>

            {/* Payment Method Selector (Nakit / POS / Karma) */}
            {paymentType !== 'unpaid' && (
              <div className="pt-2">
                <span className="text-[11px] font-semibold text-slate-500 block mb-1.5">Ödeme Yöntemi:</span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('CASH')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                      paymentMethod === 'CASH'
                        ? 'bg-emerald-100 text-emerald-800 border-2 border-emerald-500'
                        : 'bg-white dark:bg-slate-800 text-slate-700 border border-slate-200'
                    }`}
                  >
                    Nakit
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('POS')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                      paymentMethod === 'POS'
                        ? 'bg-indigo-100 text-indigo-800 border-2 border-indigo-500'
                        : 'bg-white dark:bg-slate-800 text-slate-700 border border-slate-200'
                    }`}
                  >
                    POS (Kredi Kartı)
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('MIXED')}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                      paymentMethod === 'MIXED'
                        ? 'bg-sky-100 text-sky-800 border-2 border-sky-500'
                        : 'bg-white dark:bg-slate-800 text-slate-700 border border-slate-200'
                    }`}
                  >
                    Karma (Nakit + POS)
                  </button>
                </div>

                {/* Amount Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  {(paymentMethod === 'CASH' || paymentMethod === 'MIXED') && (
                    <div>
                      <label className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 block mb-1">
                        Fiilen Alınan Nakit (₺)
                      </label>
                      <input
                        type="number"
                        value={cashAmountInput}
                        onChange={(e) => {
                          setPaymentType('custom');
                          setCashAmountInput(e.target.value);
                        }}
                        className="w-full p-2 rounded-lg border border-emerald-300 font-mono font-bold text-sm bg-white dark:bg-slate-800"
                      />
                    </div>
                  )}

                  {(paymentMethod === 'POS' || paymentMethod === 'MIXED') && (
                    <div>
                      <label className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400 block mb-1">
                        POS Cihazından Çekilen (₺)
                      </label>
                      <input
                        type="number"
                        value={posAmountInput}
                        onChange={(e) => {
                          setPaymentType('custom');
                          setPosAmountInput(e.target.value);
                        }}
                        className="w-full p-2 rounded-lg border border-indigo-300 font-mono font-bold text-sm bg-white dark:bg-slate-800"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Financial Reconciliation Summary Note */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-xs">
              <div className="flex items-center justify-between font-semibold">
                <span>Fiilen Tahsil Edilen Toplam:</span>
                <span className="font-mono text-emerald-600 font-bold tabular-nums">
                  {totalCollectedVal.toLocaleString('tr-TR')} ₺
                </span>
              </div>

              {uncollectedDiff !== 0 && selectedCustomer?.isAccountCustomer && (
                <div className="mt-1 text-[11px] text-sky-800 dark:text-sky-300">
                  {uncollectedDiff > 0 ? (
                    <span>
                      📋 Tahsil edilmeyen <strong>{uncollectedDiff.toLocaleString('tr-TR')} ₺</strong>, müşterinin cari borç bakiyesine eklenecektir.
                    </span>
                  ) : (
                    <span>
                      ℹ️ Fazla alınan <strong>{Math.abs(uncollectedDiff).toLocaleString('tr-TR')} ₺</strong>, müşterinin cari hesabından düşülecektir.
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400 block mb-1">
              Teslimat Notu (İsteğe bağlı):
            </label>
            <input
              type="text"
              placeholder="Örn: Mutfak personeline teslim edildi, pos slipi zımbalandı..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 shrink-0 flex items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-900">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-100"
          >
            İptal
          </button>

          <button
            type="button"
            onClick={handleSubmitDelivery}
            disabled={isSubmitting || !selectedCustomer || deliveredItems.length === 0}
            className="flex-1 sm:flex-initial px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold text-xs shadow-md shadow-sky-600/20 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" />
            <span>
              {isSubmitting
                ? 'Kaydediliyor...'
                : `Teslimatı Kaydet (${totalCollectedVal.toLocaleString('tr-TR')} ₺ Tahsilat)`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
