import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Droplets,
  Edit2,
  Loader2,
  Plus,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import {
  CustomerDispenser,
  CustomerDispenserSuggestions,
} from '../../types';
import {
  addCustomerDispenser,
  editCustomerDispenser,
  fetchCustomerDispensers,
  removeCustomerDispenser,
} from '../../services/api';
import {
  normalizeCustomerDispenserInput,
  summarizeCustomerDispenserQuantity,
} from '../../services/customerDispenserRules';

interface CustomerDispensersSectionProps {
  customerId: string;
  customerName?: string;
  defaultOpen?: boolean;
  className?: string;
}

type Message = { kind: 'success' | 'error'; text: string };

const EMPTY_SUGGESTIONS: CustomerDispenserSuggestions = {
  brands: [],
  models: [],
};

function mergeSuggestions(
  previous: CustomerDispenserSuggestions,
  brand: string,
  model: string
): CustomerDispenserSuggestions {
  const compare = (a: string, b: string) => a.localeCompare(b, 'tr');
  return {
    brands: Array.from(new Set([...previous.brands, brand])).sort(compare),
    models: Array.from(new Set([...previous.models, model])).sort(compare),
  };
}

export const CustomerDispensersSection: React.FC<
  CustomerDispensersSectionProps
> = ({ customerId, customerName, defaultOpen = false, className = '' }) => {
  const [open, setOpen] = useState(defaultOpen);
  const [dispensers, setDispensers] = useState<CustomerDispenser[]>([]);
  const [suggestions, setSuggestions] =
    useState<CustomerDispenserSuggestions>(EMPTY_SUGGESTIONS);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerDispenser | null>(null);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const requestSeq = useRef(0);
  const listId = `sebil-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const brandListId = `${listId}-marka`;
  const modelListId = `${listId}-model`;

  const total = useMemo(
    () => summarizeCustomerDispenserQuantity(dispensers),
    [dispensers]
  );

  const showMessage = (kind: Message['kind'], text: string) => {
    setMessage({ kind, text });
  };

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    requestSeq.current += 1;
    setOpen(defaultOpen);
    setDispensers([]);
    setSuggestions(EMPTY_SUGGESTIONS);
    setLoaded(false);
    setLoading(false);
    setLoadError(null);
    setMessage(null);
    setFormOpen(false);
    setEditing(null);
    setBrand('');
    setModel('');
    setQuantity('1');
    setNote('');
    setDeletingId(null);
  }, [customerId, defaultOpen]);

  const loadDispensers = async () => {
    if (!isOnline) {
      setLoaded(false);
      setLoadError('Çevrimdışıyken sebil listesi alınamaz. Bağlantı sağlandığında tekrar deneyin.');
      return;
    }

    const sequence = ++requestSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await fetchCustomerDispensers(customerId);
      if (sequence !== requestSeq.current) return;
      setDispensers(result.dispensers);
      setSuggestions(result.suggestions);
      setLoaded(true);
    } catch (err: any) {
      if (sequence !== requestSeq.current) return;
      setLoadError(err?.message || 'Sebil kayıtları alınamadı.');
    } finally {
      if (sequence === requestSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || loaded) return;
    void loadDispensers();
  }, [open, loaded, customerId, isOnline]);

  const resetForm = () => {
    setFormOpen(false);
    setEditing(null);
    setBrand('');
    setModel('');
    setQuantity('1');
    setNote('');
  };

  const startCreate = () => {
    if (!isOnline) {
      showMessage('error', 'Çevrimdışıyken sebil kayıtları değiştirilemez.');
      return;
    }
    setEditing(null);
    setBrand('');
    setModel('');
    setQuantity('1');
    setNote('');
    setFormOpen(true);
  };

  const startEdit = (dispenser: CustomerDispenser) => {
    if (!isOnline) {
      showMessage('error', 'Çevrimdışıyken sebil kayıtları değiştirilemez.');
      return;
    }
    setEditing(dispenser);
    setBrand(dispenser.brand);
    setModel(dispenser.model);
    setQuantity(String(dispenser.quantity));
    setNote(dispenser.note || '');
    setFormOpen(true);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isOnline) {
      showMessage('error', 'Çevrimdışıyken sebil kayıtları değiştirilemez.');
      return;
    }

    let input;
    try {
      input = normalizeCustomerDispenserInput({
        brand,
        model,
        quantity: Number(quantity),
        note,
      });
    } catch (err: any) {
      showMessage('error', err?.message || 'Sebil bilgileri geçersiz.');
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        const updated = await editCustomerDispenser(
          customerId,
          editing.id,
          input
        );
        setDispensers((previous) =>
          previous.map((item) => (item.id === updated.id ? updated : item))
        );
        setSuggestions((previous) =>
          mergeSuggestions(previous, updated.brand, updated.model)
        );
        setLoaded(true);
        showMessage('success', 'Sebil güncellendi.');
      } else {
        const created = await addCustomerDispenser(customerId, input);
        setDispensers((previous) => [...previous, created]);
        setSuggestions((previous) =>
          mergeSuggestions(previous, created.brand, created.model)
        );
        setLoaded(true);
        showMessage('success', 'Sebil eklendi.');
      }
      resetForm();
    } catch (err: any) {
      showMessage('error', err?.message || 'Sebil kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (dispenser: CustomerDispenser) => {
    if (!isOnline) {
      showMessage('error', 'Çevrimdışıyken sebil kayıtları değiştirilemez.');
      return;
    }

    const label = `${dispenser.brand} ${dispenser.model}`.trim();
    if (
      !window.confirm(
        `"${label}" sebil kaydını silmek istiyor musunuz? Bu işlem geri alınamaz.`
      )
    ) {
      return;
    }

    setDeletingId(dispenser.id);
    try {
      await removeCustomerDispenser(customerId, dispenser.id);
      setDispensers((previous) =>
        previous.filter((item) => item.id !== dispenser.id)
      );
      setLoaded(true);
      if (editing?.id === dispenser.id) resetForm();
      showMessage('success', 'Sebil silindi.');
    } catch (err: any) {
      showMessage('error', err?.message || 'Sebil silinemedi.');
    } finally {
      setDeletingId(null);
    }
  };

  const toggleOpen = () => {
    if (open) resetForm();
    setOpen(!open);
  };

  return (
    <section
      className={`rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden ${className}`}
      aria-label={customerName ? `${customerName} sebil kayıtları` : 'Sebil kayıtları'}
    >
      <button
        type="button"
        onClick={toggleOpen}
        className="w-full min-h-12 px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
        aria-expanded={open}
      >
        <span className="w-9 h-9 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 flex items-center justify-center shrink-0">
          <Droplets className="w-4 h-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-900 dark:text-white">
            Sebiller
          </span>
          <span className="block text-[11px] text-slate-500 dark:text-slate-400">
            Müşteride bulunan sebil adetleri
          </span>
        </span>
        {loaded ? (
          <span className="shrink-0 text-[11px] font-bold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/60 px-2 py-1 rounded-md">
            Toplam: {total} sebil
          </span>
        ) : (
          <span className="shrink-0 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Görüntüle
          </span>
        )}
        {open ? (
          <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
        )}
      </button>

      {open && (
        <div
          className={`border-t border-slate-100 dark:border-slate-800 p-3 space-y-3 ${
            !isOnline ? 'pb-16' : ''
          }`}
        >
          {!isOnline && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-2 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
              <WifiOff className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Çevrimdışıyken sebil kayıtları değiştirilemez. Bağlantı
                sağlandığında tekrar deneyin.
              </span>
            </div>
          )}

          {message && (
            <div
              role="status"
              className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] font-semibold ${
                message.kind === 'success'
                  ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200'
                  : 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200'
              }`}
            >
              {message.kind === 'success' && (
                <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              )}
              <span className="min-w-0 break-words">{message.text}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Sebil Listesi
            </span>
            <button
              type="button"
              onClick={startCreate}
              disabled={!isOnline || !loaded}
              className="min-h-12 px-3 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Ekle</span>
            </button>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Sebil kayıtları yükleniyor...</span>
            </div>
          )}

          {!loading && loadError && (
            <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-2.5 space-y-2">
              <p className="text-[11px] font-semibold text-red-800 dark:text-red-200 break-words">
                {loadError}
              </p>
              <button
                type="button"
                onClick={() => void loadDispensers()}
                disabled={!isOnline}
                className="min-h-11 px-3 rounded-lg border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 text-xs font-bold disabled:opacity-50"
              >
                Tekrar dene
              </button>
            </div>
          )}

          {!loading && !loadError && loaded && dispensers.length === 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
              Henüz sebil kaydı yok.
            </p>
          )}

          {!loading && !loadError && dispensers.length > 0 && (
            <ul className="space-y-2">
              {dispensers.map((dispenser) => (
                <li
                  key={dispenser.id}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 p-2.5"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-bold text-sky-800 dark:text-sky-200 bg-sky-100 dark:bg-sky-950 px-1.5 py-0.5 rounded-md">
                          {dispenser.quantity} adet
                        </span>
                        <span className="text-sm font-bold text-slate-900 dark:text-white break-words">
                          {dispenser.brand}
                        </span>
                        <span className="text-xs text-slate-600 dark:text-slate-300 break-words">
                          {dispenser.model}
                        </span>
                      </div>
                      {dispenser.note && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 break-words whitespace-pre-wrap">
                          <span className="font-semibold">Açıklama:</span>{' '}
                          {dispenser.note}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(dispenser)}
                        disabled={!isOnline || saving || deletingId !== null}
                        className="min-w-11 min-h-11 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                        aria-label={`${dispenser.brand} ${dispenser.model} sebilini düzenle`}
                        title="Düzenle"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(dispenser)}
                        disabled={!isOnline || saving || deletingId !== null}
                        className="min-w-11 min-h-11 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                        aria-label={`${dispenser.brand} ${dispenser.model} sebilini sil`}
                        title="Sil"
                      >
                        {deletingId === dispenser.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {formOpen && (
            <form
              onSubmit={handleSubmit}
              className="rounded-lg border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/20 p-3 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-sky-900 dark:text-sky-200">
                  {editing ? 'Sebil Düzenle' : 'Yeni Sebil'}
                </span>
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={saving}
                  className="min-w-11 min-h-11 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-white/70 dark:hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center"
                  aria-label="Sebil formunu kapat"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block min-w-0 text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Marka <span className="text-red-600">*</span>
                  <input
                    type="text"
                    value={brand}
                    onChange={(event) => setBrand(event.target.value)}
                    list={brandListId}
                    maxLength={60}
                    required
                    autoComplete="off"
                    className="mt-1 w-full min-h-12 px-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-base text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <datalist id={brandListId}>
                    {suggestions.brands.map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                </label>

                <label className="block min-w-0 text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Model <span className="text-red-600">*</span>
                  <input
                    type="text"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    list={modelListId}
                    maxLength={60}
                    required
                    autoComplete="off"
                    className="mt-1 w-full min-h-12 px-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-base text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <datalist id={modelListId}>
                    {suggestions.models.map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                </label>
              </div>

              <label className="block min-w-0 text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Adet <span className="text-red-600">*</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  required
                  className="mt-1 w-full min-h-12 px-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-base text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </label>

              <label className="block min-w-0 text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Açıklama (isteğe bağlı)
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={300}
                  rows={2}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-base text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 resize-y"
                />
              </label>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={saving}
                  className="min-h-11 px-3 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-xs font-bold disabled:opacity-50"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={!isOnline || saving}
                  className="min-h-12 px-4 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center justify-center gap-1.5"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  <span>{saving ? 'Kaydediliyor...' : 'Kaydet'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
};
