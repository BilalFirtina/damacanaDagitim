import React, { useState } from 'react';
import { Customer } from '../../types';
import { AuditHistoryView } from './AuditHistoryView';
import { DeliveryCorrectionsView } from './DeliveryCorrectionsView';

type AuditView = 'all' | 'corrections';

const VIEW_OPTIONS: Array<[AuditView, string]> = [
  ['all', 'Tüm Kayıtlar'],
  ['corrections', 'Teslimat Düzeltmeleri'],
];

// Denetim kayıtları: işlem geçmişi ve teslimat iptal/düzenleme kayıtları tek sekmede.
// Her iki görünüm de salt okunurdur.
export const AuditLogView: React.FC<{ customers?: Customer[] }> = ({ customers = [] }) => {
  const [view, setView] = useState<AuditView>('all');

  return (
    <div className="space-y-4 w-full max-w-full min-w-0">
      <div className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1 gap-1 w-full sm:w-auto">
        {VIEW_OPTIONS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            aria-pressed={view === key}
            className={`flex-1 sm:flex-none min-h-11 px-3 rounded-lg text-xs font-bold transition-colors ${
              view === key ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'all' ? (
        <AuditHistoryView />
      ) : (
        <DeliveryCorrectionsView customers={customers} />
      )}
    </div>
  );
};
