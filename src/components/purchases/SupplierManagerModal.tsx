import React, { useEffect, useState } from 'react';
import { AlertCircle, Pencil, Save, X } from 'lucide-react';
import type { Supplier } from '../../types';
import { createSupplier, updateSupplier } from '../../services/api';

interface SupplierManagerModalProps {
  open: boolean;
  onClose: () => void;
  suppliers: Supplier[];
  onChanged: () => void;
}

export const SupplierManagerModal: React.FC<SupplierManagerModalProps> = ({
  open,
  onClose,
  suppliers,
  onChanged,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEditingId(null);
    setName('');
    setNote('');
    setIsActive(true);
    setError(null);
    setIsSaving(false);
  }, [open]);

  if (!open) return null;

  const startEdit = (supplier: Supplier) => {
    setEditingId(supplier.id);
    setName(supplier.name);
    setNote(supplier.note || '');
    setIsActive(supplier.isActive);
    setError(null);
  };

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setNote('');
    setIsActive(true);
    setError(null);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Toptancı adı zorunludur.');
      return;
    }
    try {
      setIsSaving(true);
      if (editingId) {
        await updateSupplier(editingId, {
          name: trimmed,
          note: note.trim() || null,
          isActive,
        });
      } else {
        await createSupplier({
          name: trimmed,
          note: note.trim() || null,
          isActive,
        });
      }
      onChanged();
      resetForm();
    } catch (err: any) {
      setError(err?.message || 'Toptancı kaydedilemedi.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-2xl min-w-0 rounded-2xl bg-white shadow-2xl border border-slate-200 my-4 sm:my-0 max-h-[calc(94dvh-env(safe-area-inset-bottom))] sm:max-h-[94vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Toptancıları Yönet</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Toptancı silinmez; pasife alınır. Geçmiş alımlar korunur.
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
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
                {editingId ? 'Toptancıyı Düzenle' : 'Yeni Toptancı'}
              </span>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
                >
                  Yeni kayda geç
                </button>
              )}
            </div>

            <label className="block min-w-0">
              <span className="text-[11px] text-slate-600 block mb-1">Ad</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="Örn: Doğuş Kağıtçılık"
                className="w-full min-h-11 p-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-900"
              />
            </label>

            <label className="block min-w-0">
              <span className="text-[11px] text-slate-600 block mb-1">
                Not (opsiyonel)
              </span>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                placeholder="Kısa not"
                className="w-full min-h-11 p-2.5 rounded-xl border border-slate-200 bg-white text-xs text-slate-900"
              />
            </label>

            <label className="flex items-center gap-2 min-h-11 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300"
              />
              Aktif
            </label>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-words">{error}</span>
              </div>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="w-full min-h-11 px-4 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Kaydediliyor...' : editingId ? 'Güncelle' : 'Ekle'}
            </button>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
              Tanımlı Toptancılar ({suppliers.length})
            </div>
            {suppliers.length === 0 ? (
              <div className="rounded-xl border border-slate-200 p-4 text-center text-xs text-slate-500">
                Henüz toptancı tanımlanmadı.
              </div>
            ) : (
              suppliers.map((supplier) => (
                <div
                  key={supplier.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 min-w-0"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 break-words">
                      {supplier.name}
                    </div>
                    {supplier.note && (
                      <div className="text-[11px] text-slate-500 break-words">
                        {supplier.note}
                      </div>
                    )}
                    <span
                      className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded ${
                        supplier.isActive
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {supplier.isActive ? 'Aktif' : 'Pasif'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => startEdit(supplier)}
                    className="min-w-11 min-h-11 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center shrink-0"
                    aria-label={`${supplier.name} düzenle`}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-11 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-xs"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
