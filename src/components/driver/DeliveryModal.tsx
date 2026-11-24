import React, { useState, useEffect, useRef } from "react";
import {
  Customer,
  Product,
  Dispatch,
  Delivery,
  User,
  ProductCategory,
  CustomerDispenser,
  CustomerDispenserInput,
  DispenserDetailInput,
  getProductCategoryCodes,
  getProductCategoryTitle,
  filterProductsBySearch,
  groupProductsByCategory,
  isGlassPresentation,
  sortProductsForLoading,
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
  fetchCustomerDispensers,
  replaceDelivery,
} from "../../services/api";
import { CustomerDispenserInfo } from "../common/CustomerDispenserInfo";
import { GlassProductBadge, GLASS_PRODUCT_CARD_CLASS } from "../common/GlassProductBadge";
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
  /** Aynı seferdeki aktif teslimatlar; kalan stok uyarısı için kullanılır. */
  activeDeliveries?: Delivery[];
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
  autoHint?: string;
}

const EmptyContainerRow: React.FC<EmptyContainerRowProps> = ({
  label,
  delivered,
  value,
  manual,
  onToggle,
  onChange,
  autoHint = "Otomatik: dolu kadar",
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
          <span className="text-[10px] text-slate-500">{autoHint}</span>
          <span className="font-mono font-bold text-sm text-slate-800 tabular-nums">
            {value}
          </span>
        </div>
      )}
    </div>
  );
};

type DeliveryStepKey = "customer" | "products" | "empties" | "payment";

interface DispenserDetailRow {
  brand: string;
  model: string;
  note: string;
  /** İade satırı müşteride kayıtlı bir sebilden seçildiyse o kaydın kimliği. */
  customerDispenserId?: string;
}

const EMPTY_DISPENSER_DETAIL_ROW: DispenserDetailRow = {
  brand: "",
  model: "",
  note: "",
  customerDispenserId: "",
};

interface DispenserDetailCardsProps {
  title: string;
  itemLabel: string;
  count: number;
  rows: Record<number, DispenserDetailRow>;
  notePlaceholder: string;
  onChange: (
    index: number,
    field: keyof DispenserDetailRow,
    value: string,
  ) => void;
  /** Yalnızca iade kartlarında: müşteride kayıtlı sebil detayları. */
  existingDispensers?: CustomerDispenser[];
  onSelectExisting?: (index: number, dispenserId: string) => void;
}

const dispenserOptionLabel = (dispenser: CustomerDispenser): string => {
  const detail = [dispenser.brand, dispenser.model].filter(Boolean).join(" • ");
  const note = (dispenser.note || "").trim();
  const parts = [detail || "Detaysız sebil"];
  if (note) parts.push(note);
  parts.push(`${dispenser.quantity} adet`);
  return parts.join(" • ");
};

