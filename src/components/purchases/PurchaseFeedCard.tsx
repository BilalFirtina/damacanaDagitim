import React from 'react';
import {
  CheckCircle2,
  Clock,
  Package,
  Pencil,
  Truck,
  X,
} from 'lucide-react';
import type { Purchase } from '../../types';
import { formatDateTimeTr } from '../../services/dateWindow';

interface PurchaseFeedCardProps {
  purchase: Purchase;
  canManage?: boolean;
  onEdit?: (purchase: Purchase) => void;
  onCancel?: (purchase: Purchase) => void;
}

const moneyFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const money = (value: number) => `${moneyFmt.format(value)} ₺`;

export const PurchaseFeedCard: React.FC<PurchaseFeedCardProps> = ({
  purchase,
  canManage = false,
  onEdit,
  onCancel,
}) => {
  const cancelled = purchase.status === 'cancelled';

  return (
    <div
      className={`bg-white rounded-2xl border p-4 sm:p-5 shadow-xs transition-all hover:shadow-md border-l-4 ${
        cancelled
          ? 'border-l-slate-400 border-slate-200 opacity-80'
          : 'border-l-purple-500 border-purple-200 bg-purple-50/20'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 shadow-xs ${
              cancelled ? 'bg-slate-500 text-white' : 'bg-purple-600 text-white'
            }`}
          >
            <Package className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="font-bold text-xs px-2.5 py-0.5 rounded-lg flex items-center gap-1.5 bg-purple-100 text-purple-900 border border-purple-300 max-w-full break-words">
              <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
              <span className="break-words">{purchase.supplierName}</span>
            </span>
            {purchase.dispatchPlate && (
              <span className="inline-flex items-center gap-1 font-mono font-bold text-xs px-2 py-0.5 rounded-lg bg-slate-100 text-slate-800 border border-slate-200">
                <Truck className="w-3 h-3" />
                {purchase.dispatchPlate}
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
          <span className="font-mono">{formatDateTimeTr(purchase.purchasedAt)}</span>
        </div>
      </div>

      <div className="mt-3 flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="space-y-2 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {purchase.items.map((item, index) => (
              <span
                key={`${purchase.id}-${item.productId}-${index}`}
                className="px-2.5 py-1 rounded-lg bg-white/90 text-slate-800 text-xs font-medium border border-slate-200 shadow-2xs max-w-full break-words"
              >
                {item.productName} -{' '}
                <strong className="font-mono tabular-nums text-purple-700">
                  {item.quantity}
                </strong>{' '}
                {item.unit}
                {item.unitPrice !== null && (
                  <span className="text-slate-400 font-normal">
                    {' '}
                    ({money(item.unitPrice)})
                  </span>
                )}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Ürün Teslim Alındı</span>
          </div>

          {purchase.description && (
            <div className="text-xs text-slate-600 break-words">
              {purchase.description}
            </div>
          )}

          <div className="text-[11px] text-slate-500 break-words">
            Teslim Alan: <strong>{purchase.createdByUserName || '-'}</strong>
          </div>

          {canManage && !cancelled && (onEdit || onCancel) && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(purchase)}
                  className="min-h-11 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Düzelt
                </button>
              )}
              {onCancel && (
                <button
                  type="button"
                  onClick={() => onCancel(purchase)}
                  className="min-h-11 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs font-semibold hover:bg-rose-100"
                >
                  <X className="w-3.5 h-3.5" />
                  İptal Et
                </button>
              )}
            </div>
          )}
        </div>

        {purchase.totalAmount !== null && (
          <div className="bg-white/80 p-3 rounded-xl border border-slate-200 shrink-0 w-full sm:w-auto sm:min-w-[200px] text-right space-y-1 shadow-2xs">
            <div className="text-[11px] text-slate-500">Toplam Fiyat</div>
            <div className="text-base font-extrabold font-mono text-slate-900 tabular-nums">
              {money(purchase.totalAmount)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
