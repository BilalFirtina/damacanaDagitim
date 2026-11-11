import React, { useState, useEffect, useRef } from "react";
import {
  Customer,
  Product,
  Dispatch,
  Delivery,
  User,
  ProductCategory,
  getProductCategoryCodes,
  getProductCategoryTitle,
  filterProductsBySearch,
  groupProductsByCategory,
} from "../../types";
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
  X,
  ChevronDown,
  ArrowRight,
} from "lucide-react";
import {
  createDelivery,
  createCustomer,
  createProduct,
  replaceDelivery,
  addCustomerDispenser,
} from "../../services/api";
import { CustomerDispenserInfo } from "../common/CustomerDispenserInfo";
import {
  computeStockWarnings,
  getStockWarningSignature,
  shouldShowStockWarning,
  STOCK_WARNING_DURATION_MS,
} from "../../services/stockWarning";
import { computeDeliveredDeposits } from "../../services/depositRules";
import { negativeEmptyMessages } from "../../services/emptyBalanceDisplay";
import {
  matchCustomerSearch,
  normalizeSearchText,
} from "../../services/searchText";

interface DeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  dispatch: Dispatch;
  currentUser: User;
  customers: Customer[];
  products: Product[];
  onDeliveryCreated: (delivery: any, updatedCustomer?: Customer) => void;
  onCustomerCreated?: (customer: Customer) => void;
  editDelivery?: Delivery | null;
  onDeliveryUpdated?: () => void;
}

type DepositKey =
  | "damacana"
  | "cam_damacana"
  | "tup_buyuk"
  | "tup_kucuk"
  | "sebil";

interface EmptyContainerRowProps {
  label: string;
  delivered: number;
  value: number;
  manual: boolean;
  onToggle: (manual: boolean) => void;
  onChange: (value: number) => void;
}

const EmptyContainerRow: React.FC<EmptyContainerRowProps> = ({
  label,
  delivered,
  value,
  manual,
  onToggle,
  onChange,
}) => {
  const normalize = (quantity: number) =>
    Math.max(0, Math.floor(Number(quantity) || 0));

  return (
    <div className="p-2.5 rounded-lg bg-white border border-orange-100 space-y-2 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-800 break-words">
            {label}
          </div>
          <div className="text-[10px] text-slate-500">
            Bırakılan dolu: {delivered}
          </div>
        </div>
        <label className="flex items-center gap-1.5 min-h-11 px-1 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={manual}
            onChange={(event) => onToggle(event.target.checked)}
            className="w-4 h-4 rounded border-orange-300 text-orange-600 focus:ring-orange-500"
          />
          <span className="text-[10px] font-bold text-orange-800">
            Manuel
          </span>
        </label>
      </div>

      {manual ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-semibold text-orange-700">
            Elle girilen miktar
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onChange(normalize(value - 1))}
              aria-label={`${label} azalt`}
              className="min-w-11 min-h-11 rounded-lg bg-slate-100 text-sm font-bold"
            >
              -
            </button>
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              aria-label={label}
              value={value}
              onChange={(event) =>
                onChange(normalize(event.target.valueAsNumber))
              }
              className="w-14 h-11 rounded-lg border border-orange-200 text-center font-mono font-bold text-sm"
            />
            <button
              type="button"
              onClick={() => onChange(normalize(value + 1))}
              aria-label={`${label} artır`}
              className="min-w-11 min-h-11 rounded-lg bg-orange-50 text-orange-600 text-sm font-bold"
            >
              +
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-500">
            Otomatik: dolu kadar
          </span>
          <span className="font-mono font-bold text-sm text-slate-800 tabular-nums">
            {value}
          </span>
        </div>
      )}
    </div>
  );
};

type DeliveryStepKey = "customer" | "products" | "empties" | "payment";

interface StepSectionProps {
  stepKey: DeliveryStepKey;
  step: number;
  title: string;
  summary?: React.ReactNode;
  isOpen: boolean;
  isComplete?: boolean;
  hasWarning?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  onToggle: () => void;
  children: React.ReactNode;
}

/**
 * Teslimat formunun tek açık kalan adım paneli.
 * Başlık her zaman dokunulabilir; kapalıyken tek satır özet gösterir.
 */
