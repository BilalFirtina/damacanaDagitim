import React from 'react';
import { AlertTriangle, CalendarDays, FileCheck, Truck } from 'lucide-react';
import { Dispatch } from '../../types';
import { formatDateTr } from '../../services/dateWindow';

interface StaleDispatchWarningProps {
  /** Tarihi geçmiş ve hâlâ açık olan sefer. */
  dispatch: Dispatch;
  /** Şoförü doğrudan bu seferin gün sonu ekranına götürür. */
  onCompleteEndOfDay: () => void;
}

// AGENTS.md Bölüm 9.1 — Sonlandırılmamış sefer uyarısı.
// Bilinçli olarak kapatılamaz (dismiss edilemez): sefer sonlandırılana kadar
// şoförün her girişinde görünür ve yeni sefer başlatılamaz.
export const StaleDispatchWarning: React.FC<StaleDispatchWarningProps> = ({
  dispatch,
  onCompleteEndOfDay,
}) => {
  return (
    <div
      role="alert"
      className="w-full max-w-full min-w-0 rounded-2xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 sm:p-5 shadow-xs space-y-3"
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-md">
          <AlertTriangle className="w-5 h-5" />
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-amber-950 dark:text-amber-200 break-words">
              Önceki seferiniz sonlandırılmadı
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200">
              Önceki gün sonlandırılmadı
            </span>
          </div>

          <p className="text-xs font-semibold text-amber-900 dark:text-amber-200 break-words">
            Yeni sefere başlamadan önce gün sonunu tamamlayın.
          </p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-amber-900/90 dark:text-amber-300 min-w-0">
            <span className="inline-flex items-center gap-1 min-w-0 break-words">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" />
              <span>Sefer tarihi: <strong>{formatDateTr(dispatch.date)}</strong></span>
            </span>
            <span className="inline-flex items-center gap-1 min-w-0 break-words">
              <Truck className="w-3.5 h-3.5 shrink-0" />
              <span>Araç: <strong>{dispatch.vehiclePlate}</strong></span>
            </span>
          </div>

          <p className="text-[11px] text-amber-900/80 dark:text-amber-300/90 break-words">
            Bu sefer kapatılmadan yeni sefer yüklemesi yapılamaz. Sayım, mutabakat ve rapor şoförün sorumluluğundadır.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onCompleteEndOfDay}
        className="w-full sm:w-auto px-5 py-3 rounded-xl bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-all"
      >
        <FileCheck className="w-4 h-4" />
        <span>Gün Sonunu Tamamla</span>
      </button>
    </div>
  );
};
