import React, { useState } from 'react';
import { Customer } from '../../types';
import { CustomerPaymentModal } from '../admin/CustomerPaymentModal';
import { Building2, Search, Wallet, X } from 'lucide-react';

interface DriverPaymentModalProps {
  customers: Customer[];
  dispatchId: string;
  onClose: () => void;
  onSaved: (customerId: string, newBalance: number | null) => void;
}

const moneyFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// AGENTS.md 6 ve 6.1 — Şoförün ürün vermeden (teslimat dışı) tahsilat yapması.
// Peşin müşteride bakiye görünür; faturalı müşteride bakiye gizlenir.
export const DriverPaymentModal: React.FC<DriverPaymentModalProps> = ({
  customers,
  dispatchId,
  onClose,
  onSaved,
}) => {
  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  if (selectedCustomer) {
    return (
      <CustomerPaymentModal
        customer={selectedCustomer}
        hideBalance={selectedCustomer.isAccountCustomer}
        dispatchId={dispatchId}
        onClose={onClose}
        onSaved={(newBalance) => {
          if (newBalance !== null) {
            setSelectedCustomer((prev) =>
              prev ? { ...prev, currentBalanceTL: newBalance } : prev
            );
          }
          onSaved(selectedCustomer.id, newBalance);
        }}
      />
    );
  }

  const needle = search.trim().toLocaleLowerCase('tr-TR');
  const filtered = customers
    .filter((c) => {
      if (!needle) return true;
      return (
        c.name.toLocaleLowerCase('tr-TR').includes(needle) ||
        (c.phone || '').toLocaleLowerCase('tr-TR').includes(needle)
      );
    })
    .sort((a, b) => {
      const debtA = !a.isAccountCustomer ? Math.max(Number(a.currentBalanceTL) || 0, 0) : 0;
      const debtB = !b.isAccountCustomer ? Math.max(Number(b.currentBalanceTL) || 0, 0) : 0;
      return debtB - debtA || a.name.localeCompare(b.name, 'tr');
    });

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white  rounded-2xl border border-slate-200  shadow-2xl w-full max-w-md my-4 min-w-0">
        <div className="p-4 sm:p-5 border-b border-slate-100  flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900  flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Tahsilat Al</span>
            </h2>
            <p className="text-xs text-slate-500 break-words">
              Ürün teslim etmeden müşteriden tahsilat kaydedin.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-2 rounded-xl hover:bg-slate-100  text-slate-500"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Müşteri adı veya telefon ara..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200  bg-slate-50  text-xs text-slate-900 "
            />
          </div>

          <div className="max-h-[55vh] overflow-y-auto divide-y divide-slate-100  border border-slate-100  rounded-xl">
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                Aramaya uygun müşteri bulunamadı.
              </div>
            ) : (
              filtered.map((customer) => {
                const balance = Number(customer.currentBalanceTL) || 0;
                const hasCashDebt = !customer.isAccountCustomer && balance > 0;
                return (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => setSelectedCustomer(customer)}
                    className="w-full text-left p-3 hover:bg-slate-50  transition-colors flex items-start justify-between gap-3 min-w-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-1.5 min-w-0">
                        <Building2 className="w-3.5 h-3.5 text-sky-600 shrink-0 mt-0.5" />
                        <div className="flex flex-col items-start gap-1 min-w-0">
                          <span className="text-xs font-bold text-slate-900 break-words">
                            {customer.name}
                          </span>
                          {customer.isAccountCustomer && (
                            <span className="text-[10px] font-semibold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">
                              Faturalı
                            </span>
                          )}
                        </div>
                      </div>
                      {customer.phone && (
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {customer.phone}
                        </div>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      {customer.isAccountCustomer ? (
                        <span className="text-[10px] text-slate-400">
                          Bakiye yöneticide
                        </span>
                      ) : (
                        <span
                          className={`text-[11px] font-mono font-bold ${
                            hasCashDebt
                              ? 'text-rose-600 '
                              : balance < 0
                                ? 'text-emerald-600 '
                                : 'text-slate-500'
                          }`}
                        >
                          {hasCashDebt
                            ? `${moneyFmt.format(balance)} ₺ Borç`
                            : balance < 0
                              ? `${moneyFmt.format(Math.abs(balance))} ₺ Avans`
                              : 'Borç yok'}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