// Şoförün sebil marka/model/açıklamasını serbest metin olarak girdiği kartlar.
// Her sebil ayrı karttır; alanlar dikey sırada (Marka → Model → Açıklama) durur.
const DispenserDetailCards: React.FC<DispenserDetailCardsProps> = ({
  title,
  itemLabel,
  count,
  rows,
  notePlaceholder,
  onChange,
  existingDispensers,
  onSelectExisting,
}) => {
  if (count <= 0) return null;

  return (
    <div className="p-3 rounded-xl border border-indigo-200 bg-indigo-50/40 space-y-3">
      <div className="text-[11px] font-semibold text-indigo-800">{title}</div>
      {Array.from({ length: count }, (_, index) => {
        const row = rows[index] || EMPTY_DISPENSER_DETAIL_ROW;
        return (
          <div
            key={index}
            className="rounded-xl border border-indigo-100 bg-white p-3 space-y-2"
          >
            <div className="text-[11px] font-bold text-indigo-800">
              {index + 1}. {itemLabel}
            </div>
            {existingDispensers && onSelectExisting && (
              <label className="block min-w-0">
                <span className="text-[11px] text-slate-600 block mb-1">
                  Müşteride kayıtlı sebil
                </span>
                <select
                  value={row.customerDispenserId || ""}
                  onChange={(e) => onSelectExisting(index, e.target.value)}
                  className="w-full p-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-900"
                >
                  <option value="">Farklı / yeni detay</option>
                  {existingDispensers.map((dispenser) => (
                    <option key={dispenser.id} value={dispenser.id}>
                      {dispenserOptionLabel(dispenser)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block min-w-0">
              <span className="text-[11px] text-slate-600 block mb-1">
                Marka
              </span>
              <input
                type="text"
                value={row.brand}
                onChange={(e) => onChange(index, "brand", e.target.value)}
                maxLength={60}
                placeholder="Örn: Arçelik"
                className="w-full p-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-900"
              />
            </label>
            <label className="block min-w-0">
              <span className="text-[11px] text-slate-600 block mb-1">
                Model
              </span>
              <input
                type="text"
                value={row.model}
                onChange={(e) => onChange(index, "model", e.target.value)}
                maxLength={60}
                placeholder="Örn: 1200 A"
                className="w-full p-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-900"
              />
            </label>
            <label className="block min-w-0">
              <span className="text-[11px] text-slate-600 block mb-1">
                Açıklama
              </span>
              <textarea
                value={row.note}
                onChange={(e) => onChange(index, "note", e.target.value)}
                maxLength={300}
                rows={2}
                placeholder={notePlaceholder}
                className="w-full p-2 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 resize-y"
              />
            </label>
          </div>
        );
      })}
    </div>
  );
};

const buildDispenserDetails = (
  rows: Record<number, DispenserDetailRow>,
  count: number,
): DispenserDetailInput[] => {
  const details: DispenserDetailInput[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows[index];
    if (!row) continue;
    const brand = row.brand.trim();
    const model = row.model.trim();
    const note = row.note.trim();
    const customerDispenserId = (row.customerDispenserId || "").trim();
    if (!brand && !model && !note && !customerDispenserId) continue;
    details.push({
      brand,
      model,
      note: note || null,
      customerDispenserId: customerDispenserId || null,
    });
  }
  return details;
};

const normalizeDispenserKeyText = (value: string): string =>
  value.trim().toLocaleLowerCase("tr-TR");

const dispenserMatchKey = (value: {
  brand?: string;
  model?: string;
}): string =>
  `${normalizeDispenserKeyText(value.brand || "")}\u0000${normalizeDispenserKeyText(
    value.model || "",
  )}`;

type DispenserMatchCandidate = {
  id: string;
  brand: string;
  model: string;
  quantity: number;
};

/**
 * İade eşleşme kontrolü için aday listesi. Düzenlemede eski teslimatın iade
 * detayları, değiştirme işlemi başlamadan önce müşteriye geri ekleneceği için
 * adaylara dahil edilir; böylece değiştirilmeyen iade gereksiz açıklama istemez.
 */
const buildReturnValidationCandidates = (
  current: CustomerDispenser[],
  previousReturns?: DispenserDetailInput[],
): DispenserMatchCandidate[] => {
  const candidates: DispenserMatchCandidate[] = current.map((row) => ({
    id: row.id,
    brand: row.brand,
    model: row.model,
    quantity: row.quantity,
  }));
  if (!previousReturns?.length) return candidates;

  const grouped = new Map<
    string,
    { brand: string; model: string; quantity: number }
  >();
  for (const detail of previousReturns) {
    const brand = (detail.brand || "").trim();
    const model = (detail.model || "").trim();
    if (!brand && !model) continue;
    const key = dispenserMatchKey({ brand, model });
    const existing = grouped.get(key);
    if (existing) existing.quantity += 1;
    else grouped.set(key, { brand, model, quantity: 1 });
  }

  for (const group of grouped.values()) {
    const existing = candidates.find(
      (row) => dispenserMatchKey(row) === dispenserMatchKey(group),
    );
    if (existing) {
      existing.quantity += group.quantity;
    } else {
      candidates.push({
        id: `previous_return_${candidates.length}`,
        brand: group.brand,
        model: group.model,
        quantity: group.quantity,
      });
    }
  }

  return candidates;
};

/**
 * İade detayları müşterideki kayıtlarla eşleşiyor mu?
 * Önce seçilen kayıt kimliği, sonra marka + model eşleşmesi kullanılır.
 * Kayıt adedi kadar eşleşme kabul edilir; kalanlar "detaysız iade" sayılır
 * ve açıklama gerektirir.
 */
const hasUnmatchedDispenserReturns = (
  details: DispenserDetailInput[],
  dispensers: DispenserMatchCandidate[],
): boolean => {
  const remaining = new Map(
    dispensers.map((dispenser) => [dispenser.id, dispenser.quantity]),
  );
  const byKey = new Map<string, DispenserMatchCandidate[]>();
  for (const dispenser of dispensers) {
    const key = dispenserMatchKey(dispenser);
    const list = byKey.get(key) || [];
    list.push(dispenser);
    byKey.set(key, list);
  }

  for (const detail of details) {
    const brand = detail.brand.trim();
    const model = detail.model.trim();
    if (!brand && !model && !detail.customerDispenserId) continue;

    let match: DispenserMatchCandidate | undefined;
    if (detail.customerDispenserId) {
      match = dispensers.find(
        (dispenser) => dispenser.id === detail.customerDispenserId,
      );
    }
    if (!match && (brand || model)) {
      match = (byKey.get(dispenserMatchKey(detail)) || []).find(
        (dispenser) => (remaining.get(dispenser.id) || 0) > 0,
      );
    }
    if (!match) return true;

    const available = remaining.get(match.id) || 0;
    if (available <= 0) return true;
    remaining.set(match.id, available - 1);
  }

  return false;
};

const groupCustomerDispenserDetails = (
  details: DispenserDetailInput[],
): CustomerDispenserInput[] => {
  const grouped = new Map<string, CustomerDispenserInput>();
  for (const detail of details) {
    const key = [detail.brand, detail.model, detail.note || ""].join("\u0000");
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += 1;
    } else {
      grouped.set(key, {
        brand: detail.brand,
        model: detail.model,
        note: detail.note || null,
        quantity: 1,
      });
    }
  }
  return Array.from(grouped.values());
};

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
  activeDeliveries = [],
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
    setOpenCategories({ damacana: true });
    setSebilGivenDetails({});
    setSebilReturnDetails({});
    setSebilReturnNote("");
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
      const resolvedTupBuyuk = editTupBuyuk;
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
        sebil: editReceived.sebil !== 0,
      });

      // Önceki kayıttaki sebil detayları düzenleme ekranına taşınır.
      const editGivenRows: Record<number, DispenserDetailRow> = {};
      let editGivenIndex = 0;
      (editDelivery.dispenserGivenDetails || []).forEach((detail) => {
        const quantity = Math.max(1, Math.floor(Number(detail.quantity) || 0));
        for (let i = 0; i < quantity; i += 1) {
          editGivenRows[editGivenIndex] = {
            brand: detail.brand || "",
            model: detail.model || "",
            note: detail.note || "",
            customerDispenserId: "",
          };
          editGivenIndex += 1;
        }
      });
      setSebilGivenDetails(editGivenRows);

      const editReturnRows: Record<number, DispenserDetailRow> = {};
      (editDelivery.dispenserReturns || []).forEach((detail, index) => {
        editReturnRows[index] = {
          brand: detail.brand || "",
          model: detail.model || "",
          note: detail.note || "",
          customerDispenserId: "",
        };
      });
      setSebilReturnDetails(editReturnRows);

      const cash = Number(editDelivery.collectedPayment?.cashAmount) || 0;
      const pos = Number(editDelivery.collectedPayment?.posAmount) || 0;
      setPaymentType("custom");
      setPaymentMethod(
        cash > 0 && pos > 0 ? "MIXED" : pos > 0 ? "POS" : "CASH",
      );
      setCashAmountInput(String(cash));
      setPosAmountInput(String(pos));
      setNotes(editDelivery.notes || "");
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
  // Varsayılan olarak yalnızca Damacana Su açıktır; diğer kategoriler kapalıdır.
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>(
    { damacana: true },
  );
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
  // Verilen ve iade alınan sebil detayları: her adet için serbest metin.
  const [sebilGivenDetails, setSebilGivenDetails] = useState<
    Record<number, DispenserDetailRow>
  >({});
  const [sebilReturnDetails, setSebilReturnDetails] = useState<
    Record<number, DispenserDetailRow>
  >({});
  const [sebilReturnNote, setSebilReturnNote] = useState("");
  // İade sırasında müşteride kayıtlı sebil detaylarından seçim yapılabilir.
  const [customerDispensers, setCustomerDispensers] = useState<
    CustomerDispenser[]
  >([]);
  const [dispensersLoading, setDispensersLoading] = useState(false);
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
  const [showStockOverrideConfirm, setShowStockOverrideConfirm] = useState(false);
  const stockOverrideConfirmedRef = useRef(false);

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

  // Seçilen müşterinin kayıtlı sebil detayları; iade kartlarında seçim için.
  useEffect(() => {
    if (!isOpen) return;
    const customerId = selectedCustomer?.id;
    if (!customerId) {
      setCustomerDispensers([]);
      setDispensersLoading(false);
      return;
    }
    let cancelled = false;
    setDispensersLoading(true);
    fetchCustomerDispensers(customerId)
      .then((rows) => {
        if (!cancelled) setCustomerDispensers(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[customer dispensers]", err);
          setCustomerDispensers([]);
        }
      })
      .finally(() => {
        if (!cancelled) setDispensersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCustomer?.id, isOpen]);

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
  const stockWarnings = computeStockWarnings(
    deliveredItems,
    dispatch.loadedItems,
    activeDeliveries,
    editDelivery?.id,
  );
  const stockWarningSignature = getStockWarningSignature(stockWarnings);
  useEffect(() => {
    if (!isOpen) {
      setShowStockOverrideConfirm(false);
      stockOverrideConfirmedRef.current = false;
    }
  }, [isOpen]);
  const selectedNegativeEmptyMessages = selectedCustomer
    ? negativeEmptyMessages(selectedCustomer.emptyDepositBalance)
    : [];
  const selectedCustomerEmptyParts = selectedCustomer
    ? [
        (selectedCustomer.emptyDepositBalance?.damacana || 0) > 0
          ? `${selectedCustomer.emptyDepositBalance.damacana} Damacana`
          : null,
        (selectedCustomer.emptyDepositBalance?.camDamacana || 0) > 0
          ? `${selectedCustomer.emptyDepositBalance.camDamacana} Cam Damacana`
          : null,
        (selectedCustomer.emptyDepositBalance?.tupBuyuk || 0) > 0
          ? `${selectedCustomer.emptyDepositBalance.tupBuyuk} Büyük Tüp`
          : null,
        (selectedCustomer.emptyDepositBalance?.tupKucuk || 0) > 0
          ? `${selectedCustomer.emptyDepositBalance.tupKucuk} Küçük Tüp`
          : null,
        (selectedCustomer.emptyDepositBalance?.sebil || 0) > 0
          ? `${selectedCustomer.emptyDepositBalance.sebil} Sebil`
          : null,
      ].filter((part): part is string => part !== null)
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
    if (selectedCustomer?.id !== customer.id) {
      setSebilGivenDetails({});
      setSebilReturnDetails({});
      setSebilReturnNote("");
    }
    setSelectedCustomer(customer);
    setErrorPersistent(false);
    setErrorMsg(null);
    openStepAndScroll("products");
  };

  const handleReturnDetailChange = (
    index: number,
    field: keyof DispenserDetailRow,
    value: string,
  ) => {
    setSebilReturnDetails((prev) => ({
      ...prev,
      [index]: {
        ...(prev[index] || EMPTY_DISPENSER_DETAIL_ROW),
        [field]: value,
        // Serbest metin değişince seçili kayıt bağlantısı düşer; eşleşme
        // marka + model üzerinden yeniden yapılır.
        customerDispenserId: "",
      },
    }));
  };

  const handleSelectExistingDispenser = (
    index: number,
    dispenserId: string,
  ) => {
    const dispenser = customerDispensers.find((row) => row.id === dispenserId);
    setSebilReturnDetails((prev) => ({
      ...prev,
      [index]: dispenser
        ? {
            brand: dispenser.brand || "",
            model: dispenser.model || "",
            note: dispenser.note || "",
            customerDispenserId: dispenser.id,
          }
        : { ...EMPTY_DISPENSER_DETAIL_ROW },
    }));
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
      setOpenCategories({ damacana: true });
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
    if (stockWarnings.length > 0 && !stockOverrideConfirmedRef.current) {
      setShowStockOverrideConfirm(true);
      return;
    }
    const allowStockOverride = stockWarnings.length > 0;
    stockOverrideConfirmedRef.current = false;

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
        tupBuyuk: emptyTupBuyukReturned,
        tupKucuk: emptyTupKucukReturned,
        sebil: emptySebilReturned,
      };
      const dispenserReturns = buildDispenserDetails(
        sebilReturnDetails,
        emptySebilReturned,
      );

      if (emptySebilReturned > 0) {
        if (dispensersLoading) {
          setErrorPersistent(true);
          setErrorMsg(
            "Müşterinin kayıtlı sebil bilgileri yükleniyor. Lütfen kısa bir süre sonra tekrar deneyin.",
          );
          return;
        }
        if (
          hasUnmatchedDispenserReturns(
            dispenserReturns,
            buildReturnValidationCandidates(
              customerDispensers,
              isEdit ? editDelivery?.dispenserReturns : undefined,
            ),
          ) &&
          sebilReturnNote.trim().length < 3
        ) {
          setErrorPersistent(true);
          setErrorMsg(
            "İade edilen sebil müşteride kayıtlı bilgilerle eşleşmiyor. Farkı açıklayan en az 3 karakterlik bir açıklama girin.",
          );
          window.requestAnimationFrame(() => {
            const noteEl = document.getElementById(
              "delivery-sebil-return-note",
            );
            noteEl?.scrollIntoView({ block: "center", behavior: "smooth" });
            noteEl?.focus();
          });
          return;
        }
      }

      const givenDispenserDetails = groupCustomerDispenserDetails(
        buildDispenserDetails(sebilGivenDetails, deliveredDepositSebil),
      );

      if (isEdit && editDelivery) {
        const rid =
          replacementId ||
          `del_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        if (!replacementId) setReplacementId(rid);
        await replaceDelivery(editDelivery.id, rid, {
          deliveredItems,
          collectedPayment,
          emptyContainersReceived,
          dispenserReturns,
          dispenserGivenDetails: givenDispenserDetails,
          dispenserReturnNote: sebilReturnNote.trim(),
          notes: notes.trim(),
          allowStockOverride,
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
        dispenserReturns,
        dispenserGivenDetails: givenDispenserDetails,
        dispenserReturnNote: sebilReturnNote.trim(),
        notes: notes.trim(),
        allowStockOverride,
      };

      const result = await createDelivery(payload);

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

  const isSubmitReady = !!selectedCustomer && hasDeliveryContent;

  if (!isOpen) return null;

  // Filter customers
  const normalizedCustomerSearch = normalizeSearchText(customerSearch);
  const filteredCustomers = allCustomers.filter((c) =>
    matchCustomerSearch(c, normalizedCustomerSearch),
  );

  // Filter products for Step 2
  const filteredProducts = filterProductsBySearch(allProducts, productSearch);
  const groupedProducts = groupProductsByCategory(
    filteredProducts,
    sortProductsForLoading,
  );

  const handleProductSearchChange = (value: string) => {
    setProductSearch(value);
    if (!value.trim()) {
      setOpenCategories({ damacana: true });
      return;
    }
    const matches = filterProductsBySearch(allProducts, value);
    const codes = new Set(matches.map((p) => p.category || "none"));
    setOpenCategories(
      Object.fromEntries(Array.from(codes).map((code) => [code, true])),
    );
  };

  const toggleCategory = (code: string) => {
    setOpenCategories((prev) => ({ ...prev, [code]: !prev[code] }));
  };

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
              </p>
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

                    {selectedCustomerEmptyParts.length > 0 && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-orange-100 text-orange-800  ">
                        Müşteride Kalan Boş:{" "}
                        {selectedCustomerEmptyParts.join(", ")}
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
                      setSebilGivenDetails({});
                      setSebilReturnDetails({});
                      setSebilReturnNote("");
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
                  onChange={(e) => handleProductSearchChange(e.target.value)}
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
                    {groupedProducts.map((group) => {
                      const isOpen = Boolean(openCategories[group.code]);
                      const selectedCount = group.products.filter(
                        (p) => (quantities[p.id] || 0) > 0,
                      ).length;

                      return (
                        <section
                          key={group.code}
                          className="rounded-xl border border-slate-200 bg-white overflow-hidden"
                        >
                          <button
                            type="button"
                            onClick={() => toggleCategory(group.code)}
                            aria-expanded={isOpen}
                            aria-controls={`delivery-cat-${group.code}`}
                            className={`w-full min-h-11 px-3 py-2.5 flex items-center justify-between gap-2 text-left transition-colors ${
                              isOpen
                                ? "bg-slate-50"
                                : "bg-white hover:bg-slate-50"
                            }`}
                          >
                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                              {group.title}
                            </span>
                            <span className="flex items-center gap-2 shrink-0">
                              {!isOpen && selectedCount > 0 && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700">
                                  {selectedCount} kalem
                                </span>
                              )}
                              <ChevronDown
                                className={`w-4 h-4 text-slate-400 transition-transform ${
                                  isOpen ? "rotate-180" : ""
                                }`}
                              />
                            </span>
                          </button>

                          {isOpen && (
                            <div
                              id={`delivery-cat-${group.code}`}
                              role="region"
                              aria-label={group.title}
                              className="p-2 pt-0 space-y-2"
                            >
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
                    const isGlass = isGlassPresentation(p);
                    const isSebilProduct = p.depositType === "sebil";

                    return (
                      <React.Fragment key={p.id}>
                      <div
                        className={`p-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                          qty > 0
                            ? "border-sky-400 bg-sky-50/30   shadow-2xs"
                            : isGlass
                              ? GLASS_PRODUCT_CARD_CLASS
                              : "border-slate-100  bg-slate-50/50 "
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900  flex flex-wrap items-center gap-1.5">
                            <span className="break-words">{p.name}</span>
                            {isGlass && <GlassProductBadge />}
                            {isCustomerSpecific && (
                              <span className="text-[10px] text-sky-700 font-medium bg-sky-100  px-1 py-0.2 rounded">
                                Müşteriye Özel Fiyat
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs">
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
                                    className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono font-bold text-sky-800 active:scale-95 whitespace-nowrap"
                                    title="Birim fiyatı düzenle"
                                    aria-label="Birim fiyatı düzenle"
                                  >
                                    <span>{unitPrice} ₺</span>
                                    <Edit2 className="w-3.5 h-3.5 text-sky-600" />
                                    <span className="text-[10px] font-sans font-semibold text-sky-700">
                                      Düzenle
                                    </span>
                                  </button>
                                )}
                              </div>
                            )}

                            <span className="text-slate-400">{p.unit}</span>

                            <span className="text-[11px] font-medium text-slate-500 font-mono max-[425px]:basis-full">
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
                      {isSebilProduct && qty > 0 && (
                        <DispenserDetailCards
                          title="Verilen su sebili bilgileri (isteğe bağlı)"
                          itemLabel="Sebil"
                          count={qty}
                          rows={sebilGivenDetails}
                          notePlaceholder="Örn: Müşterinin giriş katındaki mutfağında, tezgâhın yanında bırakıldı; teslim alan kişi: güvenlik görevlisi"
                          onChange={(index, field, value) =>
                            setSebilGivenDetails((prev) => ({
                              ...prev,
                              [index]: {
                                ...(prev[index] || EMPTY_DISPENSER_DETAIL_ROW),
                                [field]: value,
                              },
                            }))
                          }
                        />
                      )}
                      </React.Fragment>
                    );
                        })}
                            </div>
                          )}
                        </section>
                      );
                    })}
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
                    autoHint="Otomatik: 0"
                    onToggle={(manual) => {
                      setManualEmpty((prev) => ({ ...prev, sebil: manual }));
                      if (!manual) {
                        setEmptySebilReturned(0);
                        setSebilReturnDetails({});
                        setSebilReturnNote("");
                      }
                    }}
                    onChange={setEmptySebilReturned}
                  />

                  {emptySebilReturned > 0 && (
                    <div className="sm:col-span-2 space-y-3">
                      <DispenserDetailCards
                        title="İade alınan su sebili bilgileri (isteğe bağlı)"
                        itemLabel="İade Edilen Sebil"
                        count={emptySebilReturned}
                        rows={sebilReturnDetails}
                        notePlaceholder="Örn: Mutfaktan alındı; musluk kırık, depoya götürülecek"
                        existingDispensers={customerDispensers}
                        onSelectExisting={handleSelectExistingDispenser}
                        onChange={handleReturnDetailChange}
                      />
                      <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/50 space-y-1.5">
                        <label
                          htmlFor="delivery-sebil-return-note"
                          className="block text-[11px] font-semibold text-amber-900"
                        >
                          Sebil iade açıklaması
                        </label>
                        <textarea
                          id="delivery-sebil-return-note"
                          value={sebilReturnNote}
                          onChange={(e) => setSebilReturnNote(e.target.value)}
                          maxLength={300}
                          rows={2}
                          placeholder="İade detayı müşteride kayıtlı sebilden farklıysa kısa bir açıklama yazın"
                          className="w-full p-2 rounded-lg border border-amber-200 bg-white text-xs text-slate-900 resize-y"
                        />
                        <p className="text-[10px] text-amber-800">
                          İade detayı müşteride kayıtlı sebil bilgileriyle
                          eşleşmiyorsa açıklama zorunludur. Açıklama gün sonu
                          raporunda müşteri satırında görünür.
                        </p>
                      </div>
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
                <textarea
                  rows={3}
                  placeholder="Örn: 3. kat mutfağa bırakıldı, slip eklendi..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200  text-xs bg-slate-50  text-slate-900 resize-y"
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
                    ⚠️ <strong>{warning.productName}</strong>: kalan{" "}
                    {warning.vehicleQty}, girilen {warning.qty} —{" "}
                    <strong>{warning.oversellQty} adet stok aşımı</strong>.
                    Teslimat onayınızla kaydedilebilir; gün sonunda stok aşımı
                    olarak ayrıca gösterilecektir.
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

        {showStockOverrideConfirm && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="stock-override-title"
              className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-4 sm:p-5 space-y-3"
            >
              <div className="flex items-start gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3
                    id="stock-override-title"
                    className="text-sm font-bold text-slate-900"
                  >
                    Stok Aşımını Onayla
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Araçta kalan stoktan fazla teslimat yapıyorsunuz.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
                {stockWarnings.map((warning) => (
                  <div key={warning.productId} className="break-words">
                    <strong>{warning.productName}</strong>: kalan{" "}
                    {warning.vehicleQty}, girilen {warning.qty} —{" "}
                    {warning.oversellQty} adet aşım
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-slate-500">
                Devam ederseniz teslimat stok aşımı olarak kaydedilecek ve gün
                sonunda ayrıca gösterilecektir.
              </p>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowStockOverrideConfirm(false)}
                  className="w-1/2 min-h-11 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-semibold text-xs"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowStockOverrideConfirm(false);
                    stockOverrideConfirmedRef.current = true;
                    void handleSubmitDelivery();
                  }}
                  className="w-1/2 min-h-11 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs"
                >
                  Onayla ve Kaydet
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
