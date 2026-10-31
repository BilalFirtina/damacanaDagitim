import React, { useEffect, useMemo, useState } from 'react';
import { Customer } from '../../types';
import {
  CustomerStatementResponse,
  fetchCustomerStatement,
} from '../../services/api';
import { formatDateTr, todayUtcDateStr } from '../../services/dateWindow';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Droplet,
  RefreshCw,
  Wallet,
  X,
} from 'lucide-react';

interface CustomerStatementModalProps {
  customer: Customer;
  onClose: () => void;
}

const moneyFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: number): string {
  return `${moneyFmt.format(Number(value) || 0)} ₺`;
}

function shiftDays(dateStr: string, days: number): string {
  return new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

// AGENTS.md Bölüm 10.1 — Müşteri cari hesap ekstresi.
// Finansal bakiye ile iade edilebilir kalem miktarları AYRI gösterilir (Bölüm 9).
export const CustomerStatementModal: React.FC<CustomerStatementModalProps> = ({
  customer,
  onClose,
}) => {
  const today = todayUtcDateStr();
  const [from, setFrom] = useState(() => shiftDays(today, -29));
  const [to, setTo] = useState(today);
  const [data, setData] = useState<CustomerStatementResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (fromDate: string, toDate: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchCustomerStatement(customer.id, fromDate, toDate);
      setData(result);
    } catch (err: any) {
      setError(err?.message || 'Cari hesap ekstresi alınamadı.');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load(from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statement = data?.statement;
  const entries = statement?.entries || [];

  const summary = useMemo(
    () => [
      { label: 'Açılış Bakiyesi', value: statement?.openingBalance ?? 0, tone: 'slate' },
      { label: 'Toplam Satış', value: statement?.totalSales ?? 0, tone: 'sky' },
      { label: 'Tahsilat', value: statement?.totalPayments ?? 0, tone: 'emerald' },
      { label: 'Düzeltme', value: statement?.totalAdjustments ?? 0, tone: 'amber' },
      { label: 'Kapanış Bakiyesi', value: statement?.closingBalance ?? 0, tone: 'rose' },
    ],
    [statement]
  );

  const toneClass = (tone: string) =>
    tone === 'sky'
      ? 'text-sky-700 dark:text-sky-300'
      : tone === 'emerald'
      ? 'text-emerald-700 dark:text-emerald-300'
      : tone === 'amber'
      ? 'text-amber-700 dark:text-amber-300'
      : tone === 'rose'
      ? 'text-rose-700 dark:text-rose-300'
      : 'text-slate-700 dark:text-slate-200';

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-3xl my-4 min-w-0">
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white break-words">
              Cari Hesap Ekstresi
            </h2>
            <p className="text-xs text-slate-500 break-words">{customer.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <label className="flex-1 min-w-0">
              <span className="text-[11px] font-semibold text-slate-500 block mb-1">Başlangıç</span>
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              />
            </label>
            <label className="flex-1 min-w-0">
              <span className="text-[11px] font-semibold text-slate-500 block mb-1">Bitiş</span>
              <input
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => setTo(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              />
            </label>
            <button
              type="button"
              onClick={() => load(from, to)}
              disabled={isLoading}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Getir
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {isLoading && !data && (
            <div className="p-8 text-center text-xs text-slate-400">Ekstre hazırlanıyor...</div>
          )}

          {statement && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {summary.map((s) => (
                  <div
                    key={s.label}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 min-w-0"
                  >
                    <div className="text-[10px] font-semibold text-slate-500 break-words">
                      {s.label}
                    </div>
                    <div
                      className={`font-mono font-bold text-xs tabular-nums break-words ${toneClass(
                        s.tone
                      )}`}
                    >
                      {money(s.value)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                  <Wallet className="w-4 h-4 text-sky-600" />
                  <span>Hesap Hareketleri ({entries.length})</span>
                </div>

                {entries.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    Seçilen tarih aralığında hesap hareketi bulunmuyor.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800">
                    {entries.map((entry) => (
                      <div key={entry.id} className="p-3 flex items-start gap-2.5 min-w-0">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                            entry.type === 'sale'
                              ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
                              : entry.type === 'payment'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                          }`}
                        >
                          {entry.type === 'sale' ? (
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          ) : entry.type === 'payment' ? (
                            <ArrowDownLeft className="w-3.5 h-3.5" />
                          ) : (
                            <AlertCircle className="w-3.5 h-3.5" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-slate-500">
                            {new Date(entry.timestamp).toLocaleString('tr-TR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                          <div className="text-xs font-semibold text-slate-900 dark:text-white break-words">
                            {entry.type === 'sale'
                              ? 'Satış'
                              : entry.type === 'payment'
                              ? 'Tahsilat'
                              : 'Düzeltme'}
                          </div>
                          <div className="text-[11px] text-slate-500 break-words">
                            {entry.description}
                            {entry.actor ? ` · ${entry.actor}` : ''}
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          <div
                            className={`font-mono font-bold text-xs tabular-nums ${
                              entry.balanceDelta >= 0
                                ? 'text-rose-600 dark:text-rose-300'
                                : 'text-emerald-600 dark:text-emerald-300'
                            }`}
                          >
                            {entry.balanceDelta >= 0 ? '+' : '−'}
                            {money(Math.abs(entry.balanceDelta))}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono tabular-nums">
                            {money(entry.balanceAfter)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* İade edilebilir kalemler — finansal bakiyeden BAĞIMSIZ (Bölüm 9). */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                  <Droplet className="w-4 h-4 text-cyan-600" />
                  <span>Müşteride Bulunan İade Edilebilir Kalemler</span>
                </div>
                <p className="text-[10px] text-slate-500">
                  Bu miktarlar parasal bakiyeden ayrıdır; depozito tutarı hesaplanmaz.
                </p>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className="px-2 py-1 rounded-lg bg-cyan-50 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-200 font-mono">
                    {Number(data?.returnables.emptyDepositBalance?.damacana) || 0} Boş Damacana
                  </span>
                  <span className="px-2 py-1 rounded-lg bg-cyan-50 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-200 font-mono">
                    {Number(
                      data?.returnables.emptyDepositBalance?.camDamacana ??
                        (data?.returnables.emptyDepositBalance as any)?.cam_damacana
                    ) || 0}{' '}
                    Boş Cam Damacana
                  </span>
                  <span className="px-2 py-1 rounded-lg bg-cyan-50 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-200 font-mono">
                    {Number(data?.returnables.emptyDepositBalance?.tup) || 0} Boş Tüp
                  </span>
                  {(data?.returnables.dispensers || []).map((d) => (
                    <span
                      key={d.id}
                      className="px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200 font-mono break-words"
                    >
                      {d.quantity} Sebil {d.brand ? `(${d.brand}${d.model ? ` ${d.model}` : ''})` : ''}
                    </span>
                  ))}
                </div>
              </div>

              <div className="text-[10px] text-slate-400">
                Aralık: {formatDateTr(statement.from)} – {formatDateTr(statement.to)}. Veriler
                saklama süresi (60 gün) içindeki kayıtlardan üretilir.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
