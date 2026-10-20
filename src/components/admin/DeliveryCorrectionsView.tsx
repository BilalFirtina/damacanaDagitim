import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Ban,
  Edit2,
  History,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  fetchDeliveryCorrections,
  DeliveryCorrectionAudit,
} from '../../services/api';

const EMPTY_LABELS: Record<string, string> = {
  damacana: 'Damacana',
  cam_damacana: 'Cam Damacana',
  camDamacana: 'Cam Damacana',
  tup: 'Tüp',
};

function formatMoney(value: number): string {
  return `${Number(value || 0).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₺`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function nonZeroEmpty(values: Record<string, number>): Array<[string, number]> {
  return Object.entries(values || {}).filter(([, qty]) => Number(qty) !== 0);
}

export const DeliveryCorrectionsView: React.FC = () => {
  const [corrections, setCorrections] = useState<DeliveryCorrectionAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const loadCorrections = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchDeliveryCorrections(100);
      setCorrections(data);
      setLastUpdated(new Date().toISOString());
    } catch (err: any) {
      setError(err.message || 'Teslimat düzeltme kayıtları yüklenemedi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCorrections();
  }, []);

  return (
    <div className="space-y-4 w-full max-w-full min-w-0">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <History className="w-4 h-4 text-sky-600 shrink-0" />
              <span className="break-words">
                Teslimat İptal ve Düzenleme Kayıtları
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Şoförlerin yaptığı iptal/düzenleme işlemleri ve geri alınan cari
              bakiye ile boş kap miktarları
            </p>
          </div>

          <button
            type="button"
            onClick={loadCorrections}
            disabled={loading}
            className="min-h-11 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            Yenile
          </button>
        </div>

        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 font-semibold w-fit">
            <ShieldCheck className="w-3.5 h-3.5" />
            Salt okunur denetim kaydı
          </span>
          <span className="text-slate-500">
            {corrections.length} kayıt
            {lastUpdated
              ? ` · Son güncelleme: ${formatDate(lastUpdated)}`
              : ''}
          </span>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-4 text-sm font-semibold text-rose-700 dark:text-rose-300 flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {loading && corrections.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center text-xs text-slate-500">
          Kayıtlar yükleniyor...
        </div>
      ) : corrections.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center text-xs text-slate-500 space-y-2">
          <History className="w-8 h-8 text-slate-300 mx-auto" />
          <p>Henüz teslimat iptal veya düzenleme kaydı bulunmuyor.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {corrections.map((item) => {
            const isReplace = item.action === 'replace';
            const reversedEmpty = nonZeroEmpty(item.reversedEmpty);
            const balanceChanged =
              Number(item.previousBalance) !== Number(item.newBalance);

            return (
              <article
                key={item.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs min-w-0"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ${
                          isReplace
                            ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                        }`}
                      >
                        {isReplace ? (
                          <Edit2 className="w-3 h-3" />
                        ) : (
                          <Ban className="w-3 h-3" />
                        )}
                        {isReplace ? 'Düzenleme' : 'İptal'}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {formatDate(item.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1.5 break-words">
                      Müşteri: {item.customerId}
                    </p>
                    <p className="text-[11px] text-slate-500 break-words">
                      İşlemi yapan: {item.performedByUserName || item.performedByUserId}
                    </p>
                  </div>

                  <div className="text-left sm:text-right shrink-0">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                      Teslimat
                    </p>
                    <p className="text-[11px] font-mono text-slate-600 dark:text-slate-300 break-all">
                      {item.deliveryId}
                    </p>
                  </div>
                </div>

                <div className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 space-y-2">
                  <p className="text-xs text-slate-700 dark:text-slate-300 break-words">
                    <span className="font-bold">Gerekçe:</span> {item.reason}
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="text-slate-500">Cari bakiye:</span>
                    <span className="font-mono font-semibold">
                      {formatMoney(item.previousBalance)}
                    </span>
                    <ArrowRight className="w-3 h-3 text-slate-400" />
                    <span className="font-mono font-bold">
                      {formatMoney(item.newBalance)}
                    </span>
                    {balanceChanged && (
                      <span className="text-rose-600 dark:text-rose-300 font-semibold">
                        (ters: {formatMoney(item.reversedBalance)})
                      </span>
                    )}
                  </div>

                  {reversedEmpty.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-slate-500">
                        Geri alınan boş kap:
                      </span>
                      {reversedEmpty.map(([type, qty]) => (
                        <span
                          key={type}
                          className="px-2 py-0.5 rounded bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 font-semibold"
                        >
                          {EMPTY_LABELS[type] || type}: {Number(qty)}
                        </span>
                      ))}
                    </div>
                  )}

                  {isReplace && item.replacementDeliveryId && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-slate-500">Yeni teslimat:</span>
                      <span className="font-mono font-semibold text-sky-700 dark:text-sky-300 break-all">
                        {item.replacementDeliveryId}
                      </span>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
