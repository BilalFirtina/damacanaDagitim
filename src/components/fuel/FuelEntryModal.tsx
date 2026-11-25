import React, { useRef, useState } from 'react';
import { AUTHORIZED_VEHICLE_PLATES } from '../../types';
import { todayUtcDateStr } from '../../services/dateWindow';
import { createFuelCredit, createFuelPurchase } from '../../services/api';
import { AlertCircle, Fuel, X } from 'lucide-react';

interface FuelEntryModalProps {
  mode: 'credit' | 'purchase';
  lastMileages: Record<string, number | null>;
  onClose: () => void;
  onSaved: () => void;
}

const newEntryId = () =>
  `fuel_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

const parseDecimal = (value: string): number => {
  const normalized = value.trim().replace(',', '.');
  return normalized ? Number(normalized) : NaN;
};

export const FuelEntryModal: React.FC<FuelEntryModalProps> = ({
  mode,
  lastMileages,
  onClose,
  onSaved,
}) => {
  const today = todayUtcDateStr();
  const isCredit = mode === 'credit';
  const [entryId] = useState(newEntryId);
  const [date, setDate] = useState(today);
  const [plate, setPlate] = useState<string>(AUTHORIZED_VEHICLE_PLATES[0]);
  const [mileage, setMileage] = useState('');
  const [liters, setLiters] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitRef = useRef(false);

  const lastMileage = lastMileages[plate] ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitRef.current) return;
    setError(null);

    if (!date || date > today) {
      setError('Geçerli bir tarih girin. Gelecek tarih seçilemez.');
      return;
    }
    const litersValue = parseDecimal(liters);
    if (!Number.isFinite(litersValue) || litersValue <= 0) {
      setError('Litre sıfırdan büyük olmalıdır.');
      return;
    }

    const amountValue = parseDecimal(amount);
    if (!isCredit && (!Number.isFinite(amountValue) || amountValue <= 0)) {
      setError('Tutar sıfırdan büyük olmalıdır.');
      return;
    }
    if (isCredit && amount.trim() && (!Number.isFinite(amountValue) || amountValue <= 0)) {
      setError('Tutar sıfırdan büyük olmalıdır.');
      return;
    }

    let mileageValue: number | null = null;
    if (!isCredit) {
      mileageValue = Number(mileage);
      if (!Number.isInteger(mileageValue) || mileageValue <= 0) {
        setError('Kilometre pozitif tam sayı olmalıdır.');
        return;
      }
      if (lastMileage !== null && mileageValue <= lastMileage) {
        setError(
          `Kilometre son kayıttan büyük olmalıdır. Son kayıt: ${lastMileage.toLocaleString('tr-TR')} km.`
        );
        return;
      }
    }

    submitRef.current = true;
    setIsSubmitting(true);
    try {
      if (isCredit) {
        await createFuelCredit({
          id: entryId,
          date,
          liters: Math.round(litersValue * 100) / 100,
          amountTl: amount.trim() ? Math.round(amountValue * 100) / 100 : null,
          note: note.trim() || null,
        });
      } else {
        await createFuelPurchase({
          id: entryId,
          plate,
          date,
          liters: Math.round(litersValue * 100) / 100,
          amountTl: Math.round(amountValue * 100) / 100,
          mileageKm: mileageValue!,
          note: note.trim() || null,
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Yakıt kaydı oluşturulamadı.');
    } finally {
      submitRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md max-h-[92dvh] sm:my-4 flex flex-col min-w-0">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Fuel className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{isCredit ? 'Genel Yakıt Yüklemesi' : 'Araç Yakıt Alımı'}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 break-words">
              {isCredit
                ? 'Ortak mazot bakiyesine litre ekler.'
                : 'Araç yakıt alımını kilometre ve tutarla kaydeder.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="shrink-0 min-w-11 min-h-11 rounded-xl hover:bg-slate-100 text-slate-500 flex items-center justify-center"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {!isCredit && (
            <label className="block min-w-0">
              <span className="text-[11px] font-semibold text-slate-500 block mb-1">
                Plaka
              </span>
              <select
                value={plate}
                onChange={(e) => {
                  setPlate(e.target.value);
                  setMileage('');
                }}
                className="w-full min-h-11 p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900"
              >
                {AUTHORIZED_VEHICLE_PLATES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">Tarih</span>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className="w-full min-h-11 p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900"
            />
          </label>

          {!isCredit && (
            <label className="block min-w-0">
              <span className="text-[11px] font-semibold text-slate-500 block mb-1">
                Kilometre (KM)
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={mileage}
                onChange={(e) => setMileage(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="Örn: 125400"
                className="w-full min-h-11 p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-lg font-mono text-slate-900"
              />
              {lastMileage !== null && (
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Son kayıt: {lastMileage.toLocaleString('tr-TR')} km
                </span>
              )}
            </label>
          )}

          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">
              Litre
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={liters}
              onChange={(e) => setLiters(e.target.value)}
              placeholder="0,00"
              className="w-full min-h-11 p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-lg font-mono text-slate-900"
            />
          </label>

          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">
              Tutar (₺){isCredit ? ' (isteğe bağlı)' : ''}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              className="w-full min-h-11 p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-lg font-mono text-slate-900"
            />
            <span className="text-[10px] text-slate-400 mt-1 block">
              Tutar yalnızca bilgi olarak saklanır; bakiyeye etki etmez.
            </span>
          </label>

          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">Not</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              placeholder="İsteğe bağlı"
              className="w-full min-h-11 p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900"
            />
          </label>

          <div className="sticky bottom-0 -mx-4 sm:-mx-5 px-3 sm:px-4 py-3 border-t border-slate-200 flex gap-2 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="w-1/2 min-h-12 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs disabled:opacity-40"
            >
              Vazgeç
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-1/2 min-h-12 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-60 font-bold text-xs"
            >
              {isSubmitting ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
