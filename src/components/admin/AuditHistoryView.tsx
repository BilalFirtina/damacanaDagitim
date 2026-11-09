import React, { useEffect, useMemo, useState } from 'react';
import { AuditHistoryEvent, fetchAuditHistory } from '../../services/api';
import {
  AlertCircle,
  History,
  RefreshCw,
  Truck,
  XCircle,
} from 'lucide-react';

type FilterKind = 'all' | AuditHistoryEvent['kind'];

const kindMeta: Record<
  AuditHistoryEvent['kind'],
  { label: string; icon: React.ReactNode; tone: string }
> = {
  delivery_correction: {
    label: 'Teslimat',
    icon: <XCircle className="w-4 h-4" />,
    tone: 'bg-amber-100 text-amber-800  ',
  },
  dispatch_cancellation: {
    label: 'İptal',
    icon: <XCircle className="w-4 h-4" />,
    tone: 'bg-rose-100 text-rose-800  ',
  },
  dispatch_loading: {
    label: 'Yükleme',
    icon: <Truck className="w-4 h-4" />,
    tone: 'bg-indigo-100 text-indigo-800  ',
  },
};

// AGENTS.md Bölüm 10.2 — Stok/işlem geçmişi raporu.
// Teslimat iptal/düzeltme, yükleme düzeltme ve yükleme iptallerini tek,
// kronolojik listede birleştirir. Kayıtlar silinemez.
export const AuditHistoryView: React.FC = () => {
  const [events, setEvents] = useState<AuditHistoryEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKind>('all');

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setEvents(await fetchAuditHistory(150));
    } catch (err: any) {
      setError(err?.message || 'İşlem geçmişi alınamadı.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () => (filter === 'all' ? events : events.filter((e) => e.kind === filter)),
    [events, filter]
  );

  return (
    <div className="space-y-4 w-full max-w-full min-w-0">
      <div className="bg-white  rounded-2xl border border-slate-200  p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900  flex items-center gap-2">
              <History className="w-4 h-4 text-indigo-600 shrink-0" />
              <span className="break-words">İşlem Geçmişi</span>
            </h2>
            <p className="text-xs text-slate-500">
              Teslimat iptal/düzeltme, yükleme düzeltme ve yükleme iptalleri. Kayıtlar
              değiştirilemez ve silinemez.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={isLoading}
            className="shrink-0 p-2 rounded-xl border border-slate-200  text-slate-600  hover:bg-slate-50  disabled:opacity-60"
            aria-label="Yenile"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="inline-flex flex-wrap rounded-xl bg-slate-100  p-1 gap-1 w-full sm:w-auto">
          {(
            [
              ['all', 'Tümü'],
              ['delivery_correction', 'Teslimat'],
              ['dispatch_cancellation', 'İptal'],
              ['dispatch_loading', 'Yükleme'],
            ] as Array<[FilterKind, string]>
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              onClick={() => setFilter(kind)}
              className={`flex-1 sm:flex-none min-h-9 px-3 rounded-lg text-xs font-bold transition-colors ${
                filter === kind
                  ? 'bg-white  text-slate-900  shadow-xs'
                  : 'text-slate-600 '
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50  border border-rose-200  text-rose-800  text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {isLoading && events.length === 0 ? (
        <div className="p-10 text-center text-xs text-slate-400">İşlem geçmişi yükleniyor...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white  rounded-2xl border border-slate-200  p-10 text-center text-xs text-slate-400">
          Kayıtlı işlem bulunmuyor.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((event) => {
            const meta = kindMeta[event.kind];
            return (
              <div
                key={event.id}
                className="bg-white  rounded-2xl border border-slate-200  p-3.5 min-w-0"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <span
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${meta.tone}`}
                  >
                    {meta.icon}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-900  break-words">
                        {event.title}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100  text-slate-600 ">
                        {meta.label}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500 break-words mt-0.5">
                      {new Date(event.at).toLocaleString('tr-TR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' · '}
                      {event.by || 'Bilinmeyen kullanıcı'}
                      {' · Sefer: '}
                      <span className="font-mono">{event.dispatchId}</span>
                    </div>

                    {event.reason && (
                      <div className="text-xs text-slate-700  break-words mt-1">
                        Gerekçe: {event.reason}
                      </div>
                    )}
                    <div className="text-[11px] text-slate-500 break-words mt-0.5">
                      {event.detail}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
