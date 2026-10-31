import React, { useState } from 'react';
import { Customer } from '../../types';
import { createCustomerPayment } from '../../services/api';
import { AlertCircle, CheckCircle2, Wallet, X } from 'lucide-react';

interface CustomerPaymentModalProps {
  customer: Customer;
  onClose: () => void;
  onSaved: (newBalance: number) => void;
}

const moneyFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// AGENTS.md Bölüm 6 — Teslimat dışı (sonraki ziyaret) müşteri tahsilatı.
// Bakiye, ödeme kaydı ve denetim izi sunucuda tek transaction'da yazılır.
export const CustomerPaymentModal: React.FC<CustomerPaymentModalProps> = ({
  customer,
  onClose,
  onSaved,
}) => {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'POS' | 'TRANSFER'>('CASH');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      setError('Tahsilat tutarı sıfırdan büyük olmalıdır.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createCustomerPayment(customer.id, {
        amount: value,
        method,
        note: note.trim(),
      });
      setSuccess(
        `${moneyFmt.format(value)} ₺ tahsilat kaydedildi. Güncel bakiye: ${moneyFmt.format(
          result.balance
        )} ₺`
      );
      setAmount('');
      setNote('');
      onSaved(result.balance);
    } catch (err: any) {
      setError(err?.message || 'Tahsilat kaydedilemedi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentBalance = Number(customer.currentBalanceTL) || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-md my-4 min-w-0">
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Tahsilat Al</span>
            </h2>
            <p className="text-xs text-slate-500 break-words">{customer.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
            <div className="text-[11px] text-slate-500">Güncel Cari Bakiye</div>
            <div
              className={`font-mono font-bold text-lg tabular-nums ${
                currentBalance > 0
                  ? 'text-rose-600 dark:text-rose-300'
                  : currentBalance < 0
                  ? 'text-emerald-600 dark:text-emerald-300'
                  : 'text-slate-700 dark:text-slate-200'
              }`}
            >
              {moneyFmt.format(currentBalance)} ₺
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-[11px]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="break-words">{error}</span>
            </div>
          )}
          {success && (
            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-[11px]">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="break-words">{success}</span>
            </div>
          )}

          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">Tutar (₺)</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-mono text-slate-900 dark:text-white"
            />
          </label>

          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">
              Ödeme Yöntemi
            </span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as 'CASH' | 'POS' | 'TRANSFER')}
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
            >
              <option value="CASH">Nakit</option>
              <option value="POS">POS / Kredi Kartı</option>
              <option value="TRANSFER">Havale / EFT</option>
            </select>
          </label>

          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">
              Not (isteğe bağlı)
            </span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Örn: Geçen haftaki borç için"
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
            />
          </label>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="w-1/2 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs"
            >
              Kapat
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-1/2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs"
            >
              {isSubmitting ? 'Kaydediliyor...' : 'Tahsilatı Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
