import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Wallet, X } from 'lucide-react';
import type { CustomerPayment } from '../../types';
import { updateCustomerPayment, PaymentChangedError } from '../../services/api';

interface PaymentCorrectionModalProps {
  payment: CustomerPayment;
  onClose: () => void;
  onSaved: () => void;
}

type PaymentMethod = 'CASH' | 'POS';

interface PaymentSnapshot {
  amount: number;
  method: PaymentMethod;
}

const moneyFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Nakit',
  POS: 'POS',
};

const toMethod = (method: CustomerPayment['method'] | string | undefined): PaymentMethod =>
  method === 'POS' ? 'POS' : 'CASH';

const toInputValue = (amount: number) => amount.toFixed(2).replace('.', ',');

const sanitizeAmountInput = (raw: string) => {
  const match = raw.replace(/[^\d.,]/g, '').match(/^(\d*)([.,]?)(\d{0,2})/);
  if (!match) return '';
  const [, whole, separator, decimals] = match;
  return separator ? `${whole}${separator}${decimals}` : whole;
};

const parseAmountInput = (raw: string) => {
  const value = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN;
};

export const PaymentCorrectionModal: React.FC<PaymentCorrectionModalProps> = ({
  payment,
  onClose,
  onSaved,
}) => {
  const [saved, setSaved] = useState<PaymentSnapshot>(() => ({
    amount: payment.amount,
    method: toMethod(payment.method),
  }));
  const [amountInput, setAmountInput] = useState(() => toInputValue(payment.amount));
  const [method, setMethod] = useState<PaymentMethod>(() => toMethod(payment.method));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const submittingRef = useRef(false);

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

  const newAmount = parseAmountInput(amountInput);
  const isAmountValid = Number.isFinite(newAmount) && newAmount > 0;
  const amountDiff = isAmountValid
    ? Math.round((newAmount - saved.amount) * 100) / 100
    : 0;
  const amountChanged = isAmountValid && amountDiff !== 0;
  const methodChanged = method !== saved.method;
  const hasChange = amountChanged || methodChanged;
  const canSave = isOnline && isAmountValid && hasChange && !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || submittingRef.current) return;

    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await updateCustomerPayment(payment.id, {
        amount: newAmount,
        method,
        expectedAmount: saved.amount,
        expectedMethod: saved.method,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      if (err instanceof PaymentChangedError || err?.code === 'PAYMENT_CHANGED') {
        const currentAmount = Number(err.currentAmount);
        const next: PaymentSnapshot = {
          amount: Number.isFinite(currentAmount) ? currentAmount : saved.amount,
          method: toMethod(err.currentMethod),
        };
        setSaved(next);
        setError(
          `Bu tahsilat başka bir cihazda değiştirildi. Güncel tutar: ${moneyFmt.format(
            next.amount
          )} ₺. Lütfen kontrol edip tekrar kaydedin.`
        );
      } else if (err instanceof TypeError) {
        setError('Bağlantı yok, kayıt yapılmadı. Tekrar deneyin.');
      } else {
        setError(err?.message || 'Tahsilat düzeltilemedi.');
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-correction-title"
        className="relative w-full max-w-md min-w-0 max-h-[92dvh] flex flex-col bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 shadow-2xl overflow-hidden"
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-100 shrink-0">
          <div className="min-w-0">
            <h2
              id="payment-correction-title"
              className="text-sm font-bold text-slate-900 flex items-center gap-2"
            >
              <Wallet className="w-4 h-4 text-sky-600 shrink-0" />
              <span>Tahsilatı Düzelt</span>
            </h2>
            <p className="text-xs text-slate-500 break-words">
              {payment.customerName || payment.customerId}
            </p>
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

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4 min-w-0">
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold min-w-0"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-words min-w-0">{error}</span>
              </div>
            )}

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 min-w-0">
              <div className="text-xs font-semibold text-slate-500">Mevcut tutar:</div>
              <div className="flex flex-wrap items-baseline gap-x-2 text-slate-900 min-w-0">
                <span className="font-mono font-extrabold text-2xl tabular-nums break-all">
                  {moneyFmt.format(saved.amount)} ₺
                </span>
                <span className="text-sm font-semibold text-slate-600">
                  · {METHOD_LABELS[saved.method]}
                </span>
              </div>
            </div>

            <div className="space-y-1.5 min-w-0">
              <label
                htmlFor="payment-correction-amount"
                className="block text-xs font-bold text-slate-700"
              >
                Yeni tutar
              </label>
              <div className="relative min-w-0">
                <input
                  id="payment-correction-amount"
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={amountInput}
                  onChange={(e) => setAmountInput(sanitizeAmountInput(e.target.value))}
                  onFocus={(e) => e.target.select()}
                  disabled={isSubmitting}
                  placeholder="0,00"
                  className="w-full min-w-0 min-h-12 pl-4 pr-12 py-3 rounded-xl border border-slate-300 bg-white text-xl font-bold font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xl font-bold text-slate-500">
                  ₺
                </span>
              </div>
              {!isAmountValid && (
                <p className="text-[11px] font-semibold text-rose-600">
                  Tutar 0'dan büyük olmalıdır.
                </p>
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setAmountInput(toInputValue(saved.amount))}
                  disabled={isSubmitting}
                  className="text-xs font-semibold text-sky-700 hover:underline disabled:opacity-40"
                >
                  Eski tutara dön
                </button>
              </div>
            </div>

            <div className="space-y-1.5 min-w-0">
              <span className="block text-xs font-bold text-slate-700">Ödeme yöntemi</span>
              <div className="grid grid-cols-2 gap-2">
                {(['CASH', 'POS'] as const).map((option) => {
                  const selected = method === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setMethod(option)}
                      disabled={isSubmitting}
                      aria-pressed={selected}
                      className={`w-full min-w-0 min-h-12 rounded-xl border text-sm font-bold transition-colors disabled:opacity-60 ${
                        selected
                          ? 'bg-sky-600 border-sky-600 text-white'
                          : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {METHOD_LABELS[option]}
                    </button>
                  );
                })}
              </div>
            </div>

            {isAmountValid &&
              (hasChange ? (
                <div className="rounded-xl bg-sky-50 border border-sky-200 p-3 text-xs text-sky-900 space-y-1 min-w-0">
                  <p className="font-bold">Değişiklik özeti</p>
                  {amountChanged && (
                    <p className="font-mono tabular-nums break-words">
                      {moneyFmt.format(saved.amount)} ₺ → {moneyFmt.format(newAmount)} ₺ (
                      {amountDiff > 0 ? '+' : '-'}
                      {moneyFmt.format(Math.abs(amountDiff))} ₺)
                    </p>
                  )}
                  {methodChanged && (
                    <p>
                      {METHOD_LABELS[saved.method]} → {METHOD_LABELS[method]}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs font-semibold text-slate-500">Değişiklik yok</p>
              ))}

            {!isOnline && (
              <p className="text-xs font-semibold text-amber-700 break-words">
                Tahsilat düzeltmek için internet bağlantısı gerekir.
              </p>
            )}
          </div>

          <div className="shrink-0 flex items-center gap-2 p-4 border-t border-slate-200 bg-white pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 min-w-0 min-h-12 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-sm hover:bg-slate-50 disabled:opacity-40"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="flex-1 min-w-0 min-h-12 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
