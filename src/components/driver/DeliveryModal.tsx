import React, { useState, useEffect } from 'react';
import {
  Customer,
  Product,
  Dispatch,
  User,
  ProductCategory,
  getProductCategoryCodes,
  getProductCategoryTitle,
} from '../../types';
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
import { createDelivery, createCustomer, createProduct } from '../../services/api';
import {
  computeStockWarnings,
  getStockWarningSignature,
  shouldShowStockWarning,
  STOCK_WARNING_DURATION_MS,
} from '../../services/stockWarning';

interface DeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  dispatch: Dispatch;
  currentUser: User;
  customers: Customer[];
  products: Product[];
  onDeliveryCreated: (delivery: any, updatedCustomer?: Customer) => void;
  onCustomerCreated?: (customer: Customer) => void;
}

export const DeliveryModal: React.FC<DeliveryModalProps> = ({
  isOpen,
  onClose,
  dispatch,
  currentUser,
  customers,
  products,
  onDeliveryCreated,
  onCustomerCreated,
}) => {
  // Local products list so newly created products are immediately selectable
  const [allProducts, setAllProducts] = useState<Product[]>(products);

  useEffect(() => {
    setAllProducts(products);
  }, [products]);

  // Local customers list so newly created customers are immediately searchable
  const [allCustomers, setAllCustomers] = useState<Customer[]>(customers);

  useEffect(() => {
    setAllCustomers(customers);
  }, [customers]);

  // Step 1: Customer selection
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);

  // New customer inline inputs
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustEmails, setNewCustEmails] = useState('');
  const [newCustIsAccount, setNewCustIsAccount] = useState(true);

  // Step 2: Product search & selection
  const [productSearch, setProductSearch] = useState('');
  const [showNewProductForm, setShowNewProductForm] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdCategory, setNewProdCategory] = useState<ProductCategory>('damacana');
  const [newProdPrice, setNewProdPrice] = useState('120');
  const [newProdUnit, setNewProdUnit] = useState('Adet');
  const [newProdIsDeposit, setNewProdIsDeposit] = useState(true);
  const [newProdDepositType, setNewProdDepositType] = useState<'none' | 'damacana' | 'cam_damacana' | 'tup'>('damacana');

  // Quantities & Unit prices
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [unitPrices, setUnitPrices] = useState<Record<string, number>>({});
  const [editingPriceProductId, setEditingPriceProductId] = useState<string | null>(null);

  // Step 3: Empty containers returned
  const [emptyDamacanaReturned, setEmptyDamacanaReturned] = useState<number>(0);
  const [emptyCamDamacanaReturned, setEmptyCamDamacanaReturned] = useState<number>(0);
  const [emptyTupReturned, setEmptyTupReturned] = useState<number>(0);

  // Payment
  const [paymentType, setPaymentType] = useState<'full' | 'unpaid' | 'custom'>('full');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'POS' | 'MIXED'>('CASH');
  const [cashAmountInput, setCashAmountInput] = useState<string>('0');
  const [posAmountInput, setPosAmountInput] = useState<string>('0');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingCustomer, setIsSubmittingCustomer] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorPersistent, setErrorPersistent] = useState(false);
  const [dismissedWarningSignature, setDismissedWarningSignature] = useState<string | null>(null);
  const [warningExpiresAt, setWarningExpiresAt] = useState<number | null>(null);
  const [warningClock, setWarningClock] = useState(() => Date.now());

  const showTransientError = (message: string) => {
    setErrorPersistent(false);
    setErrorMsg(message);
  };

  useEffect(() => {
    if (!errorMsg || errorPersistent) return;
    const timeout = setTimeout(() => setErrorMsg(null), STOCK_WARNING_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [errorMsg, errorPersistent]);

  // When customer is selected, initialize prices with customer's custom prices or product defaults
  useEffect(() => {
    if (selectedCustomer) {
      const initialPrices: Record<string, number> = {};
      allProducts.forEach((p) => {
        initialPrices[p.id] =
          selectedCustomer.customPrices?.[p.id] ?? p.defaultUnitPrice;
      });
      setUnitPrices(initialPrices);
    }
  }, [selectedCustomer, allProducts]);

  // Delivered items calculation
  const deliveredItems = Object.entries(quantities)
    .filter(([_, q]) => q > 0)
    .map(([productId, quantity]) => {
      const p = allProducts.find((prod) => prod.id === productId)!;
      const unitPrice = unitPrices[productId] ?? p?.defaultUnitPrice ?? 100;
      return {
        productId,
        productName: p?.name || 'Ürün',
        quantity,
        unitPrice,
        lineTotal: quantity * unitPrice,
      };
    });

  const grandTotal = deliveredItems.reduce((acc, item) => acc + item.lineTotal, 0);

  // Calculate delivered deposit items
  let deliveredDepositDamacana = 0;
  let deliveredDepositCamDamacana = 0;
  let deliveredDepositTup = 0;
  deliveredItems.forEach((item) => {
    const p = allProducts.find((prod) => prod.id === item.productId);
    if (p?.depositType === 'damacana') deliveredDepositDamacana += item.quantity;
    if (p?.depositType === 'cam_damacana') deliveredDepositCamDamacana += item.quantity;
    if (p?.depositType === 'tup') deliveredDepositTup += item.quantity;
  });

  const handleQuantityChange = (productId: string, newQty: number) => {
    setQuantities((prev) => {
      const updated = { ...prev, [productId]: Math.max(0, newQty) };
      const p = allProducts.find((prod) => prod.id === productId);
      if (p?.depositType === 'damacana') {
        let totalDam = 0;
        Object.entries(updated).forEach(([pId, q]) => {
          if (allProducts.find((x) => x.id === pId)?.depositType === 'damacana') totalDam += q;
        });
        setEmptyDamacanaReturned(totalDam);
      }
      if (p?.depositType === 'cam_damacana') {
        let totalCam = 0;
        Object.entries(updated).forEach(([pId, q]) => {
          if (allProducts.find((x) => x.id === pId)?.depositType === 'cam_damacana') totalCam += q;
        });
        setEmptyCamDamacanaReturned(totalCam);
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

  // New Customer submit
  const handleCreateNewCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingCustomer) return;
    if (!newCustName.trim()) {
      showTransientError('Lütfen müşteri adını giriniz');
      return;
    }

    const parsedEmails = newCustEmails
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0 && s.includes('@'));

    try {
      setIsSubmittingCustomer(true);
      setErrorPersistent(false);
      setErrorMsg(null);
      const created = await createCustomer({
        name: newCustName.trim(),
        phone: newCustPhone.trim(),
        address: newCustAddress.trim(),
        emails: parsedEmails,
        isAccountCustomer: newCustIsAccount,
      });
      // Make the new customer immediately available in search / selection lists
      setAllCustomers((prev) => (prev.some((c) => c.id === created.id) ? prev : [...prev, created]));
      onCustomerCreated?.(created);
      // Automatically select created customer and proceed to product selection
      setSelectedCustomer(created);
      setShowNewCustomerForm(false);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustAddress('');
      setNewCustEmails('');
    } catch (err: any) {
      setErrorPersistent(true);
      setErrorMsg(err.message || 'Müşteri oluşturulamadı');
    } finally {
      setIsSubmittingCustomer(false);
    }
  };

  // New Product submit
  const handleCreateNewProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProdName.trim()) {
      showTransientError('Lütfen ürün adını giriniz');
      return;
    }

    try {
      setErrorPersistent(false);
      setErrorMsg(null);
      const created = await createProduct({
        name: newProdName.trim(),
        category: newProdCategory,
        defaultUnitPrice: Number(newProdPrice) || 100,
        unit: newProdUnit.trim() || 'Adet',
        isDeposit: newProdIsDeposit,
        depositType: newProdIsDeposit ? newProdDepositType : 'none',
      });

      // Update local product list and auto-select product with quantity 1
      setAllProducts((prev) => [...prev, created]);
      setQuantities((prev) => ({ ...prev, [created.id]: 1 }));
      setUnitPrices((prev) => ({ ...prev, [created.id]: created.defaultUnitPrice }));
      setShowNewProductForm(false);
      setNewProdName('');
      setProductSearch('');
    } catch (err: any) {
      setErrorPersistent(true);
      setErrorMsg(err.message || 'Ürün oluşturulamadı');
    }
  };

  // Submit Delivery
  const handleSubmitDelivery = async () => {
    if (!selectedCustomer) {
      showTransientError('Lütfen önce bir müşteri seçiniz');
      return;
    }
    if (deliveredItems.length === 0) {
      showTransientError('Lütfen teslim edilecek en az bir ürün seçiniz ve adedini giriniz');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorPersistent(false);
      setErrorMsg(null);

      const payload = {
        dispatchId: dispatch.id,
        driverId: currentUser.id,
        driverName: currentUser.name,
        vehiclePlate: dispatch.vehiclePlate,
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        customerAddress: selectedCustomer.address,
        customerPhone: selectedCustomer.phone,
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
          camDamacana: emptyCamDamacanaReturned,
          tup: emptyTupReturned,
        },
        notes: notes.trim(),
      };

      const result = await createDelivery(payload);
      onDeliveryCreated(result.delivery, result.updatedCustomer);
      onClose();
    } catch (err: any) {
      setErrorPersistent(true);
      setErrorMsg(err.message || 'Teslimat kaydedilemedi');
    } finally {
      setIsSubmitting(false);
    }
  };

  const stockWarnings = computeStockWarnings(deliveredItems, dispatch.loadedItems);
  const stockWarningSignature = getStockWarningSignature(stockWarnings);

  useEffect(() => {
    if (!stockWarningSignature) {
      setWarningExpiresAt(null);
      setDismissedWarningSignature(null);
      return;
    }

    setDismissedWarningSignature(null);
    setWarningExpiresAt(Date.now() + STOCK_WARNING_DURATION_MS);
    const timeout = setTimeout(
      () => setWarningClock(Date.now()),
      STOCK_WARNING_DURATION_MS + 50
    );
    return () => clearTimeout(timeout);
  }, [stockWarningSignature]);

  const showStockWarning = shouldShowStockWarning({
    warnings: stockWarnings,
    dismissedSignature: dismissedWarningSignature,
    expiresAt: warningExpiresAt,
    now: warningClock,
  });

  if (!isOpen) return null;

  // Filter customers
  const filteredCustomers = allCustomers.filter((c) => {
    const term = customerSearch.toLowerCase().trim();
    if (!term) return true;
    return (
      c.name.toLowerCase().includes(term) ||
      c.address.toLowerCase().includes(term) ||
      c.phone.includes(term) ||
      (c.emails && c.emails.some((em) => em.toLowerCase().includes(term)))
    );
  });

  // Filter products for Step 2
  const filteredProducts = allProducts.filter((p) => {
    const term = productSearch.toLowerCase().trim();
    if (!term) return true;
    return (
      p.name.toLowerCase().includes(term) ||
      p.category.toLowerCase().includes(term)
    );
  });

  // Stock check helper: find loaded qty on vehicle
  const getVehicleStock = (productId: string) => {
    const item = dispatch.loadedItems.find((i) => i.productId === productId);
    return item ? item.quantity : 0;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 my-auto max-h-[calc(94dvh-env(safe-area-inset-bottom))] sm:max-h-[94vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>Yeni Teslimat Girişi</span>
              <span className="text-xs px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 font-mono font-bold">
                {dispatch.vehiclePlate}
              </span>
            </h2>
            <p className="text-xs text-slate-500">
              {selectedCustomer ? 'Müşteri seçildi, teslim edilecek ürünleri belirleyiniz' : 'Adım 1: Önce teslimat yapılacak müşteriyi seçiniz'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="min-w-11 min-h-11 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center shrink-0"
            aria-label="Teslimat penceresini kapat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-5 flex-1 min-h-0">
          {/* ============================================================== */}
          {/* STEP 1: CUSTOMER SELECTION (ALWAYS FIRST)                     */}
          {/* ============================================================== */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-sky-600 text-white text-[11px] flex items-center justify-center font-bold">1</span>
                <span>Müşteri Seçimi</span>
              </label>
              {selectedCustomer && (
                <button
                  type="button"
                  onClick={() => setSelectedCustomer(null)}
                  className="text-xs font-semibold text-sky-600 hover:text-sky-800 dark:text-sky-400 hover:underline"
                >
                  Müşteriyi Değiştir
                </button>
              )}
            </div>

            {!selectedCustomer ? (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      autoFocus
                      placeholder="Müşteri adı veya telefon ile ara..."
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowNewCustomerForm(!showNewCustomerForm)}
                    className="px-3 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center gap-1 shrink-0 active:scale-95 transition-all shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Yeni Müşteri Ekle</span>
                  </button>
                </div>

                {/* Inline New Customer Form */}
                {showNewCustomerForm && (
                  <form onSubmit={handleCreateNewCustomer} className="p-3.5 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/20 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-sky-900 dark:text-sky-300">Yeni Müşteri Kaydı</span>
                      <button
                        type="button"
                        onClick={() => setShowNewCustomerForm(false)}
                        className="text-xs text-slate-400 hover:text-slate-600"
                      >
                        Kapat
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <input
                        type="text"
                        required
                        placeholder="Müşteri / İşletme Adı *"
                        value={newCustName}
                        onChange={(e) => setNewCustName(e.target.value)}
                        className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                      />
                      <input
                        type="text"
                        placeholder="Telefon Numarası"
                        value={newCustPhone}
                        onChange={(e) => setNewCustPhone(e.target.value)}
                        className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                      <input
                        type="text"
                        placeholder="Adres / Cadde / Kat"
                        value={newCustAddress}
                        onChange={(e) => setNewCustAddress(e.target.value)}
                        className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white sm:col-span-2"
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
                        <span>Cari / Açık Hesap Müşterisi</span>
                      </label>
                      <button
                        type="submit"
                        disabled={isSubmittingCustomer}
                        className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isSubmittingCustomer ? 'Kaydediliyor...' : 'Kaydet & Seç'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Customer search list */}
                <div className="max-h-52 overflow-y-auto space-y-1.5 border border-slate-100 dark:border-slate-800 rounded-xl p-1 bg-slate-50/50 dark:bg-slate-800/30">
                  {filteredCustomers.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400 space-y-2">
                      <p>Aramaya uygun kayıtlı müşteri bulunamadı.</p>
                      <button
                        type="button"
                        onClick={() => setShowNewCustomerForm(true)}
                        className="px-3 py-1.5 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 font-semibold text-xs inline-flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>"{customerSearch}" Adıyla Yeni Müşteri Ekle</span>
                      </button>
                    </div>
                  ) : (
                    filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedCustomer(c);
                          setErrorPersistent(false);
                          setErrorMsg(null);
                        }}
                        className="w-full text-left p-2.5 rounded-xl hover:bg-white dark:hover:bg-slate-800 transition-colors flex items-center justify-between border border-transparent hover:border-slate-200 dark:hover:border-slate-700 shadow-2xs"
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
                          <div className="text-[11px] text-slate-500 truncate max-w-sm">{c.address || 'Adres bilgisi yok'}</div>
                          {c.phone && (
                            <div className="text-[10px] text-slate-400 font-mono">
                              📞 {c.phone}
                            </div>
                          )}
                        </div>

                        <div className="text-right shrink-0">
                          {c.currentBalanceTL > 0 && (
                            <div className="text-[11px] font-mono font-bold text-red-600">
                              {c.currentBalanceTL.toLocaleString('tr-TR')} ₺ Borç
                            </div>
                          )}
                          {c.emptyDepositBalance?.damacana > 0 && (
                            <div className="text-[10px] font-semibold text-orange-600">
                              {c.emptyDepositBalance.damacana} Boş Borcu
                            </div>
                          )}
                          {c.emptyDepositBalance?.camDamacana > 0 && (
                            <div className="text-[10px] font-semibold text-amber-700">
                              {c.emptyDepositBalance.camDamacana} Boş Cam Borcu
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
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      {selectedCustomer.address || 'Adres yok'}
                    </span>
                    {selectedCustomer.phone && (
                      <span className="flex items-center gap-1 font-mono">
                        <Phone className="w-3 h-3 text-slate-400" />
                        {selectedCustomer.phone}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {(selectedCustomer.emptyDepositBalance?.damacana > 0 ||
                      selectedCustomer.emptyDepositBalance?.camDamacana > 0 ||
                      selectedCustomer.emptyDepositBalance?.tup > 0) && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300">
                        Müşteride Kalan Boş: {selectedCustomer.emptyDepositBalance?.damacana || 0} Damacana
                        {selectedCustomer.emptyDepositBalance?.camDamacana > 0 ? `, ${selectedCustomer.emptyDepositBalance.camDamacana} Cam Damacana` : ''}
                        {selectedCustomer.emptyDepositBalance?.tup > 0 ? `, ${selectedCustomer.emptyDepositBalance.tup} Tüp` : ''}
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
                  className="px-2.5 py-1 rounded-lg border border-sky-300 text-sky-700 hover:bg-sky-100 text-xs font-semibold shrink-0"
                >
                  Değiştir
                </button>
              </div>
            )}
          </div>

          {/* ============================================================== */}
          {/* STEP 2: PRODUCT SELECTION (ONLY AFTER CUSTOMER IS SELECTED)   */}
          {/* ============================================================== */}
          {selectedCustomer && (
            <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-sky-600 text-white text-[11px] flex items-center justify-center font-bold">2</span>
                  <span>Ürün Arama ve Seçimi</span>
                </label>
                {currentUser.role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => setShowNewProductForm(!showNewProductForm)}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Yeni Ürün Ekle</span>
                  </button>
                )}
              </div>

              {/* Product search box */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Ürün adı ile ara (Damacana, Tüp, Pet su vb.)..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                />
              </div>

              {/* Inline New Product Form */}
              {currentUser.role === 'admin' && showNewProductForm && (
                <form onSubmit={handleCreateNewProduct} className="p-3.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-900 dark:text-indigo-300">Hızlı Yeni Ürün Tanımla</span>
                    <button
                      type="button"
                      onClick={() => setShowNewProductForm(false)}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >
                      Kapat
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <input
                      type="text"
                      required
                      placeholder="Ürün Adı *"
                      value={newProdName}
                      onChange={(e) => setNewProdName(e.target.value)}
                      className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white sm:col-span-2"
                    />
                    <select
                      value={newProdCategory}
                      onChange={(e) => setNewProdCategory(e.target.value as ProductCategory)}
                      className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    >
                      {getProductCategoryCodes().map((code) => (
                        <option key={code} value={code}>
                          {getProductCategoryTitle(code)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      required
                      placeholder="Birim Fiyat (₺) *"
                      value={newProdPrice}
                      onChange={(e) => setNewProdPrice(e.target.value)}
                      className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold"
                    />
                    <input
                      type="text"
                      placeholder="Birim (Örn: Adet, Koli)"
                      value={newProdUnit}
                      onChange={(e) => setNewProdUnit(e.target.value)}
                      className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newProdIsDeposit}
                          onChange={(e) => setNewProdIsDeposit(e.target.checked)}
                          className="rounded text-indigo-600 w-4 h-4"
                        />
                        <span>İadeli Boş Kap</span>
                      </label>
                    </div>
                    {newProdIsDeposit && (
                      <select
                        value={newProdDepositType}
                        onChange={(e) =>
                          setNewProdDepositType(e.target.value as 'none' | 'damacana' | 'cam_damacana' | 'tup')
                        }
                        className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white sm:col-span-3"
                      >
                        <option value="damacana">🔄 Boş Damacana İadesi Zorunlu</option>
                        <option value="cam_damacana">🔄 Boş Cam Damacana İadesi Zorunlu</option>
                        <option value="tup">🔥 Boş Tüp İadesi Zorunlu</option>
                      </select>
                    )}
                  </div>
                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-sm"
                    >
                      Ürünü Kaydet & Teslimata Ekle
                    </button>
                  </div>
                </form>
              )}

              {/* Product selection cards */}
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {filteredProducts.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400 space-y-2">
                    <p>Aranan isimde ürün bulunamadı.</p>
                    <button
                      type="button"
                      onClick={() => setShowNewProductForm(true)}
                      className="px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-semibold text-xs inline-flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>"{productSearch}" Ürününü Şimdi Ekle</span>
                    </button>
                  </div>
                ) : (
                  filteredProducts.map((p) => {
                    const qty = quantities[p.id] || 0;
                    const unitPrice = unitPrices[p.id] ?? p.defaultUnitPrice;
                    const lineTotal = qty * unitPrice;
                    const vehicleStock = getVehicleStock(p.id);
                    const isEditingPrice = editingPriceProductId === p.id;
                    const isCustomerSpecific = selectedCustomer?.customPrices?.[p.id] !== undefined;

                    return (
                      <div
                        key={p.id}
                        className={`p-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                          qty > 0
                            ? 'border-sky-400 bg-sky-50/30 dark:border-sky-800 dark:bg-sky-950/20 shadow-2xs'
                            : 'border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <span>{p.name}</span>
                            {isCustomerSpecific && (
                              <span className="text-[10px] text-sky-700 font-medium bg-sky-100 dark:bg-sky-900 px-1 py-0.2 rounded">
                                Müşteriye Özel Fiyat
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 mt-1 text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-500">Birim Fiyat:</span>
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
                                    className="w-16 h-6 rounded border border-sky-400 font-mono font-bold text-center text-xs bg-white dark:bg-slate-800"
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
                                  className="flex items-center gap-1 font-mono font-bold text-slate-800 dark:text-slate-200 hover:text-sky-600"
                                  title="Fiyatı Düzenle"
                                >
                                  <span>{unitPrice} ₺</span>
                                  <Edit2 className="w-2.5 h-2.5 text-slate-400" />
                                </button>
                              )}
                            </div>

                            <span className="text-slate-400">· {p.unit}</span>

                            <span className="text-[11px] font-medium text-slate-500 font-mono">
                              (Araçta: {vehicleStock})
                            </span>
                          </div>
                        </div>

                        {/* Quantity selection */}
                        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleQuantityChange(p.id, qty - 1)}
                              className="w-11 h-11 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center text-base active:scale-95"
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
                              className="w-14 h-11 rounded-lg border border-slate-200 dark:border-slate-700 text-center font-bold font-mono text-sm dark:bg-slate-800 dark:text-white"
                            />
                            <button
                              type="button"
                              onClick={() => handleQuantityChange(p.id, qty + 1)}
                              className="w-11 h-11 rounded-lg bg-sky-50 dark:bg-sky-950 text-sky-600 font-bold flex items-center justify-center text-base active:scale-95"
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
                  })
                )}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* STEP 3: DELIVERY DETAILS, STOCK WARNING & PAYMENT              */}
          {/* ============================================================== */}
          {selectedCustomer && deliveredItems.length > 0 && (
            <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
              <label className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-sky-600 text-white text-[11px] flex items-center justify-center font-bold">3</span>
                <span>Teslimat & Tahsilat Detayları</span>
              </label>

              {/* Deposit Empties Returned */}
              {(deliveredDepositDamacana > 0 || deliveredDepositCamDamacana > 0 || deliveredDepositTup > 0) && (
                <div className="p-3.5 rounded-xl border border-orange-200 dark:border-orange-900/60 bg-orange-50/40 dark:bg-orange-950/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-orange-900 dark:text-orange-300 flex items-center gap-1.5">
                      <RotateCcw className="w-4 h-4 text-orange-600" />
                      <span>Müşteriden Alınan Boş Emanet Kaplar</span>
                    </span>
                    <span className="text-[11px] text-orange-700 dark:text-orange-400">
                      Bırakılan Dolu: {deliveredDepositDamacana} Damacana{deliveredDepositCamDamacana > 0 ? `, ${deliveredDepositCamDamacana} Cam Damacana` : ''}{deliveredDepositTup > 0 ? `, ${deliveredDepositTup} Tüp` : ''}
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

                    {deliveredDepositCamDamacana > 0 && (
                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-amber-100 dark:border-amber-800">
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          Alınan Boş Cam Damacana
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEmptyCamDamacanaReturned((prev) => Math.max(0, prev - 1))}
                            className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-700 text-xs font-bold"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            value={emptyCamDamacanaReturned}
                            onChange={(e) => setEmptyCamDamacanaReturned(parseInt(e.target.value) || 0)}
                            className="w-12 h-7 rounded border border-amber-200 text-center font-mono font-bold text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => setEmptyCamDamacanaReturned((prev) => prev + 1)}
                            className="w-7 h-7 rounded bg-amber-50 text-amber-600 text-xs font-bold"
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
                          ⚠️ <strong>{deliveredDepositDamacana - emptyDamacanaReturned} adet boş damacana eksik alındı.</strong> Müşterinin emanet boş borcuna işlenecektir.
                        </span>
                      ) : (
                        <span>
                          ℹ️ Müşteri fazladan <strong>{emptyDamacanaReturned - deliveredDepositDamacana} adet boş damacana teslim etti.</strong> Emanet borcundan düşülecektir.
                        </span>
                      )}
                    </div>
                  )}

                  {deliveredDepositCamDamacana - emptyCamDamacanaReturned !== 0 && (
                    <div className="text-[11px] text-amber-800 dark:text-amber-300">
                      {deliveredDepositCamDamacana - emptyCamDamacanaReturned > 0 ? (
                        <span>
                          ⚠️ <strong>{deliveredDepositCamDamacana - emptyCamDamacanaReturned} adet boş cam damacana eksik alındı.</strong> Müşterinin emanet boş cam damacana borcuna işlenecektir.
                        </span>
                      ) : (
                        <span>
                          ℹ️ Müşteri fazladan <strong>{emptyCamDamacanaReturned - deliveredDepositCamDamacana} adet boş cam damacana teslim etti.</strong> Emanet borcundan düşülecektir.
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Payment Section */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                    Tahsilat & Ödeme Durumu
                  </label>
                  <div className="text-right">
                    <span className="text-[11px] text-slate-500">Teslimat Tutarı:</span>
                    <span className="font-mono font-extrabold text-base text-slate-900 dark:text-white ml-1.5 tabular-nums">
                      {grandTotal.toLocaleString('tr-TR')} ₺
                    </span>
                  </div>
                </div>

                {/* Quick Payment Type Buttons */}
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
                    Tahsil Edilmedi (Borç / 0 ₺)
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

                {/* Payment Method Selector */}
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
                        POS (Kart)
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
                        Karma (Nakit+POS)
                      </button>
                    </div>

                    {/* Amount Inputs */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                      {(paymentMethod === 'CASH' || paymentMethod === 'MIXED') && (
                        <div>
                          <label className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 block mb-1">
                            Alınan Nakit (₺)
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

                {/* Balance impact summary */}
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
                          📋 Kalan <strong>{uncollectedDiff.toLocaleString('tr-TR')} ₺</strong>, müşterinin cari hesabına borç kaydedilecektir.
                        </span>
                      ) : (
                        <span>
                          ℹ️ Fazla alınan <strong>{Math.abs(uncollectedDiff).toLocaleString('tr-TR')} ₺</strong>, müşterinin cari bakiyesinden düşülecektir.
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
                  placeholder="Örn: 3. kat mutfağa bırakıldı, slip eklendi..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>
          )}
        </div>

        {/* Non-blocking alerts: always above the action bar so they cannot cover it */}
        {(errorMsg || showStockWarning) && (
          <div className="shrink-0 px-4 sm:px-5 pt-3 space-y-2 max-h-[35vh] overflow-y-auto">
            {errorMsg && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-semibold flex items-start gap-2"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="flex-1 break-words">{errorMsg}</span>
                <button
                  type="button"
                  onClick={() => {
                    setErrorPersistent(false);
                    setErrorMsg(null);
                  }}
                  className="min-w-11 min-h-11 -my-2 -mr-2 rounded-lg flex items-center justify-center shrink-0 hover:bg-red-100 dark:hover:bg-red-900/40"
                  aria-label="Hata mesajını kapat"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {showStockWarning && (
              <div
                role="status"
                aria-live="polite"
                onClick={() => setDismissedWarningSignature(stockWarningSignature)}
                className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-sm space-y-1 cursor-pointer"
              >
                <div className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="flex-1">Araç Stok Aşımı Uyarısı</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDismissedWarningSignature(stockWarningSignature);
                    }}
                    className="min-w-11 min-h-11 -my-2 -mr-2 rounded-lg flex items-center justify-center shrink-0 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                    aria-label="Uyarıyı kapat"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {stockWarnings.map((warning) => (
                  <p key={warning.productId} className="break-words">
                    ⚠️ <strong>{warning.productName}</strong> için girilen miktar ({warning.qty}), araçtaki yüklü stoğu ({warning.vehicleQty}) aşıyor. Teslimat kaydedilebilir ancak gün sonu sayımında dikkate alınacaktır.
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-slate-100 dark:border-slate-800 shrink-0 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 bg-slate-50/50 dark:bg-slate-900">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto min-h-11 px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 dark:text-slate-300 font-semibold text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            İptal
          </button>

          <button
            type="button"
            onClick={handleSubmitDelivery}
            disabled={isSubmitting || !selectedCustomer || deliveredItems.length === 0}
            className="w-full sm:w-auto sm:flex-1 min-h-12 px-6 py-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold text-sm shadow-md shadow-sky-600/20 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Check className="w-4 h-4 shrink-0" />
            <span className="break-words">
              {isSubmitting
                ? 'Kaydediliyor...'
                : !selectedCustomer
                ? 'Önce Müşteri Seçiniz'
                : deliveredItems.length === 0
                ? 'Ürün Seçiniz'
                : `Teslimatı Kaydet (${totalCollectedVal.toLocaleString('tr-TR')} ₺)`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
