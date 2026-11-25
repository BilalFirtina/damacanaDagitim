import React from 'react';
import type { FuelEntry } from '../../types';
import { formatDateTr } from '../../services/dateWindow';
import { FUEL_GENERAL_PLATE_LABEL } from '../../services/fuelRules';
import { Fuel, Trash2, UserRound } from 'lucide-react';

const moneyFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const literFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

interface FuelEntryCardProps {
  entry: FuelEntry;
  canCancel: boolean;
  onCancel: (entry: FuelEntry) => void;
}

export const FuelEntryCard: React.FC<FuelEntryCardProps> = ({
  entry,
  canCancel,
  onCancel,
}) => {
  const isCredit = entry.entryType === 'credit';
  return (
    <article className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ${
                isCredit
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-sky-100 text-sky-800'
              }`}
            >
              <Fuel className="w-3 h-3" />
              {isCredit ? 'Mazot Yüklemesi' : 'Yakıt Alımı'}
            </span>
            <span className="text-[11px] text-slate-500">
              {formatDateTr(entry.entryDate)}
            </span>
          </div>
          <p className="text-sm font-bold text-slate-900 mt-1.5 break-words">
            {isCredit ? FUEL_GENERAL_PLATE_LABEL : entry.plate || '—'}
          </p>
        </div>

        {canCancel && (
          <button
            type="button"
            onClick={() => onCancel(entry)}
            className="self-start min-h-11 px-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-bold flex items-center gap-1.5 hover:bg-rose-100"
          >
            <Trash2 className="w-3.5 h-3.5" />
            İptal
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 min-w-0">
          <div className="text-[10px] text-slate-500 uppercase font-semibold">Şoför</div>
          <div className="font-bold text-slate-900 break-words flex items-start gap-1 mt-0.5">
            <UserRound className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
            <span>{entry.createdByUserName || '—'}</span>
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 min-w-0">
          <div className="text-[10px] text-slate-500 uppercase font-semibold">KM</div>
          <div className="font-mono font-bold text-slate-900 mt-0.5 tabular-nums break-words">
            {entry.mileageKm === null
              ? '—'
              : entry.mileageKm.toLocaleString('tr-TR')}
          </div>
        </div>
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 min-w-0">
          <div className="text-[10px] text-emerald-700 uppercase font-semibold">Litre</div>
          <div className="font-mono font-bold text-emerald-800 mt-0.5 tabular-nums break-words">
            {literFmt.format(entry.liters)} L
          </div>
        </div>
        <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-2.5 min-w-0">
          <div className="text-[10px] text-indigo-700 uppercase font-semibold">Tutar</div>
          <div className="font-mono font-bold text-indigo-800 mt-0.5 tabular-nums break-words">
            {entry.amountTl === null ? '—' : `${moneyFmt.format(entry.amountTl)} ₺`}
          </div>
        </div>
      </div>

      {entry.note && (
        <p className="text-[11px] text-slate-500 break-words whitespace-pre-line">
          {entry.note}
        </p>
      )}
    </article>
  );
};
