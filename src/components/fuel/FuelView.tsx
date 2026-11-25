import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { FuelEntry, User } from '../../types';
import { AUTHORIZED_VEHICLE_PLATES } from '../../types';
import {
  cancelFuelEntry,
  fetchFuelEntries,
  getAuthToken,
} from '../../services/api';
import {
  computeFuelBalance,
  computeLastMileage,
  buildFuelConsumptionSeries,
} from '../../services/fuelRules';
import { FUEL_POLL_INTERVAL_MS } from '../../services/polling';
import { AlertCircle, Fuel, Maximize2, Plus, RotateCw, X } from 'lucide-react';
import { FuelEntryCard } from './FuelEntryCard';
import { FuelEntryModal } from './FuelEntryModal';
import { FuelConsumptionChart } from './FuelConsumptionChart';

const literFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface FuelViewProps {
  currentUser: User;
}

export const FuelView: React.FC<FuelViewProps> = ({ currentUser }) => {
  const [entries, setEntries] = useState<FuelEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<'credit' | 'purchase' | null>(null);
  const [chartOpen, setChartOpen] = useState(false);

  const loadEntries = useCallback(async () => {
    try {
      const list = await fetchFuelEntries();
      setEntries(list);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Yakıt kayıtları alınamadı.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntries();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (!navigator.onLine) return;
      if (!getAuthToken()) return;
      void loadEntries();
    }, FUEL_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [loadEntries]);

  const balance = useMemo(() => computeFuelBalance(entries), [entries]);
  const series = useMemo(() => buildFuelConsumptionSeries(entries), [entries]);
  const lastMileages = useMemo(
    () =>
      Object.fromEntries(
        AUTHORIZED_VEHICLE_PLATES.map((plate) => [
          plate,
          computeLastMileage(entries, plate),
        ])
      ) as Record<string, number | null>,
    [entries]
  );
  const sortedEntries = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const createdDiff = b.createdAt.localeCompare(a.createdAt);
        return createdDiff !== 0
          ? createdDiff
          : b.entryDate.localeCompare(a.entryDate);
      }),
    [entries]
  );

  const closeChart = () => {
    setChartOpen(false);
    try {
      const orientation = (screen as any).orientation;
      orientation?.unlock?.();
    } catch {
      /* yön kilidi desteklenmiyorsa yoksay */
    }
  };

  const openChart = () => {
    setChartOpen(true);
    try {
      const orientation = (screen as any).orientation;
      orientation?.lock?.('landscape')?.catch?.(() => undefined);
    } catch {
      /* yön kilidi desteklenmiyorsa kullanıcı telefonu çevirir */
    }
  };

  const handleCancel = async (entry: FuelEntry) => {
    const label = entry.entryType === 'credit' ? 'Genel yakıt yüklemesini' : 'yakıt alımını';
    if (!window.confirm(`Bu ${label} kalıcı olarak silinecek. Devam edilsin mi?`)) {
      return;
    }
    try {
      await cancelFuelEntry(entry.id);
      await loadEntries();
    } catch (err: any) {
      setError(err?.message || 'Yakıt kaydı iptal edilemedi.');
    }
  };

  const canCancel = (entry: FuelEntry) =>
    currentUser.role === 'admin' ||
    (entry.entryType === 'purchase' && entry.createdByUserId === currentUser.id);

  return (
    <div className="space-y-4 w-full max-w-full min-w-0">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
        <div className="min-w-0">
          <h1 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Fuel className="w-5 h-5 text-amber-600 shrink-0" />
            <span>Yakıt Alımı</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Ortak mazot bakiyesi, araç yakıt alımları ve 100 km tüketim grafiği.
          </p>
        </div>

        <div className="rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 p-4">
          <div className="text-[11px] font-bold text-amber-700 uppercase tracking-wide">
            Bakiye Mazot Litresi
          </div>
          <div
            className={`text-3xl sm:text-4xl font-black font-mono tabular-nums mt-1 break-words ${
              balance < 0 ? 'text-rose-600' : 'text-slate-900'
            }`}
          >
            {literFmt.format(balance)} Litre
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          {currentUser.role === 'admin' && (
            <button
              type="button"
              onClick={() => setModalMode('credit')}
              className="w-full sm:w-auto min-h-11 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Genel Yakıt Yüklemesi
            </button>
          )}
          <button
            type="button"
            onClick={() => setModalMode('purchase')}
            className="w-full sm:w-auto min-h-11 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs flex items-center justify-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Yakıt Alımı
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-bold text-slate-900">Yakıt Kayıtları</h2>
        {isLoading && entries.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-500">
            Yakıt kayıtları yükleniyor...
          </div>
        ) : sortedEntries.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-500">
            Henüz yakıt kaydı yok.
          </div>
        ) : (
          sortedEntries.map((entry) => (
            <FuelEntryCard
              key={entry.id}
              entry={entry}
              canCancel={canCancel(entry)}
              onCancel={handleCancel}
            />
          ))
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900">
              100 km Ortalama Yakıt Tüketimi
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Tüm araçlar · L/100 km · Her araç sabit renkle gösterilir.
            </p>
          </div>
          <button
            type="button"
            onClick={openChart}
            className="self-start min-h-11 px-3.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-bold text-xs flex items-center gap-1.5"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            Yatay Görünüm
          </button>
        </div>
        <FuelConsumptionChart series={series} />
      </div>

      {modalMode && (
        <FuelEntryModal
          mode={modalMode}
          lastMileages={lastMileages}
          onClose={() => setModalMode(null)}
          onSaved={() => {
            setModalMode(null);
            void loadEntries();
          }}
        />
      )}

      {chartOpen && (
        <div className="fixed inset-0 z-[70] bg-white flex flex-col min-w-0">
          <div className="flex items-center justify-between gap-3 p-3 sm:p-4 border-b border-slate-200">
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <RotateCw className="w-4 h-4 text-slate-500" />
                <span>Yakıt Tüketimi · Yatay Görünüm</span>
              </h2>
              <p className="text-[11px] text-slate-500">
                Daha iyi görünüm için telefonu yan çevirin.
              </p>
            </div>
            <button
              type="button"
              onClick={closeChart}
              className="shrink-0 min-w-11 min-h-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center"
              aria-label="Kapat"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-2 sm:p-4 flex items-center">
            <div className="w-full min-w-[720px] sm:min-w-0">
              <FuelConsumptionChart series={series} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
