import React, { useEffect, useMemo, useState } from "react";
import { CustomerDispenser, CustomerDispenserInput } from "../../types";
import {
  addCustomerDispenser,
  deleteCustomerDispenser,
  fetchCustomerDispensers,
  updateCustomerDispenser,
} from "../../services/api";
import { normalizeCustomerDispenserInput } from "../../services/customerDispenserRules";
import { Edit2, Plus, RefreshCw, Trash2, X } from "lucide-react";

interface CustomerDispenserEditorProps {
  customerId: string;
  /** Yönetici dışındaki kullanıcılar için düzenleme kapalıdır. */
  disabled?: boolean;
}

const emptyForm = {
  brand: "",
  model: "",
  note: "",
  quantity: "1",
};

const formatDispenserTitle = (dispenser: CustomerDispenser): string => {
  const detail = [dispenser.brand, dispenser.model].filter(Boolean).join(" • ");
  return detail || "Detaysız sebil";
};

export const CustomerDispenserEditor: React.FC<
  CustomerDispenserEditorProps
> = ({ customerId, disabled = false }) => {
  const [dispensers, setDispensers] = useState<CustomerDispenser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadDispensers = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const rows = await fetchCustomerDispensers(customerId);
      setDispensers(rows);
    } catch (err: any) {
      setLoadError(err?.message || "Sebil detayları yüklenemedi.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setForm(emptyForm);
    setEditingId(null);
    setFormError(null);
    void loadDispensers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const totalQuantity = useMemo(
    () =>
      dispensers.reduce(
        (sum, dispenser) => sum + (Number(dispenser.quantity) || 0),
        0,
      ),
    [dispensers],
  );

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setFormError(null);
  };

  const parseForm = (): CustomerDispenserInput => {
    const quantity = Number(form.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error("Adet 1 veya daha büyük bir tam sayı olmalıdır.");
    }
    return normalizeCustomerDispenserInput({
      brand: form.brand,
      model: form.model,
      note: form.note,
      quantity,
    });
  };

  const handleSubmit = async () => {
    if (disabled || isSaving) return;
    setFormError(null);

    let input: CustomerDispenserInput;
    try {
      input = parseForm();
    } catch (err: any) {
      setFormError(err?.message || "Sebil bilgileri geçersiz.");
      return;
    }

    try {
      setIsSaving(true);
      if (editingId) {
        const updated = await updateCustomerDispenser(
          customerId,
          editingId,
          input,
        );
        setDispensers((prev) =>
          prev.map((row) => (row.id === editingId ? updated : row)),
        );
      } else {
        const created = await addCustomerDispenser(customerId, input);
        setDispensers((prev) => [...prev, created]);
      }
      resetForm();
    } catch (err: any) {
      setFormError(err?.message || "Sebil detayı kaydedilemedi.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (dispenser: CustomerDispenser) => {
    if (disabled) return;
    setEditingId(dispenser.id);
    setForm({
      brand: dispenser.brand || "",
      model: dispenser.model || "",
      note: dispenser.note || "",
      quantity: String(dispenser.quantity),
    });
    setFormError(null);
  };

  const handleDelete = async (dispenser: CustomerDispenser) => {
    if (disabled || deletingId) return;
    if (
      !confirm(
        `${formatDispenserTitle(dispenser)} kaydını silmek istediğinize emin misiniz?`,
      )
    ) {
      return;
    }
    setDeletingId(dispenser.id);
    setFormError(null);
    try {
      await deleteCustomerDispenser(customerId, dispenser.id);
      setDispensers((prev) => prev.filter((row) => row.id !== dispenser.id));
      if (editingId === dispenser.id) resetForm();
    } catch (err: any) {
      setFormError(err?.message || "Sebil detayı silinemedi.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div
      className="p-3.5 rounded-xl bg-indigo-50/50 border border-indigo-200 space-y-3"
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-indigo-900">Sebil Detayları</div>
          <p className="text-[10px] text-indigo-700 mt-0.5">
            Adet zorunludur; marka, model ve açıklama isteğe bağlıdır. Bu
            bilgiler şoförün iade ekranında seçilebilir.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadDispensers()}
          disabled={isLoading}
          className="min-h-10 shrink-0 inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-indigo-200 bg-white text-indigo-700 text-[11px] font-semibold disabled:opacity-60"
          title="Listeyi yenile"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>Yenile</span>
        </button>
      </div>

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {loadError}
        </div>
      )}

      {isLoading ? (
        <div className="text-[11px] text-indigo-700">Sebil detayları yükleniyor…</div>
      ) : dispensers.length === 0 ? (
        <div className="text-[11px] text-indigo-700">
          Kayıtlı sebil detayı yok. Aşağıdaki alanlardan ekleyebilirsiniz.
        </div>
      ) : (
        <div className="space-y-2">
          {dispensers.map((dispenser) => (
            <div
              key={dispenser.id}
              className="rounded-lg border border-indigo-100 bg-white p-2.5 flex items-start gap-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-900 break-words">
                  {formatDispenserTitle(dispenser)}
                </div>
                <div className="text-[11px] text-slate-600 break-words">
                  {dispenser.quantity} adet
                  {dispenser.note ? ` • ${dispenser.note}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleEdit(dispenser)}
                  disabled={disabled}
                  className="w-9 h-9 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center disabled:opacity-50"
                  title="Sebil detayını düzenle"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(dispenser)}
                  disabled={disabled || deletingId === dispenser.id}
                  className="w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center disabled:opacity-50"
                  title="Sebil detayını sil"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          <div className="text-[10px] text-indigo-700">
            Detaylarda kayıtlı toplam: {totalQuantity} adet
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-700 block mb-1">
              Adet <span className="text-red-600">*</span>
            </span>
            <input
              type="number"
              min={1}
              step={1}
              value={form.quantity}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, quantity: e.target.value }))
              }
              disabled={disabled || isSaving}
              className="w-full p-2.5 rounded-xl border border-indigo-200 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-700 block mb-1">
              Marka
            </span>
            <input
              type="text"
              maxLength={60}
              value={form.brand}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, brand: e.target.value }))
              }
              disabled={disabled || isSaving}
              placeholder="Örn: Arçelik"
              className="w-full p-2.5 rounded-xl border border-indigo-200 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-700 block mb-1">
              Model
            </span>
            <input
              type="text"
              maxLength={60}
              value={form.model}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, model: e.target.value }))
              }
              disabled={disabled || isSaving}
              placeholder="Örn: 1200 A"
              className="w-full p-2.5 rounded-xl border border-indigo-200 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-700 block mb-1">
              Açıklama
            </span>
            <input
              type="text"
              maxLength={300}
              value={form.note}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, note: e.target.value }))
              }
              disabled={disabled || isSaving}
              placeholder="Örn: Çatı katı"
              className="w-full p-2.5 rounded-xl border border-indigo-200 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
        </div>

        {formError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
            {formError}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={disabled || isSaving}
            className="min-h-10 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-60"
          >
            {editingId ? (
              <>
                <Edit2 className="w-3.5 h-3.5" />
                <span>{isSaving ? "Güncelleniyor…" : "Detayı Güncelle"}</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>{isSaving ? "Ekleniyor…" : "Sebil Detayı Ekle"}</span>
              </>
            )}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              disabled={isSaving}
              className="min-h-10 inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-semibold disabled:opacity-60"
            >
              <X className="w-3.5 h-3.5" />
              <span>Vazgeç</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
