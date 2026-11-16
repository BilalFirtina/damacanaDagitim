import React, { useState } from 'react';
import { AlertCircle, Wallet, X } from 'lucide-react';
import type { CustomerPayment } from '../../types';
import { updateCustomerPayment } from '../../services/api';

interface PaymentCorrectionModalProps {
  payment: CustomerPayment;
  onClose: () => void;
  onSaved: () => void;
}

const moneyFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const newRequestId = () =>
  `payfix_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

// Teslimat dışı tahsilat düzeltmesi — AGENTS.md 13 (denetim izi sunucuda).
export const PaymentCorrectionModal: React.FC<PaymentCorrectionModalProps> = ({
  payment,
  onClose,
  onSaved,
}) => {
  const [amount, setAmount] = useState(
    String(payment.amount).replace('.', ',')
  );
  const [method, setMethod] = useState<'CASH' | 'POS'>(
    payment.method === 'POS' ? 'POS' : 'CASH'
  );
  const [note, setNote] = useState(payment.note || '');
  // Ağ hatasında aynı kimlikle yeniden denenir; sunucu mükerrer yazmayı engeller.
  const [requestId] = useState<string>(newRequestId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const value = Number(amount.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      setError('Tahsilat tutarı sıfırdan büyük olmalıdır.');
      return;
    }

    setIsSubmitting(true);
    try {
      await updateCustomerPayment(payment.id, {
        amount: value,
        method,
        note: note.trim(),
        requestId,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Tahsilat düzeltilemedi.');
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

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-3">
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="text-[11px] text-slate-500">Mevcut Tahsilat</div>
            <div className="font-mono font-bold text-base tabular-nums text-slate-900">
              {moneyFmt.format(payment.amount)} ₺
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
              Yeni Tutar (₺)
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-mono text-slate-900"
            />
          </label>

          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">
              Ödeme Yöntemi
            </span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as 'CASH' | 'POS')}
              className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900"
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
              className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900"
            />
          </label>

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
              {isSubmitting ? 'Kaydediliyor...' : 'Düzeltmeyi Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
