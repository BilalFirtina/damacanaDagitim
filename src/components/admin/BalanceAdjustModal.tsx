import React, { useState } from 'react';
import { AlertCircle, Wallet, X } from 'lucide-react';
import type { Customer } from '../../types';
import { updateCustomer } from '../../services/api';
import { parseBalanceInput } from '../../services/balanceAdjustRules';

interface BalanceAdjustModalProps {
  customer: Customer;
  onClose: () => void;
  onSaved: (customer: Customer) => void;
}

const moneyFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const money = (value: number) => `${moneyFmt.format(value)} ₺`;

// Yönetici cari bakiye düzeltmesi. Açıklama istenmez; denetim kaydında
// sunucu tarafından "Yönetici düzeltmesi" yazılır.
export const BalanceAdjustModal: React.FC<BalanceAdjustModalProps> = ({
  customer,
  onClose,
  onSaved,
}) => {
  const currentBalance = Number(customer.currentBalanceTL) || 0;
  const [balanceInput, setBalanceInput] = useState(
    String(currentBalance).replace('.', ',')
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedBalance = parseBalanceInput(balanceInput);
  const difference =
    parsedBalance === null
      ? null
      : Math.round((parsedBalance - currentBalance) * 100) / 100;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (parsedBalance === null) {
      setError('Geçerli bir bakiye tutarı girin.');
      return;
    }
    if (Math.abs(parsedBalance - currentBalance) < 0.005) {
      setError('Yeni bakiye mevcut bakiyeyle aynı.');
      return;
    }

    setIsSubmitting(true);
    try {
      const updated = await updateCustomer(customer.id, {
        currentBalanceTL: parsedBalance,
        expectedBalanceTL: currentBalance,
      });
      onSaved(updated);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Cari bakiye düzeltilemedi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md my-4 min-w-0">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Wallet className="w-4 h-4 text-sky-600 shrink-0" />
              <span>Cari Bakiye Düzelt</span>
            </h2>
            <p className="text-xs text-slate-500 break-words">{customer.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="shrink-0 p-2 rounded-xl hover:bg-slate-100 text-slate-500 disabled:opacity-40"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-3">
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="text-[11px] text-slate-500">Mevcut Bakiye</div>
            <div
              className={`font-mono font-bold text-lg tabular-nums ${
                currentBalance > 0
                  ? 'text-rose-600'
                  : currentBalance < 0
                    ? 'text-emerald-600'
                    : 'text-slate-700'
              }`}
            >
              {money(currentBalance)}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="break-words">{error}</span>
            </div>
          )}

          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">
              Yeni Bakiye (₺)
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={balanceInput}
              onChange={(e) => setBalanceInput(e.target.value)}
              placeholder="0,00"
              className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-mono text-slate-900"
            />
            <span className="text-[10px] text-slate-400 block mt-1">
              Negatif değer müşteri avansı anlamına gelir.
            </span>
          </label>

          {parsedBalance !== null && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
              <span className="text-slate-500">Fark</span>
              <span
                className={`font-mono font-bold tabular-nums ${
                  (difference || 0) > 0
                    ? 'text-rose-600'
                    : (difference || 0) < 0
                      ? 'text-emerald-600'
                      : 'text-slate-600'
                }`}
              >
                {(difference || 0) > 0 ? '+' : ''}
                {money(difference || 0)}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="w-1/2 min-h-11 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs disabled:opacity-40"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-1/2 min-h-11 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-60 font-bold text-xs"
            >
              {isSubmitting ? 'Kaydediliyor...' : 'Bakiyeyi Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
