import React, { useMemo, useState } from 'react';
import type { Dispatch, Product } from '../../types';
import { formatDateTr, todayUtcDateStr } from '../../services/dateWindow';
import { buildRecentEndOfDayReports } from '../../services/recentEndOfDayReports';
import {
  ChevronDown,
  ChevronUp,
  Droplet,
  History,
  PackageCheck,
  Wallet,
} from 'lucide-react';

const moneyFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface RecentEndOfDayReportsProps {
  dispatches: Dispatch[];
  products: Product[];
}

// Gün sonu sekmesinin altında, son 2 günün kapanmış seferlerini salt okunur gösterir.
export const RecentEndOfDayReports: React.FC<RecentEndOfDayReportsProps> = ({
  dispatches,
  products,
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const reports = useMemo(
    () =>
      buildRecentEndOfDayReports({
        dispatches,
        products,
        today: todayUtcDateStr(),
      }),
    [dispatches, products]
  );

  if (reports.length === 0) return null;

  return (
    <section className="print:hidden bg-slate-50 rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3 w-full max-w-full min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600 shrink-0" />
            <span className="break-words">Son 2 Günün Gün Sonu Raporları</span>
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5 break-words">
            Dün ve önceki gün kapatılan seferler. Salt okunur bilgi amaçlıdır.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen((value) => !value)}
          aria-expanded={isOpen}
          className="shrink-0 min-h-11 px-3 rounded-xl border border-slate-200 bg-white text-slate-600 flex items-center gap-1"
        >
          <span className="text-[11px] font-bold">{isOpen ? 'Kapat' : 'Aç'}</span>
          {isOpen ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      </div>

      {isOpen && (
        <div className="space-y-3">
          {reports.map((report) => (
            <article
              key={report.dispatchId}
              className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 min-w-0"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 min-w-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-900 break-words">
                      {formatDateTr(report.date)}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
                      Kapatıldı
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1 break-words">
                    {report.driverName}
                    <span className="text-slate-400"> · </span>
                    <span className="font-mono">{report.vehiclePlate}</span>
                  </p>
                  {report.closedByUserName && (
                    <p className="text-[10px] text-slate-400 mt-0.5 break-words">
                      Kapatan: {report.closedByUserName}
                    </p>
                  )}
                </div>
              </div>

              {!report.hasReconciliation ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5 break-words">
                  Bu sefer için gün sonu kaydı bulunmuyor.
                </p>
              ) : (
                <>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1.5 mb-1.5">
                      <PackageCheck className="w-3.5 h-3.5 text-sky-600" />
                      <span>Depoya Teslim Edilen Ürünler</span>
                    </div>
                    {report.products.length === 0 ? (
                      <p className="text-xs text-slate-400">Depoya ürün kalmadı.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {report.products.map((product) => (
                          <span
                            key={product.productId}
                            className="px-2.5 py-1 rounded-lg bg-sky-50 border border-sky-200 text-slate-800 text-xs font-medium break-words"
                          >
                            {product.name} · {product.quantity} {product.unit}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1.5 mb-1.5">
                      <Droplet className="w-3.5 h-3.5 text-orange-600" />
                      <span>Toplanan Boş Kaplar</span>
                    </div>
                    {report.empties.length === 0 ? (
                      <p className="text-xs text-slate-400">Boş kap toplanmadı.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {report.empties.map((empty) => (
                          <span
                            key={empty.label}
                            className="px-2.5 py-1 rounded-lg bg-orange-50 border border-orange-200 text-orange-900 text-xs font-medium break-words"
                          >
                            {empty.label} · {empty.quantity} Adet
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1.5 mb-1.5">
                      <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Tahsilat</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 min-w-0">
                        <div className="text-[10px] font-semibold text-emerald-700 uppercase">
                          Nakit
                        </div>
                        <div className="text-sm font-bold font-mono tabular-nums text-emerald-800 break-words">
                          {moneyFmt.format(report.cash)} ₺
                        </div>
                      </div>
                      <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-2.5 min-w-0">
                        <div className="text-[10px] font-semibold text-indigo-700 uppercase">
                          POS
                        </div>
                        <div className="text-sm font-bold font-mono tabular-nums text-indigo-800 break-words">
                          {moneyFmt.format(report.pos)} ₺
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 min-w-0 col-span-2 sm:col-span-1">
                        <div className="text-[10px] font-semibold text-slate-500 uppercase">
                          Toplam
                        </div>
                        <div className="text-sm font-bold font-mono tabular-nums text-slate-900 break-words">
                          {moneyFmt.format(report.total)} ₺
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
