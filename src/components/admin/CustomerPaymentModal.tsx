import React, { useState } from 'react';
import { Customer } from '../../types';
import { createCustomerPayment } from '../../services/api';
import { AlertCircle, CheckCircle2, Wallet, X } from 'lucide-react';

interface CustomerPaymentModalProps {
  customer: Customer;
  onClose: () => void;
  onSaved: (newBalance: number | null) => void;
  /** Faturalı müşteride şoför bakiyeyi görmez (AGENTS.md 6.1). */
  hideBalance?: boolean;
  /** Şoför tahsilatını aktif sefere bağlar. */
  dispatchId?: string;
}

const moneyFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const newPaymentId = () =>
  `pay_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

// AGENTS.md Bölüm 6 — Teslimat dışı (sonraki ziyaret) müşteri tahsilatı.
// Bakiye, ödeme kaydı ve denetim izi sunucuda tek transaction'da yazılır.
export const CustomerPaymentModal: React.FC<CustomerPaymentModalProps> = ({
  customer,
  onClose,
  onSaved,
  hideBalance = false,
  dispatchId,
}) => {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'POS'>('CASH');
  const [note, setNote] = useState('');
  // Ağ hatasında aynı kimlikle yeniden denenir; sunucu mükerrer düşürmeyi engeller.
  const [paymentId, setPaymentId] = useState<string>(newPaymentId);
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
        paymentId,
        ...(dispatchId ? { dispatchId } : {}),
      });
      setSuccess(
        hideBalance || result.balance === null
          ? `${moneyFmt.format(value)} ₺ tahsilat kaydedildi.`
          : `${moneyFmt.format(value)} ₺ tahsilat kaydedildi. Güncel bakiye: ${moneyFmt.format(
              result.balance
            )} ₺`
      );
      setAmount('');
      setNote('');
      setPaymentId(newPaymentId());
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
      <div className="bg-white  rounded-2xl border border-slate-200  shadow-2xl w-full max-w-md my-4 min-w-0">
        <div className="p-4 sm:p-5 border-b border-slate-100  flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900  flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Tahsilat Al</span>
            </h2>
            <p className="text-xs text-slate-500 break-words">{customer.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-2 rounded-xl hover:bg-slate-100  text-slate-500"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-3">
          {hideBalance ? (
            <div className="rounded-xl border border-slate-200  p-3 text-[11px] text-slate-500">
              Faturalı müşteri — cari bakiye yönetici tarafından takip edilir.
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200  p-3">
              <div className="text-[11px] text-slate-500">Güncel Cari Bakiye</div>
              <div
                className={`font-mono font-bold text-lg tabular-nums ${
                  currentBalance > 0
                    ? 'text-rose-600 '
                    : currentBalance < 0
                      ? 'text-emerald-600 '
                      : 'text-slate-700 '
                }`}
              >
                {moneyFmt.format(currentBalance)} ₺
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-50  border border-rose-200  text-rose-800  text-[11px]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="break-words">{error}</span>
            </div>
          )}
          {success && (
            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-emerald-50  border border-emerald-200  text-emerald-800  text-[11px]">
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
              className="w-full p-2.5 rounded-xl border border-slate-200  bg-slate-50  text-sm font-mono text-slate-900 "
            />
          </label>

          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">
              Ödeme Yöntemi
            </span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as 'CASH' | 'POS')}
              className="w-full p-2.5 rounded-xl border border-slate-200  bg-slate-50  text-xs text-slate-900 "
            >
              <option value="CASH">Nakit</option>
              <option value="POS">POS / Kredi Kartı</option>
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
              className="w-full p-2.5 rounded-xl border border-slate-200  bg-slate-50  text-xs text-slate-900 "
            />
          </label>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="w-1/2 py-2.5 rounded-xl border border-slate-200  text-slate-700  font-semibold text-xs"
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
