import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import type { Product, Purchase, Supplier, User } from '../../types';
import {
  groupProductsByCategory,
  sortProductsForLoading,
} from '../../types';
import {
  computePurchaseLineTotal,
  computePurchaseTotal,
} from '../../services/purchaseRules';
import { createPurchase, updatePurchase } from '../../services/api';

interface PurchaseFormModalProps {
  open: boolean;
  onClose: () => void;
  products: Product[];
  suppliers: Supplier[];
  currentUser: User;
  editingPurchase: Purchase | null;
  onSaved: () => void;
  onOpenSuppliers?: () => void;
}

interface PurchaseRow {
  key: string;
  productId: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

const newRow = (): PurchaseRow => ({
  key: `row_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
  productId: '',
  quantity: '',
  unit: '',
  unitPrice: '',
});

const moneyFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const PurchaseFormModal: React.FC<PurchaseFormModalProps> = ({
  open,
  onClose,
  products,
  suppliers,
  currentUser,
  editingPurchase,
  onSaved,
  onOpenSuppliers,
}) => {
  const [supplierId, setSupplierId] = useState('');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<PurchaseRow[]>([newRow()]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.isActive),
    [suppliers]
  );
  const availableSuppliers = useMemo(() => {
    const list = [...activeSuppliers];
    if (
      editingPurchase &&
      !list.some((supplier) => supplier.id === editingPurchase.supplierId)
    ) {
      const current = suppliers.find(
        (supplier) => supplier.id === editingPurchase.supplierId
      );
      if (current) list.push(current);
    }
    return list;
  }, [activeSuppliers, suppliers, editingPurchase]);
  const productGroups = useMemo(
    () => groupProductsByCategory(products, sortProductsForLoading),
    [products]
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setIsSaving(false);
    if (editingPurchase) {
      setSupplierId(editingPurchase.supplierId);
      setDescription(editingPurchase.description || '');
      setRows(
        editingPurchase.items.map((item) => ({
          key: `row_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          productId: item.productId,
          quantity: String(item.quantity),
          unit: item.unit,
          unitPrice: item.unitPrice === null ? '' : String(item.unitPrice),
        }))
      );
    } else {
      setSupplierId(availableSuppliers[0]?.id || '');
      setDescription('');
      setRows([newRow()]);
    }
  }, [open, editingPurchase]);

  if (!open) return null;

  const updateRow = (key: string, patch: Partial<PurchaseRow>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const handleProductChange = (key: string, productId: string) => {
    const product = products.find((p) => p.id === productId);
    updateRow(key, {
      productId,
      unit: product?.unit || '',
    });
  };

  const addRow = () => setRows((prev) => [...prev, newRow()]);
  const removeRow = (key: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.key !== key)));
  };

  const total = computePurchaseTotal(
    rows.map((row) => ({
      quantity: Number(row.quantity) || 0,
      unitPrice: row.unitPrice.trim() === '' ? null : Number(row.unitPrice),
    }))
  );

  const handleSubmit = async () => {
    setError(null);
    if (!supplierId) {
      setError('Toptancı seçilmelidir.');
      return;
    }
    if (rows.length === 0) {
      setError('En az bir ürün satırı girilmelidir.');
      return;
    }

    const items = [];
    for (const row of rows) {
      const quantity = Number(row.quantity);
      if (!row.productId) {
        setError('Her satırda ürün seçilmelidir.');
        return;
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        setError('Miktar 1 veya daha büyük bir tam sayı olmalıdır.');
        return;
      }
      const product = products.find((p) => p.id === row.productId);
      const unit = product?.unit || row.unit;
      if (!unit) {
        setError('Ürün birimi bulunamadı.');
        return;
      }
      let unitPrice: number | null = null;
      if (row.unitPrice.trim() !== '') {
        unitPrice = Number(row.unitPrice);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          setError('Birim alış fiyatı geçersiz.');
          return;
        }
      }
      items.push({ productId: row.productId, quantity, unitPrice });
    }

    try {
      setIsSaving(true);
      if (editingPurchase) {
        await updatePurchase(editingPurchase.id, {
          supplierId,
          description: description.trim() || null,
          items,
        });
      } else {
        await createPurchase({
          id: `pur_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          supplierId,
          description: description.trim() || null,
          items,
        });
      }
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Satın alım kaydedilemedi.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-3xl min-w-0 rounded-2xl bg-white shadow-2xl border border-slate-200 my-4 sm:my-0 max-h-[calc(94dvh-env(safe-area-inset-bottom))] sm:max-h-[94vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              {editingPurchase ? 'Satın Alımı Düzelt' : 'Yeni Satın Alım'}
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Ürün birimi katalogdan gelir; miktar tam sayıdır. Fiyat isteğe bağlıdır.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-11 min-h-11 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center shrink-0"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto min-h-0">
          {availableSuppliers.length === 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-2">
              <div>Henüz tanımlı bir toptancı yok.</div>
              {currentUser.role === 'admin' && onOpenSuppliers && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSuppliers();
                  }}
                  className="min-h-11 px-3 py-2 rounded-lg bg-amber-700 text-white font-bold text-xs"
                >
                  Toptancı Ekle
                </button>
              )}
            </div>
          )}

          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-600 block mb-1">
              Toptancı
            </span>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full min-h-11 p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-900"
            >
              <option value="">Toptancı seçin</option>
              {availableSuppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-600 block mb-1">
              Açıklama (opsiyonel)
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Örn: Cuppa marka, depoya teslim edilecek"
              className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900 resize-y"
            />
          </label>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
                Alınan Ürünler
              </span>
              <button
                type="button"
                onClick={addRow}
                className="min-h-11 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-purple-200 bg-purple-50 text-purple-800 text-xs font-bold"
              >
                <Plus className="w-3.5 h-3.5" />
                Ürün Satırı Ekle
              </button>
            </div>

            {rows.map((row, index) => {
              const lineTotal = computePurchaseLineTotal(
                Number(row.quantity) || 0,
                row.unitPrice.trim() === '' ? null : Number(row.unitPrice)
              );
              return (
                <div
                  key={row.key}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-slate-700">
                      {index + 1}. Ürün
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      disabled={rows.length <= 1}
                      className="min-w-11 min-h-11 rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-40 flex items-center justify-center"
                      aria-label="Satırı kaldır"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <label className="block min-w-0">
                    <span className="text-[11px] text-slate-600 block mb-1">Ürün</span>
                    <select
                      value={row.productId}
                      onChange={(e) => handleProductChange(row.key, e.target.value)}
                      className="w-full min-h-11 p-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-900"
                    >
                      <option value="">Ürün seçin</option>
                      {productGroups.map((group) => (
                        <optgroup key={group.code} label={group.title}>
                          {group.products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <label className="block min-w-0">
                      <span className="text-[11px] text-slate-600 block mb-1">Miktar</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        value={row.quantity}
                        onChange={(e) =>
                          updateRow(row.key, { quantity: e.target.value })
                        }
                        placeholder="0"
                        className="w-full min-h-11 p-2.5 rounded-xl border border-slate-200 bg-white text-center font-mono font-bold text-xs"
                      />
                    </label>

                    <label className="block min-w-0">
                      <span className="text-[11px] text-slate-600 block mb-1">Birim</span>
                      <input
                        type="text"
                        value={row.unit}
                        readOnly
                        placeholder="Ürün seçin"
                        className="w-full min-h-11 p-2.5 rounded-xl border border-slate-200 bg-slate-100 text-xs text-slate-700"
                      />
                    </label>

                    <label className="block min-w-0">
                      <span className="text-[11px] text-slate-600 block mb-1">
                        Birim Alış (opsiyonel)
                      </span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        value={row.unitPrice}
                        onChange={(e) =>
                          updateRow(row.key, { unitPrice: e.target.value })
                        }
                        placeholder="0,00"
                        className="w-full min-h-11 p-2.5 rounded-xl border border-slate-200 bg-white text-center font-mono text-xs"
                      />
                    </label>

                    <div className="block min-w-0">
                      <span className="text-[11px] text-slate-600 block mb-1">Satır Toplamı</span>
                      <div className="w-full min-h-11 p-2.5 rounded-xl border border-slate-200 bg-slate-100 text-center font-mono font-bold text-xs text-slate-800 flex items-center justify-center">
                        {lineTotal === null ? '-' : `${moneyFmt.format(lineTotal)} ₺`}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {total !== null && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-purple-200 bg-purple-50 p-3">
              <span className="text-xs font-bold text-purple-900">Toplam Fiyat</span>
              <span className="font-mono font-extrabold text-sm text-purple-900">
                {moneyFmt.format(total)} ₺
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="break-words">{error}</span>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-200 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-11 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-xs"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || availableSuppliers.length === 0}
            className="flex-1 min-h-11 px-4 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            {isSaving ? 'Kaydediliyor...' : editingPurchase ? 'Düzelt' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
};
