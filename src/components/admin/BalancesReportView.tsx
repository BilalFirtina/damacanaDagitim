import React, { useEffect, useMemo, useState } from 'react';
import { BalancesReportResponse, fetchBalancesReport } from '../../services/api';
import { AlertCircle, Search, Wallet, Droplet } from 'lucide-react';

const moneyFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: number): string {
  return `${moneyFmt.format(Number(value) || 0)} ₺`;
}

// AGENTS.md Bölüm 10.2 — Bekleyen müşteri borç raporu ve müşteri bazında
// iade edilebilir kalem bakiyeleri. İki bakiye türü AYRI gösterilir (Bölüm 9).
export const BalancesReportView: React.FC = () => {
  const [data, setData] = useState<BalancesReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'debts' | 'returnables'>('debts');

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchBalancesReport());
    } catch (err: any) {
      setError(err?.message || 'Bakiye raporu alınamadı.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(() => {
    const all = data?.rows || [];
    const filtered = all.filter((r) =>
      r.name.toLowerCase().includes(search.trim().toLowerCase())
    );
    if (mode === 'debts') return filtered.filter((r) => Math.abs(r.balance) > 0.005);
    return filtered.filter(
      (r) =>
        r.empty.damacana !== 0 ||
        r.empty.camDamacana !== 0 ||
        r.empty.tup !== 0 ||
        r.empty.sebil !== 0
    );
  }, [data, search, mode]);

  return (
    <div className="space-y-4 w-full max-w-full min-w-0">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Cari & İade Edilebilir Kalem Bakiyeleri
            </h2>
            <p className="text-xs text-slate-500">
              Parasal borç ile iade edilebilir kalem miktarları ayrı tutulur.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={isLoading}
            className="w-full sm:w-auto min-h-11 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
          >
            {isLoading ? 'Yükleniyor...' : 'Yenile'}
          </button>
        </div>

        {data && (
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 min-w-0">
              <div className="text-[10px] font-semibold text-slate-500">Toplam Borç</div>
              <div className="font-mono font-bold text-xs text-rose-600 dark:text-rose-300 tabular-nums break-words">
                {money(data.totals.totalDebt)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 min-w-0">
              <div className="text-[10px] font-semibold text-slate-500">Toplam Avans</div>
              <div className="font-mono font-bold text-xs text-emerald-600 dark:text-emerald-300 tabular-nums break-words">
                {money(data.totals.totalAdvance)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 min-w-0">
              <div className="text-[10px] font-semibold text-slate-500">Boş Damacana</div>
              <div className="font-mono font-bold text-xs text-cyan-700 dark:text-cyan-300 tabular-nums">
                {data.totals.emptyDamacana}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 min-w-0">
              <div className="text-[10px] font-semibold text-slate-500">Boş Cam Damacana</div>
              <div className="font-mono font-bold text-xs text-cyan-700 dark:text-cyan-300 tabular-nums">
                {data.totals.emptyCamDamacana}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 min-w-0">
              <div className="text-[10px] font-semibold text-slate-500">Boş Tüp</div>
              <div className="font-mono font-bold text-xs text-slate-700 dark:text-slate-200 tabular-nums">
                {data.totals.emptyTup}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 min-w-0">
              <div className="text-[10px] font-semibold text-slate-500">Müşteride Su Sebili</div>
              <div className="font-mono font-bold text-xs text-indigo-700 dark:text-indigo-300 tabular-nums">
                {data.totals.emptySebil}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setMode('debts')}
              className={`flex-1 sm:flex-none min-h-9 px-3 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
                mode === 'debts'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              Cari Borçlar
            </button>
            <button
              type="button"
              onClick={() => setMode('returnables')}
              className={`flex-1 sm:flex-none min-h-9 px-3 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
                mode === 'returnables'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Droplet className="w-3.5 h-3.5" />
              İade Edilebilir
            </button>
          </div>

          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Müşteri ara..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {isLoading && !data ? (
        <div className="p-10 text-center text-xs text-slate-400">Rapor hazırlanıyor...</div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center text-xs text-slate-400">
          {mode === 'debts'
            ? 'Bekleyen cari borcu olan müşteri bulunmuyor.'
            : 'Müşteride iade edilebilir kalem bulunmuyor.'}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 min-w-0"
            >
              <div className="flex items-start justify-between gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="font-bold text-sm text-slate-900 dark:text-white break-words">
                    {row.name}
                  </div>
                  <div className="text-[11px] text-slate-500 break-words">
                    {row.phone || 'Telefon yok'}
                    {row.isAccountCustomer ? ' · Cari Hesap' : ' · Peşin Müşteri'}
                  </div>
                </div>

                {mode === 'debts' && (
                  <div className="shrink-0 text-right">
                    <div
                      className={`font-mono font-bold text-sm tabular-nums ${
                        row.balance > 0
                          ? 'text-rose-600 dark:text-rose-300'
                          : 'text-emerald-600 dark:text-emerald-300'
                      }`}
                    >
                      {money(row.balance)}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {row.balance > 0 ? 'Borçlu' : 'Avanslı'}
                    </div>
                  </div>
                )}
              </div>

              {mode === 'returnables' && (
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  {row.empty.damacana !== 0 && (
                    <span className="px-2 py-1 rounded-lg bg-cyan-50 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-200 font-mono">
                      {row.empty.damacana} Boş Damacana
                    </span>
                  )}
                  {row.empty.camDamacana !== 0 && (
                    <span className="px-2 py-1 rounded-lg bg-cyan-50 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-200 font-mono">
                      {row.empty.camDamacana} Boş Cam Damacana
                    </span>
                  )}
                  {row.empty.tup !== 0 && (
                    <span className="px-2 py-1 rounded-lg bg-cyan-50 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-200 font-mono">
                      {row.empty.tup} Boş Tüp
                    </span>
                  )}
                  {row.empty.sebil !== 0 && (
                    <span className="px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200 font-mono">
                      {row.empty.sebil} Su Sebili
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
