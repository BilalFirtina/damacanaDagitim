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
import { formatDateTimeTr } from '../../services/dateWindow';
import type { Customer } from '../../types';

interface DeliveryCorrectionsViewProps {
  customers?: Customer[];
}

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


function nonZeroEmpty(values: Record<string, number>): Array<[string, number]> {
  return Object.entries(values || {}).filter(([, qty]) => Number(qty) !== 0);
}

export const DeliveryCorrectionsView: React.FC<DeliveryCorrectionsViewProps> = ({
  customers = [],
}) => {
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

  const customerOf = (customerId: string) =>
    customers.find((customer) => customer.id === customerId);
  const customerNameOf = (customerId: string) =>
    customerOf(customerId)?.name || 'Müşteri kaydı bulunamadı';
  const isAccountOf = (customerId: string) =>
    customerOf(customerId)?.isAccountCustomer === true;

  return (
    <div className="space-y-4 w-full max-w-full min-w-0">
      <div className="bg-white  rounded-2xl border border-slate-200  p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900  flex items-center gap-2">
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
            className="min-h-11 px-4 py-2.5 rounded-xl border border-slate-200  bg-white  text-slate-700  text-xs font-bold hover:bg-slate-50  disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            Yenile
          </button>
        </div>

        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50  text-emerald-700  font-semibold w-fit">
            <ShieldCheck className="w-3.5 h-3.5" />
            Salt okunur denetim kaydı
          </span>
          <span className="text-slate-500">
            {corrections.length} kayıt
            {lastUpdated
              ? ` · Son güncelleme: ${formatDateTimeTr(lastUpdated)}`
              : ''}
          </span>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200  bg-rose-50  p-4 text-sm font-semibold text-rose-700  flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {loading && corrections.length === 0 ? (
        <div className="bg-white  rounded-2xl border border-slate-200  p-10 text-center text-xs text-slate-500">
          Kayıtlar yükleniyor...
        </div>
      ) : corrections.length === 0 ? (
        <div className="bg-white  rounded-2xl border border-slate-200  p-10 text-center text-xs text-slate-500 space-y-2">
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
                className="bg-white  rounded-2xl border border-slate-200  p-4 shadow-xs min-w-0"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ${
                          isReplace
                            ? 'bg-sky-100 text-sky-800  '
                            : 'bg-rose-100 text-rose-800  '
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
                        {formatDateTimeTr(item.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-800  mt-1.5 break-words">
                      Müşteri: {customerNameOf(item.customerId)}
                    </p>
                    <p className="text-[11px] text-slate-500 break-words">
                      İşlemi yapan: {item.performedByUserName || item.performedByUserId}
                    </p>
                  </div>

                  <div className="text-left sm:text-right shrink-0">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                      Teslimat
                    </p>
                    <p className="text-[11px] font-mono text-slate-600  break-all">
                      {item.deliveryId}
                    </p>
                  </div>
                </div>

                <div className="mt-3 rounded-xl bg-slate-50  p-3 space-y-2">
                  <p className="text-xs text-slate-700  break-words">
                    <span className="font-bold">Gerekçe:</span> {item.reason}
                  </p>

                  {isAccountOf(item.customerId) ? (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-slate-500">Cari bakiye:</span>
                      <span className="font-mono font-semibold">FATURALI</span>
                    </div>
                  ) : (
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
                      <span className="text-rose-600  font-semibold">
                        (ters: {formatMoney(item.reversedBalance)})
                      </span>
                    )}
                  </div>
                  )}

                  {reversedEmpty.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-slate-500">
                        Geri alınan boş kap:
                      </span>
                      {reversedEmpty.map(([type, qty]) => (
                        <span
                          key={type}
                          className="px-2 py-0.5 rounded bg-orange-100 text-orange-800   font-semibold"
                        >
                          {EMPTY_LABELS[type] || type} - {Number(qty)}
                        </span>
                      ))}
                    </div>
                  )}

                  {isReplace && item.replacementDeliveryId && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-slate-500">Yeni teslimat:</span>
                      <span className="font-mono font-semibold text-sky-700  break-all">
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
