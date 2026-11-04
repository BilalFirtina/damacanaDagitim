import React, { useMemo, useState } from 'react';
import { Dispatch, Product } from '../../types';
import { AlertTriangle, CheckCircle2, Search, Truck } from 'lucide-react';

const moneyFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: number): string {
  return `${moneyFmt.format(Number(value) || 0)} ₺`;
}

interface DiscrepancyReportProps {
  dispatches: Dispatch[];
  products: Product[];
}

// AGENTS.md Bölüm 9 ve 10.2 — Araçta kalan ürün, nakit ve POS uyuşmazlıkları.
// Kaynak: gün sonu mutabakatındaki sayılan/ beklenen değerler.
export const DiscrepancyReport: React.FC<DiscrepancyReportProps> = ({
  dispatches,
  products,
}) => {
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [search, setSearch] = useState('');

  const productName = (id: string) => products.find((p) => p.id === id)?.name || id;

  const rows = useMemo(() => {
    return dispatches
      .filter((d) => d.status === 'completed' && d.endOfDayReconciliation)
      .map((dispatch) => {
        const recon = dispatch.endOfDayReconciliation!;
        const stockDiffs = Object.keys(recon.remainingFullCounted || {})
          .map((productId) => {
            const counted = Number(recon.remainingFullCounted[productId]) || 0;
            const expected = Number(recon.remainingFullExpected?.[productId]) || 0;
            return { productId, counted, expected, diff: counted - expected };
          })
          .filter((row) => row.diff !== 0);

        const cashDiff =
          (Number(recon.actualCashInPocket) || 0) - (Number(recon.totalCashCollected) || 0);
        const posDiff =
          (Number(recon.actualPosSlipsTotal) || 0) - (Number(recon.totalPosCollected) || 0);

        return {
          dispatch,
          recon,
          stockDiffs,
          cashDiff,
          posDiff,
          hasProblem: stockDiffs.length > 0 || Math.abs(cashDiff) > 0.005 || Math.abs(posDiff) > 0.005,
        };
      })
      .filter((row) => {
        if (onlyProblems && !row.hasProblem) return false;
        const term = search.trim().toLowerCase();
        if (!term) return true;
        return (
          row.dispatch.driverName.toLowerCase().includes(term) ||
          row.dispatch.vehiclePlate.toLowerCase().includes(term) ||
          row.dispatch.date.includes(term)
        );
      })
      .sort((a, b) => (a.dispatch.date < b.dispatch.date ? 1 : -1));
  }, [dispatches, onlyProblems, search]);

  return (
    <div className="space-y-4 w-full max-w-full min-w-0">
      <div className="bg-white  rounded-2xl border border-slate-200  p-4 sm:p-5 shadow-xs space-y-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 ">
            Araçta Kalan Ürün ve Kasa Uyuşmazlıkları
          </h2>
          <p className="text-xs text-slate-500">
            Gün sonu sayımında beklenen ile sayılan arasındaki farklar. İade edilebilir kalemler
            ayrı raporlanır.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="inline-flex rounded-xl bg-slate-100  p-1 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setOnlyProblems(true)}
              className={`flex-1 sm:flex-none min-h-9 px-3 rounded-lg text-xs font-bold ${
                onlyProblems
                  ? 'bg-white  text-slate-900  shadow-xs'
                  : 'text-slate-600 '
              }`}
            >
              Sadece Uyuşmazlıklar
            </button>
            <button
              type="button"
              onClick={() => setOnlyProblems(false)}
              className={`flex-1 sm:flex-none min-h-9 px-3 rounded-lg text-xs font-bold ${
                !onlyProblems
                  ? 'bg-white  text-slate-900  shadow-xs'
                  : 'text-slate-600 '
              }`}
            >
              Tüm Seferler
            </button>
          </div>

          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Şoför, plaka veya tarih ara..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200  bg-slate-50  text-xs text-slate-900 "
            />
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white  rounded-2xl border border-slate-200  p-10 text-center text-xs text-slate-400">
          {onlyProblems
            ? 'Uyuşmazlık bulunmuyor. Tüm kapatılan seferlerde sayım ve kasa tutuyor.'
            : 'Kapatılmış sefer bulunmuyor.'}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div
              key={row.dispatch.id}
              className={`bg-white  rounded-2xl border p-3.5 space-y-2.5 min-w-0 ${
                row.hasProblem
                  ? 'border-amber-300 '
                  : 'border-slate-200 '
              }`}
            >
              <div className="flex items-start justify-between gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="font-bold text-sm text-slate-900  break-words">
                    {row.dispatch.driverName}
                  </div>
                  <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2">
                    <span className="inline-flex items-center gap-1">
                      <Truck className="w-3.5 h-3.5" />
                      <span className="font-mono">{row.dispatch.vehiclePlate}</span>
                    </span>
                    <span>·</span>
                    <span>
                      {new Date(`${row.dispatch.date}T00:00:00.000Z`).toLocaleDateString('tr-TR')}
                    </span>
                  </div>
                </div>

                <span
                  className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                    row.hasProblem
                      ? 'bg-amber-100 text-amber-800  '
                      : 'bg-emerald-100 text-emerald-800  '
                  }`}
                >
                  {row.hasProblem ? (
                    <AlertTriangle className="w-3 h-3" />
                  ) : (
                    <CheckCircle2 className="w-3 h-3" />
                  )}
                  {row.hasProblem ? 'Uyuşmazlık' : 'Tutuyor'}
                </span>
              </div>

              {row.stockDiffs.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Araçta Kalan Ürün Farkı
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {row.stockDiffs.map((d) => (
                      <span
                        key={d.productId}
                        className="px-2 py-1 rounded-lg bg-amber-50  text-amber-800  text-[11px] font-mono break-words"
                      >
                        {productName(d.productId)}: beklenen {d.expected}, sayılan {d.counted} (
                        {d.diff > 0 ? '+' : ''}
                        {d.diff})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(Math.abs(row.cashDiff) > 0.005 || Math.abs(row.posDiff) > 0.005) && (
                <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                  {Math.abs(row.cashDiff) > 0.005 && (
                    <span className="px-2 py-1 rounded-lg bg-rose-50  text-rose-800 ">
                      Nakit fark: {row.cashDiff > 0 ? '+' : ''}
                      {money(row.cashDiff)}
                    </span>
                  )}
                  {Math.abs(row.posDiff) > 0.005 && (
                    <span className="px-2 py-1 rounded-lg bg-indigo-50  text-indigo-800 ">
                      POS fark: {row.posDiff > 0 ? '+' : ''}
                      {money(row.posDiff)}
                    </span>
                  )}
                </div>
              )}

              {!row.hasProblem && (
                <div className="text-[11px] text-slate-500 break-words">
                  Sayım ve kasa tutuyor. Kapanış: {row.recon.remainingFullCounted ? Object.keys(row.recon.remainingFullCounted).length : 0} ürün kalemi.
                </div>
              )}

              {row.recon.notes && (
                <div className="text-[11px] text-slate-500 break-words">
                  Açıklama: {row.recon.notes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
