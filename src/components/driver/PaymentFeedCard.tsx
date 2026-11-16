import React from 'react';
import { Clock, CreditCard, Truck, Wallet } from 'lucide-react';
import type { CustomerPayment } from '../../types';
import { formatDateTimeTr } from '../../services/dateWindow';

interface PaymentFeedCardProps {
  payment: CustomerPayment;
}

const moneyFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const money = (value: number) => `${moneyFmt.format(value)} ₺`;

const methodLabel = (method: CustomerPayment['method']) =>
  method === 'CASH' ? 'Nakit' : method === 'POS' ? 'POS' : 'Havale';

// Teslimat dışı tahsilat kartı — canlı akışta salt okunurdur.
export const PaymentFeedCard: React.FC<PaymentFeedCardProps> = ({ payment }) => {
  const cancelled = payment.status === 'cancelled';
  const MethodIcon = payment.method === 'POS' ? CreditCard : Wallet;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-4 sm:p-5 shadow-xs transition-all hover:shadow-md ${
        cancelled
          ? 'border-slate-200 bg-white opacity-80'
          : 'border-teal-200 bg-gradient-to-br from-teal-50/40 via-white to-emerald-50/30'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1 ${
          cancelled
            ? 'bg-slate-400'
            : 'bg-gradient-to-b from-teal-400 via-emerald-500 to-cyan-500'
        }`}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-xs ${
              cancelled
                ? 'bg-slate-500 text-white'
                : 'bg-gradient-to-br from-teal-500 via-emerald-500 to-cyan-600 text-white'
            }`}
          >
            <MethodIcon className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="font-bold text-xs px-2.5 py-0.5 rounded-lg flex items-center gap-1.5 bg-gradient-to-r from-teal-100 via-emerald-100 to-cyan-100 text-teal-900 border border-teal-300 max-w-full break-words">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="break-words">
                {payment.customerName || payment.customerId}
              </span>
            </span>
            {payment.isAccountCustomer && (
              <span className="font-bold text-[10px] px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600 border border-slate-200">
                Faturalı
              </span>
            )}
            {payment.dispatchPlate && (
              <span className="inline-flex items-center gap-1 font-mono font-bold text-xs px-2 py-0.5 rounded-lg bg-slate-100 text-slate-800 border border-slate-200">
                <Truck className="w-3 h-3" />
                {payment.dispatchPlate}
              </span>
            )}
            {cancelled && (
              <span className="font-bold text-[10px] px-2 py-0.5 rounded-lg bg-rose-100 text-rose-800 border border-rose-200">
                İptal Edildi
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400 shrink-0">
          <Clock className="w-3.5 h-3.5" />
          <span className="font-mono">{formatDateTimeTr(payment.collectedAt)}</span>
        </div>
      </div>

      <div className="mt-3 flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="space-y-2 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="px-2.5 py-1 rounded-lg bg-white/90 text-slate-800 text-xs font-medium border border-slate-200 shadow-2xs max-w-full break-words">
              <strong className="font-mono tabular-nums text-teal-700">
                {money(payment.amount)}
              </strong>{' '}
              {methodLabel(payment.method)} tahsilat
            </span>
            {payment.note && (
              <span className="px-2.5 py-1 rounded-lg bg-white/90 text-slate-600 text-xs border border-slate-200 shadow-2xs max-w-full break-words">
                {payment.note}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
            <MethodIcon className="w-3.5 h-3.5" />
            <span>{cancelled ? 'Tahsilat İptal Edildi' : 'Tahsilat Alındı'}</span>
          </div>

          <div className="text-[11px] text-slate-500 break-words">
            Tahsil Eden: <strong>{payment.collectedByUserName || '-'}</strong>
            {payment.correctedByUserName && (
              <span className="text-slate-400">
                {' '}
                · Son düzeltme: {payment.correctedByUserName}
              </span>
            )}
          </div>
        </div>

        <div className="bg-white/80 p-3 rounded-xl border border-slate-200 shrink-0 w-full sm:w-auto sm:min-w-[200px] text-right space-y-1 shadow-2xs">
          <div className="text-[11px] text-slate-500">Tahsilat Tutarı</div>
          <div
            className={`text-base font-extrabold font-mono tabular-nums ${
              cancelled ? 'text-slate-400 line-through' : 'text-slate-900'
            }`}
          >
            {money(payment.amount)}
          </div>
        </div>
      </div>
    </div>
  );
};
