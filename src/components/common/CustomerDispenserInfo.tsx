import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Droplet } from 'lucide-react';
import { fetchCustomerDispensers } from '../../services/api';
import { CustomerDispenser } from '../../types';

interface CustomerDispenserInfoProps {
  customerId: string;
  className?: string;
}

// AGENTS.md Bölüm 7.1 — Emanet sebil detayları (marka, model, açıklama).
// Raporlarda yalnızca adet gösterilir; bu bilgiler yalnızca istendiğinde,
// şoförün müşteriye ait emanet sebil kayıtlarını görmesi için açılır.
export const CustomerDispenserInfo: React.FC<CustomerDispenserInfoProps> = ({
  customerId,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [dispensers, setDispensers] = useState<CustomerDispenser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    setIsOpen(true);
    if (dispensers !== null) return;

    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchCustomerDispensers(customerId);
      setDispensers(result.dispensers || []);
    } catch (err: any) {
      setError(err?.message || 'Emanet sebil bilgileri alınamadı.');
      setDispensers([]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`w-full max-w-full min-w-0 ${className}`}>
      <button
        type="button"
        onClick={toggle}
        className="w-full min-h-11 px-3 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/20 text-indigo-800 dark:text-indigo-200 text-xs font-semibold flex items-center justify-between gap-2"
        aria-expanded={isOpen}
      >
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <Droplet className="w-3.5 h-3.5 shrink-0" />
          <span className="break-words">Emanet Sebil Bilgileri</span>
        </span>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 shrink-0" />
        )}
      </button>

      {isOpen && (
        <div className="mt-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 p-3 space-y-2">
          {isLoading && (
            <div className="text-[11px] text-slate-500">Sebil bilgileri yükleniyor...</div>
          )}
          {error && <div className="text-[11px] text-rose-600 break-words">{error}</div>}
          {!isLoading && !error && dispensers !== null && dispensers.length === 0 && (
            <div className="text-[11px] text-slate-500">
              Bu müşteri için kayıtlı sebil detayı yok.
            </div>
          )}
          {(dispensers || []).map((d) => (
            <div
              key={d.id}
              className="text-[11px] text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 last:border-0 pb-2 last:pb-0 min-w-0"
            >
              <div className="font-semibold break-words">
                {d.quantity} adet
                {[d.brand, d.model].filter(Boolean).length > 0
                  ? ` · ${[d.brand, d.model].filter(Boolean).join(' ')}`
                  : ''}
              </div>
              {d.note && (
                <div className="text-slate-500 break-words mt-0.5">{d.note}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
