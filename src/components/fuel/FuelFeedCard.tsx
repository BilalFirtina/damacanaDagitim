import React from 'react';
import type { FuelEntry } from '../../types';
import { formatDateTimeTr } from '../../services/dateWindow';
import { FUEL_GENERAL_PLATE_LABEL } from '../../services/fuelRules';
import { Fuel, UserRound } from 'lucide-react';

const moneyFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const literFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export const FuelFeedCard: React.FC<{ entry: FuelEntry }> = ({ entry }) => {
  const isCredit = entry.entryType === 'credit';
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 min-w-0 border-l-4 border-l-amber-400">
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ${
                isCredit ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'
              }`}
            >
              <Fuel className="w-3 h-3" />
              {isCredit ? 'Mazot Yüklemesi' : 'Yakıt Alımı'}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {formatDateTimeTr(entry.createdAt)}
            </span>
          </div>
          <p className="text-sm font-bold text-slate-900 mt-1 break-words">
            {isCredit ? FUEL_GENERAL_PLATE_LABEL : entry.plate || '—'}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
          <UserRound className="w-3 h-3 text-slate-400" />
          {entry.createdByUserName || '—'}
        </span>
        <span className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
          KM: {entry.mileageKm === null ? '—' : entry.mileageKm.toLocaleString('tr-TR')}
        </span>
        <span className="px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold">
          {literFmt.format(entry.liters)} Litre
        </span>
        <span className="px-2 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 font-semibold">
          {entry.amountTl === null ? '—' : `${moneyFmt.format(entry.amountTl)} ₺`}
        </span>
      </div>

      {entry.note && (
        <p className="text-[11px] text-slate-500 mt-1.5 break-words whitespace-pre-line">
          {entry.note}
        </p>
      )}
    </div>
  );
};