const StepSection: React.FC<StepSectionProps> = ({
  stepKey,
  step,
  title,
  summary,
  isOpen,
  isComplete = false,
  hasWarning = false,
  disabled = false,
  disabledHint,
  onToggle,
  children,
}) => {
  const contentId = `delivery-step-${stepKey}-content`;

  return (
    <section
      id={`delivery-step-${stepKey}`}
      className="rounded-xl border border-slate-200 bg-white scroll-mt-2"
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-controls={contentId}
        className={`w-full min-h-12 px-3 py-2.5 flex items-start gap-2.5 text-left transition-colors ${
          isOpen
            ? "bg-sky-50/70 rounded-t-xl"
            : "bg-white hover:bg-slate-50 rounded-xl"
        } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        <span
          className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${
            isComplete
              ? "bg-emerald-600 text-white"
              : isOpen
                ? "bg-sky-600 text-white"
                : "bg-slate-200 text-slate-600"
          }`}
        >
          {isComplete ? <Check className="w-3.5 h-3.5" /> : step}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-bold text-slate-900 uppercase tracking-wider break-words">
              {title}
            </span>
            {hasWarning && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0"
                title="Uyarı var"
              />
            )}
          </span>
          {!isOpen && (
            <span className="block text-[11px] text-slate-500 mt-0.5 break-words">
              {disabled && disabledHint ? disabledHint : summary}
            </span>
          )}
        </span>

        <ChevronDown
          className={`w-4 h-4 mt-0.5 shrink-0 text-slate-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div
          id={contentId}
          role="region"
          aria-label={title}
          className="p-3 space-y-3 border-t border-slate-100"
        >
          {children}
        </div>
      )}
    </section>
  );
};

export const DeliveryModal: React.FC<DeliveryModalProps> = ({
  isOpen,
  onClose,
  dispatch,
  currentUser,
  customers,
  products,
  onDeliveryCreated,
  onCustomerCreated,
  editDelivery,
  onDeliveryUpdated,
}) => {
  const isEdit = !!editDelivery;
  const initializedKeyRef = useRef<string | null>(null);
  const [openStep, setOpenStep] = useState<DeliveryStepKey | null>("customer");
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

  // Modal her açıldığında bir kez başlatılır. Arka plan yenilemeleri açık
  // formdaki kullanıcı girişlerini sıfırlamaz.
  useEffect(() => {
    const key = isOpen
      ? editDelivery
        ? `edit:${editDelivery.id}`
        : "new"
      : null;
    if (!key) {
      initializedKeyRef.current = null;
      return;
    }
    if (initializedKeyRef.current === key) return;
    initializedKeyRef.current = key;

    setOpenStep(editDelivery ? "products" : "customer");
    setShowNewCustomerForm(false);
    setCustomerSearch("");
    setProductSearch("");
    setErrorPersistent(false);
    setErrorMsg(null);
    setShowNewProductForm(false);

    if (editDelivery) {
      const customer =
        customers.find((c) => c.id === editDelivery.customerId) || null;
      setSelectedCustomer(customer);

      const quantitiesFromDelivery: Record<string, number> = {};
      const pricesFromDelivery: Record<string, number> = {};
      editDelivery.deliveredItems.forEach((item) => {
        quantitiesFromDelivery[item.productId] = item.quantity;
        pricesFromDelivery[item.productId] = item.unitPrice;
      });
      setQuantities(quantitiesFromDelivery);
      setUnitPrices(pricesFromDelivery);

      const editDelivered = computeDeliveredDeposits(
        editDelivery.deliveredItems,
        allProducts,
      );
      const editTupBuyuk =
        Number(editDelivery.emptyContainersReceived?.tupBuyuk) || 0;
      const editTupKucuk =
        Number(editDelivery.emptyContainersReceived?.tupKucuk) || 0;
      const editTupLegacy =
        Number(editDelivery.emptyContainersReceived?.tup) || 0;
      // Eski kayıtta boyut yoksa sayıyı büyük tüp kovasına koyarız; yeni
      // kayıtlarda iki boyut ayrı gelir.
      const resolvedTupBuyuk =
        editTupBuyuk || (editTupKucuk === 0 ? editTupLegacy : 0);
      const editReceived = {
        damacana: Number(editDelivery.emptyContainersReceived?.damacana) || 0,
        camDamacana:
          Number(
            editDelivery.emptyContainersReceived?.camDamacana ??
              editDelivery.emptyContainersReceived?.cam_damacana,
          ) || 0,
        tupBuyuk: resolvedTupBuyuk,
        tupKucuk: editTupKucuk,
        sebil: Number(editDelivery.emptyContainersReceived?.sebil) || 0,
      };
      setEmptyDamacanaReturned(editReceived.damacana);
      setEmptyCamDamacanaReturned(editReceived.camDamacana);
      setEmptyTupBuyukReturned(editReceived.tupBuyuk);
      setEmptyTupKucukReturned(editReceived.tupKucuk);
      setEmptySebilReturned(editReceived.sebil);
      setManualEmpty({
        damacana: editReceived.damacana !== editDelivered.damacana,
        cam_damacana: editReceived.camDamacana !== editDelivered.camDamacana,
        tup_buyuk:
          editReceived.tupBuyuk !== (Number(editDelivered.tupBuyuk) || 0),
        tup_kucuk:
          editReceived.tupKucuk !== (Number(editDelivered.tupKucuk) || 0),
        sebil: editReceived.sebil !== editDelivered.sebil,
      });

      const cash = Number(editDelivery.collectedPayment?.cashAmount) || 0;
      const pos = Number(editDelivery.collectedPayment?.posAmount) || 0;
      setPaymentType("custom");
      setPaymentMethod(
        cash > 0 && pos > 0 ? "MIXED" : pos > 0 ? "POS" : "CASH",
      );
      setCashAmountInput(String(cash));
      setPosAmountInput(String(pos));
      setNotes(editDelivery.notes || "");
      setCorrectionReason("");
      setReplacementId(
        `del_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      );
    } else {
      setSelectedCustomer(null);
      setQuantities({});
      setUnitPrices({});
      setEmptyDamacanaReturned(0);
      setEmptyCamDamacanaReturned(0);
      setEmptyTupBuyukReturned(0);
      setEmptyTupKucukReturned(0);
      setEmptySebilReturned(0);
      setSebilBrand("");
      setSebilModel("");
      setSebilNote("");
      setManualEmpty({
        damacana: false,
        cam_damacana: false,
        tup_buyuk: false,
        tup_kucuk: false,
        sebil: false,
      });
      setPaymentType("full");
      setPaymentMethod("CASH");
      setCashAmountInput("0");
      setPosAmountInput("0");
      setNotes("");
      setCorrectionReason("");
      setReplacementId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editDelivery]);

  // Step 1: Customer selection
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    null,
  );
  const [customerSearch, setCustomerSearch] = useState("");
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);

  // New customer inline inputs
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [newCustAddress, setNewCustAddress] = useState("");
  const [newCustEmails, setNewCustEmails] = useState("");
  const [newCustIsAccount, setNewCustIsAccount] = useState(true);

  // Step 2: Product search & selection
  const [productSearch, setProductSearch] = useState("");
  const [showNewProductForm, setShowNewProductForm] = useState(false);
  const [newProdName, setNewProdName] = useState("");
  const [newProdCategory, setNewProdCategory] =
    useState<ProductCategory>("damacana");
  const [newProdPrice, setNewProdPrice] = useState("120");
  const [newProdUnit, setNewProdUnit] = useState("Adet");
  const [newProdIsDeposit, setNewProdIsDeposit] = useState(true);
  const [newProdDepositType, setNewProdDepositType] = useState<
    | "none"
    | "damacana"
    | "cam_damacana"
    | "tup"
    | "tup_buyuk"
    | "tup_kucuk"
  >("damacana");

  // Quantities & Unit prices
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [unitPrices, setUnitPrices] = useState<Record<string, number>>({});
  const [editingPriceProductId, setEditingPriceProductId] = useState<
    string | null
  >(null);

  // Step 3: Empty containers returned
  const [emptyDamacanaReturned, setEmptyDamacanaReturned] = useState<number>(0);
  const [emptyCamDamacanaReturned, setEmptyCamDamacanaReturned] =
    useState<number>(0);
  const [emptyTupBuyukReturned, setEmptyTupBuyukReturned] = useState<number>(0);
  const [emptyTupKucukReturned, setEmptyTupKucukReturned] = useState<number>(0);
  const [emptySebilReturned, setEmptySebilReturned] = useState<number>(0);
  // Verilen sebilin marka/modeli ve bırakıldığı yer (AGENTS.md 7.1).
  const [sebilBrand, setSebilBrand] = useState("");
  const [sebilModel, setSebilModel] = useState("");
  const [sebilNote, setSebilNote] = useState("");
  const [manualEmpty, setManualEmpty] = useState<Record<DepositKey, boolean>>({
    damacana: false,
    cam_damacana: false,
    tup_buyuk: false,
    tup_kucuk: false,
    sebil: false,
  });

  // Payment
  const [paymentType, setPaymentType] = useState<"full" | "unpaid" | "custom">(
    "full",
  );
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "POS" | "MIXED">(
    "CASH",
  );
  const [cashAmountInput, setCashAmountInput] = useState<string>("0");
  const [posAmountInput, setPosAmountInput] = useState<string>("0");
  const [notes, setNotes] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [replacementId, setReplacementId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingCustomer, setIsSubmittingCustomer] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorPersistent, setErrorPersistent] = useState(false);
  const [dismissedWarningSignature, setDismissedWarningSignature] = useState<
    string | null
  >(null);
  const [warningExpiresAt, setWarningExpiresAt] = useState<number | null>(null);
  const [warningClock, setWarningClock] = useState(() => Date.now());

  const showTransientError = (message: string) => {
    setErrorPersistent(false);
    setErrorMsg(message);
  };

  const scrollToStep = (step: DeliveryStepKey) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .getElementById(`delivery-step-${step}`)
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    });
  };

  const openStepAndScroll = (step: DeliveryStepKey) => {
    setOpenStep(step);
    scrollToStep(step);
  };

  const toggleStep = (step: DeliveryStepKey) => {
    if (openStep === step) {
      setOpenStep(null);
      return;
    }
    openStepAndScroll(step);
  };

  useEffect(() => {
    if (!errorMsg || errorPersistent) return;
    const timeout = setTimeout(
      () => setErrorMsg(null),
      STOCK_WARNING_DURATION_MS,
    );
    return () => clearTimeout(timeout);
  }, [errorMsg, errorPersistent]);

  // When customer is selected, initialize prices with customer's custom prices or product defaults.
  // Faturalı müşteride önceki (özel) fiyat şoföre gösterilmez; güncel ürün
  // fiyatı esas alınır. Düzenlemede kaydedilmiş teslimat fiyatları korunur.
  useEffect(() => {
    if (isEdit) return;
    if (selectedCustomer) {
      const initialPrices: Record<string, number> = {};
      allProducts.forEach((p) => {
        initialPrices[p.id] = selectedCustomer.isAccountCustomer
          ? p.defaultUnitPrice
          : (selectedCustomer.customPrices?.[p.id] ?? p.defaultUnitPrice);
      });
      setUnitPrices(initialPrices);
    }
  }, [selectedCustomer, allProducts, isEdit]);

  // Faturalı müşteride tutar bilgisi yazılmadığı için "tam tahsilat" varsayılanı
  // kullanılmaz; şoför tahsilat aldıysa tutarı kendisi girer.
  useEffect(() => {
    if (isEdit || !selectedCustomer) return;
    setPaymentMethod("CASH");
    setCashAmountInput("0");
    setPosAmountInput("0");
    setPaymentType(selectedCustomer.isAccountCustomer ? "unpaid" : "full");
  }, [selectedCustomer?.id, selectedCustomer?.isAccountCustomer, isEdit]);

  // Delivered items calculation
  const deliveredItems = Object.entries(quantities)
    .filter(([_, q]) => q > 0)
    .map(([productId, quantity]) => {
      const p = allProducts.find((prod) => prod.id === productId)!;
      const unitPrice = unitPrices[productId] ?? p?.defaultUnitPrice ?? 100;
      return {
        productId,
        productName: p?.name || "Ürün",
        quantity,
        unitPrice,
        lineTotal: quantity * unitPrice,
      };
    });

  const grandTotal = deliveredItems.reduce(
    (acc, item) => acc + item.lineTotal,
    0,
  );
  const receivedEmptyTotal =
    emptyDamacanaReturned +
    emptyCamDamacanaReturned +
    emptyTupBuyukReturned +
    emptyTupKucukReturned +
    emptySebilReturned;
  const hasDeliveryContent =
    deliveredItems.length > 0 || receivedEmptyTotal > 0;
  const selectedNegativeEmptyMessages = selectedCustomer
    ? negativeEmptyMessages(selectedCustomer.emptyDepositBalance)
    : [];

  // Calculate delivered deposit items
  const deliveredDeposits = computeDeliveredDeposits(
    deliveredItems,
    allProducts,
  );
  const deliveredDepositDamacana = deliveredDeposits.damacana;
  const deliveredDepositCamDamacana = deliveredDeposits.camDamacana;
  const deliveredDepositTupBuyuk = Number(deliveredDeposits.tupBuyuk) || 0;
  const deliveredDepositTupKucuk = Number(deliveredDeposits.tupKucuk) || 0;
  const deliveredDepositSebil = deliveredDeposits.sebil;

  // Otomatik modda alınan boş kap, bırakılan dolu miktarını canlı takip eder.
  const syncAutomaticEmpties = (
    nextQuantities: Record<string, number>,
    productList: Product[] = allProducts,
  ) => {
    const deposits = computeDeliveredDeposits(
      Object.entries(nextQuantities).map(([productId, quantity]) => ({
        productId,
        quantity,
      })),
      productList,
    );
    if (!manualEmpty.damacana) {
      setEmptyDamacanaReturned(deposits.damacana);
    }
    if (!manualEmpty.cam_damacana) {
      setEmptyCamDamacanaReturned(deposits.camDamacana);
    }
    if (!manualEmpty.tup_buyuk) {
      setEmptyTupBuyukReturned(Number(deposits.tupBuyuk) || 0);
    }
    if (!manualEmpty.tup_kucuk) {
      setEmptyTupKucukReturned(Number(deposits.tupKucuk) || 0);
    }
    if (!manualEmpty.sebil) {
      setEmptySebilReturned(deposits.sebil);
    }
  };

  const handleQuantityChange = (productId: string, newQty: number) => {
    setQuantities((prev) => {
      const updated = {
        ...prev,
        [productId]: Math.max(0, Math.floor(Number(newQty) || 0)),
      };
      syncAutomaticEmpties(updated);
      return updated;
    });
  };

  // Sync payment inputs based on selected paymentType
  useEffect(() => {
    if (paymentType === "full") {
      if (paymentMethod === "CASH") {
        setCashAmountInput(grandTotal.toString());
        setPosAmountInput("0");
      } else if (paymentMethod === "POS") {
        setCashAmountInput("0");
        setPosAmountInput(grandTotal.toString());
      } else {
        const half = Math.floor(grandTotal / 2);
        setCashAmountInput(half.toString());
        setPosAmountInput((grandTotal - half).toString());
      }
    } else if (paymentType === "unpaid") {
      setCashAmountInput("0");
      setPosAmountInput("0");
    }
  }, [paymentType, paymentMethod, grandTotal]);

  const cashVal = Number(cashAmountInput) || 0;
  const posVal = Number(posAmountInput) || 0;
  const totalCollectedVal = cashVal + posVal;
  const uncollectedDiff = grandTotal - totalCollectedVal;

  const openNewCustomerForm = () => {
    const term = customerSearch.trim();
    if (term && !newCustName.trim()) {
      setNewCustName(term);
    }
    setShowNewCustomerForm(true);
  };

  const handleSelectCustomer = (customer: Customer) => {
    setSelectedCustomer(customer);
    setErrorPersistent(false);
    setErrorMsg(null);
    openStepAndScroll("products");
  };

  // New Customer submit
  const handleCreateNewCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingCustomer) return;
    if (!newCustName.trim()) {
      showTransientError("Lütfen müşteri adını giriniz");
      return;
    }

    const parsedEmails = newCustEmails
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0 && s.includes("@"));

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
      setAllCustomers((prev) =>
        prev.some((c) => c.id === created.id) ? prev : [...prev, created],
      );
      onCustomerCreated?.(created);
      // Automatically select created customer and proceed to product selection
      handleSelectCustomer(created);
      setCustomerSearch(created.name);
      setShowNewCustomerForm(false);
      setNewCustName("");
      setNewCustPhone("");
      setNewCustAddress("");
      setNewCustEmails("");
    } catch (err: any) {
      setErrorPersistent(true);
      setErrorMsg(err.message || "Müşteri oluşturulamadı");
    } finally {
      setIsSubmittingCustomer(false);
    }
  };

  // New Product submit
  const handleCreateNewProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProdName.trim()) {
      showTransientError("Lütfen ürün adını giriniz");
      return;
    }

    try {
      setErrorPersistent(false);
      setErrorMsg(null);
      const created = await createProduct({
        name: newProdName.trim(),
        category: newProdCategory,
        defaultUnitPrice: Number(newProdPrice) || 100,
        unit: newProdUnit.trim() || "Adet",
        isDeposit: newProdIsDeposit,
        depositType: newProdIsDeposit ? newProdDepositType : "none",
      });

      // Update local product list and auto-select product with quantity 1
      const nextProducts = [...allProducts, created];
      setAllProducts(nextProducts);
      setQuantities((prev) => {
        const updated = { ...prev, [created.id]: 1 };
        syncAutomaticEmpties(updated, nextProducts);
        return updated;
      });
      setUnitPrices((prev) => ({
        ...prev,
        [created.id]: created.defaultUnitPrice,
      }));
      setShowNewProductForm(false);
      setNewProdName("");
      setProductSearch("");
    } catch (err: any) {
      setErrorPersistent(true);
      setErrorMsg(err.message || "Ürün oluşturulamadı");
    }
  };

  // Submit Delivery
  const handleSubmitDelivery = async () => {
    if (!selectedCustomer) {
      openStepAndScroll("customer");
      showTransientError("Lütfen önce bir müşteri seçiniz");
      return;
    }
    if (!hasDeliveryContent) {
      openStepAndScroll("products");
      showTransientError(
        "Teslimat için en az bir ürün veya müşteriden alınan boş kap girilmelidir.",
      );
      return;
    }
    if (isEdit && correctionReason.trim().length < 3) {
      setErrorPersistent(true);
      setErrorMsg("Düzenleme için en az 3 karakterlik bir gerekçe girin.");
      window.requestAnimationFrame(() => {
        const reasonEl = document.getElementById(
          "delivery-correction-reason",
        );
        reasonEl?.scrollIntoView({ block: "center", behavior: "smooth" });
        reasonEl?.focus();
      });
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorPersistent(false);
      setErrorMsg(null);

      const collectedPayment = {
        method:
          paymentType === "unpaid"
            ? "UNPAID"
            : cashVal > 0 && posVal > 0
              ? "MIXED"
              : posVal > 0
                ? "POS"
                : "CASH",
        cashAmount: cashVal,
        posAmount: posVal,
        totalCollected: totalCollectedVal,
      };
      const emptyContainersReceived = {
        damacana: emptyDamacanaReturned,
        camDamacana: emptyCamDamacanaReturned,
        tup: emptyTupBuyukReturned + emptyTupKucukReturned,
        tupBuyuk: emptyTupBuyukReturned,
        tupKucuk: emptyTupKucukReturned,
        sebil: emptySebilReturned,
      };

      if (isEdit && editDelivery) {
        const rid =
          replacementId ||
          `del_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        if (!replacementId) setReplacementId(rid);
        await replaceDelivery(editDelivery.id, rid, correctionReason.trim(), {
          deliveredItems,
          collectedPayment,
          emptyContainersReceived,
          notes: notes.trim(),
        });
        onDeliveryUpdated?.();
        onClose();
        return;
      }

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
        collectedPayment,
        emptyContainersReceived,
        notes: notes.trim(),
      };

      const result = await createDelivery(payload);

      // Sebil emanet detayı: marka, model veya açıklamadan en az biri girildiyse kaydet.
      if (
        deliveredDepositSebil > 0 &&
        (sebilBrand.trim() || sebilModel.trim() || sebilNote.trim())
      ) {
        try {
          await addCustomerDispenser(selectedCustomer.id, {
            brand: sebilBrand.trim(),
            model: sebilModel.trim(),
            quantity: deliveredDepositSebil,
            note: sebilNote.trim() || null,
          });
        } catch (dispenserErr) {
          // Teslimat kaydı başarılı; detay kaydı başarısızsa kullanıcı bilgilendirilir.
          console.error("[delivery dispenser detail]", dispenserErr);
        }
      }

      onDeliveryCreated(result.delivery, result.updatedCustomer);
      onClose();
    } catch (err: any) {
      setErrorPersistent(true);
      setErrorMsg(
        err.message ||
          (isEdit ? "Teslimat düzenlenemedi" : "Teslimat kaydedilemedi"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const stockWarnings = computeStockWarnings(
    deliveredItems,
    dispatch.loadedItems,
  );
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
      STOCK_WARNING_DURATION_MS + 50,
    );
    return () => clearTimeout(timeout);
  }, [stockWarningSignature]);

  const showStockWarning = shouldShowStockWarning({
    warnings: stockWarnings,
    dismissedSignature: dismissedWarningSignature,
    expiresAt: warningExpiresAt,
    now: warningClock,
  });

  const totalQuantity = deliveredItems.reduce(
    (acc, item) => acc + item.quantity,
    0,
  );

  const paymentMethodLabel =
    cashVal > 0 && posVal > 0
      ? "Karma"
      : posVal > 0
        ? "POS"
        : "Nakit";

  const receivedEmptyParts: string[] = [];
  if (emptyDamacanaReturned > 0) {
    receivedEmptyParts.push(`${emptyDamacanaReturned} damacana`);
  }
  if (emptyCamDamacanaReturned > 0) {
    receivedEmptyParts.push(`${emptyCamDamacanaReturned} cam damacana`);
  }
  if (emptyTupBuyukReturned > 0) {
    receivedEmptyParts.push(`${emptyTupBuyukReturned} büyük tüp`);
  }
  if (emptyTupKucukReturned > 0) {
    receivedEmptyParts.push(`${emptyTupKucukReturned} küçük tüp`);
  }
  if (emptySebilReturned > 0) {
    receivedEmptyParts.push(`${emptySebilReturned} sebil`);
  }
  const emptiesSummaryText =
    receivedEmptyParts.length > 0
      ? `Alınan: ${receivedEmptyParts.join(", ")}`
      : "Boş kap alınmadı";

  const emptyShortageParts: string[] = [];
  if (deliveredDepositDamacana - emptyDamacanaReturned > 0) {
    emptyShortageParts.push(
      `${deliveredDepositDamacana - emptyDamacanaReturned} damacana`,
    );
  }
  if (deliveredDepositCamDamacana - emptyCamDamacanaReturned > 0) {
    emptyShortageParts.push(
      `${deliveredDepositCamDamacana - emptyCamDamacanaReturned} cam damacana`,
    );
  }
  if (deliveredDepositTupBuyuk - emptyTupBuyukReturned > 0) {
    emptyShortageParts.push(
      `${deliveredDepositTupBuyuk - emptyTupBuyukReturned} büyük tüp`,
    );
  }
  if (deliveredDepositTupKucuk - emptyTupKucukReturned > 0) {
    emptyShortageParts.push(
      `${deliveredDepositTupKucuk - emptyTupKucukReturned} küçük tüp`,
    );
  }
  const emptyShortageText =
    emptyShortageParts.length > 0
      ? `${emptyShortageParts.join(", ")} eksik`
      : null;

  const paymentSummaryText = (() => {
    if (!selectedCustomer) return "Müşteri seçilince aktive olur";
    if (selectedCustomer.isAccountCustomer) {
      return totalCollectedVal > 0
        ? `${totalCollectedVal.toLocaleString("tr-TR")} ₺ tahsil edildi • ${paymentMethodLabel}`
        : "Tahsilat alınmadı";
    }
    if (paymentType === "unpaid") return "Tahsilat alınmadı • borç";
    if (grandTotal === 0 && totalCollectedVal === 0) {
      return "Tahsilat gerekmiyor";
    }
    if (paymentType === "full") {
      return `Tam tahsilat: ${grandTotal.toLocaleString("tr-TR")} ₺ • ${paymentMethodLabel}`;
    }
    const parts = [
      `${totalCollectedVal.toLocaleString("tr-TR")} ₺ alındı`,
    ];
    if (uncollectedDiff > 0) {
      parts.push(
        `${uncollectedDiff.toLocaleString("tr-TR")} ₺ borç`,
      );
    } else if (uncollectedDiff < 0) {
      parts.push(
        `${Math.abs(uncollectedDiff).toLocaleString("tr-TR")} ₺ fazla`,
      );
    }
    parts.push(paymentMethodLabel);
    return parts.join(" • ");
  })();

  const stepSubtitle = isEdit
    ? "Müşteri sabit. Ürün, boş kap ve tahsilat düzeltilebilir."
    : !selectedCustomer
      ? "Adım 1/4 — Önce teslimat yapılacak müşteriyi seçin"
      : openStep === "customer"
        ? "Adım 1/4 — Müşteriyi değiştirebilirsiniz"
        : openStep === "products"
          ? "Adım 2/4 — Teslim edilecek ürünleri girin"
          : openStep === "empties"
            ? "Adım 3/4 — Boş kap iadelerini kontrol edin"
            : openStep === "payment"
              ? "Adım 4/4 — Tahsilat ve notları girin"
              : "Adım seçin veya kaydetmeye devam edin";

  const isSubmitReady =
    !!selectedCustomer &&
    hasDeliveryContent &&
    (!isEdit || correctionReason.trim().length >= 3);

  if (!isOpen) return null;

  // Filter customers
  const normalizedCustomerSearch = normalizeSearchText(customerSearch);
  const filteredCustomers = allCustomers.filter((c) =>
    matchCustomerSearch(c, normalizedCustomerSearch),
  );

  // Filter products for Step 2
  const filteredProducts = filterProductsBySearch(allProducts, productSearch);
  const groupedProducts = groupProductsByCategory(filteredProducts);

  // Stock check helper: find loaded qty on vehicle
  const getVehicleStock = (productId: string) => {
    const item = dispatch.loadedItems.find((i) => i.productId === productId);
    return item ? item.quantity : 0;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-2xl min-w-0 rounded-2xl bg-white shadow-2xl border border-slate-200 my-auto max-h-[calc(94dvh-env(safe-area-inset-bottom))] sm:max-h-[94vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100  shrink-0">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900  flex items-center gap-2 flex-wrap">
              <span>
                {isEdit ? "Teslimatı Düzenle" : "Yeni Teslimat Girişi"}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-md bg-sky-100 text-sky-800   font-mono font-bold">
                {dispatch.vehiclePlate}
              </span>
            </h2>
            <p className="text-xs text-slate-500">{stepSubtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="min-w-11 min-h-11 p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100  flex items-center justify-center shrink-0"
            aria-label="Teslimat penceresini kapat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3 sm:space-y-4 flex-1 min-h-0">
          {isEdit && (
            <div className="p-3.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs space-y-2">
              <p className="font-bold">
                Eski teslimat iptal edilip yenisi oluşturulacak.
              </p>
              <p>
                Cari bakiye ve boş kap bakiyeleri net fark kadar düzeltilir.
                İşlem değiştirilemez denetim kaydına yazılır.
              </p>
              <div>
                <label className="text-xs font-bold text-amber-800 block mb-1">
                  Düzenleme Gerekçesi *
                </label>
                <textarea
                  id="delivery-correction-reason"
                  required
                  minLength={3}
                  rows={2}
                  placeholder="Örn: Müşteriye 2 adet yerine 3 adet teslim edilmiş."
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-amber-300 text-xs bg-white text-slate-900 resize-y"
                />
                <p className="text-[11px] text-amber-800/80 mt-1">
                  En az 3 karakter. Gerekçe denetim kaydında saklanır.
                </p>
              </div>
            </div>
          )}

          {/* STEP 1: CUSTOMER */}
          <StepSection
            stepKey="customer"
            step={1}
            title="Müşteri"
            isOpen={openStep === "customer"}
            isComplete={!!selectedCustomer}
            onToggle={() => {
              if (!selectedCustomer) {
                setOpenStep("customer");
                return;
              }
              toggleStep("customer");
            }}
            summary={
              selectedCustomer ? (
                <span className="flex min-w-0 flex-col items-start gap-1">
                  <span className="font-semibold text-slate-700 break-words">
                    {selectedCustomer.name}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        selectedCustomer.isAccountCustomer
                          ? "text-sky-700 bg-sky-100"
                          : "text-red-700 bg-red-100"
                      }`}
                    >
                      {selectedCustomer.isAccountCustomer
                        ? "Faturalı"
                        : "Peşin"}
                    </span>
                    {!selectedCustomer.isAccountCustomer &&
                      selectedCustomer.currentBalanceTL > 0 && (
                        <span className="font-mono font-semibold text-red-600">
                          {selectedCustomer.currentBalanceTL.toLocaleString(
                            "tr-TR",
                          )}{" "}
                          ₺ borç
                        </span>
                      )}
                    {!selectedCustomer.isAccountCustomer &&
                      selectedCustomer.currentBalanceTL < 0 && (
                        <span className="font-mono font-semibold text-emerald-700">
                          {Math.abs(
                            selectedCustomer.currentBalanceTL,
                          ).toLocaleString("tr-TR")}{" "}
                          ₺ alacaklı
                        </span>
                      )}
                  </span>
                </span>
              ) : (
                "Teslimat yapılacak müşteriyi seçin"
              )
            }
          >
            {!selectedCustomer ? (
              <div className="space-y-2.5">
                <div className="sticky top-0 z-10 -mx-3 px-3 py-2 bg-white/95 backdrop-blur-sm border-b border-slate-100">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      autoFocus
                      placeholder="Müşteri adı veya telefon ile ara..."
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200  bg-slate-50  text-xs text-slate-900  focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                    />
                  </div>
                </div>

                {/* Inline New Customer Form */}
                {showNewCustomerForm && (
                  <form
                    onSubmit={handleCreateNewCustomer}
                    className="p-3.5 rounded-xl border border-sky-200  bg-sky-50/50  space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-sky-900 ">
                        Yeni Müşteri Kaydı
                      </span>
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
                        className="p-2.5 rounded-lg border border-slate-200  bg-white  text-slate-900  font-semibold"
                      />
                      <input
                        type="text"
                        placeholder="Telefon Numarası"
                        value={newCustPhone}
                        onChange={(e) => setNewCustPhone(e.target.value)}
                        className="p-2.5 rounded-lg border border-slate-200  bg-white  text-slate-900 "
                      />
                      <input
                        type="text"
                        placeholder="Adres / Cadde / Kat"
                        value={newCustAddress}
                        onChange={(e) => setNewCustAddress(e.target.value)}
                        className="p-2.5 rounded-lg border border-slate-200  bg-white  text-slate-900  sm:col-span-2"
                      />
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-2 text-xs text-slate-700  cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!newCustIsAccount}
                          onChange={(e) =>
                            setNewCustIsAccount(!e.target.checked)
                          }
                          className="rounded text-sky-600 focus:ring-sky-500 w-4 h-4"
                        />
                        <span>Peşin Müşteri</span>
                      </label>
                      <button
                        type="submit"
                        disabled={isSubmittingCustomer}
                        className="min-h-11 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isSubmittingCustomer
                          ? "Kaydediliyor..."
                          : "Kaydet & Seç"}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500">
                      Tahsilat şoför arkadaşlar tarafından yapılacaksa bu kutucuğu işaretleyin,
                      eğer fatura toplu kesilecekse kutucuğa tıklamayın.
                    </p>
                  </form>
                )}

                {/* Customer search list */}
                <div className="space-y-1.5 border border-slate-100 rounded-xl p-1 bg-slate-50/50">
                  {filteredCustomers.length === 0 ? (
                    showNewCustomerForm ? null : (
                      <div className="p-4 text-center text-xs text-slate-400 space-y-2">
                        <p>Aramaya uygun kayıtlı müşteri bulunamadı.</p>
                        <button
                          type="button"
                          onClick={openNewCustomerForm}
                          className="min-h-11 px-3 py-2 rounded-lg bg-sky-100 text-sky-700 font-semibold text-xs inline-flex items-center gap-1"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>
                            {customerSearch.trim()
                              ? `"${customerSearch.trim()}" Adıyla Yeni Müşteri Ekle`
                              : 'Yeni Müşteri Ekle'}
                          </span>
                        </button>
                      </div>
                    )
                  ) : (
                    filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectCustomer(c)}
                        className="w-full text-left p-2.5 rounded-xl hover:bg-white transition-colors flex items-center justify-between border border-transparent hover:border-slate-200 shadow-2xs"
                      >
                        <div className="space-y-0.5 min-w-0 flex-1">
                          <div className="flex flex-col items-start gap-1 min-w-0">
                            <span className="text-xs font-bold text-slate-900 break-words">
                              {c.name}
                            </span>
                            {c.isAccountCustomer ? (
                              <span className="text-[10px] font-semibold text-sky-700 bg-sky-50 px-1.5 py-0.2 rounded">
                                Faturalı
                              </span>
                            ) : (
                              <span className="text-[10px] font-semibold text-red-700 bg-red-50 px-1.5 py-0.2 rounded">
                                Peşin
                              </span>
                            )}
                          </div>
                          {c.phone && (
                            <div className="text-[10px] text-slate-400 font-mono">
                              📞 {c.phone}
                            </div>
                          )}
                          <div className="text-[11px] text-slate-500 break-words line-clamp-2">
                            {c.address || "Adres bilgisi yok"}
                          </div>
                        </div>

                        <div className="text-right min-w-0 max-w-[45%]">
                          {!c.isAccountCustomer && c.currentBalanceTL > 0 && (
                            <div className="text-[11px] font-mono font-bold text-red-600">
                              {c.currentBalanceTL.toLocaleString("tr-TR")} ₺
                              Borç
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
                          {(c.emptyDepositBalance?.sebil || 0) > 0 && (
                            <div className="text-[10px] font-semibold text-indigo-700 ">
                              {c.emptyDepositBalance?.sebil} Sebil
                            </div>
                          )}
                          {negativeEmptyMessages(c.emptyDepositBalance).map(
                            (message) => (
                              <div
                                key={message}
                                className="text-[10px] font-semibold text-sky-700 "
                              >
                                ℹ️ {message}
                              </div>
                            ),
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              /* Selected Customer Card */
              <div className="p-3.5 rounded-xl border-2 border-sky-500/40 bg-sky-50/40  flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2 min-w-0">
                    <Building2 className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                    <div className="flex flex-col items-start gap-1 min-w-0">
                      <span className="text-sm font-bold text-slate-900 break-words">
                        {selectedCustomer.name}
                      </span>
                      {selectedCustomer.isAccountCustomer ? (
                        <span className="text-[10px] font-bold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded">
                          Faturalı Müşteri
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
                          Peşin Müşteri
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px] text-slate-600 ">
                    {selectedCustomer.phone && (
                      <span className="flex items-center gap-1 font-mono">
                        <Phone className="w-3 h-3 text-slate-400" />
                        {selectedCustomer.phone}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      {selectedCustomer.address || "Adres yok"}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {selectedNegativeEmptyMessages.map((message) => (
                      <span
                        key={message}
                        className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-sky-100 text-sky-800  "
                      >
                        ℹ️ {message}
                      </span>
                    ))}

                    {(selectedCustomer.emptyDepositBalance?.damacana > 0 ||
                      selectedCustomer.emptyDepositBalance?.camDamacana > 0 ||
                      selectedCustomer.emptyDepositBalance?.tup > 0 ||
                      (selectedCustomer.emptyDepositBalance?.tupBuyuk || 0) > 0 ||
                      (selectedCustomer.emptyDepositBalance?.tupKucuk || 0) > 0) && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-orange-100 text-orange-800  ">
                        Müşteride Kalan Boş:{" "}
                        {selectedCustomer.emptyDepositBalance?.damacana || 0}{" "}
                        Damacana
                        {selectedCustomer.emptyDepositBalance?.camDamacana > 0
                          ? `, ${selectedCustomer.emptyDepositBalance.camDamacana} Cam Damacana`
                          : ""}
                        {(selectedCustomer.emptyDepositBalance?.tupBuyuk || 0) > 0
                          ? `, ${selectedCustomer.emptyDepositBalance.tupBuyuk} Büyük Tüp`
                          : ""}
                        {(selectedCustomer.emptyDepositBalance?.tupKucuk || 0) > 0
                          ? `, ${selectedCustomer.emptyDepositBalance.tupKucuk} Küçük Tüp`
                          : ""}
                        {selectedCustomer.emptyDepositBalance?.tup > 0
                          ? `, ${selectedCustomer.emptyDepositBalance.tup} Tüp`
                          : ""}
                        {(selectedCustomer.emptyDepositBalance?.sebil || 0) > 0
                          ? `, ${selectedCustomer.emptyDepositBalance?.sebil} Sebil`
                          : ""}
                      </span>
                    )}

                    {!selectedCustomer.isAccountCustomer &&
                      selectedCustomer.currentBalanceTL !== 0 && (
                      <span
                        className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md ${
                          selectedCustomer.currentBalanceTL > 0
                            ? "bg-red-100 text-red-800  "
                            : "bg-emerald-100 text-emerald-800  "
                        }`}
                      >
                        {selectedCustomer.currentBalanceTL > 0
                          ? `Önceki Borcu: ${selectedCustomer.currentBalanceTL.toLocaleString("tr-TR")} ₺`
                          : `Alacağı: ${Math.abs(selectedCustomer.currentBalanceTL).toLocaleString("tr-TR")} ₺`}
                      </span>
                    )}
                  </div>
                </div>

                {!isEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCustomer(null);
                      openStepAndScroll("customer");
                    }}
                    className="min-h-11 px-3 py-2 rounded-lg border border-sky-300 text-sky-700 hover:bg-sky-100 text-xs font-semibold shrink-0"
                  >
                    Değiştir
                  </button>
                )}
              </div>
            )}
          </StepSection>

          {selectedCustomer && (
            <CustomerDispenserInfo customerId={selectedCustomer.id} />
          )}

          {/* STEP 2: PRODUCTS */}
          <StepSection
            stepKey="products"
            step={2}
            title="Ürünler"
            isOpen={!!selectedCustomer && openStep === "products"}
            isComplete={deliveredItems.length > 0}
            disabled={!selectedCustomer}
            disabledHint="Önce müşteri seçin"
            onToggle={() => toggleStep("products")}
            summary={
              deliveredItems.length > 0
                ? `${deliveredItems.length} kalem • ${totalQuantity} adet${
                    !selectedCustomer?.isAccountCustomer
                      ? ` • ${grandTotal.toLocaleString("tr-TR")} ₺`
                      : ""
                  }`
                : "Teslim edilecek ürün seçilmedi"
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500">
                Ürün adına göre arayın, adet girin.
              </span>
              {currentUser.role === "admin" && (
                <button
                  type="button"
                  onClick={() => setShowNewProductForm(!showNewProductForm)}
                  className="min-h-11 px-2 -mr-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Yeni Ürün Ekle</span>
                </button>
              )}
            </div>

            {/* Product search box */}
            <div className="sticky top-0 z-10 -mx-3 px-3 py-2 bg-white/95 backdrop-blur-sm border-b border-slate-100">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Ürün adı ile ara (Damacana, Tüp, Pet su vb.)..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                />
              </div>
            </div>

              {/* Inline New Product Form */}
              {currentUser.role === "admin" && showNewProductForm && (
                <form
                  onSubmit={handleCreateNewProduct}
                  className="p-3.5 rounded-xl border border-indigo-200  bg-indigo-50/50  space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-900 ">
                      Hızlı Yeni Ürün Tanımla
                    </span>
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
                      className="p-2 rounded-lg border border-slate-200  bg-white  text-slate-900  sm:col-span-2"
                    />
                    <select
                      value={newProdCategory}
                      onChange={(e) =>
                        setNewProdCategory(e.target.value as ProductCategory)
                      }
                      className="p-2 rounded-lg border border-slate-200  bg-white  text-slate-900 "
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
                      className="p-2 rounded-lg border border-slate-200  bg-white  text-slate-900  font-mono font-bold"
                    />
                    <input
                      type="text"
                      placeholder="Birim (Örn: Adet, Koli)"
                      value={newProdUnit}
                      onChange={(e) => setNewProdUnit(e.target.value)}
                      className="p-2 rounded-lg border border-slate-200  bg-white  text-slate-900 "
                    />
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newProdIsDeposit}
                          onChange={(e) =>
                            setNewProdIsDeposit(e.target.checked)
                          }
                          className="rounded text-indigo-600 w-4 h-4"
                        />
                        <span>İadeli Boş Kap</span>
                      </label>
                    </div>
                    {newProdIsDeposit && (
                      <select
                        value={newProdDepositType}
                        onChange={(e) =>
                          setNewProdDepositType(
                            e.target.value as
                              | "none"
                              | "damacana"
                              | "cam_damacana"
                              | "tup"
                              | "tup_buyuk"
                              | "tup_kucuk",
                          )
                        }
                        className="p-2 rounded-lg border border-slate-200  bg-white  text-slate-900  sm:col-span-3"
                      >
                        <option value="damacana">
                          🔄 Boş Damacana İadesi Zorunlu
                        </option>
                        <option value="cam_damacana">
                          🔄 Boş Cam Damacana İadesi Zorunlu
                        </option>
                        <option value="tup_buyuk">
                          🔥 Büyük Tüp İadesi Zorunlu
                        </option>
                        <option value="tup_kucuk">
                          🔥 Küçük Tüp İadesi Zorunlu
                        </option>
                        <option value="tup">
                          🔥 Tüp (genel / eski kayıt)
                        </option>
                      </select>
                    )}
                  </div>
                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      className="min-h-11 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-sm"
                    >
                      Ürünü Kaydet & Teslimata Ekle
                    </button>
                  </div>
                </form>
              )}

              {/* Product selection cards */}
              <div className="space-y-2">
                {filteredProducts.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400 space-y-2">
                    <p>Aranan isimde ürün bulunamadı.</p>
                    <button
                      type="button"
                      onClick={() => setShowNewProductForm(true)}
                      className="min-h-11 px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 font-semibold text-xs inline-flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>"{productSearch}" Ürününü Şimdi Ekle</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {groupedProducts.map((group) => (
                      <div key={group.code} className="space-y-2">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          {group.title}
                        </div>
                        {group.products.map((p) => {
                    const qty = quantities[p.id] || 0;
                    const unitPrice = unitPrices[p.id] ?? p.defaultUnitPrice;
                    const lineTotal = qty * unitPrice;
                    const vehicleStock = getVehicleStock(p.id);
                    const isEditingPrice = editingPriceProductId === p.id;
                    // Faturalı müşteride önceki özel fiyat bilgisi gösterilmez.
                    const isCustomerSpecific =
                      !selectedCustomer?.isAccountCustomer &&
                      selectedCustomer?.customPrices?.[p.id] !== undefined;

                    return (
                      <div
                        key={p.id}
                        className={`p-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                          qty > 0
                            ? "border-sky-400 bg-sky-50/30   shadow-2xs"
                            : "border-slate-100  bg-slate-50/50 "
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold text-slate-900  flex items-center gap-1.5">
                            <span>{p.name}</span>
                            {isCustomerSpecific && (
                              <span className="text-[10px] text-sky-700 font-medium bg-sky-100  px-1 py-0.2 rounded">
                                Müşteriye Özel Fiyat
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 mt-1 text-xs">
                            {!selectedCustomer?.isAccountCustomer && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-500">
                                  Birim Fiyat:
                                </span>
                                {isEditingPrice ? (
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="number"
                                      value={unitPrice}
                                      onChange={(e) =>
                                        setUnitPrices((prev) => ({
                                          ...prev,
                                          [p.id]: Math.max(
                                            0,
                                            parseFloat(e.target.value) || 0,
                                          ),
                                        }))
                                      }
                                      className="w-16 h-6 rounded border border-sky-400 font-mono font-bold text-center text-xs bg-white "
                                      autoFocus
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEditingPriceProductId(null)
                                      }
                                      className="p-1 rounded bg-sky-600 text-white"
                                    >
                                      <Check className="w-3 h-3" />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setEditingPriceProductId(p.id)}
                                    className="flex items-center gap-1 font-mono font-bold text-slate-800  hover:text-sky-600"
                                    title="Fiyatı Düzenle"
                                  >
                                    <span>{unitPrice} ₺</span>
                                    <Edit2 className="w-2.5 h-2.5 text-slate-400" />
                                  </button>
                                )}
                              </div>
                            )}

                            <span className="text-slate-400">· {p.unit}</span>

                            <span className="text-[11px] font-medium text-slate-500 font-mono">
                              (Araçta: {vehicleStock})
                            </span>
                          </div>
                        </div>

                        {/* Quantity selection */}
                        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 shrink-0">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                handleQuantityChange(p.id, qty - 1)
                              }
                              className="w-11 h-11 rounded-lg bg-white  border border-slate-200  font-bold text-slate-700  flex items-center justify-center text-base active:scale-95"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              value={qty === 0 ? "" : qty}
                              onChange={(e) =>
                                handleQuantityChange(
                                  p.id,
                                  parseInt(e.target.value) || 0,
                                )
                              }
                              placeholder="0"
                              className="w-14 h-11 rounded-lg border border-slate-200  text-center font-bold font-mono text-sm  "
                            />
                            <button
                              type="button"
                              onClick={() =>
                                handleQuantityChange(p.id, qty + 1)
                              }
                              className="w-11 h-11 rounded-lg bg-sky-50  text-sky-600 font-bold flex items-center justify-center text-base active:scale-95"
                            >
                              +
                            </button>
                          </div>

                          <div className="w-20 text-right">
                            {selectedCustomer?.isAccountCustomer ? (
                              <span className="text-[10px] text-slate-400">
                                FATURALI
                              </span>
                            ) : (
                              <span className="font-mono font-bold text-xs tabular-nums text-slate-900 ">
                                {lineTotal > 0
                                  ? `${lineTotal.toLocaleString("tr-TR")} ₺`
                                  : "-"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => openStepAndScroll("empties")}
                className="w-full min-h-11 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.99]"
              >
                <span>Devam: Boş Kap İadesi</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>
          </StepSection>

          {/* STEP 3: EMPTY CONTAINERS */}
          <StepSection
            stepKey="empties"
            step={3}
            title="Boş Kap İadesi"
            isOpen={!!selectedCustomer && openStep === "empties"}
            hasWarning={!!emptyShortageText}
            disabled={!selectedCustomer}
            disabledHint="Önce müşteri seçin"
            onToggle={() => toggleStep("empties")}
            summary={
              <span className="inline-flex flex-wrap items-center gap-x-1.5">
                <span>{emptiesSummaryText}</span>
                {emptyShortageText && (
                  <span className="font-semibold text-orange-700">
                    • {emptyShortageText}
                  </span>
                )}
              </span>
            }
          >
            {/* Deposit Empties Returned */}
              <div className="p-3.5 rounded-xl border border-orange-200 bg-orange-50/40 space-y-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs font-bold text-orange-900  flex items-center gap-1.5">
                    <RotateCcw className="w-4 h-4 text-orange-600" />
                    <span>Müşteriden Alınan Boş Emanet Kaplar</span>
                  </span>
                  <span className="text-[11px] text-orange-700 ">
                    Bırakılan Dolu: {deliveredDepositDamacana} Damacana
                    {deliveredDepositCamDamacana > 0
                      ? `, ${deliveredDepositCamDamacana} Cam Damacana`
                      : ""}
                    {deliveredDepositTupBuyuk > 0
                      ? `, ${deliveredDepositTupBuyuk} Büyük Tüp`
                      : ""}
                    {deliveredDepositTupKucuk > 0
                      ? `, ${deliveredDepositTupKucuk} Küçük Tüp`
                      : ""}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <EmptyContainerRow
                    label="Alınan Boş Damacana"
                    delivered={deliveredDepositDamacana}
                    value={emptyDamacanaReturned}
                    manual={manualEmpty.damacana}
                    onToggle={(manual) => {
                      setManualEmpty((prev) => ({ ...prev, damacana: manual }));
                      if (!manual) {
                        setEmptyDamacanaReturned(deliveredDepositDamacana);
                      }
                    }}
                    onChange={setEmptyDamacanaReturned}
                  />
                  <EmptyContainerRow
                    label="Alınan Boş Cam Damacana"
                    delivered={deliveredDepositCamDamacana}
                    value={emptyCamDamacanaReturned}
                    manual={manualEmpty.cam_damacana}
                    onToggle={(manual) => {
                      setManualEmpty((prev) => ({
                        ...prev,
                        cam_damacana: manual,
                      }));
                      if (!manual) {
                        setEmptyCamDamacanaReturned(
                          deliveredDepositCamDamacana,
                        );
                      }
                    }}
                    onChange={setEmptyCamDamacanaReturned}
                  />
                  <EmptyContainerRow
                    label="Alınan Boş Büyük Tüp"
                    delivered={deliveredDepositTupBuyuk}
                    value={emptyTupBuyukReturned}
                    manual={manualEmpty.tup_buyuk}
                    onToggle={(manual) => {
                      setManualEmpty((prev) => ({
                        ...prev,
                        tup_buyuk: manual,
                      }));
                      if (!manual) {
                        setEmptyTupBuyukReturned(deliveredDepositTupBuyuk);
                      }
                    }}
                    onChange={setEmptyTupBuyukReturned}
                  />
                  <EmptyContainerRow
                    label="Alınan Boş Küçük Tüp"
                    delivered={deliveredDepositTupKucuk}
                    value={emptyTupKucukReturned}
                    manual={manualEmpty.tup_kucuk}
                    onToggle={(manual) => {
                      setManualEmpty((prev) => ({
                        ...prev,
                        tup_kucuk: manual,
                      }));
                      if (!manual) {
                        setEmptyTupKucukReturned(deliveredDepositTupKucuk);
                      }
                    }}
                    onChange={setEmptyTupKucukReturned}
                  />
                  <EmptyContainerRow
                    label="Alınan Su Sebili"
                    delivered={deliveredDepositSebil}
                    value={emptySebilReturned}
                    manual={manualEmpty.sebil}
                    onToggle={(manual) => {
                      setManualEmpty((prev) => ({ ...prev, sebil: manual }));
                      if (!manual) {
                        setEmptySebilReturned(deliveredDepositSebil);
                      }
                    }}
                    onChange={setEmptySebilReturned}
                  />

                  {deliveredDepositSebil > 0 && (
                    <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl border border-indigo-200  bg-indigo-50/40 ">
                      <div className="sm:col-span-2 text-[11px] font-semibold text-indigo-800 ">
                        Verilen su sebili bilgileri (isteğe bağlı)
                      </div>
                      <label className="min-w-0">
                        <span className="text-[11px] text-slate-600  block mb-1">
                          Marka
                        </span>
                        <input
                          type="text"
                          value={sebilBrand}
                          onChange={(e) => setSebilBrand(e.target.value)}
                          maxLength={60}
                          placeholder="Örn: Arçelik"
                          className="w-full p-2 rounded-lg border border-slate-200  bg-white  text-xs text-slate-900 "
                        />
                      </label>
                      <label className="min-w-0">
                        <span className="text-[11px] text-slate-600  block mb-1">
                          Model
                        </span>
                        <input
                          type="text"
                          value={sebilModel}
                          onChange={(e) => setSebilModel(e.target.value)}
                          maxLength={60}
                          placeholder="Örn: 1200 A"
                          className="w-full p-2 rounded-lg border border-slate-200  bg-white  text-xs text-slate-900 "
                        />
                      </label>
                      <label className="min-w-0 sm:col-span-2">
                        <span className="text-[11px] text-slate-600  block mb-1">
                          Nereye bırakıldı / açıklama
                        </span>
                        <textarea
                          value={sebilNote}
                          onChange={(e) => setSebilNote(e.target.value)}
                          maxLength={300}
                          rows={2}
                          placeholder="Örn: Müşterinin giriş katındaki mutfağında, tezgâhın yanında bırakıldı; teslim alan kişi: güvenlik görevlisi"
                          className="w-full p-2 rounded-lg border border-slate-200  bg-white  text-xs text-slate-900  resize-y"
                        />
                      </label>
                    </div>
                  )}
                </div>

                {deliveredDepositDamacana - emptyDamacanaReturned !== 0 && (
                  <div className="text-[11px] text-orange-800 ">
                    {deliveredDepositDamacana - emptyDamacanaReturned > 0 ? (
                      <span>
                        ⚠️{" "}
                        <strong>
                          {deliveredDepositDamacana - emptyDamacanaReturned}{" "}
                          adet boş damacana eksik alındı.
                        </strong>{" "}
                        Müşterinin emanet boş borcuna işlenecektir.
                      </span>
                    ) : (
                      <span>
                        ℹ️ Müşteriye{" "}
                        <strong>
                          {emptyDamacanaReturned - deliveredDepositDamacana}{" "}
                          adet boş damacana borcumuz oluşur.
                        </strong>{" "}
                        Emanet bakiyesine işlenecektir.
                      </span>
                    )}
                  </div>
                )}

                {deliveredDepositCamDamacana - emptyCamDamacanaReturned !==
                  0 && (
                  <div className="text-[11px] text-amber-800 ">
                    {deliveredDepositCamDamacana - emptyCamDamacanaReturned >
                    0 ? (
                      <span>
                        ⚠️{" "}
                        <strong>
                          {deliveredDepositCamDamacana -
                            emptyCamDamacanaReturned}{" "}
                          adet boş cam damacana eksik alındı.
                        </strong>{" "}
                        Müşterinin emanet boş cam damacana borcuna işlenecektir.
                      </span>
                    ) : (
                      <span>
                        ℹ️ Müşteriye{" "}
                        <strong>
                          {emptyCamDamacanaReturned -
                            deliveredDepositCamDamacana}{" "}
                          adet boş cam damacana borcumuz oluşur.
                        </strong>{" "}
                        Emanet bakiyesine işlenecektir.
                      </span>
                    )}
                  </div>
                )}

                {deliveredDepositTupBuyuk - emptyTupBuyukReturned !== 0 && (
                  <div className="text-[11px] text-orange-800 ">
                    {deliveredDepositTupBuyuk - emptyTupBuyukReturned > 0 ? (
                      <span>
                        ⚠️{" "}
                        <strong>
                          {deliveredDepositTupBuyuk - emptyTupBuyukReturned} adet
                          boş büyük tüp eksik alındı.
                        </strong>{" "}
                        Müşterinin emanet boş büyük tüp borcuna işlenecektir.
                      </span>
                    ) : (
                      <span>
                        ℹ️ Müşteriye{" "}
                        <strong>
                          {emptyTupBuyukReturned - deliveredDepositTupBuyuk} adet
                          boş büyük tüp borcumuz oluşur.
                        </strong>{" "}
                        Emanet bakiyesine işlenecektir.
                      </span>
                    )}
                  </div>
                )}

                {deliveredDepositTupKucuk - emptyTupKucukReturned !== 0 && (
                  <div className="text-[11px] text-orange-800 ">
                    {deliveredDepositTupKucuk - emptyTupKucukReturned > 0 ? (
                      <span>
                        ⚠️{" "}
                        <strong>
                          {deliveredDepositTupKucuk - emptyTupKucukReturned} adet
                          boş küçük tüp eksik alındı.
                        </strong>{" "}
                        Müşterinin emanet boş küçük tüp borcuna işlenecektir.
                      </span>
                    ) : (
                      <span>
                        ℹ️ Müşteriye{" "}
                        <strong>
                          {emptyTupKucukReturned - deliveredDepositTupKucuk} adet
                          boş küçük tüp borcumuz oluşur.
                        </strong>{" "}
                        Emanet bakiyesine işlenecektir.
                      </span>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => openStepAndScroll("payment")}
                className="w-full min-h-11 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.99]"
              >
                <span>Devam: Tahsilat & Not</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>
          </StepSection>

          {/* STEP 4: PAYMENT & NOTES */}
          <StepSection
            stepKey="payment"
            step={4}
            title="Tahsilat & Not"
            isOpen={!!selectedCustomer && openStep === "payment"}
            disabled={!selectedCustomer}
            disabledHint="Önce müşteri seçin"
            onToggle={() => toggleStep("payment")}
            summary={paymentSummaryText}
          >
              {/* Payment Section */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Tahsilat Detayı
                  </label>
                  {selectedCustomer?.isAccountCustomer ? (
                    <span className="text-[11px] text-slate-500">
                      FATURALI
                    </span>
                  ) : (
                    <div className="text-right">
                      <span className="text-[11px] text-slate-500">
                        Teslimat Tutarı:
                      </span>
                      <span className="font-mono font-extrabold text-base text-slate-900  ml-1.5 tabular-nums">
                        {grandTotal.toLocaleString("tr-TR")} ₺
                      </span>
                    </div>
                  )}
                </div>

                {/* Quick Payment Type Buttons */}
                {selectedCustomer?.isAccountCustomer ? (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentType("unpaid")}
                      className={`min-h-11 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                        paymentType === "unpaid"
                          ? "bg-amber-600 text-white shadow-xs"
                          : "bg-white  text-slate-700  border border-slate-200 "
                      }`}
                    >
                      Tahsilat Alınmadı
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setPaymentType("custom");
                        setPaymentMethod("CASH");
                        setCashAmountInput("");
                        setPosAmountInput("");
                      }}
                      className={`min-h-11 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                        paymentType === "custom"
                          ? "bg-sky-600 text-white shadow-xs"
                          : "bg-white  text-slate-700  border border-slate-200 "
                      }`}
                    >
                      Tahsilat Al
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentType("full")}
                      className={`min-h-11 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                        paymentType === "full"
                          ? "bg-emerald-600 text-white shadow-xs"
                          : "bg-white  text-slate-700  border border-slate-200 "
                      }`}
                    >
                      Tam Tahsilat ({grandTotal} ₺)
                    </button>

                    <button
                      type="button"
                      onClick={() => setPaymentType("unpaid")}
                      className={`min-h-11 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                        paymentType === "unpaid"
                          ? "bg-amber-600 text-white shadow-xs"
                          : "bg-white  text-slate-700  border border-slate-200 "
                      }`}
                    >
                      Tahsil Edilmedi (Borç / 0 ₺)
                    </button>

                    <button
                      type="button"
                      onClick={() => setPaymentType("custom")}
                      className={`col-span-2 min-h-11 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                        paymentType === "custom"
                          ? "bg-sky-600 text-white shadow-xs"
                          : "bg-white  text-slate-700  border border-slate-200 "
                      }`}
                    >
                      Kısmi / Farklı Tutar
                    </button>
                  </div>
                )}

                {/* Payment Method Selector */}
                {paymentType !== "unpaid" && (
                  <div className="pt-2">
                    <span className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                      Ödeme Yöntemi:
                    </span>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod("CASH")}
                        className={`min-h-11 py-2 px-2 rounded-lg text-xs font-semibold transition-all ${
                          paymentMethod === "CASH"
                            ? "bg-emerald-100 text-emerald-800 border-2 border-emerald-500"
                            : "bg-white  text-slate-700 border border-slate-200"
                        }`}
                      >
                        Nakit
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaymentMethod("POS")}
                        className={`min-h-11 py-2 px-2 rounded-lg text-xs font-semibold transition-all ${
                          paymentMethod === "POS"
                            ? "bg-indigo-100 text-indigo-800 border-2 border-indigo-500"
                            : "bg-white  text-slate-700 border border-slate-200"
                        }`}
                      >
                        POS (Kart)
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaymentMethod("MIXED")}
                        className={`min-h-11 py-2 px-2 rounded-lg text-xs font-semibold transition-all ${
                          paymentMethod === "MIXED"
                            ? "bg-sky-100 text-sky-800 border-2 border-sky-500"
                            : "bg-white  text-slate-700 border border-slate-200"
                        }`}
                      >
                        Karma (Nakit+POS)
                      </button>
                    </div>

                    {/* Amount Inputs */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                      {(paymentMethod === "CASH" ||
                        paymentMethod === "MIXED") && (
                        <div>
                          <label className="text-[11px] font-semibold text-emerald-700  block mb-1">
                            Alınan Nakit (₺)
                          </label>
                          <input
                            type="number"
                            value={cashAmountInput}
                            onChange={(e) => {
                              setPaymentType("custom");
                              setCashAmountInput(e.target.value);
                            }}
                            className="w-full p-2 rounded-lg border border-emerald-300 font-mono font-bold text-sm bg-white "
                          />
                        </div>
                      )}

                      {(paymentMethod === "POS" ||
                        paymentMethod === "MIXED") && (
                        <div>
                          <label className="text-[11px] font-semibold text-indigo-700  block mb-1">
                            POS Cihazından Çekilen (₺)
                          </label>
                          <input
                            type="number"
                            value={posAmountInput}
                            onChange={(e) => {
                              setPaymentType("custom");
                              setPosAmountInput(e.target.value);
                            }}
                            className="w-full p-2 rounded-lg border border-indigo-300 font-mono font-bold text-sm bg-white "
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Balance impact summary */}
                <div className="pt-2 border-t border-slate-200  text-xs">
                  <div className="flex items-center justify-between font-semibold">
                    <span>Fiilen Tahsil Edilen Toplam:</span>
                    <span className="font-mono text-emerald-600 font-bold tabular-nums">
                      {totalCollectedVal.toLocaleString("tr-TR")} ₺
                    </span>
                  </div>

                  {selectedCustomer &&
                    !selectedCustomer.isAccountCustomer &&
                    uncollectedDiff !== 0 && (
                    <div className="mt-1 text-[11px] text-sky-800 ">
                      {uncollectedDiff > 0 ? (
                        <span>
                          📋 Kalan{" "}
                          <strong>
                            {uncollectedDiff.toLocaleString("tr-TR")} ₺
                          </strong>
                          , müşterinin cari hesabına borç kaydedilecektir.
                        </span>
                      ) : (
                        <span>
                          ℹ️ Fazla alınan{" "}
                          <strong>
                            {Math.abs(uncollectedDiff).toLocaleString("tr-TR")} ₺
                          </strong>
                          , müşterinin cari bakiyesinden düşülecektir.
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs font-medium text-slate-600  block mb-1">
                  Teslimat Notu (İsteğe bağlı):
                </label>
                <input
                  type="text"
                  placeholder="Örn: 3. kat mutfağa bırakıldı, slip eklendi..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200  text-xs bg-slate-50 "
                />
              </div>
          </StepSection>
        </div>

        {/* Non-blocking alerts: always above the action bar so they cannot cover it */}
        {(errorMsg || showStockWarning) && (
          <div className="shrink-0 px-4 sm:px-5 pt-3 space-y-2 max-h-[35vh] overflow-y-auto">
            {errorMsg && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-red-50  border border-red-200  text-red-700  text-sm font-semibold flex items-start gap-2"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="flex-1 break-words">{errorMsg}</span>
                <button
                  type="button"
                  onClick={() => {
                    setErrorPersistent(false);
                    setErrorMsg(null);
                  }}
                  className="min-w-11 min-h-11 -my-2 -mr-2 rounded-lg flex items-center justify-center shrink-0 hover:bg-red-100 "
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
                onClick={() =>
                  setDismissedWarningSignature(stockWarningSignature)
                }
                className="p-3 rounded-xl bg-amber-50  border border-amber-300  text-amber-900  text-sm space-y-1 cursor-pointer"
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
                    className="min-w-11 min-h-11 -my-2 -mr-2 rounded-lg flex items-center justify-center shrink-0 hover:bg-amber-100 "
                    aria-label="Uyarıyı kapat"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {stockWarnings.map((warning) => (
                  <p key={warning.productId} className="break-words">
                    ⚠️ <strong>{warning.productName}</strong> için girilen
                    miktar ({warning.qty}), araçtaki yüklü stoğu (
                    {warning.vehicleQty}) aşıyor. Teslimat kaydedilebilir ancak
                    gün sonu sayımında dikkate alınacaktır.
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-slate-100  shrink-0 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 bg-slate-50/50 ">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto min-h-11 px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700  font-semibold text-sm hover:bg-slate-100 "
          >
            İptal
          </button>

          <button
            type="button"
            onClick={handleSubmitDelivery}
            disabled={isSubmitting}
            aria-disabled={!isSubmitReady || isSubmitting}
            className={`w-full sm:w-auto sm:flex-1 min-h-12 px-6 py-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold text-sm shadow-md shadow-sky-600/20 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer ${
              !isSubmitReady ? "opacity-60" : ""
            }`}
          >
            <Check className="w-4 h-4 shrink-0" />
            <span className="break-words">
              {isSubmitting
                ? "Kaydediliyor..."
                : !selectedCustomer
                  ? "Önce Müşteri Seçiniz"
                  : !hasDeliveryContent
                    ? "Ürün veya Boş Kap Giriniz"
                    : isEdit && correctionReason.trim().length < 3
                      ? "Düzenleme Gerekçesi Giriniz"
                      : isEdit
                        ? selectedCustomer.isAccountCustomer ||
                          totalCollectedVal === 0
                          ? "Düzenlemeyi Kaydet"
                          : `Düzenlemeyi Kaydet (${totalCollectedVal.toLocaleString("tr-TR")} ₺)`
                        : selectedCustomer.isAccountCustomer ||
                            totalCollectedVal === 0
                          ? "Teslimatı Kaydet"
                          : `Teslimatı Kaydet (${totalCollectedVal.toLocaleString("tr-TR")} ₺)`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
